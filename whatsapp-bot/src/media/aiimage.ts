import { ApiError, type GoogleGenAI } from "@google/genai";
import { discoverGeminiModels, geminiClient } from "../content/llm.js";
import type { Store } from "../db.js";
import { dayKey, hash32 } from "../time.js";

const STYLE =
  "Square picture. Bright, friendly cartoon illustration suitable for children. No text, letters or numbers anywhere in the picture. No real people, no logos, no brands, no video game characters.";

export type ImageProvider = "gemini" | "cloudflare" | "pollinations" | "horde";

export interface ImageKeys {
  gemini?: string;
  cloudflareAccount?: string;
  cloudflareToken?: string;
  pollinationsToken?: string;
  hordeKey?: string;
}

export interface AiImageOptions {
  enabled: boolean;
  /** pictures a day from paid services (Gemini) */
  maxPerDay: number;
  /** pictures a day from the free services */
  freeMaxPerDay: number;
  /** Gemini image models; "auto" = the ones Google lists for the key */
  models: string[];
  /** services to try, in order */
  providers: ImageProvider[];
  timezone: string;
}

type Fetch = typeof fetch;

/**
 * Draws pictures with several services, trying them in order until one
 * answers: Gemini (usually paid), Cloudflare Workers AI (free daily
 * allowance, needs an account), Pollinations (free, no account) and AI
 * Horde (free, no account, slow). A service that fails rests for a while;
 * when all fail the caller uses its own background.
 */
export class AiImages {
  private gemini: GoogleGenAI | null;
  private discovered: { at: number; names: string[] } | null = null;

  constructor(
    private store: Store,
    private opts: AiImageOptions,
    private keys: ImageKeys,
    private onNote: (message: string) => void = () => {},
    client?: GoogleGenAI,
    private http: Fetch = fetch,
    private wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    this.gemini = client ?? (keys.gemini ? geminiClient(keys.gemini) : null);
  }

  private count(kind: "paid" | "free", now: number): number {
    return this.store.get(`aiimg_day_${kind}`) === dayKey(now, this.opts.timezone) ? (this.store.getNumber(`aiimg_count_${kind}`) ?? 0) : 0;
  }

  private bump(kind: "paid" | "free", now: number): void {
    const n = this.count(kind, now) + 1;
    this.store.set(`aiimg_day_${kind}`, dayKey(now, this.opts.timezone));
    this.store.set(`aiimg_count_${kind}`, String(n));
  }

  private available(p: ImageProvider): boolean {
    if (p === "gemini") return this.gemini !== null;
    if (p === "cloudflare") return Boolean(this.keys.cloudflareAccount && this.keys.cloudflareToken);
    return true; // pollinations and horde work without an account
  }

  /** Pictures made today and each service's last result, for the settings website. */
  usage(now = Date.now()): { today: number; max: number; enabled: boolean; providers: { name: ImageProvider; ready: boolean; status: string }[] } {
    return {
      today: this.count("paid", now) + this.count("free", now),
      max: this.opts.maxPerDay + this.opts.freeMaxPerDay,
      enabled: this.opts.enabled,
      providers: this.opts.providers.map((p) => ({
        name: p,
        ready: this.available(p) && (this.store.getNumber(`aiimg_rest:${p}`) ?? 0) <= now,
        status: !this.available(p) ? "צריך מפתח" : (this.store.get(`aiimg_status:${p}`) ?? "עוד לא נוסה"),
      })),
    };
  }

  /** A picture, or null when no service could make one (the caller then uses its own background). */
  async draw(prompt: string, now = Date.now()): Promise<Buffer | null> {
    if (!this.opts.enabled || !prompt.trim()) return null;
    const full = `${prompt.trim()}\n\n${STYLE}`;
    for (const p of this.opts.providers) {
      if (!this.available(p)) continue;
      if ((this.store.getNumber(`aiimg_rest:${p}`) ?? 0) > now) continue;
      const kind = p === "gemini" ? "paid" : "free";
      if (this.count(kind, now) >= (kind === "paid" ? this.opts.maxPerDay : this.opts.freeMaxPerDay)) continue;
      try {
        const img = await this.run(p, full, now);
        if (img && img.length > 0) {
          this.bump(kind, now);
          this.store.set(`aiimg_status:${p}`, "עובד ✓");
          return img;
        }
        throw new Error("no picture in the answer");
      } catch (err) {
        const msg = (err as Error).message.slice(0, 160);
        // a refusal or missing access rests longer than a passing error
        const hard = /\b(401|403|404|402)\b|PERMISSION|not found|quota|billing/i.test(msg);
        this.store.set(`aiimg_rest:${p}`, String(now + (hard ? 6 * 3600_000 : 20 * 60_000)));
        this.store.set(`aiimg_status:${p}`, `שגיאה: ${msg}`);
        this.onNote(`AI image (${p}) failed: ${msg}`);
      }
    }
    return null;
  }

  private run(p: ImageProvider, prompt: string, now: number): Promise<Buffer | null> {
    switch (p) {
      case "gemini":
        return this.viaGemini(prompt, now);
      case "cloudflare":
        return this.viaCloudflare(prompt);
      case "pollinations":
        return this.viaPollinations(prompt);
      case "horde":
        return this.viaHorde(prompt);
    }
  }

  private async geminiModels(now: number): Promise<string[]> {
    if (!this.opts.models.includes("auto")) return this.opts.models;
    if (!this.discovered || now - this.discovered.at > 6 * 3600_000) {
      try {
        this.discovered = { at: now, names: await discoverGeminiModels(this.gemini!, "image") };
      } catch (err) {
        this.onNote(`AI image: could not list Gemini models: ${(err as Error).message.slice(0, 150)}`);
        this.discovered = { at: now, names: [] };
      }
    }
    return this.opts.models.flatMap((m) => (m === "auto" ? this.discovered!.names : [m]));
  }

  private async viaGemini(prompt: string, now: number): Promise<Buffer | null> {
    const models = await this.geminiModels(now);
    if (models.length === 0) throw new Error("no Gemini image model for this key (404)");
    let last = "";
    for (const model of models) {
      try {
        const res = await this.gemini!.models.generateContent({ model, contents: prompt, config: { responseModalities: ["IMAGE"] } });
        const part = res.candidates?.[0]?.content?.parts?.find((x) => x.inlineData?.data);
        if (part?.inlineData?.data) return Buffer.from(part.inlineData.data, "base64");
        last = `${model}: no picture (${res.candidates?.[0]?.finishReason ?? "?"})`;
      } catch (err) {
        last = `${model}: ${err instanceof ApiError ? err.status : ""} ${(err as Error).message}`;
      }
    }
    throw new Error(last);
  }

  private async viaCloudflare(prompt: string): Promise<Buffer | null> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.keys.cloudflareAccount}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
    const res = await this.http(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.keys.cloudflareToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, steps: 4 }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`Cloudflare HTTP ${res.status}`);
    const json = (await res.json()) as { result?: { image?: string } };
    return json.result?.image ? Buffer.from(json.result.image, "base64") : null;
  }

  private async viaPollinations(prompt: string): Promise<Buffer | null> {
    const seed = hash32(prompt) % 1_000_000;
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&safe=true&private=true&seed=${seed}`;
    const headers: Record<string, string> = {};
    if (this.keys.pollinationsToken) headers.Authorization = `Bearer ${this.keys.pollinationsToken}`;
    const res = await this.http(url, { headers, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`Pollinations HTTP ${res.status}`);
    if (!(res.headers.get("content-type") ?? "").startsWith("image/")) throw new Error("Pollinations answered without a picture");
    return Buffer.from(await res.arrayBuffer());
  }

  /** AI Horde: a volunteer network. Free and anonymous, but a picture can take a few minutes. */
  private async viaHorde(prompt: string): Promise<Buffer | null> {
    const base = "https://aihorde.net/api/v2";
    const headers = { apikey: this.keys.hordeKey || "0000000000", "Client-Agent": "whatsapp-channels-bot:1.0:anonymous", "Content-Type": "application/json" };
    const start = await this.http(`${base}/generate/async`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt, params: { width: 512, height: 512, steps: 20, n: 1 }, nsfw: false, censor_nsfw: true, r2: true }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!start.ok) throw new Error(`AI Horde HTTP ${start.status}`);
    const { id } = (await start.json()) as { id?: string };
    if (!id) throw new Error("AI Horde did not start a job");
    for (let i = 0; i < 60; i++) {
      await this.wait(5000);
      const check = (await (await this.http(`${base}/generate/check/${id}`, { headers, signal: AbortSignal.timeout(20_000) })).json()) as { done?: boolean; faulted?: boolean };
      if (check.faulted) throw new Error("AI Horde job failed");
      if (!check.done) continue;
      const status = (await (await this.http(`${base}/generate/status/${id}`, { headers, signal: AbortSignal.timeout(20_000) })).json()) as { generations?: { img?: string; censored?: boolean }[] };
      const g = status.generations?.[0];
      if (!g?.img || g.censored) throw new Error("AI Horde returned no usable picture");
      if (g.img.startsWith("http")) {
        const img = await this.http(g.img, { signal: AbortSignal.timeout(60_000) });
        if (!img.ok) throw new Error(`AI Horde download HTTP ${img.status}`);
        return Buffer.from(await img.arrayBuffer());
      }
      return Buffer.from(g.img, "base64");
    }
    throw new Error("AI Horde took too long");
  }
}
