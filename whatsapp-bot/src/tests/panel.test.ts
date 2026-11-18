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
