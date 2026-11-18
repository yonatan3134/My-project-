import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { ApiError, GoogleGenAI } from "@google/genai";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { ChannelConfig, Settings } from "../config.js";
import type { PostKind, SourceItem } from "../db.js";
import { REVIEWER_SYSTEM, WRITER_SYSTEM, reviewerPrompt, writerPrompt, type ReviewItem, type WriterRequest } from "./prompts.js";

const DraftSchema = z.object({
  kind: z.enum(["text", "poll", "image", "video"]),
  text: z.string(),
  poll_question: z.string(),
  poll_options: z.array(z.string()),
  card_text: z.string(),
  visual_query: z.string(),
  followup: z.string(),
  topic_key: z.string(),
  source_index: z.number().int(),
});
const BatchSchema = z.object({ posts: z.array(DraftSchema) });
export type Draft = z.infer<typeof DraftSchema>;

const VerdictSchema = z.object({ index: z.number().int(), ok: z.boolean(), reason: z.string() });
const ReviewSchema = z.object({ verdicts: z.array(VerdictSchema) });
export type Verdict = z.infer<typeof VerdictSchema>;

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface LLM {
  write(req: WriterRequest): Promise<Draft[]>;
  review(channel: ChannelConfig, items: ReviewItem[], sources: SourceItem[]): Promise<Verdict[]>;
}

/** Why a call produced nothing, and how long to wait before trying again. */
export class LLMError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "rate_limit" | "refusal" | "truncated" | "invalid" | "server" | "network" | "bad_request",
    readonly retryAfterMs: number,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

const MINUTE = 60_000;

function toLLMError(err: unknown): LLMError {
  if (err instanceof LLMError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new LLMError(`API key rejected: ${err.message}`, "auth", 60 * MINUTE);
  }
  if (err instanceof Anthropic.RateLimitError) return new LLMError(`rate limited: ${err.message}`, "rate_limit", 10 * MINUTE);
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError) {
    return new LLMError(`request rejected: ${err.message}`, "bad_request", 60 * MINUTE);
  }
  if (err instanceof Anthropic.APIConnectionError) return new LLMError(`network error: ${err.message}`, "network", 3 * MINUTE);
  if (err instanceof Anthropic.APIError) return new LLMError(`API error ${err.status}: ${err.message}`, "server", 5 * MINUTE);
  // Not an API failure: the service answered, but the answer was not the JSON that was asked for
  // (for example it was cut off). That is a problem with this one request, not with the service.
  return new LLMError(`answer could not be read: ${(err as Error)?.message ?? String(err)}`, "invalid", 5 * MINUTE);
}

export class ClaudeLLM implements LLM {
  private client: Anthropic;

  constructor(
    private settings: Pick<Settings, "model" | "effort">,
    private onUsage: (u: Usage) => void = () => {},
    client?: Anthropic,
  ) {
    // Credentials come from ANTHROPIC_API_KEY in the environment (.env on the server).
    this.client = client ?? new Anthropic();
  }

  private async call<T>(system: string, user: string, schema: z.ZodType<T>): Promise<T> {
    let response;
    try {
      response = await this.client.messages.parse({
        model: this.settings.model,
        max_tokens: 16000,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }],
        output_config: { effort: this.settings.effort, format: zodOutputFormat(schema) },
      });
    } catch (err) {
      throw toLLMError(err);
    }
    this.onUsage({
      inputTokens:
        response.usage.input_tokens + (response.usage.cache_creation_input_tokens ?? 0) + (response.usage.cache_read_input_tokens ?? 0),
      outputTokens: response.usage.output_tokens,
    });
    if (response.stop_reason === "refusal") {
      throw new LLMError(`model declined the request (${response.stop_details?.category ?? "no category"})`, "refusal", 30 * MINUTE);
    }
    if (response.stop_reason === "max_tokens") throw new LLMError("response was cut off at max_tokens", "truncated", 5 * MINUTE);
    if (!response.parsed_output) throw new LLMError("response did not match the expected JSON shape", "invalid", 5 * MINUTE);
    return response.parsed_output;
  }

  async write(req: WriterRequest): Promise<Draft[]> {
    const out = await this.call(WRITER_SYSTEM, writerPrompt(req), BatchSchema);
    return out.posts;
  }

  async review(channel: ChannelConfig, items: ReviewItem[], sources: SourceItem[]): Promise<Verdict[]> {
    const out = await this.call(REVIEWER_SYSTEM, reviewerPrompt(channel, items, sources), ReviewSchema);
    return out.verdicts;
  }
}

function geminiError(err: unknown): LLMError {
  if (err instanceof LLMError) return err;
  if (err instanceof ApiError) {
    const msg = err.message.slice(0, 300);
    if (err.status === 401 || err.status === 403) return new LLMError(`API key rejected: ${msg}`, "auth", 60 * MINUTE);
    if (err.status === 429) return new LLMError(`rate limited: ${msg}`, "rate_limit", 10 * MINUTE);
    if (err.status === 400 || err.status === 404) return new LLMError(`request rejected: ${msg}`, "bad_request", 60 * MINUTE);
    return new LLMError(`API error ${err.status}: ${msg}`, "server", 5 * MINUTE);
  }
  const message = (err as Error)?.message ?? String(err);
  if (/fetch failed|network|ECONN|ETIMEDOUT|timeout/i.test(message)) return new LLMError(`network error: ${message}`, "network", 3 * MINUTE);
  return new LLMError(`answer could not be read: ${message}`, "invalid", 5 * MINUTE);
}

/** Google Gemini, through the Gemini Developer API (key from Google AI Studio, GEMINI_API_KEY in .env). */
export class GeminiLLM implements LLM {
  private client: GoogleGenAI;

  constructor(
    private settings: Pick<Settings, "model">,
    private onUsage: (u: Usage) => void = () => {},
    client?: GoogleGenAI,
  ) {
    this.client = client ?? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "" });
  }

  private async call<T>(system: string, user: string, schema: z.ZodType<T>): Promise<T> {
    let response;
    try {
      response = await this.client.models.generateContent({
        model: this.settings.model,
        contents: user,
        config: {
          systemInstruction: system,
          responseMimeType: "application/json",
          responseJsonSchema: z.toJSONSchema(schema),
          maxOutputTokens: 16000,
        },
      });
    } catch (err) {
      throw geminiError(err);
    }
    const u = response.usageMetadata;
    this.onUsage({ inputTokens: u?.promptTokenCount ?? 0, outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0) });
    const blocked = response.promptFeedback?.blockReason;
    if (blocked) throw new LLMError(`the request was blocked (${blocked})`, "refusal", 30 * MINUTE);
    const finish = response.candidates?.[0]?.finishReason;
    if (finish === "MAX_TOKENS") throw new LLMError("response was cut off at the output limit", "truncated", 5 * MINUTE);
    if (finish && finish !== "STOP") throw new LLMError(`the model stopped without an answer (${finish})`, "refusal", 30 * MINUTE);
    const text = response.text;
    if (!text) throw new LLMError("empty response", "invalid", 5 * MINUTE);
    try {
      return schema.parse(JSON.parse(text));
    } catch (err) {
      throw new LLMError(`response did not match the expected JSON shape: ${(err as Error).message.slice(0, 200)}`, "invalid", 5 * MINUTE);
    }
  }

  async write(req: WriterRequest): Promise<Draft[]> {
    return (await this.call(WRITER_SYSTEM, writerPrompt(req), BatchSchema)).posts;
  }

  async review(channel: ChannelConfig, items: ReviewItem[], sources: SourceItem[]): Promise<Verdict[]> {
    return (await this.call(REVIEWER_SYSTEM, reviewerPrompt(channel, items, sources), ReviewSchema)).verdicts;
  }
}

/**
 * Spaces calls out. Free AI plans allow only a few requests a minute; when
 * many channels refill at once (for example right after starting) the calls
 * would otherwise hit that limit and fail.
 */
export class PacedLLM implements LLM {
  private next = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private inner: LLM,
    private gapMs: number,
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private clock: () => number = Date.now,
  ) {}

  private paced<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const wait = this.next - this.clock();
      if (wait > 0) await this.sleep(wait);
      this.next = this.clock() + this.gapMs;
      return fn();
    });
    this.chain = run.catch(() => {});
    return run;
  }

  write(req: WriterRequest): Promise<Draft[]> {
    return this.paced(() => this.inner.write(req));
  }

  review(channel: ChannelConfig, items: ReviewItem[], sources: SourceItem[]): Promise<Verdict[]> {
    return this.paced(() => this.inner.review(channel, items, sources));
  }
}

/** The model the bot is configured to use, paced to stay inside free-plan limits. */
export function createLLM(settings: Pick<Settings, "provider" | "model" | "effort">, onUsage: (u: Usage) => void = () => {}): LLM {
  const inner = settings.provider === "claude" ? new ClaudeLLM(settings, onUsage) : new GeminiLLM(settings, onUsage);
  // Gemini's free plan allows about 10-15 requests a minute; one every 6 seconds stays under that
  return new PacedLLM(inner, settings.provider === "claude" ? 1000 : 6000);
}

/**
 * Stand-in used by the tests and by `npm run simulate`: no network, no cost.
 * It deliberately produces some repeats and some rule-breaking posts so the
 * filters around the model can be exercised.
 */
export class FakeLLM implements LLM {
  private counter = 0;
  calls = { write: 0, review: 0 };

  constructor(private opts: { repeatEvery?: number; badEvery?: number } = {}) {}

  async write(req: WriterRequest): Promise<Draft[]> {
    this.calls.write++;
    const drafts: Draft[] = [];
    // Each fake post is made of unrelated random-looking words, the way real posts differ from each other.
    const words = (n: number, count: number) => {
      const hex = crypto.createHash("sha1").update(`${req.channel.id}:${n}`).digest("hex");
      return Array.from({ length: count }, (_, i) => hex.slice(i * 6, i * 6 + 6)).join(" ");
    };
    const push = (kind: PostKind, sourceIndex: number) => {
      this.counter++;
      const n = this.counter;
      const repeat = Boolean(this.opts.repeatEvery && n % this.opts.repeatEvery === 0);
      const bad = Boolean(this.opts.badEvery && n % this.opts.badEvery === 0);
      const idea = repeat ? "רעיון שחוזר על עצמו" : `רעיון ${words(n, 2)}`;
      const body = repeat ? "זה פוסט שכבר היה כאן פעם בדיוק ככה" : `פוסט ${words(n, 5)}`;
      drafts.push({
        kind,
        text: kind === "poll" ? "" : bad ? `${body} BADPOST` : body,
        poll_question: kind === "poll" ? (repeat ? "שאלה שכבר נשאלה כאן פעם?" : `שאלה ${words(n, 4)}?`) : "",
        poll_options: kind === "poll" ? [`כן ${words(n + 1000000, 1)}`, `לא ${words(n + 2000000, 1)}`] : [],
        card_text: kind === "image" || kind === "video" ? `כרטיס ${words(n + 3000000, 3)}` : "",
        visual_query: kind === "image" || kind === "video" ? "abstract colors" : "",
        followup: kind === "text" && n % 4 === 0 ? `התשובה: ${words(n + 4000000, 2)}` : "",
        topic_key: idea,
        source_index: sourceIndex,
      });
    };
    if (req.mode === "news") {
      req.sources.forEach((_, i) => push("text", i));
      return drafts;
    }
    req.sources.forEach((_, i) => push("text", i));
    for (const [kind, n] of Object.entries(req.counts) as [PostKind, number][]) {
      for (let i = 0; i < n; i++) push(kind, -1);
    }
    return drafts;
  }

  async review(_channel: ChannelConfig, items: ReviewItem[]): Promise<Verdict[]> {
    this.calls.review++;
    return items.map((it) => {
      const bad = it.text.includes("BADPOST");
      return { index: it.index, ok: !bad, reason: bad ? "test: marked bad" : "" };
    });
  }
}
