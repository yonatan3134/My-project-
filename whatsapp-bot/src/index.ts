import fs from "node:fs/promises";
import path from "node:path";
import type { WAMessage } from "baileys";
import { loadConfig } from "./config.js";
import { refillChannel, type GenContext } from "./content/generator.js";
import { ClaudeLLM, FakeLLM, type LLM } from "./content/llm.js";
import { Control } from "./control.js";
import { Store } from "./db.js";
import { logger } from "./logger.js";
import { DefaultMedia } from "./media/maker.js";
import { ffmpegAvailable } from "./media/video.js";
import { DB_PATH, TMP_DIR, ensureDirs } from "./paths.js";
import { Scheduler, postingChannels } from "./scheduler.js";
import { HOUR, MINUTE, dayKey } from "./time.js";
import { recentPostTexts, resolveChannels } from "./wa/channels.js";
import { WaClient } from "./wa/client.js";
import { DryRunSender, WaSender, type Sender } from "./wa/sender.js";

/** Exit code that tells systemd not to restart: a person has to link the account again first. */
const EXIT_NEEDS_LINK = 78;

async function main(): Promise<void> {
  ensureDirs();
  const config = loadConfig();
  const { settings, env } = config;
  const store = new Store(DB_PATH);
  const now = () => Date.now();

  const interrupted = store.recoverInterrupted(now());
  if (interrupted > 0) {
    store.event(now(), "warn", "interrupted", `${interrupted} post(s) were mid-send when the bot stopped; they will not be sent again`);
  }

  if (!env.fakeLlm && !env.hasAnthropicKey) {
    logger.error("ANTHROPIC_API_KEY is missing. Put it in the .env file (see .env.example).");
    process.exit(1);
  }
  const llm: LLM = env.fakeLlm
    ? new FakeLLM()
    : new ClaudeLLM(settings, (u) => store.addUsage(dayKey(now(), settings.timezone), u.inputTokens, u.outputTokens));

  const videoAvailable = await ffmpegAvailable();
  if (!videoAvailable) logger.warn("ffmpeg was not found: video posts will be sent as pictures");

  let client: WaClient | null = null;
  let sender: Sender;
  let direct: (jid: string, text: string) => Promise<boolean> = async () => false;

  if (env.dryRun) {
    logger.warn("DRY_RUN=1: nothing is sent to WhatsApp");
    sender = new DryRunSender({ saveMedia: true });
    for (const c of config.channels) {
      if (!store.channel(c.id).jid) store.updateChannel(c.id, { jid: `dry-${c.id}@newsletter`, role: "ADMIN", resolved_at: now() });
    }
  } else {
    client = new WaClient({ allowLinking: false, pairingPhone: null });
    const wa = new WaSender(client, store);
    sender = wa;
    direct = (jid, text) => wa.direct(jid, text);
  }

  const scheduler = new Scheduler({
    store,
    config,
    sender,
    media: new DefaultMedia(env.pexelsKey, (m) => store.event(now(), "info", "media_note", m)),
    now,
    isConnected: () => (client ? client.isOpen : true),
  });

  const control = new Control({
    store,
    config,
    scheduler,
    now,
    direct,
    connection: () => (client ? (client.isOpen ? "מחובר ✅" : `לא מחובר (${client.status})`) : "מצב בדיקה (DRY_RUN)"),
  });

  // ---- WhatsApp events ------------------------------------------------------

  async function syncChannels(maxAgeMs: number): Promise<void> {
    const sock = client?.sock;
    if (!client?.isOpen || !sock) return;
    const reports = await resolveChannels(sock, store, config.channels, now(), { maxAgeMs });
    const bad = reports.filter((r) => r.status !== "ok");
    logger.info({ ok: reports.length - bad.length, problems: bad.length }, "channels checked");
    if (bad.length > 0) {
      await control.alert("channels", `הבוט לא יכול לפרסם ב-${bad.length} ערוצים: ${bad.map((b) => `${b.id} (${b.status})`).join(", ")}`, 24 * HOUR);
    }
    // learn each channel's tone from its existing posts, once
    for (const c of postingChannels(config.channels)) {
      const state = store.channel(c.id);
      if (!client?.isOpen || !state.jid || store.styleSamples(c.id, 1).length > 0 || store.get(`style_tried:${c.id}`)) continue;
      store.set(`style_tried:${c.id}`, "1");
      try {
        const texts = await recentPostTexts(sock, state.jid, 30);
        if (texts.length > 0) store.setStyleSamples(c.id, texts.slice(0, 12), now());
      } catch (err) {
        store.event(now(), "info", "style_fetch_failed", (err as Error).message, c.id);
      }
    }
  }

  if (client) {
    client.on("open", () => {
      void syncChannels(12 * HOUR).catch((err: Error) => logger.error({ err: err.message }, "channel sync failed"));
    });
    client.on("message", (m: WAMessage) => {
      void control.handleMessage(m).catch((err: Error) => logger.error({ err: err.message }, "command failed"));
    });
    client.on("logged_out", (reason: string) => {
      void (async () => {
        store.event(now(), "error", "logged_out", reason);
        await control.alert("logged_out", `הבוט התנתק מוואטסאפ וצריך לחבר אותו מחדש (${reason}). בשרת: npm run link ואז systemctl start whatsapp-bot`, HOUR);
        store.close();
        process.exit(EXIT_NEEDS_LINK);
      })();
    });
    await client.start();
  }

  // ---- loops ----------------------------------------------------------------

  const gen: GenContext = { store, llm, settings, videoAvailable };
  let refilling = false;

  async function refillAll(): Promise<void> {
    if (refilling || scheduler.isPaused()) return;
    if ((store.getNumber("llm_pause_until") ?? 0) > now()) return;
    refilling = true;
    try {
      for (const channel of scheduler.activeChannels(now())) {
        const res = await refillChannel(gen, channel, now());
        if (res.queued > 0) logger.info({ channel: channel.id, queued: res.queued, dropped: res.rejected.length }, "queue refilled");
        const err = res.llmError;
        if (!err) continue;
        if (err.kind === "auth" || err.kind === "bad_request") {
          await control.alert("llm_config", `בעיה מול שירות ה-AI: ${err.message}. בדוק את המפתח ב-.env ואת היתרה בחשבון.`);
        }
        if (["auth", "rate_limit", "network", "server", "bad_request"].includes(err.kind)) {
          // a problem with the service, not with one channel: stop asking until it has had time to clear
          store.set("llm_pause_until", String(now() + err.retryAfterMs));
          break;
        }
      }
    } finally {
      refilling = false;
    }
  }

  async function housekeeping(): Promise<void> {
    store.prune(now(), settings.dedup.lookback * 2);
    store.expireStaleNews(now(), 36 * HOUR);
    await syncChannels(24 * HOUR);
    const files = await fs.readdir(TMP_DIR).catch(() => [] as string[]);
    for (const f of files) {
      const p = path.join(TMP_DIR, f);
      const st = await fs.stat(p).catch(() => null);
      if (st && now() - st.mtimeMs > HOUR) await fs.rm(p, { force: true });
    }
  }

  const guard = (name: string, fn: () => Promise<unknown>) => () => {
    fn().catch((err: Error) => {
      logger.error({ err: err.message, loop: name }, "loop error");
      store.event(now(), "error", `${name}_error`, err.message);
    });
  };

  const startedAt = now();
  const timers = [
    setInterval(guard("tick", () => scheduler.tick()), 15_000),
    setInterval(guard("refill", refillAll), 90_000),
    setInterval(guard("housekeeping", housekeeping), HOUR),
    setInterval(
      guard("watch", async () => {
        await control.maybeDailyReport();
        if (client && !client.isOpen && client.status !== "logged_out" && now() - Math.max(client.lastOpenAt, startedAt) > 10 * MINUTE) {
          await control.alert("disconnected", "הבוט לא מצליח להתחבר לוואטסאפ כבר יותר מ-10 דקות. הוא ממשיך לנסות.", HOUR);
        }
      }),
      MINUTE,
    ),
  ];
  guard("refill", refillAll)();

  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    for (const t of timers) clearInterval(t);
    void (async () => {
      if (client) await client.stop();
      store.close();
      process.exit(0);
    })();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  logger.info({ channels: postingChannels(config.channels).length, model: settings.model, dryRun: env.dryRun }, "bot started");
}

main().catch((err: Error) => {
  logger.error({ err: err.message, stack: err.stack }, "fatal error");
  process.exit(1);
});
