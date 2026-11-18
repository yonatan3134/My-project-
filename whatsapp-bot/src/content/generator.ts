import { formatsFor, type ChannelConfig, type Formats, type Settings } from "../config.js";
import type { PostKind, PostPayload, SourceItem, Store } from "../db.js";
import { dayKey, HOUR, MINUTE } from "../time.js";
import { candidateOf, DedupIndex, type Candidate } from "./dedup.js";
import { LLMError, type Draft, type LLM } from "./llm.js";
import type { ReviewItem } from "./prompts.js";
import { collectItems, fetchSefariaChapter, fetchText, hebrewNumeral, type FetchText } from "./sources.js";

export interface GenContext {
  store: Store;
  llm: LLM;
  settings: Settings;
  fetcher?: FetchText;
  /** false when ffmpeg is missing, so video posts are not requested */
  videoAvailable?: boolean;
}

export interface RefillResult {
  queued: number;
  rejected: string[];
  /** set when the model could not be reached; the caller decides how long to back off */
  llmError?: LLMError;
}

const KINDS: PostKind[] = ["text", "poll", "image", "video"];
const SOURCE_REFRESH_MS = 45 * MINUTE;
const MAX_SOURCES_PER_CALL = 4;
/** a fan channel carries at most this many news posts a day; the rest of its posts are polls and questions */
const FANDOM_NEWS_PER_DAY = 3;
const FANDOM_NEWS_WAITING = 2;
const NEWS_MAX_AGE_MS = 48 * HOUR;

/** Splits `total` posts between the kinds in proportion to their weights (largest remainder). */
export function splitCounts(formats: Formats, total: number): Record<PostKind, number> {
  const out: Record<PostKind, number> = { text: 0, poll: 0, image: 0, video: 0 };
  const sum = KINDS.reduce((a, k) => a + formats[k], 0);
  if (sum <= 0 || total <= 0) {
    out.text = Math.max(0, total);
    return out;
  }
  const exact = KINDS.map((k) => ({ k, v: (formats[k] / sum) * total }));
  let left = total;
  for (const e of exact) {
    out[e.k] = Math.floor(e.v);
    left -= out[e.k];
  }
  for (const e of [...exact].sort((a, b) => (b.v % 1) - (a.v % 1))) {
    if (left <= 0) break;
    if (formats[e.k] > 0) {
      out[e.k]++;
      left--;
    }
  }
  return out;
}

const URL_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|gg|me|tv|xyz|app|il|ly|link|site|info)\b)/i;

/** Structural checks that do not depend on the model's judgement. Returns a reason when the draft is unusable. */
export function draftToPayload(d: Draft, mode: "creative" | "fandom" | "news", sourceCount: number): { payload: PostPayload } | { reject: string } {
  const text = d.text.trim();
  const followup = d.followup.trim();
  const all = [text, d.poll_question, ...d.poll_options, d.card_text, followup].join(" ");
  if (URL_RE.test(all)) return { reject: "contains a link" };
  if (mode === "news" && (d.source_index < 0 || d.source_index >= sourceCount)) return { reject: "news post without a source item" };
  if (d.source_index >= sourceCount) return { reject: "points to a missing source item" };
  if (followup.length > 700) return { reject: "follow-up too long" };

  if (d.kind === "text") {
    if (text.length < 3) return { reject: "empty text" };
    if (text.length > 1800) return { reject: "text too long" };
    return { payload: { kind: "text", text, ...(followup ? { followup } : {}) } };
  }
  if (d.kind === "poll") {
    const question = d.poll_question.trim();
    const options = [...new Set(d.poll_options.map((o) => o.trim()).filter(Boolean))];
    if (question.length < 3 || question.length > 250) return { reject: "bad poll question" };
    if (options.length < 2 || options.length > 6) return { reject: "poll needs 2-6 options" };
    if (options.some((o) => o.length > 95)) return { reject: "poll option too long" };
    return { payload: { kind: "poll", text: "", pollQuestion: question, pollOptions: options, ...(followup ? { followup } : {}) } };
  }
  const cardText = d.card_text.trim();
  if (cardText.length < 2 || cardText.length > 220) return { reject: "bad card text" };
  if (text.length > 900) return { reject: "caption too long" };
  const visualQuery = d.visual_query.replace(/[^a-zA-Z ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  const imagePrompt = d.image_prompt.replace(/\s+/g, " ").trim().slice(0, 400);
  return {
    payload: { kind: d.kind, text, cardText, ...(visualQuery ? { visualQuery } : {}), ...(imagePrompt ? { imagePrompt } : {}), ...(followup ? { followup } : {}) },
  };
}

function effectiveMode(c: ChannelConfig): "creative" | "fandom" | "news" | null {
  return c.mode === "creative" || c.mode === "fandom" || c.mode === "news" ? c.mode : null;
}

async function refreshSources(ctx: GenContext, channel: ChannelConfig, now: number): Promise<void> {
  if (!channel.news || channel.news.queries.length + channel.news.feeds.length === 0) return;
  const state = ctx.store.channel(channel.id);
  if (now - state.sources_checked_at < SOURCE_REFRESH_MS) return;
  ctx.store.updateChannel(channel.id, { sources_checked_at: now });
  const { items, errors } = await collectItems(channel.news, now, ctx.fetcher ?? fetchText);
  ctx.store.addSourceItems(channel.id, items, now);
  for (const e of errors) ctx.store.event(now, "warn", "source_error", e, channel.id);
}

/** Queues the next verbatim passage from Sefaria when today's quota is not yet filled. */
async function refillSefaria(ctx: GenContext, channel: ChannelConfig, now: number): Promise<number> {
  const cfg = channel.sefaria;
  if (!cfg) return 0;
  const day = dayKey(now, ctx.settings.timezone);
  const dayMark = `sefaria:${channel.id}:day`;
  const countMark = `sefaria:${channel.id}:count`;
  const done = ctx.store.get(dayMark) === day ? (ctx.store.getNumber(countMark) ?? 0) : 0;
  if (done >= cfg.perDay) return 0;
  const retryKey = `sefaria:${channel.id}:retry`;
  if ((ctx.store.getNumber(retryKey) ?? 0) > now) return 0;
  const doneKey = `sefaria:${channel.id}:done:${cfg.book}`;
  if (ctx.store.get(doneKey) === "1") return 0;

  const posKey = `sefaria:${channel.id}:pos`;
  const [chRaw, idxRaw] = (ctx.store.get(posKey) ?? "1:0").split(":");
  let chapter = Number(chRaw) || 1;
  let index = Number(idxRaw) || 0;
  try {
    let data = await fetchSefariaChapter(cfg.book, chapter, ctx.fetcher ?? fetchText);
    if (index >= data.segments.length) {
      if (chapter >= cfg.chapters && !cfg.repeat) {
        // the whole book has been posted; posting it again would repeat old posts
        ctx.store.set(doneKey, "1");
        ctx.store.event(now, "info", "sefaria_finished", `all of ${cfg.book} has been posted`, channel.id);
        return 0;
      }
      chapter = chapter >= cfg.chapters ? 1 : chapter + 1;
      index = 0;
      data = await fetchSefariaChapter(cfg.book, chapter, ctx.fetcher ?? fetchText);
    }
    const segment = data.segments[index];
    if (!segment) return 0;
    const text = `📖 *${data.heRef}, ${hebrewNumeral(index + 1)}*\n\n${segment}`;
    const payload: PostPayload = { kind: "text", text };
    const cand = candidateOf(payload, `${cfg.book} ${chapter}:${index + 1}`);
    ctx.store.enqueue({ channelId: channel.id, group: channel.group, payload, topicKey: cand.topicKey, normText: cand.normText, normHash: cand.normHash, now });
    ctx.store.set(posKey, `${chapter}:${index + 1}`);
    ctx.store.set(dayMark, day);
    ctx.store.set(countMark, String(done + 1));
    return 1;
  } catch (err) {
    ctx.store.event(now, "warn", "sefaria_error", (err as Error).message, channel.id);
    ctx.store.set(retryKey, String(now + HOUR));
    return 0;
  }
}

/**
 * Tops up one channel's queue: asks the model for a batch, drops anything
 * malformed, repeated or rejected by the reviewer, and stores the rest.
 */
export async function refillChannel(ctx: GenContext, channel: ChannelConfig, now: number): Promise<RefillResult> {
  const result: RefillResult = { queued: 0, rejected: [] };
  const mode = effectiveMode(channel);
  if (!mode || !channel.enabled) return result;
  const { store, settings } = ctx;
  const state = store.channel(channel.id);
  if (state.retry_at > now) return result;

  // the owner's "every N posts" special post, written ahead so it is ready when its turn comes
  if (channel.special?.prompt.trim() && !channel.special.text.trim() && store.readySpecialCount(channel.id) === 0) {
    const r = await refillSpecial(ctx, channel, mode, now);
    result.queued += r.queued;
    result.rejected.push(...r.rejected);
    if (r.llmError) return { ...result, llmError: r.llmError };
  }

  result.queued += await refillSefaria(ctx, channel, now);

  await refreshSources(ctx, channel, now);
  // News is taken a little at a time, newest first, so a busy day does not turn a fan channel
  // into a news ticker or leave a queue full of yesterday's headlines.
  let sources: SourceItem[] = [];
  if (mode !== "creative") {
    const waiting = store.readyNewsCount(channel.id);
    const sentToday = store.newsSentOnDay(channel.id, dayKey(now, settings.timezone));
    const perDay = mode === "news" ? (channel.maxPerDay ?? settings.newsMaxPerDay) : FANDOM_NEWS_PER_DAY;
    const room = Math.min(mode === "news" ? perDay - waiting : FANDOM_NEWS_WAITING - waiting, perDay - sentToday - waiting);
    sources = store.newSourceItems(channel.id, Math.min(MAX_SOURCES_PER_CALL, room), now - NEWS_MAX_AGE_MS);
  }
  const ready = store.readyCount(channel.id);

  if (mode === "news") {
    if (sources.length === 0) return result;
  } else if (ready >= settings.buffer.min && sources.length === 0) {
    return result;
  }

  const growth = store.get("growth") === "1";
  const formats = { ...formatsFor(channel, settings) };
  // polls get the most interaction of any post type, so growth mode leans on them
  if (growth && formats.poll > 0) formats.poll = Math.round(formats.poll * 1.5 * 10) / 10;
  if (ctx.videoAvailable === false) {
    formats.image += formats.video;
    formats.video = 0;
  }
  const fillCount = mode === "news" ? sources.length : ready >= settings.buffer.min ? 0 : settings.buffer.batch;
  const counts = splitCounts(formats, fillCount);
  if (mode !== "news" && fillCount === 0) counts.text = sources.length;

  let drafts: Draft[];
  try {
    drafts = await ctx.llm.write({
      channel,
      mode,
      counts,
      usedKeys: store
        .recentForDedup(channel.id, channel.group, settings.dedup.keysInPrompt)
        .map((r) => r.topic_key)
        .filter(Boolean),
      samples: store.styleSamples(channel.id, 8),
      sources,
      growth,
    });
  } catch (err) {
    return failed(ctx, channel, now, result, err);
  }

  // 1. structure
  const kept: { draft: Draft; payload: PostPayload; cand: Candidate }[] = [];
  for (const d of drafts) {
    const r = draftToPayload(d, mode, sources.length);
    if ("reject" in r) {
      result.rejected.push(r.reject);
      continue;
    }
    kept.push({ draft: d, payload: r.payload, cand: candidateOf(r.payload, d.topic_key) });
  }

  // 2. repeats. A post built on a news item is compared with this channel's own history only, so
  //    sibling channels can each report the same news in their own words; everything else is
  //    also compared with the whole group, so siblings never get the same idea.
  const lookback = settings.dedup.lookback;
  const own = new DedupIndex(store.recentForDedup(channel.id, null, lookback), settings.dedup);
  const shared = channel.group ? new DedupIndex(store.recentForDedup(channel.id, channel.group, lookback), settings.dedup) : own;
  const fresh = kept.filter((k) => {
    const fromSource = k.draft.source_index >= 0;
    const scope = fromSource ? null : channel.group;
    const why = store.hashExists(channel.id, scope, k.cand.normHash) ? "identical text" : (fromSource ? own : shared).check(k.cand);
    if (why) {
      result.rejected.push(`repeat: ${why}`);
      return false;
    }
    own.add(k.cand);
    if (shared !== own) shared.add(k.cand);
    return true;
  });

  // 3. second opinion. If the reviewer cannot be reached nothing is published.
  let approved = fresh;
  if (fresh.length > 0) {
    const items: ReviewItem[] = fresh.map((k, i) => ({
      index: i,
      kind: k.payload.kind,
      text: k.payload.text,
      pollQuestion: k.payload.pollQuestion ?? "",
      pollOptions: k.payload.pollOptions ?? [],
      cardText: k.payload.cardText ?? "",
      followup: k.payload.followup ?? "",
      sourceIndex: k.draft.source_index,
    }));
    try {
      const verdicts = await ctx.llm.review(channel, items, sources);
      const ok = new Map(verdicts.map((v) => [v.index, v]));
      approved = fresh.filter((_, i) => {
        const v = ok.get(i);
        if (v?.ok === true) return true;
        result.rejected.push(`review: ${v?.reason || "no verdict"}`);
        return false;
      });
    } catch (err) {
      return failed(ctx, channel, now, result, err);
    }
  }

  // 4. store
  const usedSources = new Set<number>();
  for (const k of approved) {
    const src = k.draft.source_index >= 0 ? sources[k.draft.source_index] : undefined;
    store.enqueue({
      channelId: channel.id,
      group: channel.group,
      payload: k.payload,
      topicKey: k.cand.topicKey,
      normText: k.cand.normText,
      normHash: k.cand.normHash,
      sourceItemId: src?.id ?? null,
      now,
    });
    if (src) usedSources.add(src.id);
    result.queued++;
  }
  // every offered item is settled now, so the same headline is never offered twice
  for (const s of sources) store.markSourceItem(s.id, usedSources.has(s.id) ? "used" : "skipped");

  if (result.rejected.length > 0) {
    store.event(now, "info", "rejected", `${result.rejected.length} dropped: ${summarize(result.rejected)}`, channel.id);
  }
  if (mode !== "news" && fillCount > 0 && result.queued === 0) {
    // the whole batch was unusable; wait before paying for another one
    store.updateChannel(channel.id, { retry_at: now + 30 * MINUTE });
    store.event(now, "warn", "empty_batch", `no usable posts out of ${drafts.length}: ${summarize(result.rejected)}`, channel.id);
  }
  return result;
}

async function refillSpecial(ctx: GenContext, channel: ChannelConfig, mode: "creative" | "fandom" | "news", now: number): Promise<RefillResult> {
  const result: RefillResult = { queued: 0, rejected: [] };
  const { store, settings } = ctx;
  const prompt = channel.special?.prompt.trim() ?? "";
  // a special post is written freely from the owner's instruction, never as a news report
  const writeMode = mode === "news" ? "creative" : mode;
  let drafts: Draft[];
  try {
    drafts = await ctx.llm.write({
      channel,
      mode: writeMode,
      counts: { text: 1 },
      usedKeys: store.recentForDedup(channel.id, null, settings.dedup.keysInPrompt).map((r) => r.topic_key).filter(Boolean),
      samples: store.styleSamples(channel.id, 8),
      sources: [],
      special: prompt,
    });
  } catch (err) {
    return failed(ctx, channel, now, result, err);
  }
  const index = new DedupIndex(store.recentForDedup(channel.id, null, settings.dedup.lookback), settings.dedup);
  const kept: { payload: PostPayload; cand: Candidate }[] = [];
  for (const d of drafts.slice(0, 1)) {
    const r = draftToPayload({ ...d, source_index: -1 }, writeMode, 0);
    if ("reject" in r) {
      result.rejected.push(r.reject);
      continue;
    }
    const cand = candidateOf(r.payload, d.topic_key);
    const why = index.check(cand);
    if (why) result.rejected.push(`repeat: ${why}`);
    else kept.push({ payload: r.payload, cand });
  }
  if (kept.length === 0) return result;
  try {
    const k = kept[0]!;
    const [v] = await ctx.llm.review(
      channel,
      [{ index: 0, kind: k.payload.kind, text: k.payload.text, pollQuestion: k.payload.pollQuestion ?? "", pollOptions: k.payload.pollOptions ?? [], cardText: k.payload.cardText ?? "", followup: k.payload.followup ?? "", sourceIndex: -1 }],
      [],
    );
    if (v?.ok !== true) {
      result.rejected.push(`review: ${v?.reason || "no verdict"}`);
      return result;
    }
    store.enqueue({ channelId: channel.id, group: channel.group, payload: k.payload, topicKey: k.cand.topicKey, normText: k.cand.normText, normHash: k.cand.normHash, special: true, now });
    result.queued++;
  } catch (err) {
    return failed(ctx, channel, now, result, err);
  }
  return result;
}

function failed(ctx: GenContext, channel: ChannelConfig, now: number, result: RefillResult, err: unknown): RefillResult {
  const e = err instanceof LLMError ? err : new LLMError((err as Error)?.message ?? String(err), "server", 5 * MINUTE);
  ctx.store.updateChannel(channel.id, { retry_at: now + e.retryAfterMs });
  ctx.store.event(now, e.kind === "auth" ? "error" : "warn", `llm_${e.kind}`, e.message, channel.id);
  result.llmError = e;
  return result;
}

function summarize(reasons: string[]): string {
  const counts = new Map<string, number>();
  for (const r of reasons) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([r, n]) => `${r} ×${n}`)
    .join("; ");
}
