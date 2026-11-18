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
  image_prompt: z.string(),
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
    this.client = client ?? geminiClient(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "");
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

/** A Gemini client on the API version where every current model and alias is available. */
export function geminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey, apiVersion: "v1beta" });
}

const SKIP_MODEL = /image|tts|embed|live|audio|native|vision|robotics|computer|learnlm|gemma|aqa|-exp|exp-|nano/i;

function modelRank(name: string): number[] {
  const family = /flash-lite/.test(name) ? 0 : /flash/.test(name) ? 1 : /pro/.test(name) ? 2 : 3;
  const version = Number(name.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  const preview = /preview|latest/.test(name) ? 1 : 0;
  return [family, -version, preview];
}

/** Text models this Gemini key can use right now, cheapest and newest first. */
export async function discoverGeminiModels(client: GoogleGenAI, kind: "text" | "image" = "text"): Promise<string[]> {
  const names: string[] = [];
  const pager = await client.models.list({ config: { pageSize: 200 } });
  for await (const m of pager) {
    const name = (m.name ?? "").replace(/^models\//, "");
    if (!name.startsWith("gemini") || !(m.supportedActions ?? []).includes("generateContent")) continue;
    if (kind === "image" ? !/image/i.test(name) : SKIP_MODEL.test(name)) continue;
    names.push(name);
  }
  return names.sort((a, b) => {
    const x = modelRank(a), y = modelRank(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
    return a.localeCompare(b);
  });
}

/**
 * "gemini:auto": asks Google which models this key may use, and uses the
 * best few of them with fallback between them. Names change often (models
 * are retired, renamed, or only open to some accounts), so the bot does not
 * depend on any fixed name. The list is refreshed every 6 hours.
 */
export class AutoGeminiLLM implements LLM {
  private inner: FallbackLLM | null = null;
  private loadedAt = 0;
  private error: string | null = null;

  constructor(
    private client: GoogleGenAI,
    private onUsage: (u: Usage) => void = () => {},
    private max = 4,
  ) {}

  private async models(): Promise<FallbackLLM> {
    if (this.inner && Date.now() - this.loadedAt < 6 * 60 * MINUTE) return this.inner;
    let names: string[];
    try {
      names = (await discoverGeminiModels(this.client)).slice(0, this.max);
    } catch (err) {
      this.error = (err as Error).message.slice(0, 200);
      if (this.inner) return this.inner;
      throw geminiError(err);
    }
    if (names.length === 0) {
      this.error = "Google did not list any usable text model for this key";
      throw new LLMError(this.error, "bad_request", 60 * MINUTE);
    }
    this.error = null;
    this.inner = new FallbackLLM(names.map((n) => ({ name: `gemini:${n}`, llm: new PacedLLM(new GeminiLLM({ model: n }, this.onUsage, this.client), 6000) })));
    this.loadedAt = Date.now();
    return this.inner;
  }

  status(): ModelStatus[] {
    if (this.inner) return this.inner.status();
    return [{ name: "gemini:auto", problem: this.error ?? "מחפש מודלים זמינים...", until: this.error ? Date.now() + 1 : 0, lastUsedAt: 0 }];
  }

  async write(req: WriterRequest): Promise<Draft[]> {
    return (await this.models()).write(req);
  }

  async review(channel: ChannelConfig, items: ReviewItem[], sources: SourceItem[]): Promise<Verdict[]> {
    return (await this.models()).review(channel, items, sources);
  }
}

export interface ModelStatus {
  name: string;
  /** null = fine; otherwise why it is being skipped */
  problem: string | null;
  until: number;
  lastUsedAt: number;
}

/**
 * Tries several models in order. A model that fails because of the service
 * (overloaded, out of quota, retired, refused) rests for a while and the next
 * one is asked instead. Only when every model fails does the call fail.
 */
export class FallbackLLM implements LLM {
  private state: ModelStatus[];

  constructor(
    private models: { name: string; llm: LLM }[],
    private clock: () => number = Date.now,
  ) {
    if (models.length === 0) throw new Error("no AI models to use");
    this.state = models.map((m) => ({ name: m.name, problem: null, until: 0, lastUsedAt: 0 }));
  }

  status(): ModelStatus[] {
    return this.state.flatMap((s, i) => {
      const inner = this.models[i]!.llm as Partial<{ status(): ModelStatus[] }>;
      return typeof inner.status === "function" && s.until <= this.clock() ? inner.status() : [{ ...s }];
    });
  }

  /** How long a model rests after each kind of failure. */
  private static rest(e: LLMError): number {
    switch (e.kind) {
      case "bad_request":
        return 24 * 60 * MINUTE; // usually: this model does not exist (any more) for this key
      case "auth":
        return 60 * MINUTE;
      case "rate_limit":
        return 15 * MINUTE;
      case "refusal":
      case "truncated":
      case "invalid":
        return 0; // a problem with this one request: try the next model now, keep this one for later
      default:
        return 5 * MINUTE;
    }
  }

  private async run<T>(call: (llm: LLM) => Promise<T>): Promise<T> {
    let last: LLMError | null = null;
    const now = this.clock();
    for (let i = 0; i < this.models.length; i++) {
      const st = this.state[i]!;
      if (st.until > now) continue;
      try {
        const out = await call(this.models[i]!.llm);
        st.problem = null;
        st.lastUsedAt = this.clock();
        return out;
      } catch (err) {
        const e = err instanceof LLMError ? err : new LLMError((err as Error)?.message ?? String(err), "server", 5 * MINUTE);
        last = e;
        st.problem = `${e.kind}: ${e.message.slice(0, 160)}`;
        st.until = this.clock() + FallbackLLM.rest(e);
      }
    }
    if (last) throw last;
    // every model is resting: wait until the first one is back
    const soonest = Math.min(...this.state.map((s) => s.until)) - now;
    throw new LLMError("all AI models are resting after errors", "rate_limit", Math.max(soonest, MINUTE));
  }

  write(req: WriterRequest): Promise<Draft[]> {
    return this.run((m) => m.write(req));
  }

  review(channel: ChannelConfig, items: ReviewItem[], sources: SourceItem[]): Promise<Verdict[]> {
    return this.run((m) => m.review(channel, items, sources));
  }
}

/**
 * The models the bot is configured to use, in order, each paced to stay
 * inside free-plan limits. Models whose service has no key are left out.
 */
export function createLLM(
  chain: { provider: "gemini" | "claude"; model: string }[],
  effort: Settings["effort"],
  onUsage: (u: Usage) => void = () => {},
): FallbackLLM {
  const gemini = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  const claude = process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim();
  const models = chain
    .filter((m) => (m.provider === "claude" ? claude : gemini))
    .map((m) => ({
      name: `${m.provider}:${m.model}`,
      llm:
        m.provider === "gemini" && m.model === "auto"
          ? new AutoGeminiLLM(geminiClient(gemini ?? ""), onUsage)
          : m.provider === "claude"
          ? new PacedLLM(new ClaudeLLM({ model: m.model, effort }, onUsage), 1000)
            : // Gemini's free plan allows about 10-15 requests a minute per model; one every 6 seconds stays under that
              new PacedLLM(new GeminiLLM({ model: m.model }, onUsage), 6000),
    }));
  return new FallbackLLM(models);
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
        image_prompt: kind === "image" || kind === "video" ? "a colorful cartoon illustration" : "",
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
