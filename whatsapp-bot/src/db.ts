import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type PostKind = "text" | "poll" | "image" | "video";

/** Everything needed to publish one post. Stored as JSON in the queue. */
export interface PostPayload {
  kind: PostKind;
  /** full text of a text post, or the caption of an image/video post */
  text: string;
  pollQuestion?: string;
  pollOptions?: string[];
  /** short text drawn on the picture */
  cardText?: string;
  /** English keywords for an optional stock background */
  visualQuery?: string;
  /** answer / reveal that is published later as a separate message */
  followup?: string;
}

export type QueueStatus = "ready" | "sending" | "sent" | "failed" | "discarded" | "unknown";

export interface QueueRow {
  id: number;
  channel_id: string;
  grp: string | null;
  kind: PostKind;
  payload: PostPayload;
  topic_key: string;
  norm_text: string;
  norm_hash: string;
  status: QueueStatus;
  not_before: number;
  /** 1 = sent as soon as it is due instead of waiting for the channel's next slot (answers, invasion calls) */
  is_followup: number;
  attempts: number;
  source_item_id: number | null;
  created_at: number;
  sent_at: number | null;
}

export interface ChannelState {
  id: string;
  jid: string | null;
  live_name: string | null;
  role: string | null;
  resolved_at: number | null;
  activated_at: number | null;
  last_slot_ts: number;
  last_post_ts: number;
  paused: number;
  sources_checked_at: number;
  retry_at: number;
}

export interface SourceItem {
  id: number;
  channel_id: string;
  guid: string;
  title: string;
  source: string;
  snippet: string;
  link: string;
  published_at: number;
  state: "new" | "used" | "skipped";
}

export interface DedupRow {
  norm_text: string;
  norm_hash: string;
  topic_key: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  jid TEXT,
  live_name TEXT,
  role TEXT,
  resolved_at INTEGER,
  activated_at INTEGER,
  last_slot_ts INTEGER NOT NULL DEFAULT 0,
  last_post_ts INTEGER NOT NULL DEFAULT 0,
  paused INTEGER NOT NULL DEFAULT 0,
  sources_checked_at INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  grp TEXT,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  topic_key TEXT NOT NULL DEFAULT '',
  norm_text TEXT NOT NULL DEFAULT '',
  norm_hash TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ready',
  not_before INTEGER NOT NULL DEFAULT 0,
  is_followup INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  source_item_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sent_at INTEGER,
  day_key TEXT,
  wa_msg_id TEXT
);
CREATE INDEX IF NOT EXISTS queue_channel_status ON queue (channel_id, status, id);
CREATE INDEX IF NOT EXISTS queue_grp ON queue (grp, id);
CREATE INDEX IF NOT EXISTS queue_day ON queue (channel_id, day_key);

CREATE TABLE IF NOT EXISTS source_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  guid TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  published_at INTEGER NOT NULL DEFAULT 0,
  fetched_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'new',
  UNIQUE (channel_id, guid)
);

CREATE TABLE IF NOT EXISTS style_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL,
  channel_id TEXT,
  kind TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_ts ON events (ts);

CREATE TABLE IF NOT EXISTS usage (
  day_key TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0
);
`;

/** Statuses that count as "already used" when looking for repeats. */
const HISTORY_STATUSES = "('ready','sending','sent','unknown')";

interface RawQueueRow extends Omit<QueueRow, "payload"> {
  payload: string;
}

function toQueueRow(r: RawQueueRow): QueueRow {
  return { ...r, payload: JSON.parse(r.payload) as PostPayload };
}

export class Store {
  readonly db: Database.Database;
  /** compiled statements, reused: the scheduler runs the same few queries all day */
  private statements = new Map<string, Database.Statement>();

  private q(sql: string): Database.Statement {
    let st = this.statements.get(sql);
    if (!st) {
      st = this.db.prepare(sql);
      this.statements.set(sql, st);
    }
    return st;
  }

  constructor(file: string) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.statements.clear();
    this.db.close();
  }

  // ---- key/value ----------------------------------------------------------

  get(key: string): string | null {
    const row = this.q("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    this.q("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  getNumber(key: string): number | null {
    const v = this.get(key);
    return v === null ? null : Number(v);
  }

  // ---- channels -----------------------------------------------------------

  channel(id: string): ChannelState {
    this.q("INSERT OR IGNORE INTO channels (id) VALUES (?)").run(id);
    return this.q("SELECT * FROM channels WHERE id = ?").get(id) as ChannelState;
  }

  updateChannel(id: string, fields: Partial<Omit<ChannelState, "id">>): void {
    const keys = Object.keys(fields) as (keyof typeof fields)[];
    if (keys.length === 0) return;
    this.channel(id);
    const sql = `UPDATE channels SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`;
    this.q(sql).run(...keys.map((k) => fields[k] as string | number | null), id);
  }

  // ---- queue --------------------------------------------------------------

  enqueue(row: {
    channelId: string;
    group?: string | null;
    payload: PostPayload;
    topicKey?: string;
    normText?: string;
    normHash?: string;
    notBefore?: number;
    isFollowup?: boolean;
    sourceItemId?: number | null;
    now: number;
  }): number {
    const info = this.db
      .prepare(
        `INSERT INTO queue (channel_id, grp, kind, payload, topic_key, norm_text, norm_hash, not_before, is_followup, source_item_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.channelId,
        row.group ?? null,
        row.payload.kind,
        JSON.stringify(row.payload),
        row.topicKey ?? "",
        row.normText ?? "",
        row.normHash ?? "",
        row.notBefore ?? 0,
        row.isFollowup ? 1 : 0,
        row.sourceItemId ?? null,
        row.now,
        row.now,
      );
    return Number(info.lastInsertRowid);
  }

  readyCount(channelId: string): number {
    const r = this.db
      .prepare("SELECT COUNT(*) AS n FROM queue WHERE channel_id = ? AND status = 'ready' AND is_followup = 0")
      .get(channelId) as { n: number };
    return r.n;
  }

  nextReady(channelId: string, now: number): QueueRow | null {
    const r = this.db
      .prepare(
        // posts based on a news item go first, while the news is still fresh
        "SELECT * FROM queue WHERE channel_id = ? AND status = 'ready' AND is_followup = 0 AND not_before <= ? ORDER BY (source_item_id IS NULL), id LIMIT 1",
      )
      .get(channelId, now) as RawQueueRow | undefined;
    return r ? toQueueRow(r) : null;
  }

  dueFollowups(now: number): QueueRow[] {
    const rows = this.db
      .prepare("SELECT * FROM queue WHERE status = 'ready' AND is_followup = 1 AND not_before <= ? ORDER BY not_before LIMIT 20")
      .all(now) as RawQueueRow[];
    return rows.map(toQueueRow);
  }

  queueRow(id: number): QueueRow | null {
    const r = this.q("SELECT * FROM queue WHERE id = ?").get(id) as RawQueueRow | undefined;
    return r ? toQueueRow(r) : null;
  }

  /** Claims a row for sending. Returns false if it is no longer 'ready' (so it can never be sent twice). */
  markSending(id: number, now: number): boolean {
    const info = this.db
      .prepare("UPDATE queue SET status = 'sending', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'ready'")
      .run(now, id);
    return info.changes === 1;
  }

  markSent(id: number, waMsgId: string | null, now: number, day: string): void {
    this.db
      .prepare("UPDATE queue SET status = 'sent', sent_at = ?, day_key = ?, wa_msg_id = ?, updated_at = ? WHERE id = ?")
      .run(now, day, waMsgId, now, id);
  }

  /** Send definitely did not happen: put the row back so a later slot retries it. */
  markRetry(id: number, now: number, notBefore = 0): void {
    this.q("UPDATE queue SET status = 'ready', not_before = ?, updated_at = ? WHERE id = ?").run(notBefore, now, id);
  }

  markStatus(id: number, status: "failed" | "discarded" | "unknown", now: number): void {
    this.q("UPDATE queue SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
  }

  updatePayload(id: number, payload: PostPayload): void {
    this.q("UPDATE queue SET kind = ?, payload = ? WHERE id = ?").run(payload.kind, JSON.stringify(payload), id);
  }

  /**
   * Rows left in 'sending' by a crash may or may not have reached WhatsApp.
   * They are never retried: missing one post is better than posting twice.
   */
  recoverInterrupted(now: number): number {
    const info = this.q("UPDATE queue SET status = 'unknown', updated_at = ? WHERE status = 'sending'").run(now);
    return info.changes;
  }

  /** News that waited too long in the queue is no longer news. */
  expireStaleNews(now: number, maxAgeMs: number): number {
    const info = this.db
      .prepare("UPDATE queue SET status = 'discarded', updated_at = ? WHERE status = 'ready' AND source_item_id IS NOT NULL AND created_at < ?")
      .run(now, now - maxAgeMs);
    return info.changes;
  }

  discardReady(channelId: string, now: number): number {
    const info = this.db
      .prepare("UPDATE queue SET status = 'discarded', updated_at = ? WHERE channel_id = ? AND status = 'ready'")
      .run(now, channelId);
    return info.changes;
  }

  sentOnDay(channelId: string, day: string): number {
    const r = this.db
      .prepare("SELECT COUNT(*) AS n FROM queue WHERE channel_id = ? AND day_key = ? AND status = 'sent' AND is_followup = 0")
      .get(channelId, day) as { n: number };
    return r.n;
  }

  /** Recent posts of this channel and of its group, newest first, for repeat detection. */
  recentForDedup(channelId: string, group: string | null | undefined, limit: number): DedupRow[] {
    const sql = group
      ? `SELECT norm_text, norm_hash, topic_key FROM queue
         WHERE (channel_id = ? OR grp = ?) AND is_followup = 0 AND status IN ${HISTORY_STATUSES} ORDER BY id DESC LIMIT ?`
      : `SELECT norm_text, norm_hash, topic_key FROM queue
         WHERE channel_id = ? AND is_followup = 0 AND status IN ${HISTORY_STATUSES} ORDER BY id DESC LIMIT ?`;
    const args = group ? [channelId, group, limit] : [channelId, limit];
    return this.q(sql).all(...args) as DedupRow[];
  }

  hashExists(channelId: string, group: string | null | undefined, normHash: string): boolean {
    const sql = group
      ? `SELECT 1 FROM queue WHERE (channel_id = ? OR grp = ?) AND norm_hash = ? AND status IN ${HISTORY_STATUSES} LIMIT 1`
      : `SELECT 1 FROM queue WHERE channel_id = ? AND norm_hash = ? AND status IN ${HISTORY_STATUSES} LIMIT 1`;
    const args = group ? [channelId, group, normHash] : [channelId, normHash];
    return this.q(sql).get(...args) !== undefined;
  }

  sentKindsToday(channelId: string, day: string): { kind: PostKind; n: number }[] {
    return this.db
      .prepare("SELECT kind, COUNT(*) AS n FROM queue WHERE channel_id = ? AND day_key = ? AND status = 'sent' GROUP BY kind")
      .all(channelId, day) as { kind: PostKind; n: number }[];
  }

  totals(day: string): { sent: number; failed: number; unknown: number; ready: number } {
    const one = (sql: string, ...args: (string | number)[]) => (this.q(sql).get(...args) as { n: number }).n;
    return {
      sent: one("SELECT COUNT(*) AS n FROM queue WHERE day_key = ? AND status = 'sent' AND is_followup = 0", day),
      failed: one("SELECT COUNT(*) AS n FROM queue WHERE status = 'failed'"),
      unknown: one("SELECT COUNT(*) AS n FROM queue WHERE status = 'unknown'"),
      ready: one("SELECT COUNT(*) AS n FROM queue WHERE status = 'ready' AND is_followup = 0"),
    };
  }

  sentPerChannel(day: string): Map<string, number> {
    const rows = this.db
      .prepare("SELECT channel_id, COUNT(*) AS n FROM queue WHERE day_key = ? AND status = 'sent' AND is_followup = 0 GROUP BY channel_id")
      .all(day) as { channel_id: string; n: number }[];
    return new Map(rows.map((r) => [r.channel_id, r.n]));
  }

  /** Keeps the database small: old finished rows are only needed for repeat detection. */
  prune(now: number, keepPerChannel: number): void {
    this.db
      .prepare(
        `DELETE FROM queue WHERE status IN ('sent','unknown','discarded','failed') AND id NOT IN (
           SELECT id FROM (
             SELECT id, ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY id DESC) AS rn FROM queue
           ) WHERE rn <= ?
         )`,
      )
      .run(keepPerChannel);
    this.q("DELETE FROM events WHERE ts < ?").run(now - 14 * 24 * 3600_000);
    this.q("DELETE FROM source_items WHERE fetched_at < ?").run(now - 30 * 24 * 3600_000);
  }

  // ---- source items -------------------------------------------------------

  addSourceItems(
    channelId: string,
    items: { guid: string; title: string; source: string; snippet: string; link: string; publishedAt: number }[],
    now: number,
  ): number {
    const stmt = this.q(
      `INSERT OR IGNORE INTO source_items (channel_id, guid, title, source, snippet, link, published_at, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let added = 0;
    const tx = this.db.transaction(() => {
      for (const it of items) {
        added += stmt.run(channelId, it.guid, it.title, it.source, it.snippet, it.link, it.publishedAt, now).changes;
      }
    });
    tx();
    return added;
  }

  newSourceItems(channelId: string, limit: number): SourceItem[] {
    return this.db
      .prepare("SELECT * FROM source_items WHERE channel_id = ? AND state = 'new' ORDER BY published_at DESC, id DESC LIMIT ?")
      .all(channelId, limit) as SourceItem[];
  }

  markSourceItem(id: number, state: "used" | "skipped"): void {
    this.q("UPDATE source_items SET state = ? WHERE id = ?").run(state, id);
  }

  // ---- style samples ------------------------------------------------------

  setStyleSamples(channelId: string, texts: string[], now: number): void {
    const tx = this.db.transaction(() => {
      this.q("DELETE FROM style_samples WHERE channel_id = ?").run(channelId);
      const stmt = this.q("INSERT INTO style_samples (channel_id, text, created_at) VALUES (?, ?, ?)");
      for (const t of texts) stmt.run(channelId, t, now);
    });
    tx();
  }

  styleSamples(channelId: string, limit: number): string[] {
    const rows = this.q("SELECT text FROM style_samples WHERE channel_id = ? ORDER BY id LIMIT ?").all(channelId, limit) as {
      text: string;
    }[];
    return rows.map((r) => r.text);
  }

  // ---- events & usage -----------------------------------------------------

  event(now: number, level: "info" | "warn" | "error", kind: string, message: string, channelId: string | null = null): void {
    this.q("INSERT INTO events (ts, level, channel_id, kind, message) VALUES (?, ?, ?, ?, ?)").run(now, level, channelId, kind, message);
  }

  eventsSince(since: number, level?: "warn" | "error"): { ts: number; level: string; channel_id: string | null; kind: string; message: string }[] {
    const sql = level
      ? "SELECT ts, level, channel_id, kind, message FROM events WHERE ts >= ? AND level = ? ORDER BY id DESC LIMIT 200"
      : "SELECT ts, level, channel_id, kind, message FROM events WHERE ts >= ? ORDER BY id DESC LIMIT 200";
    const args = level ? [since, level] : [since];
    return this.q(sql).all(...args) as { ts: number; level: string; channel_id: string | null; kind: string; message: string }[];
  }

  eventCounts(since: number): Map<string, number> {
    const rows = this.db
      .prepare("SELECT kind, COUNT(*) AS n FROM events WHERE ts >= ? AND level != 'info' GROUP BY kind ORDER BY n DESC")
      .all(since) as { kind: string; n: number }[];
    return new Map(rows.map((r) => [r.kind, r.n]));
  }

  addUsage(day: string, inputTokens: number, outputTokens: number): void {
    this.db
      .prepare(
        `INSERT INTO usage (day_key, calls, input_tokens, output_tokens) VALUES (?, 1, ?, ?)
         ON CONFLICT(day_key) DO UPDATE SET calls = calls + 1, input_tokens = input_tokens + excluded.input_tokens,
           output_tokens = output_tokens + excluded.output_tokens`,
      )
      .run(day, inputTokens, outputTokens);
  }

  usage(day: string): { calls: number; input_tokens: number; output_tokens: number } {
    const r = this.q("SELECT calls, input_tokens, output_tokens FROM usage WHERE day_key = ?").get(day) as
      | { calls: number; input_tokens: number; output_tokens: number }
      | undefined;
    return r ?? { calls: 0, input_tokens: 0, output_tokens: 0 };
  }
}
