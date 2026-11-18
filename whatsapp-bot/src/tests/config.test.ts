import assert from "node:assert/strict";
import { test } from "node:test";
import { inviteCode, loadConfig, parseConfig } from "../config.js";

test("the shipped configuration is valid and lists all 37 channels once", () => {
  const config = loadConfig();
  assert.equal(config.channels.length, 37);
  assert.equal(new Set(config.channels.map((c) => c.id)).size, 37);
  assert.equal(new Set(config.channels.map((c) => c.invite)).size, 37);
  for (const c of config.channels) assert.match(c.invite, /^0029V[A-Za-z0-9]{17,}$/, `${c.id} has a malformed link`);
  const modes = new Map<string, number>();
  for (const c of config.channels) modes.set(c.mode, (modes.get(c.mode) ?? 0) + 1);
  assert.deepEqual(Object.fromEntries(modes), { creative: 16, fandom: 16, news: 3, invasion: 1, off: 1 });
  // channels that promise free things only ever publish from real sources
  for (const c of config.channels.filter((c) => c.group === "brawl-free")) {
    assert.equal(c.mode, "news");
    assert.ok((c.news?.queries.length ?? 0) > 0);
  }
  for (const c of config.channels.filter((c) => c.mode === "fandom")) assert.ok((c.news?.queries.length ?? 0) > 0, `${c.id} has no source`);
  assert.equal(config.settings.provider, "gemini");
  assert.equal(config.settings.model, "gemini-flash-lite-latest");
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
