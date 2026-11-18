import sharp, { type OverlayOptions, type Sharp } from "sharp";
import { hash32 } from "../time.js";

export const CARD_SIZE = 1080;
const FONT = "Noto Sans Hebrew, Rubik, Heebo, DejaVu Sans, Segoe UI, Arial, Segoe UI Emoji, sans-serif";

/** Gradient pairs chosen to keep white text readable. */
const THEMES: [string, string][] = [
  ["#5b2be0", "#e02b8a"],
  ["#0f4c81", "#1fb6a6"],
  ["#b3261e", "#f08a24"],
  ["#1b5e20", "#9ccc65"],
  ["#311b92", "#00b0ff"],
  ["#4a148c", "#ff6f00"],
  ["#263238", "#ef5350"],
  ["#006064", "#7e57c2"],
];

function escapeMarkup(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function gradientSvg(seed: string, size: number): Buffer {
  const [a, b] = THEMES[hash32(seed) % THEMES.length] ?? ["#5b2be0", "#e02b8a"];
  const pad = Math.round(size * 0.055);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <rect x="${pad}" y="${pad}" width="${size - 2 * pad}" height="${size - 2 * pad}" rx="${Math.round(size * 0.045)}" fill="#000" fill-opacity="0.22"/>
    </svg>`,
  );
}

/**
 * Renders text with Pango, which handles right-to-left Hebrew, mixed
 * Hebrew/English lines, emoji, wrapping and fitting the text into the box.
 */
async function textLayer(text: string, width: number, height: number, weight = "bold"): Promise<Buffer> {
  return sharp({
    text: {
      text: `<span foreground="white" weight="${weight}">${escapeMarkup(text)}</span>`,
      font: FONT,
      width,
      height,
      align: "centre",
      rgba: true,
      wrap: "word",
    },
  })
    .png()
    .toBuffer();
}

export interface CardImage {
  jpeg: Buffer;
  /** small JPEG preview, base64, the form WhatsApp expects */
  thumbnail: string;
  width: number;
  height: number;
}

async function finish(img: Sharp, size: number): Promise<CardImage> {
  const jpeg = await img.jpeg({ quality: 86 }).toBuffer();
  const thumb = await sharp(jpeg).resize(96, 96, { fit: "cover" }).jpeg({ quality: 55 }).toBuffer();
  return { jpeg, thumbnail: thumb.toString("base64"), width: size, height: size };
}

async function footerLayer(footer: string, size: number): Promise<OverlayOptions[]> {
  if (!footer) return [];
  const layer = await textLayer(footer, Math.round(size * 0.7), Math.round(size * 0.035), "normal");
  const meta = await sharp(layer).metadata();
  return [{ input: layer, top: Math.round(size * 0.9), left: Math.round((size - (meta.width ?? 0)) / 2) }];
}

/** A square picture: the text on a coloured gradient (or on a darkened photo when one is supplied). */
export async function renderCard(opts: { text: string; footer?: string; seed: string; background?: Buffer; size?: number }): Promise<CardImage> {
  const size = opts.size ?? CARD_SIZE;
  const text = await textLayer(opts.text, Math.round(size * 0.76), Math.round(size * 0.56));
  let base: Sharp;
  if (opts.background) {
    const photo = await sharp(opts.background).resize(size, size, { fit: "cover" }).modulate({ brightness: 0.55 }).blur(2).toBuffer();
    base = sharp(photo);
  } else {
    base = sharp(gradientSvg(opts.seed, size));
  }
  const layers: OverlayOptions[] = [{ input: text, gravity: "centre" }, ...(await footerLayer(opts.footer ?? "", size))];
  return finish(base.composite(layers), size);
}

/** Transparent text layer that is laid over a stock video. */
export async function renderOverlay(opts: { text: string; width: number; height: number }): Promise<Buffer> {
  const { width, height } = opts;
  const boxW = Math.round(width * 0.86);
  const boxH = Math.round(height * 0.34);
  const text = await textLayer(opts.text, Math.round(boxW * 0.9), Math.round(boxH * 0.8));
  const box = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect x="${Math.round((width - boxW) / 2)}" y="${Math.round((height - boxH) / 2)}" width="${boxW}" height="${boxH}" rx="${Math.round(width * 0.04)}" fill="#000" fill-opacity="0.55"/>
    </svg>`,
  );
  return sharp(box).composite([{ input: text, gravity: "centre" }]).png().toBuffer();
}

/**
 * A picture with the text in a dark band along the bottom, so the picture
 * itself stays visible. Without text the picture is only resized.
 */
export async function renderPhotoCard(opts: { photo: Buffer; text?: string; footer?: string; size?: number }): Promise<CardImage> {
  const size = opts.size ?? CARD_SIZE;
  const photo = await sharp(opts.photo).resize(size, size, { fit: "cover" }).toBuffer();
  const text = (opts.text ?? "").trim();
  if (!text) return finish(sharp(photo), size);
  const bandH = Math.round(size * 0.3);
  const band = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.35" stop-color="#000" stop-opacity="0.62"/><stop offset="1" stop-color="#000" stop-opacity="0.78"/></linearGradient></defs>
      <rect x="0" y="${size - bandH - Math.round(size * 0.08)}" width="${size}" height="${bandH + Math.round(size * 0.08)}" fill="url(#b)"/>
    </svg>`,
  );
  const layer = await textLayer(text, Math.round(size * 0.86), Math.round(bandH * 0.62));
  const meta = await sharp(layer).metadata();
  const top = size - bandH + Math.round((bandH * 0.62 - (meta.height ?? 0)) / 2);
  const layers: OverlayOptions[] = [
    { input: band, left: 0, top: 0 },
    { input: layer, left: Math.round((size - (meta.width ?? 0)) / 2), top },
    ...(await footerLayer(opts.footer ?? "", size)),
  ];
  return finish(sharp(photo).composite(layers), size);
}
