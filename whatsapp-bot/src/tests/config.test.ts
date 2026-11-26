import assert from "node:assert/strict";
import { test } from "node:test";
import { inviteCode, loadConfig, parseConfig } from "../config.js";

test("the shipped configuration is valid and lists all channels once", () => {
  const config = loadConfig();
  assert.equal(config.channels.length, 35);
  assert.equal(new Set(config.channels.map((c) => c.id)).size, 35);
  assert.equal(new Set(config.channels.map((c) => c.invite)).size, 35);
  for (const c of config.channels) assert.match(c.invite, /^0029V[A-Za-z0-9]{17,}$/, `${c.id} has a malformed link`);
  const modes = new Map<string, number>();
  for (const c of config.channels) modes.set(c.mode, (modes.get(c.mode) ?? 0) + 1);
  assert.deepEqual(Object.fromEntries(modes), { creative: 17, fandom: 14, news: 3, invasion: 1 });
  // channels that promise free things only ever publish from real sources
  for (const c of config.channels.filter((c) => c.group === "brawl-free")) {
    assert.equal(c.mode, "news");
    assert.ok((c.news?.queries.length ?? 0) > 0);
  }
  for (const c of config.channels.filter((c) => c.mode === "fandom")) assert.ok((c.news?.queries.length ?? 0) > 0, `${c.id} has no source`);
  assert.equal(config.settings.provider, "gemini");
  assert.equal(config.settings.model, "gemini-flash-lite-latest");
  assert.equal(config.settings.models.length, 5);
});

test("links and bare codes are both accepted", () => {
  assert.equal(inviteCode("https://whatsapp.com/channel/0029VbBlj916mYPKFxLFtv3k"), "0029VbBlj916mYPKFxLFtv3k");
  assert.equal(inviteCode("0029VbBlj916mYPKFxLFtv3k"), "0029VbBlj916mYPKFxLFtv3k");
});

test("mistakes in the channel file are reported clearly", () => {
  const base = { name: "x", invite: "0029Vaaaaaaaaaaaaaaaaaaaa", mode: "creative" };
  assert.throws(() => parseConfig({}, [{ ...base, id: "a" }, { ...base, id: "a", invite: "0029Vbbbbbbbbbbbbbbbbbbbb" }]), /duplicate channel id/);
  assert.throws(() => parseConfig({}, [{ ...base, id: "a" }, { ...base, id: "b" }]), /appears twice/);
  assert.throws(() => parseConfig({}, [{ ...base, id: "Bad Id" }]));
  assert.throws(() => parseConfig({}, [{ ...base, id: "a", mode: "whatever" }]));
});

import { mergeChannelLists } from "../config.js";

test("a new built-in channel list from an update merges with the owner's edits", () => {
  const ch = (id: string, code: string, extra: Record<string, unknown> = {}) => ({ id, invite: `0029V${code.padEnd(17, "x")}`, ...extra });
  const base = [ch("a", "a"), ch("b", "b"), ch("c", "c")]; // built-in list when the owner saved
  const edited = [ch("a", "a", { topic: "my edit" }), ch("c", "c"), ch("mine", "m")]; // owner edited a, deleted b, added mine
  const shipped = [ch("a", "a"), ch("b", "b"), ch("d", "d")]; // new version: c removed, d added
  const out = mergeChannelLists(shipped, edited, base);
  assert.deepEqual(out.map((c) => c.id), ["a", "d", "mine"]);
  assert.equal(out[0]!.topic, "my edit");
  // saved by an older version (no base): the new built-in list applies, keeping the edits of channels in it
  const old = mergeChannelLists(shipped, edited, edited);
  assert.deepEqual(old.map((c) => c.id), ["a", "b", "d"]);
  assert.equal(old[0]!.topic, "my edit");
});
