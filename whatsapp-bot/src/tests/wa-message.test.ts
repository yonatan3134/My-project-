import assert from "node:assert/strict";
import { test } from "node:test";
import { generateWAMessage, type AnyMessageContent, type WAMediaUploadFunction } from "baileys";
import { waLogger } from "../logger.js";
import { renderCard } from "../media/cards.js";
import { ffmpegAvailable, videoFromCard } from "../media/video.js";
import { canPost } from "../wa/channels.js";

/**
 * Builds real WhatsApp messages with the library, without a connection:
 * checks that the content this bot hands over is accepted and lands in the
 * right fields. Whether WhatsApp then shows them in a channel can only be
 * checked against the live service (npm run test-channel).
 */
const JID = "120363000000000000@newsletter";
const uploads: { mediaType: string; bytes: number }[] = [];
const upload: WAMediaUploadFunction = async (filePath, { mediaType }) => {
  const { size } = await (await import("node:fs/promises")).stat(filePath);
  uploads.push({ mediaType, bytes: size });
  return { mediaUrl: "https://mmg.whatsapp.net/v/t/test", directPath: "/v/t/test" };
};
const build = (content: AnyMessageContent) => generateWAMessage(JID, content, { userJid: "972500000000:1@s.whatsapp.net", upload, logger: waLogger });

test("text post", async () => {
  const m = await build({ text: "פוסט בדיקה 🤖" });
  assert.equal(m.key.remoteJid, JID);
  assert.ok(m.key.id);
  assert.equal(m.message?.extendedTextMessage?.text ?? m.message?.conversation, "פוסט בדיקה 🤖");
});

test("single-choice poll", async () => {
  const m = await build({ poll: { name: "מה עדיף?", values: ["פיצה", "המבורגר"], selectableCount: 1 } });
  const poll = m.message?.pollCreationMessageV3 ?? m.message?.pollCreationMessage;
  assert.equal(poll?.name, "מה עדיף?");
  assert.deepEqual(poll?.options?.map((o) => o.optionName), ["פיצה", "המבורגר"]);
});

test("picture post: uploaded unencrypted, with caption, size and preview", async () => {
  const card = await renderCard({ text: "תמונת בדיקה", seed: "t" });
  uploads.length = 0;
  const m = await build({ image: card.jpeg, caption: "כיתוב", jpegThumbnail: card.thumbnail, width: card.width, height: card.height, mimetype: "image/jpeg" });
  const img = m.message?.imageMessage;
  assert.ok(img, "no imageMessage was built");
  assert.equal(img.caption, "כיתוב");
  assert.equal(img.width, 1080);
  assert.equal(img.directPath, "/v/t/test");
  assert.equal(Number(img.fileLength), card.jpeg.length);
  assert.ok(img.jpegThumbnail && img.jpegThumbnail.length > 300);
  // channel media is public: the file itself is uploaded, and there is no encryption key
  assert.deepEqual(uploads, [{ mediaType: "image", bytes: card.jpeg.length }]);
  assert.ok(!img.mediaKey || img.mediaKey.length === 0);
});

test("video post", { skip: !(await ffmpegAvailable()) && "ffmpeg not installed" }, async () => {
  const clip = await videoFromCard((await renderCard({ text: "סרטון בדיקה", seed: "v" })).jpeg, 2);
  uploads.length = 0;
  const m = await build({ video: clip.mp4, caption: "כיתוב", jpegThumbnail: clip.thumbnail, width: clip.width, height: clip.height, seconds: clip.seconds, mimetype: "video/mp4" } as AnyMessageContent);
  const vid = m.message?.videoMessage;
  assert.ok(vid, "no videoMessage was built");
  assert.equal(vid.caption, "כיתוב");
  assert.equal(vid.seconds, 2);
  assert.equal(vid.mimetype, "video/mp4");
  assert.deepEqual(uploads, [{ mediaType: "video", bytes: clip.mp4.length }]);
});

test("followers and guests never post; an unreported role is left for WhatsApp to decide", () => {
  assert.equal(canPost("OWNER"), true);
  assert.equal(canPost("ADMIN"), true);
  assert.equal(canPost("SUBSCRIBER"), false);
  assert.equal(canPost("GUEST"), false);
  assert.equal(canPost(null), true);
});

import { channelStanza } from "../wa/sender.js";
import { getBinaryNodeChild } from "baileys";

test("channel polls and media are sent with the parts WhatsApp requires for channels", async () => {
  const poll = await build({ poll: { name: "מה עדיף?", values: ["פיצה", "המבורגר"], selectableCount: 1 } });
  const p = channelStanza(JID, "id1", poll.message)!;
  assert.equal(p.attrs.type, "poll");
  assert.deepEqual(getBinaryNodeChild(p, "meta")?.attrs, { polltype: "creation", contenttype: "text" });
  const { proto } = await import("baileys");
  const decoded = proto.Message.decode(getBinaryNodeChild(p, "plaintext")!.content as Uint8Array);
  assert.equal(decoded.pollCreationMessageV3?.name, "מה עדיף?");
  assert.equal(decoded.messageContextInfo, null, "no encryption secret on a channel poll");

  const card = await renderCard({ text: "תמונה", seed: "s" });
  const img = await build({ image: card.jpeg, caption: "כיתוב", mimetype: "image/jpeg" });
  const i = channelStanza(JID, "id2", img.message)!;
  assert.equal(i.attrs.type, "media");
  assert.deepEqual(getBinaryNodeChild(i, "plaintext")?.attrs, { mediatype: "image" });

  const text = await build({ text: "רק טקסט" });
  assert.equal(channelStanza(JID, "id3", text.message), null, "text keeps the library's own path, which works");
});
