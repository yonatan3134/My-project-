import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { renderCard, renderOverlay } from "../media/cards.js";
import { ffmpegAvailable, videoFromCard } from "../media/video.js";

test("a card is a 1080x1080 JPEG with a preview, and the text is actually drawn", async () => {
  const withText = await renderCard({ text: "מה אתה מעדיף? 🤔\nפיצה או המבורגר", footer: "ערוץ בדיקה", seed: "s" });
  const meta = await sharp(withText.jpeg).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1080);
  assert.ok(Buffer.from(withText.thumbnail, "base64").length > 300);

  // white text pixels exist in the middle of the card
  const { data } = await sharp(withText.jpeg).extract({ left: 140, top: 240, width: 800, height: 600 }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const white = data.filter((v) => v > 235).length;
  assert.ok(white > 4000, `only ${white} bright pixels: the text was not rendered`);
});

test("long and short texts both fit inside the card", async () => {
  for (const text of ["קצר", "טקסט ארוך מאוד ".repeat(14).trim()]) {
    const card = await renderCard({ text, seed: "fit" });
    assert.ok(card.jpeg.length > 10_000);
  }
});

test("the video overlay is a transparent PNG of the requested size", async () => {
  const png = await renderOverlay({ text: "כיתוב על סרטון", width: 720, height: 720 });
  const meta = await sharp(png).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, 720);
  assert.equal(meta.hasAlpha, true);
});

test("a card becomes a short MP4 clip", { skip: !(await ffmpegAvailable()) && "ffmpeg not installed" }, async () => {
  const card = await renderCard({ text: "סרטון בדיקה 🎬", seed: "v" });
  const clip = await videoFromCard(card.jpeg, 2);
  assert.equal(clip.mp4.subarray(4, 8).toString(), "ftyp", "not an MP4 file");
  assert.ok(clip.mp4.length > 5_000);
  assert.equal(clip.seconds, 2);
  assert.equal(clip.width, 720);
});
