import type { Store } from "../db.js";
import { loadSharp } from "../media/img.js";
import { fetchText, type FetchText } from "./sources.js";

const CHANNEL_ID = /UC[A-Za-z0-9_-]{22}/;

/**
 * Finds a YouTube channel's id from what the owner typed: "@BrawlStars",
 * a channel link, or the id itself. Looked up once and remembered.
 */
export async function youtubeChannelId(input: string, store: Store, fetcher: FetchText = fetchText): Promise<string> {
  const direct = input.match(CHANNEL_ID)?.[0];
  if (direct) return direct;
  const handle = input.trim().replace(/^https?:\/\/(www\.|m\.)?youtube\.com\//, "").replace(/^\/+|\/+$/g, "");
  const key = `yt_id:${handle.toLowerCase()}`;
  const cached = store.get(key);
  if (cached) return cached;
  const page = await fetcher(`https://www.youtube.com/${handle.startsWith("@") ? handle : `@${handle}`}`);
  const id =
    page.match(/"channelId":"(UC[A-Za-z0-9_-]{22})"/)?.[1] ??
    page.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})"/)?.[1] ??
    page.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})/)?.[1];
  if (!id) throw new Error(`YouTube channel "${input}" was not found`);
  store.set(key, id);
  return id;
}

export function youtubeFeedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

export function isYoutubeLink(link: string): boolean {
  return /^https:\/\/(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)/.test(link);
}

function videoId(url: string): string | null {
  return url.match(/(?:v=|shorts\/|youtu\.be\/)([A-Za-z0-9_-]{11})/)?.[1] ?? null;
}

/**
 * The preview WhatsApp shows under a post with a YouTube link: the video's
 * title and its picture. Other links get no preview.
 */
export async function youtubePreview(url: string, fetcher: FetchText = fetchText): Promise<{
  "canonical-url": string;
  "matched-text": string;
  title: string;
  description?: string;
  jpegThumbnail?: Buffer;
  originalThumbnailUrl?: string;
} | undefined> {
  const id = videoId(url);
  if (!id || !isYoutubeLink(url)) return undefined;
  let title = "YouTube";
  try {
    const o = JSON.parse(await fetcher(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`)) as { title?: string; author_name?: string };
    title = o.title ?? title;
  } catch {
    // keep the plain title
  }
  const thumbUrl = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  let jpegThumbnail: Buffer | undefined;
  try {
    const res = await fetch(thumbUrl, { signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      const raw = Buffer.from(await res.arrayBuffer());
      try {
        const sharp = await loadSharp();
        jpegThumbnail = await sharp(raw).resize(320, 180, { fit: "cover" }).jpeg({ quality: 70 }).toBuffer();
      } catch {
        jpegThumbnail = raw.length < 60_000 ? raw : undefined;
      }
    }
  } catch {
    // no picture; the link still works
  }
  return { "canonical-url": url, "matched-text": url, title, description: "YouTube", jpegThumbnail, originalThumbnailUrl: thumbUrl };
}
