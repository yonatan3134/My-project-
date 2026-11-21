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

import http from "node:http";
import type { AddressInfo } from "node:net";
import { GoogleGenAI } from "@google/genai";
import { AiImages } from "../media/aiimage.js";
import { renderPhotoCard } from "../media/cards.js";
import { Store } from "../db.js";

test("AI pictures: drawn through the image model, capped per day, failing models rest", async () => {
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#3366ff" } }).png().toBuffer();
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.push(req.url ?? "");
      const body = JSON.parse(raw);
      if ((req.url ?? "").includes("broken-model")) {
        res.writeHead(403, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: { code: 403, message: "no access", status: "PERMISSION_DENIED" } }));
      }
      assert.deepEqual(body.generationConfig.responseModalities, ["IMAGE"]);
      assert.match(JSON.stringify(body.contents), /No text, letters/);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png.toString("base64") } }] }, finishReason: "STOP" }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const store = new Store(":memory:");
    const client = new GoogleGenAI({ apiKey: "k", httpOptions: { baseUrl, retryOptions: { attempts: 1 } } });
    const ai = new AiImages(store, { enabled: true, maxPerDay: 2, freeMaxPerDay: 0, models: ["broken-model", "good-model"], providers: ["gemini"], timezone: "UTC" }, { gemini: "k" }, () => {}, client);
    const t = Date.UTC(2026, 10, 18, 12);
    assert.ok((await ai.draw("a cat on the moon", t))?.equals(png));
    assert.ok(await ai.draw("a dog", t));
    assert.equal(await ai.draw("a third one", t), null, "daily limit");
    assert.ok(seen.filter((u) => u.includes("broken-model")).length >= 1);
    assert.ok(await ai.draw("next day", t + 86_400_000));

    const card = await renderPhotoCard({ photo: png, text: "מה אתם רואים בתמונה? 👀", footer: "ערוץ" });
    assert.equal((await sharp(card.jpeg).metadata()).width, 1080);
  } finally {
    server.close();
  }
});


test("when Gemini cannot draw, the free services are tried in order", async () => {
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#22aa55" } }).png().toBuffer();
  const calls: string[] = [];
  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url.replace(/\?.*$/, ""));
    if (url.includes("pollinations")) return new Response("busy", { status: 429 });
    if (url.endsWith("/generate/async")) {
      assert.match(String(init?.body), /censor_nsfw/);
      return Response.json({ id: "job1" });
    }
    if (url.includes("/generate/check/")) return Response.json({ done: true });
    if (url.includes("/generate/status/")) return Response.json({ generations: [{ img: "https://r2.example/x.webp" }] });
    if (url.startsWith("https://r2.example/")) return new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } });
    return new Response("no", { status: 500 });
  }) as typeof fetch;
  const store = new Store(":memory:");
  const ai = new AiImages(
    store,
    { enabled: true, maxPerDay: 5, freeMaxPerDay: 5, models: ["auto"], providers: ["gemini", "cloudflare", "pollinations", "horde"], timezone: "UTC" },
    {}, // no Gemini key, no Cloudflare account
    () => {},
    undefined,
    fakeFetch,
    async () => {},
  );
  const img = await ai.draw("a happy robot", Date.UTC(2026, 10, 21, 12));
  assert.ok(img?.equals(png), "AI Horde's picture");
  assert.deepEqual(calls.map((c) => new URL(c).hostname), ["image.pollinations.ai", "aihorde.net", "aihorde.net", "aihorde.net", "r2.example"]);
  const u = ai.usage(Date.UTC(2026, 10, 21, 12));
  assert.deepEqual(u.providers.map((p) => [p.name, p.status.slice(0, 5)]), [["gemini", "צריך "], ["cloudflare", "צריך "], ["pollinations", "שגיאה"], ["horde", "עובד "]]);
});
