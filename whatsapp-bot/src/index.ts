import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { WAMessage } from "baileys";
import { aiKey, EDITED_CHANNELS_FILE, inviteCode, loadConfig, parseConfig, type ChannelConfig } from "./config.js";
import { refillChannel, type GenContext } from "./content/generator.js";
import { createLLM, FakeLLM, type LLM } from "./content/llm.js";
import { Control } from "./control.js";
import { Store } from "./db.js";
import { logger } from "./logger.js";
import { DefaultMedia } from "./media/maker.js";
import { ffmpegAvailable } from "./media/video.js";
import { AUTH_DIR, DB_PATH, TMP_DIR, ensureDirs } from "./paths.js";
import { updateEnvFile } from "./panel/envfile.js";
import { startPanel } from "./panel/server.js";
import { Scheduler, postingChannels } from "./scheduler.js";
import { HOUR, MINUTE, dayKey, sleep } from "./time.js";
import { recentPostTexts, resolveChannels } from "./wa/channels.js";
import { WaClient } from "./wa/client.js";
import { DryRunSender, WaSender, type Sender } from "./wa/sender.js";

/** True when a WhatsApp session has been saved (the bot was linked). */
function isLinked(): boolean {
  try {
    const creds = JSON.parse(fsSync.readFileSync(`${AUTH_DIR}/creds.json`, "utf8")) as { me?: { id?: string } };
    return Boolean(creds.me?.id);
  } catch {
    return false;
  }
}

function clearSession(): void {
  fsSync.rmSync(AUTH_DIR, { recursive: true, force: true });
  fsSync.mkdirSync(AUTH_DIR, { recursive: true });
}

/** systemd starts the bot again a few seconds after it exits, with the new settings. */
function restartSoon(): void {
  setTimeout(() => process.kill(process.pid, "SIGTERM"), 700);
}

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

  const hasKey = env.fakeLlm || aiKey(config).present;
  if (!hasKey) logger.warn(`${aiKey(config).name} is missing: no posts are written until it is added on the settings website`);
  const llm: LLM | null = env.fakeLlm
    ? new FakeLLM()
    : hasKey
      ? createLLM(settings, (u) => store.addUsage(dayKey(now(), settings.timezone), u.inputTokens, u.outputTokens))
      : null;

  const videoAvailable = await ffmpegAvailable();
  if (!videoAvailable) logger.warn("ffmpeg was not found: video posts will be sent as pictures");

  const linkState: { code: string | null; error: string | null } = { code: null, error: null };
  let client: WaClient | null = null;
  let sender: Sender;
  let direct: (jid: string, text: string) => Promise<boolean> = async () => false;

  if (env.dryRun) {
    logger.warn("DRY_RUN=1: nothing is sent to WhatsApp");
    sender = new DryRunSender({ saveMedia: true });
    for (const c of config.channels) {
      if (!store.channel(c.id).jid) store.updateChannel(c.id, { jid: `dry-${c.id}@newsletter`, role: "ADMIN", resolved_at: now() });
    }
  } else if (isLinked()) {
    client = new WaClient({ allowLinking: false, pairingPhone: null });
    const wa = new WaSender(client, store);
    sender = wa;
    direct = (jid, text) => wa.direct(jid, text);
  } else {
    logger.warn("the bot is not linked to WhatsApp yet: open the settings website to link it");
    sender = new DryRunSender({ saveMedia: false, quiet: true });
  }

  const scheduler = new Scheduler({
    store,
    config,
    sender,
    media: new DefaultMedia(env.pexelsKey, (m) => store.event(now(), "info", "media_note", m)),
    now,
    isConnected: () => (client ? client.isOpen : env.dryRun),
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
      await sleep(1000);
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
        clearSession();
        linkState.error = "וואטסאפ ניתקה את הבוט. צריך לחבר אותו מחדש.";
        await control.alert("logged_out", `הבוט התנתק מוואטסאפ (${reason}). נכנסים לאתר ההגדרות ולוחצים "לקבל קוד חיבור".`, HOUR);
      })();
    });
    await client.start();
  }

  // ---- loops ----------------------------------------------------------------

  const gen: GenContext | null = llm ? { store, llm, settings, videoAvailable } : null;
  let refilling = false;

  async function refillAll(): Promise<void> {
    if (!gen || refilling || scheduler.isPaused()) return;
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

  // ---- settings website ------------------------------------------------------

  let linker: WaClient | null = null;
  const port = Number(process.env.PANEL_PORT ?? 80);
  if (process.env.PANEL !== "0") {
    startPanel(
      {
        state: () => {
          const day = dayKey(now(), settings.timezone);
          const totals = store.totals(day);
          const perChannel = store.sentPerChannel(day);
          const active = scheduler.activeChannels(now());
          const problems = store
            .eventsSince(now() - 6 * HOUR)
            .filter((e) => e.level !== "info")
            .slice(0, 8)
            .map((e) => `${new Date(e.ts).toLocaleTimeString("he-IL", { timeZone: settings.timezone, hour12: false })} ${e.channel_id ?? ""} ${e.message}`.trim());
          return {
            connection: client ? (client.isOpen ? "open" : client.status) : env.dryRun ? "open" : "not_linked",
            linked: Boolean(client) && isLinked(),
            linking: Boolean(linker),
            pairingCode: linkState.code,
            linkError: linkState.error,
            hasKey,
            hasPexels: Boolean(env.pexelsKey),
            botPhone: env.botPhone ?? "",
            ownerPhone: env.ownerPhone ?? "",
            ntfyTopic: env.ntfyTopic ?? "",
            paused: scheduler.isPaused(),
            today: { sent: totals.sent, ready: totals.ready },
            usage: store.usage(day),
            activeChannels: active.length,
            postingChannels: postingChannels(config.channels).length,
            problems,
            channels: config.channels.map((c) => {
              const st = store.channel(c.id);
              return { id: c.id, name: c.name, invite: c.invite, mode: c.mode, topic: c.topic, queries: c.news?.queries ?? [], enabled: c.enabled, role: st.role, sentToday: perChannel.get(c.id) ?? 0 };
            }),
          };
        },
        saveSettings: async (b) => {
          const str = (v: unknown) => (typeof v === "string" ? v : "");
          const phone = (v: unknown) => str(v).replace(/\D/g, "").replace(/^0(?=5)/, "972");
          const values: Record<string, string> = {
            BOT_PHONE: phone(b.botPhone),
            OWNER_PHONE: phone(b.ownerPhone),
            NTFY_TOPIC: str(b.ntfyTopic).replace(/[^A-Za-z0-9_-]/g, ""),
          };
          for (const [k, v] of [["BOT_PHONE", values.BOT_PHONE], ["OWNER_PHONE", values.OWNER_PHONE]] as const) {
            if (v && (v.length < 10 || v.length > 15)) return `המספר ב-${k === "BOT_PHONE" ? "מספר הבוט" : "המספר שלך"} לא נראה תקין. כותבים כך: 972501234567`;
          }
          if (str(b.geminiKey)) values.GEMINI_API_KEY = str(b.geminiKey);
          if (str(b.pexelsKey)) values.PEXELS_API_KEY = str(b.pexelsKey);
          if (values.BOT_PHONE && env.botPhone && values.BOT_PHONE !== env.botPhone && isLinked()) {
            clearSession(); // a different bot number needs a new link
          }
          updateEnvFile(values);
          restartSoon();
          return null;
        },
        saveChannels: async (b) => {
          if (!Array.isArray(b.channels)) return "רשימה לא תקינה";
          const old = new Map(config.channels.map((c) => [c.id, c]));
          const used = new Set<string>();
          const list: ChannelConfig[] = [];
          for (const raw of b.channels as Record<string, unknown>[]) {
            const name = String(raw.name ?? "").trim();
            const invite = inviteCode(String(raw.invite ?? ""));
            if (!name && !invite) continue;
            if (!name) return "יש ערוץ בלי שם";
            if (!/^0029V[A-Za-z0-9]{10,}$/.test(invite)) return `הקישור של "${name}" לא נראה כמו קישור לערוץ וואטסאפ`;
            const prev = typeof raw.id === "string" ? old.get(raw.id) : undefined;
            let id = prev?.id ?? `ch-${invite.slice(-8).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
            while (used.has(id)) id = `${id}-x`;
            used.add(id);
            const queries = Array.isArray(raw.queries) ? raw.queries.map(String).map((q) => q.trim()).filter(Boolean).slice(0, 5) : [];
            const mode = String(raw.mode ?? "creative") as ChannelConfig["mode"];
            const next: Record<string, unknown> = { ...(prev ?? {}), id, name, invite, mode, topic: String(raw.topic ?? "").trim(), enabled: raw.enabled !== false };
            if (queries.length > 0) next.news = { feeds: [], ...(prev?.news ?? {}), queries };
            else delete next.news;
            list.push(next as ChannelConfig);
          }
          try {
            parseConfig(settings, list);
          } catch (err) {
            return `ההגדרות לא תקינות: ${(err as Error).message.slice(0, 200)}`;
          }
          fsSync.writeFileSync(EDITED_CHANNELS_FILE, JSON.stringify(list, null, 2));
          restartSoon();
          return null;
        },
        startLink: async () => {
          if (env.dryRun) return "מצב בדיקה";
          if (client && isLinked()) return "הבוט כבר מחובר";
          if (linker) return null;
          if (!env.botPhone) return "קודם שומרים את המספר של הבוט";
          clearSession();
          linkState.code = null;
          linkState.error = null;
          const l = new WaClient({ allowLinking: true, pairingPhone: env.botPhone });
          linker = l;
          const give = setTimeout(() => {
            if (linker !== l) return;
            linkState.error = "הקוד לא הוקלד בזמן. אפשר לבקש קוד חדש.";
            linkState.code = null;
            linker = null;
            void l.stop();
          }, 4 * MINUTE);
          l.on("pairing_code", (code: string) => (linkState.code = `${code.slice(0, 4)}-${code.slice(4)}`));
          l.on("logged_out", (reason: string) => {
            clearTimeout(give);
            linkState.error = `וואטסאפ דחתה את החיבור (${reason}). בודקים את המספר ומנסים שוב.`;
            linkState.code = null;
            linker = null;
          });
          l.on("open", () => {
            clearTimeout(give);
            linkState.code = null;
            logger.info("linked to WhatsApp, restarting");
            // give the library a moment to save the session, then start normally
            setTimeout(() => void l.stop().then(restartSoon), 6000);
          });
          await l.start();
          return null;
        },
        setPaused: (paused) => store.set("paused", paused ? "1" : "0"),
      },
      port,
    );
  }

  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    for (const t of timers) clearInterval(t);
    void (async () => {
      if (client) await client.stop();
      if (linker) await linker.stop();
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
