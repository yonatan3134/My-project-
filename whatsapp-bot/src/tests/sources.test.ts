import assert from "node:assert/strict";
import { test } from "node:test";
import { collectItems, fetchSefariaChapter, googleNewsUrl, hebrewNumeral, parseFeed, stripHtml } from "../content/sources.js";

const GOOGLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>"האח הגדול" - Google News</title>
<item><title>דרמה בבית האח הגדול: ההדחה הערב - ynet</title>
<link>https://news.google.com/rss/articles/abc?oc=5</link><guid isPermaLink="false">abc</guid>
<pubDate>Thu, 12 Nov 2026 08:00:00 GMT</pubDate>
<description>&lt;a href="https://news.google.com/rss/articles/abc"&gt;דרמה בבית האח הגדול: ההדחה הערב&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;ynet&lt;/font&gt;</description>
<source url="https://www.ynet.co.il">ynet</source></item>
<item><title>ידיעה ישנה - מאקו</title><link>https://news.google.com/rss/articles/old</link><guid>old</guid>
<pubDate>Mon, 02 Nov 2026 08:00:00 GMT</pubDate><source url="https://www.mako.co.il">מאקו</source></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>בלוג המשחק</title>
<entry><title>עדכון חדש</title><link rel="alternate" href="https://example.com/post"/><id>tag:1</id>
<updated>2026-11-12T07:00:00Z</updated><summary type="html">&lt;p&gt;פרטים על &lt;b&gt;העדכון&lt;/b&gt;&lt;/p&gt;</summary></entry></feed>`;

test("reads a Google News feed: headline without the publisher suffix, publisher as source", () => {
  const items = parseFeed(GOOGLE);
  assert.equal(items.length, 2);
  assert.equal(items[0]!.title, "דרמה בבית האח הגדול: ההדחה הערב");
  assert.equal(items[0]!.source, "ynet");
  assert.equal(items[0]!.snippet, "");
  assert.equal(items[0]!.publishedAt, Date.parse("Thu, 12 Nov 2026 08:00:00 GMT"));
});

test("reads an Atom feed", () => {
  const [item] = parseFeed(ATOM);
  assert.equal(item!.title, "עדכון חדש");
  assert.equal(item!.source, "בלוג המשחק");
  assert.equal(item!.snippet, "פרטים על העדכון");
  assert.equal(item!.link, "https://example.com/post");
});

test("only items from the last two days are kept, and one broken source does not stop the others", async () => {
  const now = Date.parse("Thu, 12 Nov 2026 12:00:00 GMT");
  const { items, errors } = await collectItems({ queries: ["האח הגדול"], feeds: ["https://example.com/broken"] }, now, async (url) => {
    if (url.includes("broken")) throw new Error("HTTP 500 from example.com");
    return GOOGLE;
  });
  assert.equal(items.length, 1);
  assert.equal(items[0]!.source, "ynet");
  assert.deepEqual(errors, ["HTTP 500 from example.com"]);
});

test("search URL asks for Hebrew results from Israel", () => {
  const url = googleNewsUrl("בראול סטארס");
  assert.ok(url.startsWith("https://news.google.com/rss/search?q="));
  assert.ok(url.includes("hl=he") && url.includes("gl=IL"));
});

test("Hebrew numerals", () => {
  assert.equal(hebrewNumeral(1), "א׳");
  assert.equal(hebrewNumeral(10), "י׳");
  assert.equal(hebrewNumeral(15), "ט״ו");
  assert.equal(hebrewNumeral(16), "ט״ז");
  assert.equal(hebrewNumeral(23), "כ״ג");
});

test("Sefaria chapter: tags are removed, empty passages dropped, errors surface", async () => {
  const ch = await fetchSefariaChapter("Pirkei_Avot", 1, async () => JSON.stringify({ heRef: "משנה אבות א׳", he: ["<b>משה</b> קיבל תורה", "", "שמעון הצדיק"] }));
  assert.deepEqual(ch.segments, ["משה קיבל תורה", "שמעון הצדיק"]);
  await assert.rejects(fetchSefariaChapter("Nope", 1, async () => JSON.stringify({ error: "not found" })), /Sefaria/);
});

test("stripHtml decodes entities", () => {
  assert.equal(stripHtml("a&nbsp;&amp;&#39;b&#x5D0;"), "a &'bא");
});
