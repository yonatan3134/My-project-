import assert from "node:assert/strict";
import { test } from "node:test";
import { refillChannel } from "../content/generator.js";
import type { Draft, LLM } from "../content/llm.js";
import { isYoutubeLink, youtubeChannelId } from "../content/youtube.js";
import { Store } from "../db.js";
import { makeConfig } from "./helpers.js";

const NOW = Date.parse("2026-11-19T12:00:00Z");
const ID = "UCooVYzDxdwTtGYAkcPmOgOw";
const FEED = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
<title>Brawl Stars</title>
<entry><id>yt:video:abcDEF12345</id><title>Brawl Talk: New Brawler!</title>
<link rel="alternate" href="https://www.youtube.com/watch?v=abcDEF12345"/><published>2026-11-19T08:00:00+00:00</published>
<media:group><media:description>Everything about the new season</media:description></media:group></entry>
<entry><id>yt:video:oldOLD12345</id><title>Old video</title><link rel="alternate" href="https://www.youtube.com/watch?v=oldOLD12345"/><published>2026-10-01T08:00:00+00:00</published></entry>
</feed>`;

const fetcher = async (url: string) => {
  if (url === "https://www.youtube.com/@BrawlStars") return `<html><script>var x = {"channelId":"${ID}"}</script></html>`;
  if (url.includes(`channel_id=${ID}`)) return FEED;
  throw new Error(`unexpected ${url}`);
};

test("a YouTube handle is turned into its channel id once", async () => {
  const store = new Store(":memory:");
  let calls = 0;
  const f = async (u: string) => (calls++, fetcher(u));
  assert.equal(await youtubeChannelId("@BrawlStars", store, f), ID);
  assert.equal(await youtubeChannelId("https://www.youtube.com/@BrawlStars", store, f), ID);
  assert.equal(calls, 1, "remembered after the first lookup");
  assert.equal(await youtubeChannelId(`https://www.youtube.com/channel/${ID}`, store, f), ID);
  assert.ok(isYoutubeLink("https://www.youtube.com/watch?v=abcDEF12345"));
  assert.ok(isYoutubeLink("https://youtu.be/abcDEF12345"));
  assert.ok(!isYoutubeLink("https://evil.example/watch?v=abcDEF12345"));
});

test("a new video becomes a post with its link; old videos and AI-written links are not used", async () => {
  const config = makeConfig([{ id: "fans", mode: "fandom", youtube: ["@BrawlStars"] }], { buffer: { min: 1, batch: 1 } });
  const store = new Store(":memory:");
  store.enqueue({ channelId: "fans", payload: { kind: "text", text: "פוסט שכבר מחכה" }, now: NOW }); // the buffer is full, only sources are written
  let offered: string[] = [];
  const llm: LLM = {
    async write(req) {
      offered = req.sources.map((s) => `${s.source} | ${s.title}`);
      const d = (text: string, source_index: number): Draft => ({ kind: "text", text, poll_question: "", poll_options: [], correct_option: "", card_text: "", visual_query: "", image_prompt: "", followup: "", topic_key: text.slice(0, 20), source_index });
      return [d("🎬 סרטון חדש! הבראולר החדש כבר כאן, מי ראה? 🔥", 0), d("עוד סרטון www.example.com", 0)];
    },
    async review(_c, items) {
      return items.map((i) => ({ index: i.index, ok: !i.text.includes("http"), reason: "" }));
    },
  };
  const res = await refillChannel({ store, llm, settings: config.settings, fetcher }, config.channels[0]!, NOW);
  assert.deepEqual(offered, ["YouTube · Brawl Stars | Brawl Talk: New Brawler!"]);
  assert.equal(res.queued, 1);
  assert.ok(res.rejected.includes("contains a link"));
  const post = store.readyList("fans", 10).find((p) => p.payload.text.includes("סרטון חדש"))!;
  assert.match(post.payload.text, /\n\n👇 https:\/\/www\.youtube\.com\/watch\?v=abcDEF12345$/);
});
