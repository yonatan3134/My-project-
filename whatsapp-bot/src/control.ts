import type { WAMessage } from "baileys";
import type { AppConfig, ChannelConfig } from "./config.js";
import type { Store } from "./db.js";
import { logger } from "./logger.js";
import { postingChannels, type Scheduler } from "./scheduler.js";
import { DAY, HOUR, dayKey, hourOfDay } from "./time.js";
import { canPost } from "./wa/channels.js";

export interface ControlDeps {
  store: Store;
  config: AppConfig;
  scheduler: Scheduler;
  now: () => number;
  /** sends a private WhatsApp message; resolves false when it could not be sent */
  direct: (jid: string, text: string) => Promise<boolean>;
  connection: () => string;
  /** writes one post from an instruction and sends it right away (the website's "send now") */
  sendNow?: (channelId: string, prompt: string) => Promise<{ text: string } | { error: string }>;
}

const HELP = [
  "*פקודות הבוט*",
  "סטטוס - מה המצב עכשיו",
  "עצור - עוצר את כל הפרסומים",
  "המשך - מחזיר את הפרסומים",
  "עצור <ערוץ> / המשך <ערוץ> - לערוץ אחד",
  "ערוצים - רשימת הערוצים והמזהים שלהם",
  "פלישה <ערוץ> [אימוג'י] - קריאה לפלישה לערוץ",
  "נקה <ערוץ> - זורק את הפוסטים שמחכים בתור של הערוץ",
  "שלח <ערוץ> [מה] - כותב ושולח עכשיו (למשל: שלח riddles חידה קשה)",
  "לכולם <הודעה> - שולח את ההודעה לכל הערוצים",
].join("\n");

export class Control {
  constructor(private d: ControlDeps) {}

  // ---- alerts ---------------------------------------------------------------

  /** Sends an alert by push notification and by WhatsApp, at most once per `everyMs` for the same key. */
  async alert(key: string, text: string, everyMs = 6 * HOUR): Promise<void> {
    const { store } = this.d;
    const now = this.d.now();
    const last = store.getNumber(`alert:${key}`) ?? 0;
    if (now - last < everyMs) return;
    store.set(`alert:${key}`, String(now));
    logger.warn({ key }, `ALERT: ${text}`);
    await this.push("התראה מהבוט", text);
    const owner = store.get("owner_chat_jid");
    if (owner) await this.d.direct(owner, `⚠️ ${text}`);
  }

  private async push(title: string, text: string): Promise<void> {
    const topic = this.d.config.env.ntfyTopic;
    if (!topic) return;
    try {
      await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
        method: "POST",
        body: text,
        headers: { Title: encodeURIComponent(title), Priority: "high" },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "push notification failed");
    }
  }

  // ---- status & reports -----------------------------------------------------

  /** Token counts only: prices differ by model and change, so the bill itself is read at the AI provider. */
  private costToday(day: string): string {
    const u = this.d.store.usage(day);
    const k = (n: number) => `${Math.round(n / 1000)}K`;
    return `${u.calls} קריאות AI (${k(u.input_tokens)} טוקנים קלט, ${k(u.output_tokens)} פלט)`;
  }

  statusText(): string {
    const { store, config, scheduler } = this.d;
    const now = this.d.now();
    const day = dayKey(now, config.settings.timezone);
    const all = postingChannels(config.channels);
    const active = scheduler.activeChannels(now);
    const totals = store.totals(day);
    const notAdmin = active.filter((c) => {
      const s = store.channel(c.id);
      return s.jid && !canPost(s.role);
    });
    const unresolved = active.filter((c) => !store.channel(c.id).jid);
    const lines = [
      `*מצב הבוט*`,
      `חיבור לוואטסאפ: ${this.d.connection()}`,
      `פרסומים: ${scheduler.isPaused() ? "⏸ עצורים" : "▶️ פעילים"}`,
      `ערוצים פעילים: ${active.length} מתוך ${all.length}`,
      `פורסמו היום: ${totals.sent}`,
      `מחכים בתור: ${totals.ready}`,
      `היום: ${this.costToday(day)}`,
    ];
    if (notAdmin.length > 0) lines.push(`⚠️ הבוט לא מנהל ב: ${notAdmin.map((c) => c.id).join(", ")}`);
    if (unresolved.length > 0) lines.push(`⚠️ לא נמצאו בוואטסאפ: ${unresolved.map((c) => c.id).join(", ")}`);
    if ((store.getNumber("poll_off_until") ?? 0) > now) lines.push("⚠️ סקרים נשלחים כרגע כטקסט (נכשלו כמה פעמים)");
    if ((store.getNumber("media_off_until") ?? 0) > now) lines.push("⚠️ תמונות וסרטונים נשלחים כרגע כטקסט (נכשלו כמה פעמים)");
    if ((store.getNumber("llm_pause_until") ?? 0) > now) lines.push("⚠️ יצירת התוכן בהמתנה (בעיה מול שירות ה-AI)");
    if (totals.unknown > 0) lines.push(`לא ודאי אם נשלחו: ${totals.unknown}`);
    return lines.join("\n");
  }

  private reportText(): string {
    const { store, config } = this.d;
    const now = this.d.now();
    const day = dayKey(now, config.settings.timezone);
    const per = store.sentPerChannel(day);
    const top = [...per.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const problems = [...store.eventCounts(now - DAY).entries()].slice(0, 6);
    const lines = [this.statusText(), ""];
    if (top.length > 0) lines.push("*הכי פעילים היום*", ...top.map(([id, n]) => `${id}: ${n}`), "");
    if (problems.length > 0) lines.push("*תקלות ב-24 השעות האחרונות*", ...problems.map(([k, n]) => `${k}: ${n}`));
    return lines.join("\n").trim();
  }

  /** Sends the daily summary once a day, at the configured hour. */
  async maybeDailyReport(): Promise<void> {
    const { store, config } = this.d;
    const now = this.d.now();
    const day = dayKey(now, config.settings.timezone);
    if (store.get("report_day") === day) return;
    if (hourOfDay(now, config.settings.timezone) < config.settings.dailyReportHour) return;
    store.set("report_day", day);
    const text = this.reportText();
    logger.info(`daily report\n${text}`);
    const owner = store.get("owner_chat_jid");
    if (owner) await this.d.direct(owner, text);
    else await this.push("דוח יומי מהבוט", text);
  }

  // ---- owner commands -------------------------------------------------------

  private ownerChat(m: WAMessage): string | null {
    const owner = this.d.config.env.ownerPhone;
    if (!owner || m.key.fromMe) return null;
    const remote = m.key.remoteJid ?? "";
    if (!remote || remote.endsWith("@g.us") || remote.endsWith("@newsletter") || remote.endsWith("@broadcast")) return null;
    // newer WhatsApp accounts are addressed by an opaque id; the phone-number form then arrives in remoteJidAlt
    for (const jid of [remote, m.key.remoteJidAlt ?? ""]) {
      if (!jid.endsWith("@s.whatsapp.net")) continue;
      const digits = (jid.split("@")[0] ?? "").split(":")[0];
      if (digits === owner) return remote;
    }
    return null;
  }

  private findChannel(arg: string | undefined): ChannelConfig | null {
    if (!arg) return null;
    const a = arg.trim().toLowerCase();
    return this.d.config.channels.find((c) => c.id === a) ?? this.d.config.channels.find((c) => c.name.toLowerCase().includes(a)) ?? null;
  }

  private execute(text: string): string {
    const { store, scheduler, config } = this.d;
    const now = this.d.now();
    const [cmdRaw, ...rest] = text.trim().split(/\s+/);
    const cmd = (cmdRaw ?? "").toLowerCase();
    const arg = rest[0];

    switch (cmd) {
      case "עזרה":
      case "help":
        return HELP;
      case "סטטוס":
      case "status":
        return this.statusText();
      case "ערוצים":
      case "channels": {
        const active = new Set(scheduler.activeChannels(now).map((c) => c.id));
        return config.channels
          .map((c) => {
            const s = store.channel(c.id);
            const mark = c.mode === "off" || !c.enabled ? "⚫" : s.paused ? "⏸" : active.has(c.id) || c.mode === "invasion" ? "🟢" : "🕓";
            return `${mark} ${c.id} - ${c.name}`;
          })
          .join("\n");
      }
      case "עצור":
      case "stop": {
        if (!arg) {
          store.set("paused", "1");
          return "⏸ כל הפרסומים נעצרו. לחזרה: המשך";
        }
        const c = this.findChannel(arg);
        if (!c) return `לא מצאתי ערוץ "${arg}". שלח: ערוצים`;
        store.updateChannel(c.id, { paused: 1 });
        return `⏸ ${c.name} נעצר`;
      }
      case "המשך":
      case "start":
      case "resume": {
        if (!arg) {
          store.set("paused", "0");
          return "▶️ הפרסומים חזרו לפעול";
        }
        const c = this.findChannel(arg);
        if (!c) return `לא מצאתי ערוץ "${arg}". שלח: ערוצים`;
        store.updateChannel(c.id, { paused: 0 });
        return `▶️ ${c.name} חזר לפעול`;
      }
      case "פלישה":
      case "invade": {
        const c = this.findChannel(arg);
        if (!c) return `לא מצאתי ערוץ "${arg ?? ""}". שלח: ערוצים`;
        return scheduler.queueInvasion(c, now, rest[1]) ? `😈 קריאה לפלישה ל-${c.name} בדרך` : "אין ערוץ פלישה פעיל שהבוט מנהל בו";
      }
      case "נקה":
      case "clear": {
        const c = this.findChannel(arg);
        if (!c) return `לא מצאתי ערוץ "${arg ?? ""}". שלח: ערוצים`;
        return `נזרקו ${store.discardReady(c.id, now)} פוסטים שחיכו בתור של ${c.name}`;
      }
      default:
        return HELP;
    }
  }

  async handleMessage(m: WAMessage): Promise<void> {
    const chat = this.ownerChat(m);
    if (!chat) return;
    const text = (m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? "").trim();
    if (!text) return;
    this.d.store.set("owner_chat_jid", chat);
    let reply: string;
    try {
      const [cmd, arg, ...more] = text.split(/\s+/);
      if (cmd === "שלח" && this.d.sendNow) {
        const c = this.findChannel(arg);
        if (!c) reply = `לא מצאתי ערוץ "${arg ?? ""}". שלח: ערוצים`;
        else {
          const r = await this.d.sendNow(c.id, more.join(" ") || "חידה");
          reply = "error" in r ? `❌ ${r.error}` : `⚡ יוצא עכשיו ל${c.name}:\n${r.text}`;
        }
      } else if (cmd === "לכולם") {
        const msg = text.slice(text.indexOf(" ") + 1).trim();
        const n = msg && text.includes(" ") ? this.d.scheduler.broadcast(msg, this.d.now()) : 0;
        reply = n > 0 ? `📢 נשלח ל-${n} ערוצים` : "כותבים: לכולם <ההודעה>";
      } else reply = this.execute(text);
    } catch (err) {
      reply = `שגיאה: ${(err as Error).message}`;
    }
    logger.info({ command: text.slice(0, 60) }, "owner command");
    await this.d.direct(chat, reply);
  }
}
