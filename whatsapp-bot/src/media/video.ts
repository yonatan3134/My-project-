import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { loadSharp } from "./img.js";
import { TMP_DIR } from "../paths.js";

export interface VideoClip {
  mp4: Buffer;
  thumbnail: string;
  seconds: number;
  width: number;
  height: number;
  captionExtra?: string;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stderr });
    });
  });
}

let ffmpegChecked: boolean | null = null;

export async function ffmpegAvailable(): Promise<boolean> {
  if (ffmpegChecked !== null) return ffmpegChecked;
  try {
    ffmpegChecked = (await run("ffmpeg", ["-version"], 10_000)).code === 0;
  } catch {
    ffmpegChecked = false;
  }
  return ffmpegChecked;
}

async function tmpFile(name: string): Promise<string> {
  await fs.mkdir(TMP_DIR, { recursive: true });
  return path.join(TMP_DIR, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${name}`);
}

async function thumbnailOf(jpegOrPng: Buffer): Promise<string> {
  const sharp = await loadSharp();
  return (await sharp(jpegOrPng).resize(96, 96, { fit: "cover" }).jpeg({ quality: 55 }).toBuffer()).toString("base64");
}

const SIZE = 720;
const FPS = 30;

/** Common output settings: H.264 + AAC-less MP4 that WhatsApp plays everywhere. */
const ENCODE = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "27", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an"];

/** Turns a still card into a short clip with a slow zoom. */
export async function videoFromCard(cardJpeg: Buffer, seconds = 7): Promise<VideoClip> {
  const input = await tmpFile("card.jpg");
  const output = await tmpFile("card.mp4");
  try {
    await fs.writeFile(input, cardJpeg);
    const frames = seconds * FPS;
    const zoom = `zoompan=z='min(1+0.10*on/${frames},1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${SIZE}x${SIZE}:fps=${FPS}`;
    const res = await run("ffmpeg", ["-y", "-loop", "1", "-i", input, "-vf", zoom, "-t", String(seconds), ...ENCODE, output], 120_000);
    if (res.code !== 0) throw new Error(`ffmpeg failed: ${res.stderr.split("\n").slice(-3).join(" ")}`);
    return { mp4: await fs.readFile(output), thumbnail: await thumbnailOf(cardJpeg), seconds, width: SIZE, height: SIZE };
  } finally {
    await fs.rm(input, { force: true });
    await fs.rm(output, { force: true });
  }
}

/** Crops a stock clip to a square, trims it, and lays the text layer over it. */
export async function videoFromStock(stockPath: string, overlayPng: Buffer, seconds = 8): Promise<VideoClip> {
  const overlay = await tmpFile("overlay.png");
  const output = await tmpFile("stock.mp4");
  const frame = await tmpFile("frame.jpg");
  try {
    await fs.writeFile(overlay, overlayPng);
    const filter = `[0:v]scale=${SIZE}:${SIZE}:force_original_aspect_ratio=increase,crop=${SIZE}:${SIZE},fps=${FPS}[bg];[bg][1:v]overlay=0:0[out]`;
    const res = await run(
      "ffmpeg",
      ["-y", "-stream_loop", "-1", "-i", stockPath, "-i", overlay, "-filter_complex", filter, "-map", "[out]", "-t", String(seconds), ...ENCODE, output],
      180_000,
    );
    if (res.code !== 0) throw new Error(`ffmpeg failed: ${res.stderr.split("\n").slice(-3).join(" ")}`);
    const shot = await run("ffmpeg", ["-y", "-ss", "1", "-i", output, "-frames:v", "1", frame], 30_000);
    const thumbnail = shot.code === 0 ? await thumbnailOf(await fs.readFile(frame)) : "";
    return { mp4: await fs.readFile(output), thumbnail, seconds, width: SIZE, height: SIZE };
  } finally {
    await fs.rm(overlay, { force: true });
    await fs.rm(output, { force: true });
    await fs.rm(frame, { force: true });
  }
}

export const VIDEO_SIZE = SIZE;
