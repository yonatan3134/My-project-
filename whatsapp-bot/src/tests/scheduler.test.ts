import assert from "node:assert/strict";
import { test } from "node:test";
import { currentSlot, cycleMs, dailyCap, inQuietHours, minSpacingMs, phaseOf, pollAsText, rolloutCount } from "../scheduler.js";
import { DAY, HOUR, MINUTE } from "../time.js";
import { makeConfig } from "./helpers.js";

const config = makeConfig([{ id: "a", mode: "creative" }, { id: "b", mode: "fandom" }, { id: "c", mode: "news" }]);
const s = config.settings;

test("the cycle is three slots one hour apart, then a two hour pause", () => {
  assert.equal(cycleMs(s), 5 * HOUR);
  const phase = phaseOf("a", s);
  const base = 1000 * cycleMs(s) + phase; // start of some cycle for this channel
  assert.equal(currentSlot(base, "a", s), base);
  assert.equal(currentSlot(base + 59 * MINUTE, "a", s), base);
  assert.equal(currentSlot(base + HOUR + 5 * MINUTE, "a", s), base + HOUR);
  assert.equal(currentSlot(base + 2 * HOUR + 30 * MINUTE, "a", s), base + 2 * HOUR);
  assert.equal(currentSlot(base + 3 * HOUR + 1, "a", s), null);
  assert.equal(currentSlot(base + 4 * HOUR + 59 * MINUTE, "a", s), null);
  assert.equal(currentSlot(base + 5 * HOUR, "a", s), base + 5 * HOUR);
});

test("a full day has 14 or 15 slots per channel", () => {
  const seen = new Set<number>();
  const start = 500 * DAY;
  for (let t = start; t < start + DAY; t += MINUTE) {
    const slot = currentSlot(t, "a", s);
    if (slot !== null && slot >= start) seen.add(slot);
  }
  assert.ok(seen.size === 14 || seen.size === 15, `got ${seen.size}`);
});

test("channels are spread over the cycle rather than all posting together", () => {
  const ids = Array.from({ length: 35 }, (_, i) => `channel-${i}`);
  const minutes = new Set(ids.map((id) => Math.floor(phaseOf(id, s) / (10 * MINUTE))));
  assert.ok(minutes.size >= 15, `only ${minutes.size} distinct ten-minute offsets`);
});

test("gradual start: 5 channels, then 15, then all", () => {
  const cfg = makeConfig([{ id: "a", mode: "creative" }], { rollout: [{ days: 3, channels: 5 }, { days: 4, channels: 15 }] }).settings;
  assert.equal(rolloutCount(cfg, 0, 0, 35), 5);
  assert.equal(rolloutCount(cfg, 0, 2.9 * DAY, 35), 5);
  assert.equal(rolloutCount(cfg, 0, 3 * DAY, 35), 15);
  assert.equal(rolloutCount(cfg, 0, 6.9 * DAY, 35), 15);
  assert.equal(rolloutCount(cfg, 0, 7 * DAY, 35), 35);
  assert.equal(rolloutCount(cfg, 0, 0, 3), 3);
});

test("daily caps: warm-up first, then the mode's own limit", () => {
  const cfg = makeConfig([{ id: "a", mode: "creative" }], { warmup: [{ days: 7, maxPerDay: 4 }, { days: 7, maxPerDay: 8 }] });
  const [creative] = cfg.channels;
  assert.equal(dailyCap(creative!, cfg.settings, 0, 1 * DAY), 4);
  assert.equal(dailyCap(creative!, cfg.settings, 0, 8 * DAY), 8);
  assert.equal(dailyCap(creative!, cfg.settings, 0, 15 * DAY), null);
  const [, fandom, news] = config.channels;
  assert.equal(dailyCap(fandom!, s, 0, 30 * DAY), s.fandomMaxPerDay);
  assert.equal(dailyCap(news!, s, 0, 30 * DAY), s.newsMaxPerDay);
  assert.equal(minSpacingMs(null), 0);
  assert.ok(minSpacingMs(4) > 3 * HOUR);
});

test("quiet hours wrap around midnight", () => {
  const cfg = makeConfig([{ id: "a", mode: "creative" }], { quietHours: { from: 23, to: 7 }, timezone: "UTC" }).settings;
  assert.equal(inQuietHours(cfg, Date.UTC(2026, 0, 5, 23, 30)), true);
  assert.equal(inQuietHours(cfg, Date.UTC(2026, 0, 5, 3, 0)), true);
  assert.equal(inQuietHours(cfg, Date.UTC(2026, 0, 5, 7, 0)), false);
  assert.equal(inQuietHours(cfg, Date.UTC(2026, 0, 5, 15, 0)), false);
  assert.equal(inQuietHours(s, Date.UTC(2026, 0, 5, 3, 0)), false);
});

test("a poll that cannot be sent as a poll becomes a readable text post", () => {
  const text = pollAsText({ kind: "poll", text: "", pollQuestion: "מה עדיף?", pollOptions: ["פיצה", "המבורגר"] });
  assert.match(text, /מה עדיף\?/);
  assert.match(text, /1️⃣ פיצה/);
  assert.match(text, /2️⃣ המבורגר/);
});
