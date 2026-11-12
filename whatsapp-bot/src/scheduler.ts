import type { AppConfig, ChannelConfig, Settings } from "./config.js";
import type { PostPayload, QueueRow, Store } from "./db.js";
import type { CardImage } from "./media/cards.js";
import type { VideoClip } from "./media/video.js";
import { DAY, HOUR, MINUTE, dayKey, hash32, hourOfDay } from "./time.js";
import { canPost } from "./wa/channels.js";
import type { SendResult, Sender } from "./wa/sender.js";

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

export function inQuietHours(s: Settings, now: number): boolean {
  const q = s.quietHours;
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
    const active = all.slice(0, rolloutCount(this.s, started, now, all.length));
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
      if (!channel || !channel.enabled || !state.jid || !canPost(state.role) || state.paused || stale) {
        store.markStatus(row.id, "discarded", now);
        continue;
      }
      if (inQuietHours(this.s, now)) continue;
      await this.publish(row, channel, state.jid, now);
      return true;
    }

    // 2. the channel whose slot has been waiting longest
    const due: { channel: ChannelConfig; slot: number }[] = [];
    for (const channel of active) {
      const slot = currentSlot(now, channel.id, this.s);
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
      if (inQuietHours(this.s, now)) continue;
      if (!state.jid) {
        store.event(now, "warn", "not_resolved", "channel address is not known yet", channel.id);
        continue;
      }
      if (!canPost(state.role)) {
        store.event(now, "warn", "not_admin", `the bot is not an admin of this channel (role: ${state.role ?? "none"})`, channel.id);
        continue;
      }
      const cap = dailyCap(channel, this.s, state.activated_at, now);
      if (cap !== null) {
        if (store.sentOnDay(channel.id, dayKey(now, this.s.timezone)) >= cap) continue;
        if (now - state.last_post_ts < minSpacingMs(cap)) continue;
      }
      const row = store.nextReady(channel.id, now);
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
        const res = "image" in built ? await sender.image(jid, built.image, p.text) : await sender.video(jid, built.video, p.text);
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
      if (!row.is_followup) store.updateChannel(channel.id, { last_post_ts: now });
      if (res.sentAs === "poll") this.noteCapability("poll", true, now);
      if (res.sentAs === "image" || res.sentAs === "video") this.noteCapability("media", true, now);
      if (row.payload.followup && !row.is_followup) {
        const [lo, hi] = this.s.followupDelayMinutes;
        const delay = (Math.min(lo, hi) + this.rand() * Math.abs(hi - lo)) * MINUTE;
        store.enqueue({ channelId: channel.id, payload: { kind: "text", text: row.payload.followup }, notBefore: now + delay, isFollowup: true, now });
      }
      if (res.sentAs === "poll" && !row.is_followup) this.maybeInvade(channel, now);
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
