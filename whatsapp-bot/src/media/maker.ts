import fs from "node:fs/promises";
import type { ChannelConfig } from "../config.js";
import type { PostPayload } from "../db.js";
import { hash32 } from "../time.js";
import type { MediaMaker } from "../scheduler.js";
import { renderCard, renderOverlay, type CardImage } from "./cards.js";
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
  ) {}

  async image(p: PostPayload, channel: ChannelConfig, seed: string): Promise<CardImage> {
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
