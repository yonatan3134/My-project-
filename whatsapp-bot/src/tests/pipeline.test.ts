import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeLLM } from "../content/llm.js";
import { Store } from "../db.js";
import { Scheduler } from "../scheduler.js";
import { seededRandom, simulate, stubMedia } from "../sim.js";
import { DAY, HOUR, MINUTE } from "../time.js";
import { makeConfig, ScriptedSender } from "./helpers.js";

const START = Date.UTC(2026, 0, 4, 22, 0, 0); // midnight in Israel

function sentRows(store: Store) {
  return store.db
    .prepare("SELECT id, channel_id, grp, kind, payload, norm_hash, sent_at, day_key, is_followup, source_item_id FROM queue WHERE status = 'sent' ORDER BY sent_at")
    .all() as { id: number; channel_id: string; grp: string | null; kind: string; payload: string; norm_hash: string; sent_at: number; day_key: string; is_followup: number; source_item_id: number | null }[];
}

test("two days, mixed channels: schedule, caps, no repeats, nothing rejected gets out", async () => {
  const config = makeConfig([
    { id: "riddles", mode: "creative", formats: { text: 4, poll: 2, image: 1, video: 1 } },
    { id: "pro-1", mode: "fandom", group: "brawl", news: { queries: ["x"], feeds: [] } },
    { id: "pro-2", mode: "fandom", group: "brawl", news: { queries: ["x"], feeds: [] } },
    { id: "free", mode: "news", maxPerDay: 3, news: { queries: ["y"], feeds: [] } },
    { id: "inv", mode: "invasion" },
    { id: "closed", mode: "off" },
  ]);
  const sender = new ScriptedSender();
  const { store } = await simulate({ config, days: 2, start: START, sender, llm: new FakeLLM({ repeatEvery: 4, badEvery: 7 }) });
  const rows = sentRows(store);
  const posts = rows.filter((r) => !r.is_followup);

  // every post that was sent reached the sender exactly once
  assert.equal(sender.delivered().length, rows.length);
  assert.equal(rows.filter((r) => r.payload.includes("BADPOST")).length, 0);
  assert.equal(posts.filter((r) => r.channel_id === "closed").length, 0);

  // creative channel: the full cycle, 14-15 a day, never two posts closer than the slot spacing allows
  for (const day of new Set(posts.map((r) => r.day_key))) {
    const n = posts.filter((r) => r.channel_id === "riddles" && r.day_key === day).length;
    assert.ok(n >= 13 && n <= 15, `riddles posted ${n} on ${day}`);
    for (const id of ["pro-1", "pro-2"]) {
      const m = posts.filter((r) => r.channel_id === id && r.day_key === day).length;
      assert.ok(m >= 3 && m <= config.settings.fandomMaxPerDay, `${id} posted ${m} on ${day}`);
    }
    assert.ok(posts.filter((r) => r.channel_id === "free" && r.day_key === day).length <= 3);
  }
  const riddles = posts.filter((r) => r.channel_id === "riddles");
  for (let i = 1; i < riddles.length; i++) {
    const gap = riddles[i]!.sent_at - riddles[i - 1]!.sent_at;
    assert.ok(gap >= 39 * MINUTE, `two posts ${Math.round(gap / MINUTE)} minutes apart`);
  }
  // three in a row, then at least a two hour break
  const bigGaps = riddles.slice(1).filter((r, i) => r.sent_at - riddles[i]!.sent_at >= 2 * HOUR).length;
  assert.ok(bigGaps >= 8, `only ${bigGaps} pauses in two days`);

  // no repeats inside a channel; no repeats across the group except news both channels report
  for (const id of new Set(posts.map((r) => r.channel_id))) {
    const hashes = posts.filter((r) => r.channel_id === id).map((r) => r.norm_hash);
    assert.equal(new Set(hashes).size, hashes.length, `repeat inside ${id}`);
  }
  const groupFills = posts.filter((r) => r.grp === "brawl" && r.source_item_id === null).map((r) => r.norm_hash);
  assert.equal(new Set(groupFills).size, groupFills.length, "the same non-news post went to two sibling channels");
  assert.ok(posts.some((r) => r.grp === "brawl" && r.source_item_id !== null), "fan channels should also carry real news");

  // answers follow their riddle in the same channel, 25-40 minutes later
  const followups = rows.filter((r) => r.is_followup && r.channel_id === "riddles");
  assert.ok(followups.length > 0);
  for (const f of followups) {
    const parent = riddles.filter((p) => p.sent_at < f.sent_at && (JSON.parse(p.payload).followup ?? "") === JSON.parse(f.payload).text).at(-1);
    assert.ok(parent, "follow-up without a parent post");
    const delay = f.sent_at - parent!.sent_at;
    assert.ok(delay >= 25 * MINUTE && delay <= 42 * MINUTE, `follow-up after ${Math.round(delay / MINUTE)} minutes`);
  }

  // invasion calls: at most two a day, each linking to the channel it points at
  const inv = rows.filter((r) => r.channel_id === "inv");
  assert.ok(inv.length >= 1 && inv.length <= 4, `${inv.length} invasion posts`);
  for (const r of inv) assert.match(JSON.parse(r.payload).text, /https:\/\/whatsapp\.com\/channel\/0029Vtest/);
});

test("after an outage the bot resumes on schedule instead of posting everything it missed", async () => {
  const config = makeConfig(Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, mode: "creative", formats: { text: 1, poll: 0, image: 0, video: 0 } })));
  const sender = new ScriptedSender();
  const down = { from: START + 6 * HOUR, to: START + 30 * HOUR };
  const { store } = await simulate({ config, days: 2, start: START, sender, isConnected: (t) => t < down.from || t >= down.to });
  const posts = sentRows(store).filter((r) => !r.is_followup);
  assert.equal(posts.filter((r) => r.sent_at >= down.from && r.sent_at < down.to).length, 0);
  assert.ok(posts.some((r) => r.sent_at >= down.to && r.sent_at < down.to + HOUR), "the bot should start posting again");
  // no burst: in the ten minutes after coming back each channel posts at most once,
  // and no channel ever posts twice within less than the slot spacing
  const firstMinutes = posts.filter((r) => r.sent_at >= down.to && r.sent_at < down.to + 10 * MINUTE);
  assert.equal(new Set(firstMinutes.map((r) => r.channel_id)).size, firstMinutes.length, "a channel posted twice right after reconnecting");
  for (const id of new Set(posts.map((r) => r.channel_id))) {
    const mine = posts.filter((r) => r.channel_id === id);
    for (let i = 1; i < mine.length; i++) {
      const gap = mine[i]!.sent_at - mine[i - 1]!.sent_at;
      assert.ok(gap >= 39 * MINUTE, `${id} posted twice ${Math.round(gap / MINUTE)} minutes apart`);
    }
  }
  // the day after the outage is a normal day, not a day and a half
  const after = posts.filter((r) => r.sent_at >= down.to && r.channel_id === "c0").length;
  assert.ok(after <= 12, `c0 posted ${after} times in the 18 hours after the outage`);
});

test("a rejected poll goes out as text in the same slot; after three rejections polls stop being tried", async () => {
  const config = makeConfig([{ id: "polls", mode: "creative", formats: { text: 0, poll: 1, image: 0, video: 0 } }]);
  const sender = new ScriptedSender();
  sender.fail.poll = { ok: false, error: "WhatsApp rejected the message (code 400)" };
  const { store } = await simulate({ config, days: 1, start: START, sender });
  // three rejections switch polls off for 6 hours; after that one probe at a time, with the pause doubling
  const attempts = sender.log.filter((s) => s.kind === "poll");
  assert.ok(attempts.length >= 3 && attempts.length <= 5, `${attempts.length} poll attempts in a day`);
  const firstThree = sender.log.slice(0, 6).filter((s) => s.kind === "poll").length;
  assert.equal(firstThree, 3, "the first three posts each try a poll and fall back to text");
  assert.equal(sender.delivered("poll").length, 0);
  const texts = sender.delivered("text");
  assert.ok(texts.length >= 13, `only ${texts.length} posts went out`);
  assert.ok(texts.every((t) => t.body.includes("1️⃣")), "polls should be rewritten as numbered text");
  assert.ok((store.getNumber("poll_off_until") ?? 0) > START);
  assert.equal(sentRows(store).filter((r) => !r.is_followup).length, texts.length);
});

test("pictures and videos fall back to text the same way", async () => {
  const config = makeConfig([{ id: "pics", mode: "creative", formats: { text: 0, poll: 0, image: 1, video: 1 } }]);
  const sender = new ScriptedSender();
  sender.fail.image = { ok: false, error: "channel media upload failed" };
  sender.fail.video = { ok: false, error: "channel media upload failed" };
  const { store } = await simulate({ config, days: 1, start: START, sender });
  const tries = sender.log.filter((s) => s.kind === "image" || s.kind === "video").length;
  assert.ok(tries >= 3 && tries <= 5, `${tries} media attempts in a day`);
  assert.ok(sender.delivered("text").length >= 13);
  assert.ok((store.getNumber("media_off_until") ?? 0) > START);
});

test("a send that may or may not have arrived is never retried", async () => {
  const config = makeConfig([{ id: "one", mode: "creative", formats: { text: 1, poll: 0, image: 0, video: 0 } }]);
  const sender = new ScriptedSender();
  sender.fail.text = { ok: false, uncertain: true, error: "connection broke while sending" };
  const { store } = await simulate({ config, days: 1, start: START, sender });
  const bodies = sender.log.map((s) => s.body);
  assert.ok(bodies.length >= 13);
  assert.equal(new Set(bodies).size, bodies.length, "the same post was attempted twice");
  const statuses = store.db.prepare("SELECT status, COUNT(*) AS n FROM queue WHERE attempts > 0 GROUP BY status").all() as { status: string; n: number }[];
  assert.deepEqual(statuses.map((s) => s.status), ["unknown"]);
});

test("a definite failure is retried, at most three times, and never duplicated once it succeeds", async () => {
  const config = makeConfig([{ id: "one", mode: "creative", formats: { text: 1, poll: 0, image: 0, video: 0 } }]);
  const sender = new ScriptedSender();
  let calls = 0;
  const original = sender.text.bind(sender);
  sender.text = async (jid, text) => {
    calls++;
    sender.fail.text = calls <= 2 ? { ok: false, error: "WhatsApp rejected the message (code 500)" } : undefined;
    return original(jid, text);
  };
  const { store } = await simulate({ config, days: 1, start: START, sender });
  const first = sender.log[0]!.body;
  assert.equal(sender.log.filter((s) => s.body === first).length, 3, "first post: two failures, then one success");
  assert.equal(sender.delivered().filter((s) => s.body === first).length, 1);
  assert.equal((store.db.prepare("SELECT COUNT(*) AS n FROM queue WHERE status = 'failed'").get() as { n: number }).n, 0);
});

test("a post that was mid-send when the bot crashed is not sent again after restart", async () => {
  const config = makeConfig([{ id: "one", mode: "creative" }]);
  const store = new Store(":memory:");
  const now = START;
  store.updateChannel("one", { jid: "x@newsletter", role: "ADMIN", resolved_at: now });
  const id = store.enqueue({ channelId: "one", payload: { kind: "text", text: "פוסט שנתקע באמצע שליחה" }, normText: "a", normHash: "h1", now });
  assert.equal(store.markSending(id, now), true);
  assert.equal(store.markSending(id, now), false, "a row can be claimed only once");
  // ...crash, then restart:
  assert.equal(store.recoverInterrupted(now + 1000), 1);
  assert.equal(store.queueRow(id)!.status, "unknown");

  const sender = new ScriptedSender();
  let clock = now;
  const scheduler = new Scheduler({ store, config, sender, media: stubMedia, now: () => clock, random: seededRandom(1), isConnected: () => true });
  for (; clock < now + 6 * HOUR; clock += 15_000) await scheduler.tick();
  assert.equal(sender.log.filter((s) => s.body.includes("שנתקע")).length, 0);
  // and it still counts as used, so the same text is not queued again
  assert.equal(store.hashExists("one", null, "h1"), true);
});

test("pause stops everything; a paused channel stays silent while others continue", async () => {
  const config = makeConfig([
    { id: "a", mode: "creative", formats: { text: 1, poll: 0, image: 0, video: 0 } },
    { id: "b", mode: "creative", formats: { text: 1, poll: 0, image: 0, video: 0 } },
  ]);
  const store = new Store(":memory:");
  store.set("paused", "1");
  const all = new ScriptedSender();
  await simulate({ config, days: 1, start: START, sender: all, store });
  assert.equal(all.log.length, 0);

  const store2 = new Store(":memory:");
  store2.updateChannel("a", { paused: 1 });
  const some = new ScriptedSender();
  await simulate({ config, days: 1, start: START, sender: some, store: store2 });
  assert.ok(some.log.length >= 13);
  assert.ok(some.log.every((s) => s.jid === "sim-b@newsletter"));
});

test("the bot never posts where it is not an admin", async () => {
  const config = makeConfig([{ id: "a", mode: "creative" }, { id: "b", mode: "creative" }]);
  const store = new Store(":memory:");
  store.updateChannel("a", { jid: "sim-a@newsletter", role: "SUBSCRIBER", resolved_at: START });
  const sender = new ScriptedSender();
  await simulate({ config, days: 1, start: START, sender, store });
  assert.equal(sender.log.filter((s) => s.jid === "sim-a@newsletter").length, 0);
  assert.ok(sender.log.length > 0);
  assert.ok(store.eventsSince(START, "warn").some((e) => e.kind === "not_admin" && e.channel_id === "a"));
});

test("gradual start and warm-up on the real configuration", async () => {
  const { loadConfig } = await import("../config.js");
  const config = loadConfig();
  const { store } = await simulate({ config, days: 4, start: START });
  const posts = sentRows(store).filter((r) => !r.is_followup);
  const byDay = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  for (const r of posts) {
    if (!byDay.has(r.day_key)) byDay.set(r.day_key, new Set());
    byDay.get(r.day_key)!.add(r.channel_id);
    counts.set(`${r.day_key}:${r.channel_id}`, (counts.get(`${r.day_key}:${r.channel_id}`) ?? 0) + 1);
  }
  const days = [...byDay.keys()].sort();
  assert.equal(byDay.get(days[0]!)!.size, 5, "first days: five channels");
  assert.equal(byDay.get(days[3]!)!.size, 15, "day four: fifteen channels");
  assert.ok(Math.max(...counts.values()) <= 4, "warm-up caps new channels at four posts a day");
  assert.ok(!posts.some((r) => r.channel_id === "ai-images"));
  void DAY;
});

test("growth mode: silent at night, one recommendation of another channel per channel per day", async () => {
  const config = makeConfig([
    { id: "a", mode: "creative", formats: { text: 1, poll: 0, image: 0, video: 0 } },
    { id: "b", mode: "creative", formats: { text: 1, poll: 0, image: 0, video: 0 } },
  ]);
  const store = new Store(":memory:");
  store.set("growth", "1");
  const sender = new ScriptedSender();
  await simulate({ config, days: 2, start: START, sender, store });
  const rows = sentRows(store);
  const hour = (t: number) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hourCycle: "h23" }).format(new Date(t)));
  assert.ok(rows.length > 10);
  assert.equal(rows.filter((r) => hour(r.sent_at) < 7).length, 0, "posted at night");
  const promos = rows.filter((r) => JSON.parse(r.payload).text?.includes("whatsapp.com/channel/"));
  for (const id of ["a", "b"]) {
    const mine = promos.filter((r) => r.channel_id === id);
    assert.equal(mine.length, 2, `${id}: one promotion a day`);
    for (const p of mine) assert.doesNotMatch(JSON.parse(p.payload).text, new RegExp(id === "a" ? "ערוץ a\\*" : "ערוץ b\\*"));
  }
});

test("special post: a fixed text every 3rd post, and an AI-written one every 4th", async () => {
  const config = makeConfig([
    { id: "fixed", mode: "creative", formats: { text: 1, poll: 0, image: 0, video: 0 }, special: { every: 3, text: "⭐ תעקבו ותזמינו חברים!" } },
    { id: "ai", mode: "creative", formats: { text: 1, poll: 0, image: 0, video: 0 }, special: { every: 4, prompt: "חידה קשה במיוחד" } },
  ]);
  const sender = new ScriptedSender();
  const { store } = await simulate({ config, days: 1, start: START, sender });
  const posts = sentRows(store).filter((r) => !r.is_followup);
  const fixed = posts.filter((r) => r.channel_id === "fixed").map((r) => JSON.parse(r.payload).text as string);
  assert.ok(fixed.length >= 12);
  fixed.forEach((t, i) => assert.equal(t === "⭐ תעקבו ותזמינו חברים!", i % 3 === 2, `post ${i + 1}: ${t}`));
  const ai = store.db.prepare("SELECT special FROM queue WHERE channel_id = 'ai' AND status = 'sent' AND is_followup = 0 ORDER BY sent_at").all() as { special: number }[];
  assert.ok(ai.length >= 12);
  ai.forEach((r, i) => assert.equal(r.special, i % 4 === 3 ? 1 : 0, `ai post ${i + 1}`));
});

test("push: the channel's link goes out once in every other channel, not again within 12 hours", async () => {
  const config = makeConfig([{ id: "a", mode: "creative" }, { id: "b", mode: "creative" }, { id: "c", mode: "fandom" }, { id: "inv", mode: "invasion" }]);
  const store = new Store(":memory:");
  for (const c of config.channels) store.updateChannel(c.id, { jid: `sim-${c.id}@newsletter`, role: "ADMIN", resolved_at: START });
  store.updateChannel("c", { paused: 1 });
  const sender = new ScriptedSender();
  let clock = START + 10 * HOUR;
  const scheduler = new Scheduler({ store, config, sender, media: stubMedia, now: () => clock, random: seededRandom(2), isConnected: () => true });
  assert.equal(scheduler.pushChannel(config.channels[0]!, clock), 2, "b and the invasion channel; c is paused");
  assert.match(String(scheduler.pushChannel(config.channels[0]!, clock + HOUR)), /12/);
  for (const end = clock + 10 * MINUTE; clock < end; clock += 15_000) await scheduler.tick();
  const pushes = sender.log.filter((s) => s.body.includes(config.channels[0]!.invite));
  assert.deepEqual(pushes.map((p) => p.jid).sort(), ["sim-b@newsletter", "sim-inv@newsletter"]);
  assert.match(pushes[0]!.body, /ערוץ מומלץ/);
});

test("a channel's own rhythm replaces the general one", async () => {
  const config = makeConfig([{ id: "slow", mode: "creative", formats: { text: 1, poll: 0, image: 0, video: 0 }, cycle: { postsPerBurst: 1, intervalMinutes: 60, pauseMinutes: 180 } }]);
  const { store } = await simulate({ config, days: 2, start: START });
  const n = sentRows(store).filter((r) => !r.is_followup).length;
  assert.ok(n >= 11 && n <= 13, `${n} posts in two days (expected about 12: one every 4 hours)`);
});

test("approval mode: nothing goes out until approved; approved posts go out on schedule", async () => {
  const config = makeConfig([{ id: "a", mode: "creative", formats: { text: 1, poll: 0, image: 0, video: 0 } }]);
  const store = new Store(":memory:");
  store.set("approve:a", "1");
  const sender = new ScriptedSender();
  await simulate({ config, days: 1, start: START, sender, store });
  assert.equal(sender.log.length, 0, "sent without approval");
  const pending = store.pendingList("a", 50);
  assert.ok(pending.length >= 4 && pending.length <= 12, `${pending.length} waiting (the bot must not keep writing)`);
  for (const p of pending.slice(0, 2)) assert.equal(store.approve(p.id, START), true);
  await simulate({ config, days: 1, start: START + DAY, sender, store });
  assert.equal(sender.log.filter((s) => !s.body.startsWith("התשובה")).length, 2, "exactly the two approved posts");
});

test("send now: a riddle goes out at once (also at night in growth mode) and its answer follows", async () => {
  const { writeNow } = await import("../content/generator.js");
  const { FakeLLM } = await import("../content/llm.js");
  const config = makeConfig([{ id: "r", mode: "creative" }]);
  const store = new Store(":memory:");
  store.set("growth", "1"); // quiet 00:00-07:00
  store.updateChannel("r", { jid: "sim-r@newsletter", role: "ADMIN", resolved_at: START, paused: 1 });
  const night = START + 2 * HOUR; // 02:00 in Israel
  const llm = new FakeLLM();
  const orig = llm.write.bind(llm);
  llm.write = async (req) => (await orig(req)).map((d) => ({ ...d, text: "חידה: מה תמיד מגיע אבל אף פעם לא כאן?", followup: "התשובה: מחר!" }));
  const r = await writeNow({ store, llm, settings: config.settings }, config.channels[0]!, "חידה", night);
  assert.ok("text" in r, JSON.stringify(r));
  const sender = new ScriptedSender();
  let clock = night;
  const scheduler = new Scheduler({ store, config, sender, media: stubMedia, now: () => clock, random: seededRandom(3), isConnected: () => true });
  for (; clock < night + 2 * MINUTE; clock += 15_000) await scheduler.tick();
  assert.equal(sender.log.length, 1, "sent right away, despite night and the paused channel");
  assert.match(sender.log[0]!.body, /חידה/);
  const answer = store.db.prepare("SELECT payload, not_before FROM queue WHERE status = 'ready' AND is_followup = 1").get() as { payload: string; not_before: number };
  assert.equal(JSON.parse(answer.payload).text, "התשובה: מחר!");
  assert.ok(answer.not_before >= night + 25 * MINUTE, "the answer comes about half an hour later");
});

test("send the whole queue now: every waiting post goes out within minutes, spaced out", async () => {
  const config = makeConfig([{ id: "q", mode: "creative" }]);
  const store = new Store(":memory:");
  store.updateChannel("q", { jid: "sim-q@newsletter", role: "ADMIN", resolved_at: START });
  for (let i = 0; i < 5; i++) store.enqueue({ channelId: "q", payload: { kind: "text", text: `פוסט ${i}` }, normHash: `h${i}`, now: START });
  const sender = new ScriptedSender();
  let clock = START + 3 * HOUR + 30 * MINUTE; // whatever part of the cycle it is
  const t0 = clock;
  assert.equal(store.flushQueue("q", t0), 5);
  const scheduler = new Scheduler({ store, config, sender, media: stubMedia, now: () => clock, random: seededRandom(4), isConnected: () => true });
  for (; clock < t0 + 10 * MINUTE; clock += 15_000) await scheduler.tick();
  assert.equal(sender.log.length, 5);
  assert.equal(store.readyCount("q"), 0);
});
