import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { updateEnvFile } from "../panel/envfile.js";

test(".env updates keep other lines, replace values, and remove emptied ones", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "env-")), ".env");
  fs.writeFileSync(file, "# comment\nGEMINI_API_KEY=old\nBOT_PHONE=972500000001\nOTHER=keep\n");
  updateEnvFile({ GEMINI_API_KEY: "new\nINJECTED=1", BOT_PHONE: "", OWNER_PHONE: "972500000002" }, file);
  assert.equal(fs.readFileSync(file, "utf8"), "# comment\nGEMINI_API_KEY=newINJECTED=1\nOTHER=keep\nOWNER_PHONE=972500000002\n");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

import { PacedLLM, FakeLLM } from "../content/llm.js";
import { Store } from "../db.js";
import { makeConfig } from "./helpers.js";

test("AI calls are spaced out even when many start at once", async () => {
  let clock = 0;
  const starts: number[] = [];
  const inner = new FakeLLM();
  const orig = inner.write.bind(inner);
  inner.write = async (r) => {
    starts.push(clock);
    return orig(r);
  };
  const paced = new PacedLLM(inner, 6000, async (ms) => void (clock += ms), () => clock);
  const channel = makeConfig([{ id: "a", mode: "creative" }]).channels[0]!;
  const req = { channel, mode: "creative" as const, counts: { text: 1 }, usedKeys: [], samples: [], sources: [] };
  await Promise.all([paced.write(req), paced.write(req), paced.write(req)]);
  assert.deepEqual(starts, [0, 6000, 12000]);
});

test("follower history gives the latest count and the change over a week", () => {
  const store = new Store(":memory:");
  assert.deepEqual(store.followers("a"), { count: null, week: null });
  for (let d = 1; d <= 8; d++) store.recordFollowers("a", `2026-11-0${d}`, 100 + d * 5);
  assert.deepEqual(store.followers("a"), { count: 140, week: 35 });
  store.recordFollowers("a", "2026-11-08", 150); // same day again: updated, not duplicated
  assert.equal(store.followers("a").count, 150);
});

test("a waiting post can be thrown away once; it then counts as used", () => {
  const store = new Store(":memory:");
  const id = store.enqueue({ channelId: "a", payload: { kind: "text", text: "x" }, normHash: "h", now: 1 });
  assert.equal(store.readyList("a", 10).length, 1);
  assert.equal(store.discardOne(id, 2), true);
  assert.equal(store.discardOne(id, 3), false);
  assert.equal(store.readyList("a", 10).length, 0);
  assert.equal(store.hashExists("a", null, "h"), true);
});

import { LLMError, FallbackLLM, type LLM } from "../content/llm.js";

function failing(kind: LLMError["kind"]): LLM {
  return {
    write: async () => { throw new LLMError(`test ${kind}`, kind, 60_000); },
    review: async () => { throw new LLMError(`test ${kind}`, kind, 60_000); },
  };
}

test("when a model is unavailable the next one writes, and the broken one rests", async () => {
  let clock = 1_000_000;
  const good = new FakeLLM();
  const fb = new FallbackLLM(
    [
      { name: "a", llm: failing("rate_limit") },
      { name: "b", llm: failing("bad_request") },
      { name: "c", llm: good },
    ],
    () => clock,
  );
  const channel = makeConfig([{ id: "x", mode: "creative" }]).channels[0]!;
  const req = { channel, mode: "creative" as const, counts: { text: 2 }, usedKeys: [], samples: [], sources: [] };
  assert.equal((await fb.write(req)).length, 2);
  const st = fb.status();
  assert.match(st[0]!.problem ?? "", /rate_limit/);
  assert.match(st[1]!.problem ?? "", /bad_request/);
  assert.equal(st[2]!.problem, null);
  // resting models are skipped, so the next call goes straight to the working one
  assert.equal((await fb.write(req)).length, 2);
  assert.equal(good.calls.write, 2);
});

test("when every model fails, the call fails with a wait time", async () => {
  const fb = new FallbackLLM([{ name: "a", llm: failing("server") }, { name: "b", llm: failing("rate_limit") }]);
  const channel = makeConfig([{ id: "x", mode: "creative" }]).channels[0]!;
  await assert.rejects(fb.write({ channel, mode: "creative", counts: { text: 1 }, usedKeys: [], samples: [], sources: [] }), LLMError);
  await assert.rejects(fb.write({ channel, mode: "creative", counts: { text: 1 }, usedKeys: [], samples: [], sources: [] }), /resting/);
});

import { recordChannelEngagement } from "../engagement.js";
import { parseChannelPosts } from "../wa/channels.js";
import { proto } from "baileys";
import { refillChannel } from "../content/generator.js";

test("reactions and views are read from WhatsApp's answer and matched to the bot's posts", () => {
  const msg = (text: string, reactions: [string, number][], views: number) => ({
    tag: "message",
    attrs: { server_id: "1" },
    content: [
      { tag: "plaintext", attrs: {}, content: proto.Message.encode({ conversation: text }).finish() },
      { tag: "reactions", attrs: {}, content: reactions.map(([code, count]) => ({ tag: "reaction", attrs: { code, count: String(count) } })) },
      { tag: "views_count", attrs: { count: String(views) } },
    ],
  });
  const node = { tag: "iq", attrs: {}, content: [{ tag: "message_updates", attrs: {}, content: [{ tag: "messages", attrs: {}, content: [msg("חידה: מה עולה ויורד? 🤔", [["❤️", 5], ["😂", 2]], 120), msg("פוסט של מישהו אחר", [["👍", 1]], 50)] }] }] };
  const posts = parseChannelPosts(node as never);
  assert.deepEqual(posts, [{ text: "חידה: מה עולה ויורד? 🤔", reactions: 7, views: 120 }, { text: "פוסט של מישהו אחר", reactions: 1, views: 50 }]);

  const store = new Store(":memory:");
  const id = store.enqueue({ channelId: "c", payload: { kind: "text", text: "חידה: מה עולה ויורד?" }, now: 1 });
  store.markSent(id, null, Date.UTC(2026, 10, 18), "2026-11-18");
  assert.equal(recordChannelEngagement(store, "c", posts, Date.UTC(2026, 10, 19)), 1);
  assert.deepEqual(store.kindPerformance("c", Date.UTC(2026, 10, 19)), { text: { n: 1, avg: 7, views: 120 } });
});

test("the bot writes more of the kind of post that gets reactions", async () => {
  const config = makeConfig([{ id: "c", mode: "creative", formats: { text: 1, poll: 1, image: 0, video: 0 } }], { buffer: { min: 4, batch: 12 } });
  const store = new Store(":memory:");
  const now = Date.UTC(2026, 10, 19);
  for (let i = 0; i < 6; i++) {
    for (const [kind, reactions] of [["poll", 9], ["text", 1]] as const) {
      const id = store.enqueue({ channelId: "c", payload: kind === "poll" ? { kind, text: "", pollQuestion: `q${i}`, pollOptions: ["a", "b"] } : { kind, text: `t${i}` }, normHash: `${kind}${i}`, now });
      store.markSent(id, null, now - 3600_000, "2026-11-18");
      store.recordEngagement(id, reactions, 10, now);
    }
  }
  let asked: Record<string, number> = {};
  const llm = { write: async (r: { counts: Record<string, number> }) => { asked = r.counts; return []; }, review: async () => [] };
  await refillChannel({ store, llm: llm as never, settings: config.settings }, config.channels[0]!, now);
  assert.ok((asked.poll ?? 0) >= 9, `asked for ${JSON.stringify(asked)}: polls should dominate`);
});
