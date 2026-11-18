import { ApiError, GoogleGenAI } from "@google/genai";
import type { Store } from "../db.js";
import { dayKey } from "../time.js";

const STYLE =
  "Square picture. Bright, friendly cartoon illustration suitable for children. No text, letters or numbers anywhere in the picture. No real people, no logos, no brands, no video game characters.";

/**
 * Draws pictures with Gemini's image models. These are usually paid per
 * picture, so the number per day is capped, and a model that refuses
 * (no access on this key, out of quota) rests for a day before it is tried again.
 */
export class AiImages {
  private client: GoogleGenAI | null;

  constructor(
    private store: Store,
    private opts: { enabled: boolean; maxPerDay: number; models: string[]; timezone: string },
    apiKey: string | undefined,
    private onNote: (message: string) => void = () => {},
    client?: GoogleGenAI,
  ) {
    this.client = client ?? (apiKey ? new GoogleGenAI({ apiKey }) : null);
  }

  private dayCount(now: number): number {
    return this.store.get("aiimg_day") === dayKey(now, this.opts.timezone) ? (this.store.getNumber("aiimg_count") ?? 0) : 0;
  }

  /** Pictures made today and the daily limit, for the settings website. */
  usage(now = Date.now()): { today: number; max: number; enabled: boolean } {
    return { today: this.dayCount(now), max: this.opts.maxPerDay, enabled: this.opts.enabled && this.client !== null };
  }

  /** A PNG/JPEG picture, or null when no picture could be made (the caller then uses its own background). */
  async draw(prompt: string, now = Date.now()): Promise<Buffer | null> {
    if (!this.client || !this.opts.enabled || !prompt.trim()) return null;
    if (this.dayCount(now) >= this.opts.maxPerDay) return null;
    for (const model of this.opts.models) {
      const restKey = `aiimg_rest:${model}`;
      if ((this.store.getNumber(restKey) ?? 0) > now) continue;
      try {
        const res = await this.client.models.generateContent({
          model,
          contents: `${prompt.trim()}\n\n${STYLE}`,
          config: { responseModalities: ["IMAGE"] },
        });
        const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
        if (!part?.inlineData?.data) {
          this.onNote(`AI image (${model}): no picture in the answer (${res.candidates?.[0]?.finishReason ?? "unknown"})`);
          continue;
        }
        const day = dayKey(now, this.opts.timezone);
        const count = this.dayCount(now) + 1;
        this.store.set("aiimg_day", day);
        this.store.set("aiimg_count", String(count));
        return Buffer.from(part.inlineData.data, "base64");
      } catch (err) {
        const status = err instanceof ApiError ? err.status : 0;
        // no access / no quota / unknown model: rest a day; anything else: try again in 15 minutes
        const rest = [400, 401, 403, 404, 429].includes(status) ? 24 * 3600_000 : 15 * 60_000;
        this.store.set(restKey, String(now + rest));
        this.onNote(`AI image (${model}) failed: ${(err as Error).message.slice(0, 200)}`);
      }
    }
    return null;
  }
}
