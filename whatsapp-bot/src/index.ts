import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { WAMessage } from "baileys";
import { aiKey, modelChain, saveEditedChannels, inviteCode, loadConfig, parseConfig, type ChannelConfig } from "./config.js";
import { refillChannel, writeNow, type GenContext } from "./content/generator.js";
import { createLLM, FakeLLM, FallbackLLM, type LLM } from "./content/llm.js";
import { AiImages } from "./media/aiimage.js";
import { Control } from "./control.js";
import { Store, type PostPayload } from "./db.js";
import { logger } from "./logger.js";
import { DefaultMedia } from "./media/maker.js";
import { ffmpegAvailable } from "./media/video.js";
import { AUTH_DIR, DB_PATH, TMP_DIR, ensureDirs } from "./paths.js";
import { updateEnvFile } from "./panel/envfile.js";
import { startPanel } from "./panel/server.js";
import { Scheduler, postingChannels, type CountdownEvent } from "./scheduler.js";
import { HOUR, MINUTE, dayKey, sleep } from "./time.js";
import { canPost, fetchChannelPosts, recentPostTexts, resolveChannels } from "./wa/channels.js";
import { recordChannelEngagement } from "./engagement.js";
import { knowledgeFiles } from "./content/knowledge.js";
import { renderCard } from "./media/cards.js";
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

/** One readable line for a post, for the settings website. */
function preview(p: PostPayload): string {
  if (p.kind === "poll") return `📊 ${p.pollQuestion ?? ""} (${(p.pollOptions ?? []).join(" / ")})`;
  if (p.kind === "image" || p.kind === "video") return `${p.kind === "image" ? "🖼️" : "🎬"} ${[p.cardText, p.text].filter(Boolean).join(" · ")}`;
  return p.text;
}

function clearSession(): void {
  fsSync.rmSync(AUTH_DIR, { recursive: true, force: true });
  fsSync.mkdirSync(AUTH_DIR, { recursive: true });
}

/**
 * Shuts down cleanly; the supervisor (systemd on Linux, run.ps1 on Windows)
 * starts the bot again a few seconds later with the new settings. Emitting the
 * signal event instead of sending a signal works the same on Windows.
 */
function restartSoon(): void {
  setTimeout(() => (process as NodeJS.EventEmitter).emit("SIGTERM"), 700);
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
      ? createLLM(modelChain(settings), settings.effort, (u) => store.addUsage(dayKey(now(), settings.timezone), u.inputTokens, u.outputTokens))
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

  const aiImages = new AiImages(
    store,
    { ...settings.images, timezone: settings.timezone },
    {
      gemini: process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim(),
      cloudflareAccount: process.env.CLOUDFLARE_ACCOUNT_ID?.trim(),
      cloudflareToken: process.env.CLOUDFLARE_API_TOKEN?.trim(),
      pollinationsToken: process.env.POLLINATIONS_TOKEN?.trim(),
      hordeKey: process.env.HORDE_API_KEY?.trim(),
    },
    (m) => store.event(now(), "warn", "ai_image", m),
  );

  const media = new DefaultMedia(env.pexelsKey, (m) => store.event(now(), "info", "media_note", m), aiImages);
  const scheduler = new Scheduler({
    store,
    config,
    sender,
    media,
    now,
    isConnected: () => (client ? client.isOpen : env.dryRun),
  });

  const control = new Control({
    sendNow: (id: string, prompt: string) => {
      const c = config.channels.find((x) => x.id === id);
      if (!c || !gen) return Promise.resolve({ error: "לא אפשרי כרגע" });
      return writeNow(gen, c, prompt, now());
    },
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
    // round follower counts are celebrated in the channel
    for (const c of postingChannels(config.channels)) {
      const f = store.followers(c.id).count;
      if (f !== null) scheduler.milestone(c, f, now());
    }
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
        if (!res.llmError && res.queued > 0) store.set("llm_rl_streak", "0");
        if (res.queued > 0) logger.info({ channel: channel.id, queued: res.queued, dropped: res.rejected.length }, "queue refilled");
        const err = res.llmError;
        if (!err) continue;
        if (err.kind === "auth" || err.kind === "bad_request") {
          await control.alert("llm_config", `בעיה מול שירות ה-AI: ${err.message}. בדוק את המפתח ב-.env ואת היתרה בחשבון.`);
        }
        if (["auth", "rate_limit", "network", "server", "bad_request"].includes(err.kind)) {
          // a problem with the service, not with one channel: stop asking until it has had time to clear.
          // Repeated rate limits usually mean the daily free quota is used up, so the wait grows, up to 3 hours.
          const streak = err.kind === "rate_limit" ? (store.getNumber("llm_rl_streak") ?? 0) + 1 : 0;
          store.set("llm_rl_streak", String(streak));
          const wait = err.kind === "rate_limit" ? Math.min(err.retryAfterMs * 2 ** (streak - 1), 3 * HOUR) : err.retryAfterMs;
          store.set("llm_pause_until", String(now() + wait));
          if (streak === 4) await control.alert("llm_quota", "שירות ה-AI מגביל את הבוט שוב ושוב. כנראה נגמרה המכסה החינמית היומית של Gemini. הבוט ימשיך כשהמכסה תתחדש.", 12 * HOUR);
          break;
        }
      }
    } finally {
      refilling = false;
    }
  }

  /** Every 3 hours: reactions and views of the bot's recent posts, so the bot learns what works. */
  async function syncEngagement(): Promise<void> {
    const sock = client?.sock;
    if (!client?.isOpen || !sock) return;
    if (now() - (store.getNumber("engagement_at") ?? 0) < 3 * HOUR) return;
    store.set("engagement_at", String(now()));
    let matched = 0;
    for (const c of postingChannels(config.channels)) {
      const st = store.channel(c.id);
      if (!st.jid || !client.isOpen) continue;
      try {
        matched += recordChannelEngagement(store, c.id, await fetchChannelPosts(sock, st.jid, 50), now());
      } catch (err) {
        store.event(now(), "info", "engagement_fetch_failed", (err as Error).message, c.id);
      }
      await sleep(1500);
    }
    logger.info({ matched }, "engagement updated");
  }

  async function housekeeping(): Promise<void> {
    await syncEngagement();
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
  let lastProblemSync = now();
  const timers = [
    setInterval(guard("tick", () => scheduler.tick()), 15_000),
    setInterval(guard("refill", refillAll), 90_000),
    setInterval(guard("housekeeping", housekeeping), HOUR),
    setInterval(
      guard("watch", async () => {
        await control.maybeDailyReport();
        // new channels, and channels where the bot just became an admin, are picked up within minutes
        scheduler.countdowns(loadEvents(), now());
        if (now() - lastProblemSync > 5 * MINUTE) {
          lastProblemSync = now();
          await syncChannels(24 * HOUR);
        }
        if (client && !client.isOpen && client.status !== "logged_out" && now() - Math.max(client.lastOpenAt, startedAt) > 10 * MINUTE) {
          await control.alert("disconnected", "הבוט לא מצליח להתחבר לוואטסאפ כבר יותר מ-10 דקות. הוא ממשיך לנסות.", HOUR);
        }
      }),
      MINUTE,
    ),
  ];
  guard("refill", refillAll)();

  const loadEvents = (): CountdownEvent[] => {
    try {
      return JSON.parse(store.get("events") ?? "[]") as CountdownEvent[];
    } catch {
      return [];
    }
  };

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
            defaultCycle: settings.cycle,
            pendingTotal: store.pendingCount(),
            growth: scheduler.growth(),
            gradual: scheduler.gradual(),
            knowledgeFiles: knowledgeFiles(),
            milestones: store.get("milestones") !== "0",
            events: loadEvents(),
            // a message scheduled for many channels is shown once
            scheduled: [...store.scheduledList(500).reduce((groups, r) => {
              const key = `${r.not_before}|${preview(r.payload)}`;
              const g = groups.get(key) ?? { ids: [] as number[], names: [] as string[], at: r.not_before, text: preview(r.payload) };
              g.ids.push(r.id);
              g.names.push(config.channels.find((c) => c.id === r.channel_id)?.name ?? r.channel_id);
              return groups.set(key, g);
            }, new Map<string, { ids: number[]; names: string[]; at: number; text: string }>()).values()].map((g) => ({
              ids: g.ids, at: g.at, text: g.text, channel: g.names.length > 1 ? `${g.names.length} ערוצים` : (g.names[0] ?? ""),
            })),
            hasClaude: env.hasAnthropicKey,
            hasCloudflare: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN),
            models: llm instanceof FallbackLLM
              ? llm.status().map((m) => ({ name: m.name, problem: m.until > now() ? m.problem : null, lastUsedAt: m.lastUsedAt }))
              : modelChain(settings).map((m) => ({ name: `${m.provider}:${m.model}`, problem: "אין מפתח", lastUsedAt: 0 })),
            images: aiImages.usage(),
            today: { sent: totals.sent, ready: totals.ready },
            usage: store.usage(day),
            activeChannels: active.length,
            postingChannels: postingChannels(config.channels).length,
            problems,
            recent: store.recentSent(12).map((r) => ({ channel: config.channels.find((c) => c.id === r.channel_id)?.name ?? r.channel_id, kind: r.kind, text: preview(r.payload), at: r.sent_at })),
            channels: config.channels.map((c) => {
              const st = store.channel(c.id);
              const f = store.followers(c.id);
              return {
                id: c.id, name: c.name, invite: c.invite, mode: c.mode, topic: c.topic, queries: c.news?.queries ?? [], youtube: c.youtube, enabled: c.enabled,
                role: st.role, sentToday: perChannel.get(c.id) ?? 0, ready: store.readyCount(c.id), followers: f.count, followersWeek: f.week,
                paused: st.paused === 1, maxPerDay: c.maxPerDay ?? null, cycle: c.cycle ?? null, special: c.special ?? null,
                cap: scheduler.capFor(c, now()),
                why: scheduler.explain(c, now()),
                approve: store.get(`approve:${c.id}`) === "1",
                knowledge: store.get(`knowledge:${c.id}`) ?? "",
                shabbat: scheduler.shabbat(c.id),
                perf: store.kindPerformance(c.id, now()),
              };
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
          if (str(b.anthropicKey)) values.ANTHROPIC_API_KEY = str(b.anthropicKey);
          if (str(b.cfAccount)) values.CLOUDFLARE_ACCOUNT_ID = str(b.cfAccount).replace(/[^A-Za-z0-9]/g, "");
          if (str(b.cfToken)) values.CLOUDFLARE_API_TOKEN = str(b.cfToken);
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
            const num = (v: unknown) => (v === "" || v == null ? null : Number(v));
            const max = num(raw.maxPerDay);
            if (max && max > 0) next.maxPerDay = Math.round(max);
            else delete next.maxPerDay;
            const cyc = raw.cycle as Record<string, unknown> | null | undefined;
            if (cyc && num(cyc.postsPerBurst) && num(cyc.intervalMinutes)) {
              next.cycle = { postsPerBurst: num(cyc.postsPerBurst), intervalMinutes: num(cyc.intervalMinutes), pauseMinutes: num(cyc.pauseMinutes) ?? 0 };
            } else delete next.cycle;
            const sp = raw.special as Record<string, unknown> | null | undefined;
            if (sp && num(sp.every) && (String(sp.text ?? "").trim() || String(sp.prompt ?? "").trim())) {
              next.special = { every: num(sp.every), text: String(sp.text ?? "").trim(), prompt: String(sp.prompt ?? "").trim() };
            } else delete next.special;
            if (queries.length > 0) next.news = { feeds: [], ...(prev?.news ?? {}), queries };
            else delete next.news;
            const youtube = Array.isArray(raw.youtube) ? raw.youtube.map(String).map((y) => y.trim()).filter((y) => y.length >= 2).slice(0, 10) : [];
            if (youtube.length > 0) next.youtube = youtube;
            else delete next.youtube;
            list.push(next as ChannelConfig);
          }
          try {
            parseConfig(settings, list);
          } catch (err) {
            return `ההגדרות לא תקינות: ${(err as Error).message.slice(0, 200)}`;
          }
          saveEditedChannels(list);
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
        setGrowth: (on) => store.set("growth", on ? "1" : "0"),
        setGradual: (on) => store.set("gradual", on ? "1" : "0"),
        setKnowledge: (id, file) => {
          if (!config.channels.some((c) => c.id === id)) return "ערוץ לא קיים";
          if (file && !knowledgeFiles().some((k) => k.name === file)) return "קובץ לא קיים";
          store.set(`knowledge:${id}`, file);
          // what was written before no longer matches: let the next posts come from the file
          if (file) store.updateChannel(id, { retry_at: 0 });
          return null;
        },
        pauseChannel: (id, paused) => {
          if (!config.channels.some((c) => c.id === id)) return "ערוץ לא קיים";
          store.updateChannel(id, { paused: paused ? 1 : 0 });
          return null;
        },
        push: (id, message) => {
          const target = config.channels.find((c) => c.id === id);
          if (!target) return "ערוץ לא קיים";
          const r = scheduler.pushChannel(target, now(), message);
          if (typeof r === "string") return r;
          return r === 0 ? "אין ערוצים אחרים שהבוט מנהל בהם" : null;
        },
        setApprove: (id, on) => {
          if (!config.channels.some((c) => c.id === id)) return "ערוץ לא קיים";
          store.set(`approve:${id}`, on ? "1" : "0");
          if (on) store.holdReady(id, now());
          else store.approveAll(id, now());
          return null;
        },
        approve: (id) => (store.approve(id, now()) ? null : "הפוסט כבר לא מחכה לאישור"),
        pending: (channelId) => store.pendingList(channelId || null, 50).map((r) => ({ id: r.id, channel: config.channels.find((c) => c.id === r.channel_id)?.name ?? r.channel_id, kind: r.kind, text: preview(r.payload), special: r.special === 1 })),
        test: async (id) => {
          const c = config.channels.find((x) => x.id === id);
          if (!c) return { error: "ערוץ לא קיים" };
          const st = store.channel(c.id);
          if (!env.dryRun && !client?.isOpen) return { error: "הבוט לא מחובר לוואטסאפ" };
          if (!st.jid) return { error: "הערוץ עוד לא נמצא בוואטסאפ. מחכים דקה אחרי החיבור" };
          if (!canPost(st.role)) return { error: `הבוט לא מנהל בערוץ (${st.role})` };
          const results: { kind: string; ok: boolean; error?: string }[] = [];
          const run = async (kind: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
            try {
              const r = await fn();
              results.push({ kind, ok: r.ok, error: r.error });
            } catch (err) {
              results.push({ kind, ok: false, error: (err as Error).message });
            }
            await sleep(4000);
          };
          await run("טקסט", () => sender.text(st.jid!, "🤖 בדיקה 1/6: הודעת טקסט מהבוט"));
          await run("סקר", () => sender.poll(st.jid!, "🤖 בדיקה 2/6: הסקר הזה מופיע אצלכם?", ["כן", "לא"]));
          await run("בוחן", () => sender.quiz(st.jid!, "🤖 בדיקה 3/6: כמה זה 2+2?", ["3", "4", "5"], "4"));
          await run("שאלה (ניסיוני)", () => sender.question(st.jid!, "🤖 בדיקה 4/6: מה הכי אהבתם השבוע?"));
          await run("תמונה", async () => sender.image(st.jid!, await renderCard({ text: "בדיקה 5/6\nתמונה מהבוט 🖼️", footer: c.name, seed: "test" }), "🤖 בדיקה 5/6: תמונה"));
          await run("סרטון", async () => sender.video(st.jid!, await media.video({ kind: "video", text: "", cardText: "בדיקה 6/6\nסרטון מהבוט 🎬" }, c, "test-video"), "🤖 בדיקה 6/6: סרטון"));
          store.event(now(), "info", "test_posts", results.map((r) => `${r.kind}:${r.ok ? "ok" : r.error}`).join(" | "), c.id);
          return { results };
        },
        sendNow: async (id, prompt, as) => {
          const c = config.channels.find((x) => x.id === id);
          if (!c) return { error: "ערוץ לא קיים" };
          if (!gen) return { error: "חסר מפתח AI" };
          const st = store.channel(c.id);
          if (!st.jid || !canPost(st.role)) return { error: "הבוט לא מנהל בערוץ הזה (או שהוא עוד לא נמצא)" };
          return writeNow(gen, c, prompt, now(), as === "quiz" || as === "question" ? as : "post");
        },
        setShabbat: (id, on) => {
          if (!config.channels.some((c) => c.id === id)) return "ערוץ לא קיים";
          store.set(`shabbat:${id}`, on ? "1" : "0");
          return null;
        },
        setMilestones: (on) => store.set("milestones", on ? "1" : "0"),
        recheck: () => {
          store.db.prepare("UPDATE channels SET resolved_at = 0").run();
          lastProblemSync = 0;
          return null;
        },
        schedule: (channel, at, text) => {
          const t = text.trim();
          if (t.length < 2) return "ההודעה ריקה";
          if (!Number.isFinite(at) || at < now() - MINUTE) return "הזמן שבחרת כבר עבר";
          const targets = channel === "all" ? config.channels.filter((c) => c.enabled && c.mode !== "off") : config.channels.filter((c) => c.id === channel);
          if (targets.length === 0) return "ערוץ לא קיים";
          for (const c of targets) store.enqueue({ channelId: c.id, payload: { kind: "text", text: t }, notBefore: at, isFollowup: true, manual: true, now: now() });
          return null;
        },
        edit: (id, text) => {
          const row = store.queueRow(id);
          if (!row || !["ready", "pending"].includes(row.status)) return "הפוסט כבר לא בתור";
          const t = text.trim();
          if (t.length < 2) return "הטקסט ריק";
          const p = row.payload;
          if (p.kind === "poll") {
            const [q, ...opts] = t.split("|").map((x) => x.trim()).filter(Boolean);
            if (!q || opts.length < 2) return 'בסקר כותבים: שאלה | תשובה 1 | תשובה 2';
            store.updatePayload(id, { ...p, pollQuestion: q, pollOptions: opts.slice(0, 6) });
          } else store.updatePayload(id, { ...p, text: t });
          return null;
        },
        setEvents: (events) => {
          const clean = events
            .map((e, i) => ({
              id: String(e.id || `ev${Date.now()}${i}`),
              name: String(e.name ?? "").trim().slice(0, 80),
              date: String(e.date ?? ""),
              channel: String(e.channel || "all"),
              hour: Math.min(23, Math.max(0, Number(e.hour ?? 17) || 0)),
              text: String(e.text ?? "").trim().slice(0, 500),
            }))
            .filter((e) => e.name && /^\d{4}-\d{2}-\d{2}$/.test(e.date));
          store.set("events", JSON.stringify(clean));
          return null;
        },
        broadcast: (text) => {
          const t = text.trim();
          if (t.length < 2) return "ההודעה ריקה";
          const n = scheduler.broadcast(t, now());
          return n === 0 ? "אין ערוצים שהבוט מנהל בהם" : null;
        },
        flush: (id) => {
          const n = store.flushQueue(id, now());
          return n === 0 ? "אין פוסטים בתור של הערוץ הזה" : null;
        },
        queue: (channelId) => store.readyList(channelId, 20).map((r) => ({ id: r.id, kind: r.kind, text: preview(r.payload) })),
        discard: (id) => (store.discardOne(id, now()) ? null : "הפוסט כבר לא בתור"),
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
