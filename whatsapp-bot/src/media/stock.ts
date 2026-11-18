import fs from "node:fs/promises";
import path from "node:path";
import { TMP_DIR } from "../paths.js";

/**
 * Optional backgrounds from Pexels, whose licence allows free reuse.
 * Only used when PEXELS_API_KEY is set; without it posts use the built-in
 * gradient cards.
 */
const API = "https://api.pexels.com";
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

async function api<T>(key: string, url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: key }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Pexels HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function download(url: string, maxBytes: number): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new Error("file too large");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error("file too large");
  return buf;
}

function pick<T>(items: T[], seed: number): T | undefined {
  return items.length === 0 ? undefined : items[seed % items.length];
}

export async function stockPhoto(key: string, query: string, seed: number): Promise<Buffer | null> {
  const data = await api<{ photos?: { src?: { large2x?: string; large?: string } }[] }>(
    key,
    `${API}/v1/search?query=${encodeURIComponent(query)}&per_page=15&orientation=square`,
  );
  const url = pick(data.photos ?? [], seed)?.src;
  const src = url?.large2x ?? url?.large;
  return src ? download(src, 12 * 1024 * 1024) : null;
}

/** Downloads a short stock clip to a temp file and returns its path, or null when nothing suitable was found. */
export async function stockVideo(key: string, query: string, seed: number): Promise<string | null> {
  const data = await api<{ videos?: { duration?: number; video_files?: { link?: string; width?: number; file_type?: string }[] }[] }>(
    key,
    `${API}/videos/search?query=${encodeURIComponent(query)}&per_page=15`,
  );
  const candidates = (data.videos ?? []).filter((v) => (v.duration ?? 0) >= 4 && (v.duration ?? 0) <= 40);
  const video = pick(candidates, seed);
  const file = (video?.video_files ?? [])
    .filter((f) => f.link && f.file_type === "video/mp4" && (f.width ?? 0) >= 640 && (f.width ?? 0) <= 1920)
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0];
  if (!file?.link) return null;
  const buf = await download(file.link, MAX_VIDEO_BYTES);
  await fs.mkdir(TMP_DIR, { recursive: true });
  const out = path.join(TMP_DIR, `${Date.now()}-stock.mp4`);
  await fs.writeFile(out, buf);
  return out;
}
