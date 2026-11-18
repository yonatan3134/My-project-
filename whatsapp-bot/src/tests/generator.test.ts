import assert from "node:assert/strict";
import { test } from "node:test";
import { draftToPayload, refillChannel, splitCounts } from "../content/generator.js";
import { FakeLLM, LLMError, type Draft, type LLM, type Verdict } from "../content/llm.js";
import { Store } from "../db.js";
import { stubFetcher } from "../sim.js";
import { makeConfig } from "./helpers.js";

const NOW = Date.UTC(2026, 10, 12, 10, 0, 0);

function draft(over: Partial<Draft>): Draft {
  return { kind: "text", text: "", poll_question: "", poll_options: [], card_text: "", visual_query: "", image_prompt: "", followup: "", topic_key: "", source_index: -1, ...over };
}

/** A model that returns exactly the drafts it is given and approves everything unless told otherwise. */
function scripted(drafts: Draft[], review?: (n: number) => Verdict[] | Error): LLM & { reviews: number } {
  return {
    reviews: 0,
    async write() {
      return drafts;
    },
    async review(_c, items) {
      this.reviews++;
      const r = review ? review(items.length) : items.map((it) => ({ index: it.index, ok: true, reason: "" }));
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

test("splitCounts follows the weights and always adds up", () => {
  assert.deepEqual(splitCounts({ text: 5, poll: 3, image: 2, video: 1 }, 8), { text: 4, poll: 2, image: 1, video: 1 });
  assert.deepEqual(splitCounts({ text: 0, poll: 9, image: 0, video: 0 }, 8), { text: 0, poll: 8, image: 0, video: 0 });
  for (const total of [1, 3, 7, 8, 12]) {
    const c = splitCounts({ text: 3, poll: 5, image: 1, video: 0 }, total);
    assert.equal(c.text + c.poll + c.image + c.video, total);
    assert.equal(c.video, 0);
  }
});

test("structural checks: links, bad polls and source-less news never pass", () => {
  assert.deepEqual(draftToPayload(draft({ text: "בואו לאתר www.free-gems.com" }), "creative", 0), { reject: "contains a link" });
  assert.deepEqual(draftToPayload(draft({ text: "הורידו מ-https://x.y/z" }), "creative", 0), { reject: "contains a link" });
  assert.deepEqual(draftToPayload(draft({ text: "קוד מתנה בכתובת gems.gg" }), "creative", 0), { reject: "contains a link" });
  assert.ok("reject" in draftToPayload(draft({ kind: "poll", poll_question: "מה עדיף?", poll_options: ["רק אחת"] }), "creative", 0));
  assert.ok("reject" in draftToPayload(draft({ kind: "poll", poll_question: "מה עדיף?", poll_options: ["כן", "כן"] }), "creative", 0));
  assert.ok("reject" in draftToPayload(draft({ text: "ידיעה בלי מקור" }), "news", 2));
  assert.ok("reject" in draftToPayload(draft({ text: "מצביע למקור שלא קיים", source_index: 5 }), "fandom", 2));
  assert.ok("reject" in draftToPayload(draft({ kind: "image", text: "כיתוב", card_text: "" }), "creative", 0));
  const good = draftToPayload(draft({ kind: "poll", poll_question: "מה עדיף?", poll_options: [" פיצה ", "המבורגר"] }), "creative", 0);
  assert.deepEqual(good, { payload: { kind: "poll", text: "", pollQuestion: "מה עדיף?", pollOptions: ["פיצה", "המבורגר"] } });
});

test("repeats and rule-breaking posts are filtered out before the queue", async () => {
  const config = makeConfig([{ id: "riddles", mode: "creative", formats: { text: 1, poll: 0, image: 0, video: 0 } }]);
  const store = new Store(":memory:");
  const llm = new FakeLLM({ repeatEvery: 3, badEvery: 5 });
  const channel = config.channels[0]!;
  let total = 0;
  for (let round = 0; round < 6; round++) {
    const res = await refillChannel({ store, llm, settings: config.settings }, channel, NOW + round * 1000);
    total += res.queued;
    store.db.prepare("UPDATE queue SET status = 'sent'").run(); // pretend they were all published
  }
  const rows = store.db.prepare("SELECT payload, norm_hash FROM queue").all() as { payload: string; norm_hash: string }[];
  assert.equal(rows.length, total);
  assert.ok(total > 20, `only ${total} posts survived`);
  assert.equal(new Set(rows.map((r) => r.norm_hash)).size, rows.length, "duplicate text in the queue");
  assert.equal(rows.filter((r) => r.payload.includes("BADPOST")).length, 0, "a rejected post reached the queue");
  assert.equal(rows.filter((r) => r.payload.includes("שכבר היה כאן")).length, 1, "the repeated post should appear exactly once");
});

test("channels in the same group never get the same post, but each may report the same news", async () => {
  const config = makeConfig([
    { id: "a", mode: "fandom", group: "g", news: { queries: ["x"], feeds: [] } },
    { id: "b", mode: "fandom", group: "g", news: { queries: ["x"], feeds: [] } },
  ]);
  const store = new Store(":memory:");
  const same = [
    draft({ kind: "poll", poll_question: "איזה בראולר הכי חזק לדעתכם?", poll_options: ["שלי", "קולט"], topic_key: "הבראולר הכי חזק" }),
    draft({ text: "עדכון: כותרת הבדיקה פורסמה היום (מקור: מקור בדיקה)", topic_key: "כותרת הבדיקה", source_index: 0 }),
  ];
  const ctx = { store, llm: scripted(same), settings: config.settings, fetcher: stubFetcher(() => NOW) };
  const a = await refillChannel(ctx, config.channels[0]!, NOW);
  const b = await refillChannel(ctx, config.channels[1]!, NOW);
  assert.equal(a.queued, 2);
  assert.equal(b.queued, 1, "the sibling keeps the news post and drops the repeated poll");
  assert.ok(b.rejected.some((r) => r.startsWith("repeat")));
  const kinds = store.db.prepare("SELECT kind FROM queue WHERE channel_id = 'b'").all() as { kind: string }[];
  assert.deepEqual(kinds, [{ kind: "text" }]);
});

test("a news channel stays silent when there is nothing new, and never offers a headline twice", async () => {
  const config = makeConfig([{ id: "free", mode: "news", news: { queries: ["x"], feeds: [] } }]);
  const store = new Store(":memory:");
  const llm = new FakeLLM();
  const channel = config.channels[0]!;
  const ctx = { store, llm, settings: config.settings, fetcher: stubFetcher(() => NOW) };
  assert.equal((await refillChannel(ctx, channel, NOW)).queued, 1);
  // an hour later the feed still shows the same headline
  assert.equal((await refillChannel(ctx, channel, NOW + 3600_000)).queued, 0);
  assert.equal(llm.calls.write, 1, "the model must not be called when there is no new item");

  const silent = new Store(":memory:");
  const none = await refillChannel({ store: silent, llm, settings: config.settings, fetcher: async () => "<rss><channel></channel></rss>" }, channel, NOW);
  assert.equal(none.queued, 0);
  assert.equal(llm.calls.write, 1);
});

test("if the reviewer cannot be reached, nothing is queued", async () => {
  const config = makeConfig([{ id: "jokes", mode: "creative" }]);
  const store = new Store(":memory:");
  const llm = scripted([draft({ text: "בדיחה תקינה לגמרי על חתול", topic_key: "חתול" })], () => new LLMError("rate limited", "rate_limit", 600_000));
  const res = await refillChannel({ store, llm, settings: config.settings }, config.channels[0]!, NOW);
  assert.equal(res.queued, 0);
  assert.equal(res.llmError?.kind, "rate_limit");
  assert.equal(store.readyCount("jokes"), 0);
  assert.ok(store.channel("jokes").retry_at > NOW, "the channel should wait before trying again");
});

test("a post with no verdict from the reviewer is dropped", async () => {
  const config = makeConfig([{ id: "jokes", mode: "creative" }]);
  const store = new Store(":memory:");
  const drafts = [draft({ text: "בדיחה ראשונה על כלב שרודף אחרי הזנב", topic_key: "כלב" }), draft({ text: "משהו אחר לגמרי על גשם בקיץ", topic_key: "גשם" })];
  const llm = scripted(drafts, () => [{ index: 0, ok: true, reason: "" }]);
  const res = await refillChannel({ store, llm, settings: config.settings }, config.channels[0]!, NOW);
  assert.equal(res.queued, 1);
  assert.ok(res.rejected.includes("review: no verdict"));
});

test("scripture passages are posted in order, once a day, and stop at the end of the book", async () => {
  const config = makeConfig([{ id: "torah", mode: "creative", sefaria: { book: "Pirkei_Avot", chapters: 2, perDay: 1 } }], { buffer: { min: 1, batch: 1 } });
  const store = new Store(":memory:");
  const empty = scripted([]);
  const ctx = { store, llm: empty, settings: config.settings, fetcher: stubFetcher(() => NOW) };
  const texts: string[] = [];
  for (let day = 0; day < 9; day++) {
    const t = NOW + day * 86_400_000;
    await refillChannel(ctx, config.channels[0]!, t);
    await refillChannel(ctx, config.channels[0]!, t + 60_000); // a second pass the same day adds nothing
    store.updateChannel("torah", { retry_at: 0 });
  }
  for (const r of store.db.prepare("SELECT payload FROM queue ORDER BY id").all() as { payload: string }[]) texts.push(JSON.parse(r.payload).text);
  assert.equal(texts.length, 6, "2 chapters x 3 passages, then it stops");
  assert.equal(new Set(texts).size, 6);
  assert.match(texts[0]!, /פרק 1 משנה 1/);
  assert.match(texts[5]!, /פרק 2 משנה 3/);
});
