import fs from "node:fs/promises";
import type { ChannelConfig } from "../config.js";
import type { PostPayload } from "../db.js";
import { hash32 } from "../time.js";
import type { MediaMaker } from "../scheduler.js";
import type { AiImages } from "./aiimage.js";
import { renderCard, renderOverlay, renderPhotoCard, type CardImage } from "./cards.js";
import { stockPhoto, stockVideo } from "./stock.js";
import { VIDEO_SIZE, videoFromCard, videoFromStock, type VideoClip } from "./video.js";

/**
 * Builds the picture or clip for a post. With a Pexels key it looks for a
 * free stock background first; any problem there falls back to the built-in
 * gradient card, so a post is never lost because a photo search failed.
 */
export class DefaultMedia implements MediaMaker {
  constructor(
    private pexelsKey: string | null,
    private onNote: (message: string) => void = () => {},
    private ai: AiImages | null = null,
  ) {}

  /** An AI-drawn picture for the post, with its text, or null when none could be made. */
  private async aiCard(p: PostPayload, channel: ChannelConfig): Promise<CardImage | null> {
    if (!this.ai || !p.imagePrompt) return null;
    try {
      const photo = await this.ai.draw(p.imagePrompt);
      if (!photo) return null;
      const text = channel.style === "photo" ? "" : (p.cardText ?? p.text);
      return await renderPhotoCard({ photo, text, footer: channel.style === "photo" ? "" : channel.name });
    } catch (err) {
      this.onNote(`AI image: ${(err as Error).message}`);
      return null;
    }
  }

  async image(p: PostPayload, channel: ChannelConfig, seed: string): Promise<CardImage> {
    const ai = await this.aiCard(p, channel);
    if (ai) return ai;
    const text = p.cardText ?? p.text;
    let background: Buffer | undefined;
    if (this.pexelsKey && p.visualQuery) {
      try {
        background = (await stockPhoto(this.pexelsKey, p.visualQuery, hash32(seed))) ?? undefined;
      } catch (err) {
        this.onNote(`stock photo: ${(err as Error).message}`);
      }
    }
    return renderCard({ text, footer: channel.name, seed, background });
  }

  async video(p: PostPayload, channel: ChannelConfig, seed: string): Promise<VideoClip> {
    // an AI picture with a slow zoom makes a short clip at no extra cost
    const ai = await this.aiCard(p, channel);
    if (ai) return videoFromCard(ai.jpeg);
    const text = p.cardText ?? p.text;
    if (this.pexelsKey && p.visualQuery) {
      let stockPath: string | null = null;
      try {
        stockPath = await stockVideo(this.pexelsKey, p.visualQuery, hash32(seed));
        if (stockPath) {
          const overlay = await renderOverlay({ text, width: VIDEO_SIZE, height: VIDEO_SIZE });
          return await videoFromStock(stockPath, overlay);
        }
      } catch (err) {
        this.onNote(`stock video: ${(err as Error).message}`);
      } finally {
        if (stockPath) await fs.rm(stockPath, { force: true });
      }
    }
    const card = await renderCard({ text, footer: channel.name, seed });
    return videoFromCard(card.jpeg);
  }
}
