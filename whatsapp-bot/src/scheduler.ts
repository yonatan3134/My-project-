import type { AppConfig, ChannelConfig, Settings } from "./config.js";
import type { PostPayload, QueueRow, Store } from "./db.js";
import type { CardImage } from "./media/cards.js";
import type { VideoClip } from "./media/video.js";
import { DAY, HOUR, MINUTE, dayKey, hash32, hourOfDay } from "./time.js";
import { canPost } from "./wa/channels.js";
import type { SendResult, Sender } from "./wa/sender.js";

export const MILESTONES = [100, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 250000, 500000, 1000000];

export interface CountdownEvent {
  id: string;
  name: string;
  /** YYYY-MM-DD in the bot's time zone */
  date: string;
  /** a channel id, or "all" */
  channel: string;
  /** hour of day from which the day's post goes out */
  hour: number;
  text?: string;
}

export interface MediaMaker {
  image(payload: PostPayload, channel: ChannelConfig, seed: string): Promise<CardImage>;
  video(payload: PostPayload, channel: ChannelConfig, seed: string): Promise<VideoClip>;
}

export interface SchedulerDeps {
  store: Store;
  config: AppConfig;
  sender: Sender;
  media: MediaMaker;
  now: () => number;
  random?: () => number;
  isConnected: () => boolean;
}

// ---- pure timing rules -----------------------------------------------------

export function cycleMs(s: Settings): number {
  return (s.cycle.postsPerBurst * s.cycle.intervalMinutes + s.cycle.pauseMinutes) * MINUTE;
}

/** Each channel runs the same cycle shifted by its own fixed offset, so channels do not all post at the same minute. */
export function phaseOf(channelId: string, s: Settings): number {
  return hash32(channelId) % cycleMs(s);
}

/**
 * Start time of the posting slot that `now` falls in, or null during the
 * pause part of the cycle. With the default settings a channel has slots at
 * 0:00, 1:00 and 2:00 of every five-hour cycle.
 */
export function currentSlot(now: number, channelId: string, s: Settings): number | null {
  const cycle = cycleMs(s);
  const interval = s.cycle.intervalMinutes * MINUTE;
  const pos = (((now - phaseOf(channelId, s)) % cycle) + cycle) % cycle;
  const idx = Math.floor(pos / interval);
  if (idx >= s.cycle.postsPerBurst) return null;
  return now - (pos - idx * interval);
}

const POSTING_MODES = new Set(["creative", "fandom", "news"]);

export function postingChannels(channels: ChannelConfig[]): ChannelConfig[] {
  return channels.filter((c) => c.enabled && POSTING_MODES.has(c.mode));
}

/** How many channels are switched on at this point of the gradual start. */
export function rolloutCount(s: Settings, startedAt: number, now: number, total: number): number {
  let elapsed = (now - startedAt) / DAY;
  for (const stage of s.rollout) {
    if (elapsed < stage.days) return Math.min(stage.channels, total);
    elapsed -= stage.days;
  }
  return total;
}

/** The lowest daily limit that applies to a channel right now, or null when only the cycle limits it. */
export function dailyCap(channel: ChannelConfig, s: Settings, activatedAt: number | null, now: number): number | null {
  const caps: number[] = [];
  if (channel.maxPerDay) caps.push(channel.maxPerDay);
  else if (channel.mode === "fandom") caps.push(s.fandomMaxPerDay);
  else if (channel.mode === "news") caps.push(s.newsMaxPerDay);
  if (activatedAt !== null) {
    let age = (now - activatedAt) / DAY;
    for (const stage of s.warmup) {
      if (age < stage.days) {
        caps.push(stage.maxPerDay);
        break;
      }
      age -= stage.days;
    }
  }
  return caps.length > 0 ? Math.min(...caps) : null;
}

/** With a daily limit, posts are spread over the day instead of all going out in the morning. */
export function minSpacingMs(cap: number | null): number {
  return cap === null ? 0 : Math.floor((DAY / cap) * 0.6);
}

/** In growth mode the bot stays quiet at night: posts sent while followers sleep get buried and annoy. */
export const GROWTH_QUIET = { from: 0, to: 7 };

/**
 * Roughly Shabbat in Israel: from Friday afternoon to Saturday night. The
 * times are approximate (earlier in winter, later in summer), with a margin.
 */
export function inShabbat(now: number, tz: string): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", month: "numeric", hourCycle: "h23" }).formatToParts(new Date(now));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = get("weekday");
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  const month = Number(get("month"));
  const summer = month >= 4 && month <= 10;
  const start = summer ? 18 * 60 + 30 : 16 * 60; // Friday, before candle lighting
  const end = summer ? 20 * 60 + 30 : 17 * 60 + 45; // Saturday, after Shabbat ends
  if (day === "Fri") return minutes >= start;
  if (day === "Sat") return minutes < end;
  return false;
}

/** The general settings with this channel's own rhythm, when it has one. */
export function channelSettings(channel: ChannelConfig, s: Settings): Settings {
  return channel.cycle ? { ...s, cycle: channel.cycle } : s;
}

export function inQuietHours(s: Settings, now: number, growth = false): boolean {
  const q = s.quietHours ?? (growth ? GROWTH_QUIET : null);
  if (!q || q.from === q.to) return false;
  const h = hourOfDay(now, s.timezone);
  return q.from < q.to ? h >= q.from && h < q.to : h >= q.from || h < q.to;
}

// ---- text forms of posts that could not go out in their own format ----------

const NUMBER_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣"];

export function pollAsText(p: PostPayload): string {
  const lines = (p.pollOptions ?? []).map((o, i) => `${NUMBER_EMOJI[i] ?? "▫️"} ${o}`);
  return `*${p.pollQuestion ?? ""}*\n\n${lines.join("\n")}\n\nמגיבים עם האימוג'י של התשובה שלכם 👇`;
}

export function mediaAsText(p: PostPayload): string {
  return [p.cardText ? `*${p.cardText}*` : "", p.text].filter(Boolean).join("\n\n");
}

export function invasionText(target: ChannelConfig, emoji: string): string {
  return `😈 *פלישה לערוץ!*\n\nחברים, פולשים עכשיו לערוץ *${target.name}*\nנכנסים ומגיבים ${emoji} לכל ההודעות האחרונות 👇\nhttps://whatsapp.com/channel/${target.invite}`;
}

// ---- the scheduler ---------------------------------------------------------

const CAPABILITY_FAILURES = 3;
const CAPABILITY_OFF_MS = 6 * HOUR;
const CAPABILITY_OFF_MAX_MS = 24 * HOUR;
const MAX_ATTEMPTS = 3;

export class Scheduler {
  private nextSendAt = 0;
  private busy = false;

  constructor(private d: SchedulerDeps) {}

  private get s(): Settings {
    return this.d.config.settings;
  }

  private rand(): number {
    return (this.d.random ?? Math.random)();
  }

  /** The gradual start (few channels and few posts a day at first). The owner can switch it off on the website. */
  gradual(): boolean {
    return this.d.store.get("gradual") === "1"; // off unless the owner switches it on
  }

  /** The daily limit for a channel, with the warm-up part only while the gradual start is on. */
  capFor(channel: ChannelConfig, now: number): number | null {
    const state = this.d.store.channel(channel.id);
    return dailyCap(channel, this.s, this.gradual() ? state.activated_at : null, now);
  }

  /**
   * Why a channel is or is not posting, in words for the website, and when
   * its next post is expected. Mirrors the checks the scheduler makes.
   */
  explain(channel: ChannelConfig, now: number): { status: string; ok: boolean; next: number | null } {
    const { store } = this.d;
    const state = store.channel(channel.id);
    if (!channel.enabled || channel.mode === "off") return { status: "כבוי", ok: false, next: null };
    if (channel.mode === "invasion") return { status: "ערוץ פלישה: מפרסם כשיש סקר בערוץ אחר", ok: true, next: null };
    if (this.isPaused()) return { status: "כל הפרסומים עצורים", ok: false, next: null };
    if (state.paused) return { status: "הערוץ עצור", ok: false, next: null };
    if (this.shabbat(channel.id) && inShabbat(now, this.s.timezone)) return { status: "שבת: חוזר לפרסם במוצאי שבת", ok: true, next: null };
    if (!this.d.isConnected()) return { status: "הבוט לא מחובר לוואטסאפ", ok: false, next: null };
    if (!state.jid) return { status: "הערוץ עוד לא נמצא בוואטסאפ", ok: false, next: null };
    if (!canPost(state.role)) return { status: "הבוט לא מנהל בערוץ", ok: false, next: null };
    if (!this.activeChannels(now).some((c) => c.id === channel.id)) {
      return { status: "מחכה לתורו בהתחלה ההדרגתית", ok: false, next: null };
    }
    const cap = this.capFor(channel, now);
    const sent = store.sentOnDay(channel.id, dayKey(now, this.s.timezone));
    if (cap !== null && sent >= cap) return { status: `פרסם היום ${sent} מתוך ${cap} (המקסימום היומי)`, ok: true, next: null };
    if (store.readyCount(channel.id) === 0 && !channel.special?.text.trim()) {
      if (store.pendingList(channel.id, 1).length > 0) return { status: "יש פוסטים שמחכים לאישור שלך", ok: false, next: null };
      if (channel.mode !== "creative") return { status: "אין כרגע חדשות או סרטונים חדשים לפרסם", ok: true, next: null };
      return { status: "אין פוסטים מוכנים: ה-AI לא כתב (בדוק את המודלים)", ok: false, next: null };
    }
    const cs = channelSettings(channel, this.s);
    const notBefore = cap !== null ? state.last_post_ts + minSpacingMs(cap) : 0;
    // the first slot from now on that is not used yet, not in quiet hours, and after the spacing
    for (let t = now; t < now + 2 * DAY; t += 5 * MINUTE) {
      const slot = currentSlot(t, channel.id, cs);
      if (slot === null || slot <= state.last_slot_ts || slot < now - this.s.send.graceMinutes * MINUTE) continue;
      if (inQuietHours(this.s, t, this.growth()) || t < notBefore) continue;
      return { status: "פעיל", ok: true, next: Math.max(slot, t) };
    }
    return { status: "פעיל", ok: true, next: null };
  }

  /** "No posts on Shabbat" switched on for this channel on the website. */
  shabbat(channelId: string): boolean {
    return this.d.store.get(`shabbat:${channelId}`) === "1";
  }

  growth(): boolean {
    return this.d.store.get("growth") === "1";
  }

  isPaused(): boolean {
    return this.d.store.get("paused") === "1";
  }

  /** Channels that are switched on right now. Also stamps the moment each one was first switched on. */
  activeChannels(now: number): ChannelConfig[] {
    const { store } = this.d;
    const all = postingChannels(this.d.config.channels);
    let started = store.getNumber("rollout_started_at");
    if (started === null) {
      started = now;
      store.set("rollout_started_at", String(now));
    }
    const active = this.gradual() ? all.slice(0, rolloutCount(this.s, started, now, all.length)) : all;
    for (const c of active) {
      if (store.channel(c.id).activated_at === null) store.updateChannel(c.id, { activated_at: now });
    }
    return active;
  }

  private capabilityOff(kind: "poll" | "media", now: number): boolean {
    return (this.d.store.getNumber(`${kind}_off_until`) ?? 0) > now;
  }

  /**
   * Tracks whether WhatsApp accepts polls / media from this bot. Three
   * rejections in a row switch the format off (posts go out as text
   * instead). When the pause ends a single post probes again: if it is
   * rejected too, the pause doubles, up to a day.
   */
  private noteCapability(kind: "poll" | "media", ok: boolean, now: number, detail = ""): void {
    const { store } = this.d;
    if (ok) {
      store.set(`${kind}_failures`, "0");
      store.set(`${kind}_off_ms`, "0");
      return;
    }
    const n = (store.getNumber(`${kind}_failures`) ?? 0) + 1;
    if (n < CAPABILITY_FAILURES) {
      store.set(`${kind}_failures`, String(n));
      return;
    }
    const previous = store.getNumber(`${kind}_off_ms`) ?? 0;
    const pause = previous > 0 ? Math.min(previous * 2, CAPABILITY_OFF_MAX_MS) : CAPABILITY_OFF_MS;
    store.set(`${kind}_off_ms`, String(pause));
    store.set(`${kind}_off_until`, String(now + pause));
    store.set(`${kind}_failures`, String(CAPABILITY_FAILURES - 1));
    store.event(now, "error", `${kind}_disabled`, `${kind} posts keep being rejected and are sent as text for ${Math.round(pause / HOUR)} hours. ${detail}`.trim());
  }

  /** One pass: publishes at most one post, so sends are naturally spaced out. Returns true when something was sent. */
  async tick(): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      return await this.step();
    } finally {
      this.busy = false;
    }
  }

  private async step(): Promise<boolean> {
    const now = this.d.now();
    const { store } = this.d;
    if (this.isPaused() || !this.d.isConnected() || now < this.nextSendAt) return false;
    const active = this.activeChannels(now);
    const byId = new Map(this.d.config.channels.map((c) => [c.id, c]));

    // 1. direct posts whose time has come (riddle answers, invasion calls)
    for (const row of store.dueFollowups(now)) {
      const channel = byId.get(row.channel_id);
      const state = store.channel(row.channel_id);
      const stale = now - row.not_before > 3 * HOUR;
      if (!channel || !channel.enabled || !state.jid || !canPost(state.role) || (state.paused && !row.manual) || stale) {
        store.markStatus(row.id, "discarded", now);
        continue;
      }
      if (!row.manual && inQuietHours(this.s, now, this.growth())) continue;
      if (!row.manual && this.shabbat(channel.id) && inShabbat(now, this.s.timezone)) continue;
      await this.publish(row, channel, state.jid, now);
      return true;
    }

    // 2. the channel whose slot has been waiting longest
    const due: { channel: ChannelConfig; slot: number }[] = [];
    for (const channel of active) {
      const slot = currentSlot(now, channel.id, channelSettings(channel, this.s));
      if (slot === null) continue;
      const state = store.channel(channel.id);
      if (slot <= state.last_slot_ts) continue;
      if (now - slot > this.s.send.graceMinutes * MINUTE) {
        // too late for this slot (the bot was down or busy): skip it rather than post in a burst
        store.updateChannel(channel.id, { last_slot_ts: slot });
        continue;
      }
      due.push({ channel, slot });
    }
    due.sort((a, b) => a.slot - b.slot);

    for (const { channel, slot } of due) {
      const state = store.channel(channel.id);
      // whatever happens below, this slot is used up
      store.updateChannel(channel.id, { last_slot_ts: slot });
      if (state.paused) continue;
      if (inQuietHours(this.s, now, this.growth())) continue;
      if (this.shabbat(channel.id) && inShabbat(now, this.s.timezone)) continue;
      if (!state.jid) {
        store.event(now, "warn", "not_resolved", "channel address is not known yet", channel.id);
        continue;
      }
      if (!canPost(state.role)) {
        store.event(now, "warn", "not_admin", `the bot is not an admin of this channel (role: ${state.role ?? "none"})`, channel.id);
        continue;
      }
      const cap = this.capFor(channel, now);
      if (cap !== null) {
        if (store.sentOnDay(channel.id, dayKey(now, this.s.timezone)) >= cap) continue;
        if (now - state.last_post_ts < minSpacingMs(cap)) continue;
      }
      const row = this.specialDue(channel, now) ?? store.nextReady(channel.id, now);
      if (!row) {
        if (channel.mode === "creative") store.event(now, "warn", "queue_empty", "no post was ready for this slot", channel.id);
        continue;
      }
      await this.publish(row, channel, state.jid, now);
      return true;
    }
    return false;
  }

  private async send(p: PostPayload, channel: ChannelConfig, jid: string, seed: string, now: number): Promise<SendResult & { sentAs: string }> {
    const { sender, media } = this.d;
    if (p.kind === "text") return { ...(await sender.text(jid, p.text)), sentAs: "text" };

    if (p.kind === "poll") {
      if (!this.capabilityOff("poll", now)) {
        const res = await sender.poll(jid, p.pollQuestion ?? "", p.pollOptions ?? []);
        if (res.ok || res.uncertain || res.error === "not connected") return { ...res, sentAs: "poll" };
        this.noteCapability("poll", false, now, res.error);
        this.d.store.event(now, "warn", "poll_failed", res.error ?? "", channel.id);
      }
      return { ...(await sender.text(jid, pollAsText(p))), sentAs: "text" };
    }

    if (!this.capabilityOff("media", now)) {
      let built: { image: CardImage } | { video: VideoClip } | null = null;
      try {
        built = p.kind === "image" ? { image: await media.image(p, channel, seed) } : { video: await media.video(p, channel, seed) };
      } catch (err) {
        // a local problem (ffmpeg, fonts), not WhatsApp's: fall through to text without counting it against media
        this.d.store.event(now, "warn", "media_build_failed", (err as Error).message, channel.id);
      }
      if (built) {
        const media = "image" in built ? built.image : built.video;
        const caption = [media.captionExtra ? `*${media.captionExtra}*` : "", p.text].filter(Boolean).join("\n\n");
        const res = "image" in built ? await sender.image(jid, built.image, caption) : await sender.video(jid, built.video, caption);
        if (res.ok || res.uncertain || res.error === "not connected") return { ...res, sentAs: p.kind };
        this.noteCapability("media", false, now, res.error);
        this.d.store.event(now, "warn", "media_failed", res.error ?? "", channel.id);
      }
    }
    return { ...(await sender.text(jid, mediaAsText(p))), sentAs: "text" };
  }

  private async publish(row: QueueRow, channel: ChannelConfig, jid: string, now: number): Promise<void> {
    const { store } = this.d;
    // Claim the row first. If the process dies after this line the row stays
    // 'sending' and is never sent again, so a crash cannot cause a double post.
    if (!store.markSending(row.id, now)) return;

    let res: SendResult & { sentAs: string };
    try {
      res = await this.send(row.payload, channel, jid, `${channel.id}:${row.id}`, now);
    } catch (err) {
      res = { ok: false, uncertain: true, error: (err as Error).message, sentAs: row.payload.kind };
    }
    const gap = this.s.send.minGapSeconds + this.rand() * (this.s.send.maxGapSeconds - this.s.send.minGapSeconds);
    this.nextSendAt = now + gap * 1000;

    if (res.ok) {
      store.markSent(row.id, res.id ?? null, now, dayKey(now, this.s.timezone));
      if (!row.is_followup) {
        store.updateChannel(channel.id, { last_post_ts: now });
        const key = `special_count:${channel.id}`;
        store.set(key, row.special ? "0" : String((store.getNumber(key) ?? 0) + 1));
      }
      if (res.sentAs === "poll") this.noteCapability("poll", true, now);
      if (res.sentAs === "image" || res.sentAs === "video") this.noteCapability("media", true, now);
      // a riddle's answer follows it, also when the riddle was sent with "send now"
      if (row.payload.followup) {
        const [lo, hi] = this.s.followupDelayMinutes;
        const delay = (Math.min(lo, hi) + this.rand() * Math.abs(hi - lo)) * MINUTE;
        store.enqueue({ channelId: channel.id, payload: { kind: "text", text: row.payload.followup }, notBefore: now + delay, isFollowup: true, manual: row.manual === 1, now });
      }
      if (res.sentAs === "poll" && !row.is_followup) this.maybeInvade(channel, now);
      if (!row.is_followup && this.growth()) this.maybePromote(channel, now);
      return;
    }

    if (res.uncertain) {
      store.markStatus(row.id, "unknown", now);
      store.event(now, "warn", "send_uncertain", res.error ?? "", channel.id);
      return;
    }
    if (res.error === "not connected" || row.attempts + 1 < MAX_ATTEMPTS) {
      store.markRetry(row.id, now);
    } else {
      store.markStatus(row.id, "failed", now);
    }
    store.event(now, "warn", "send_failed", res.error ?? "", channel.id);
  }

  /**
   * Growth mode: once a day each channel recommends one of the owner's other
   * channels, preferring one on a similar topic. Channels grow mostly from
   * outside links, and here the other channels are the outside.
   */
  private maybePromote(channel: ChannelConfig, now: number): void {
    const { store } = this.d;
    const day = dayKey(now, this.s.timezone);
    const key = `promo:${channel.id}`;
    if (store.get(key) === day) return;
    const others = postingChannels(this.d.config.channels).filter((c) => c.id !== channel.id);
    if (others.length === 0) return;
    const sameGroup = others.filter((c) => c.group && c.group === channel.group);
    const pool = sameGroup.length > 0 && hash32(`${day}:${channel.id}`) % 2 === 0 ? sameGroup : others;
    const target = pool[hash32(`${channel.id}:${day}`) % pool.length];
    if (!target) return;
    store.set(key, day);
    const lines = [
      `💜 מכירים את *${target.name}*? אם אתם אוהבים את הערוץ הזה, תאהבו גם אותו 👇`,
      `👀 טיפ: גם *${target.name}* שווה מעקב 👇`,
      `🔥 עוד ערוץ שכדאי לכם: *${target.name}* 👇`,
    ];
    const text = `${lines[hash32(day + target.id) % lines.length]}\nhttps://whatsapp.com/channel/${target.invite}`;
    const delay = (15 + this.rand() * 15) * MINUTE;
    store.enqueue({ channelId: channel.id, payload: { kind: "text", text }, notBefore: now + delay, isFollowup: true, now });
  }

  /**
   * The owner's special post, when its turn has come: after every N-1
   * regular posts. A fixed text is queued on the spot; an AI-written one is
   * taken from the queue (if it is not written yet, a regular post goes out
   * and the special one follows next time).
   */
  private specialDue(channel: ChannelConfig, now: number): QueueRow | null {
    const sp = channel.special;
    if (!sp) return null;
    const { store } = this.d;
    if ((store.getNumber(`special_count:${channel.id}`) ?? 0) < sp.every - 1) return null;
    if (sp.text.trim()) {
      const id = store.enqueue({ channelId: channel.id, payload: { kind: "text", text: sp.text.trim() }, special: true, now });
      return store.queueRow(id);
    }
    return store.nextReady(channel.id, now, true);
  }

  /**
   * "Push" a channel: a recommendation with its link goes out in every other
   * channel the bot posts in, one after another. At most once in 12 hours per channel.
   */
  pushChannel(target: ChannelConfig, now: number, message?: string): number | string {
    const { store } = this.d;
    const last = store.getNumber(`push_last:${target.id}`) ?? 0;
    if (now - last < 12 * HOUR) return "הערוץ הזה כבר נדחף ב-12 השעות האחרונות";
    const text = message?.trim()
      ? `${message.trim()}\n\n👇 https://whatsapp.com/channel/${target.invite}`
      : `📣 *ערוץ מומלץ!*\n\n✨ *${target.name}* ✨\n\nהצטרפו עכשיו, מחכה לכם שם תוכן שווה 👇\nhttps://whatsapp.com/channel/${target.invite}`;
    let n = 0;
    for (const c of this.d.config.channels) {
      if (c.id === target.id || !c.enabled || c.mode === "off") continue;
      const st = store.channel(c.id);
      if (!st.jid || !canPost(st.role) || st.paused) continue;
      store.enqueue({ channelId: c.id, payload: { kind: "text", text }, notBefore: now, isFollowup: true, now });
      n++;
    }
    if (n > 0) store.set(`push_last:${target.id}`, String(now));
    return n;
  }

  /**
   * One message from the owner to every channel the bot posts in (paused
   * channels are skipped). They go out one after another, 20-45 seconds apart.
   */
  broadcast(text: string, now: number): number {
    const { store } = this.d;
    let n = 0;
    for (const c of this.d.config.channels) {
      if (!c.enabled || c.mode === "off") continue;
      const st = store.channel(c.id);
      if (!st.jid || !canPost(st.role) || st.paused) continue;
      store.enqueue({ channelId: c.id, payload: { kind: "text", text }, notBefore: now, isFollowup: true, manual: true, now });
      n++;
    }
    return n;
  }

  /**
   * Celebrates round follower counts (100, 250, 500, 1,000 ...). The first
   * count seen for a channel only sets the starting point, so old milestones
   * are not celebrated late. Returns true when a celebration was queued.
   */
  milestone(channel: ChannelConfig, followers: number, now: number): boolean {
    const { store } = this.d;
    if (store.get("milestones") === "0") return false;
    const reached = MILESTONES.filter((m) => followers >= m).at(-1) ?? 0;
    const key = `milestone:${channel.id}`;
    const last = store.getNumber(key);
    if (last === null || reached <= last) {
      if (last === null) store.set(key, String(reached));
      return false;
    }
    store.set(key, String(reached));
    const next = MILESTONES.find((m) => m > reached);
    const text = `🎉 *הגענו ל-${reached.toLocaleString("en-US")} עוקבים!*\n\nתודה לכל אחד ואחת מכם 💜${next ? `\nשתפו את הערוץ עם חברים ונגיע ל-${next.toLocaleString("en-US")} 🚀` : ""}\nhttps://whatsapp.com/channel/${channel.invite}`;
    store.enqueue({ channelId: channel.id, payload: { kind: "text", text }, notBefore: now, isFollowup: true, now });
    return true;
  }

  /**
   * Countdown events from the website: in the last 7 days before an event
   * each chosen channel gets one post a day ("עוד 3 ימים ל..."), and on the
   * day itself "היום!". Posts go out from the event's hour on.
   */
  countdowns(events: CountdownEvent[], now: number): number {
    const { store } = this.d;
    const today = dayKey(now, this.s.timezone);
    const hour = hourOfDay(now, this.s.timezone);
    let queued = 0;
    for (const ev of events) {
      const days = Math.round((Date.parse(`${ev.date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / DAY);
      if (days < 0 || days > 7 || hour < ev.hour) continue;
      const key = `event_sent:${ev.id}:${today}`;
      if (store.get(key)) continue;
      store.set(key, "1");
      const text =
        days === 0
          ? `🎉 *היום: ${ev.name}!*${ev.text ? `\n\n${ev.text}` : ""}`
          : `⏳ *עוד ${days === 1 ? "יום אחד" : `${days} ימים`} ל${ev.name}!*${ev.text ? `\n\n${ev.text}` : ""}\n\nמי מחכה? 🔥`;
      const targets = ev.channel === "all" ? this.d.config.channels.filter((c) => c.enabled && c.mode !== "off") : this.d.config.channels.filter((c) => c.id === ev.channel);
      for (const c of targets) {
        const st = store.channel(c.id);
        if (!st.jid || !canPost(st.role) || st.paused) continue;
        store.enqueue({ channelId: c.id, payload: { kind: "text", text }, notBefore: now, isFollowup: true, now });
        queued++;
      }
    }
    return queued;
  }

  /** Queues a call in the invasion channel pointing at `target`. Returns false when there is no usable invasion channel. */
  queueInvasion(target: ChannelConfig, now: number, emoji?: string): boolean {
    const { store } = this.d;
    const inv = this.d.config.channels.find((c) => c.mode === "invasion" && c.enabled);
    if (!inv || inv.id === target.id) return false;
    const state = store.channel(inv.id);
    if (!state.jid || !canPost(state.role)) return false;
    const emojis = this.s.invasion.emojis;
    const chosen = emoji ?? emojis[Math.floor(this.rand() * emojis.length)] ?? "🔥";
    store.enqueue({ channelId: inv.id, payload: { kind: "text", text: invasionText(target, chosen) }, notBefore: now, isFollowup: true, now });
    return true;
  }

  private maybeInvade(target: ChannelConfig, now: number): void {
    const { store } = this.d;
    if (this.s.invasion.maxPerDay <= 0) return;
    const day = dayKey(now, this.s.timezone);
    const count = store.get("invasion_day") === day ? (store.getNumber("invasion_count") ?? 0) : 0;
    if (count >= this.s.invasion.maxPerDay) return;
    if (now - (store.getNumber("invasion_last") ?? 0) < 4 * HOUR) return;
    if (store.get("invasion_last_target") === target.id) return;
    if (!this.queueInvasion(target, now)) return;
    store.set("invasion_day", day);
    store.set("invasion_count", String(count + 1));
    store.set("invasion_last", String(now));
    store.set("invasion_last_target", target.id);
  }
}
