import assert from "node:assert/strict";
import { test } from "node:test";
import { candidateOf, DedupIndex, fingerprintText, normalize, similarity, trigrams } from "../content/dedup.js";

const T = { similarity: 0.55, keySimilarity: 0.7 };

test("normalize ignores emoji, punctuation, vowel points, final letters and case", () => {
  assert.equal(normalize("מה אתה מעדיף? 🤔"), normalize("מה   אתה מעדיף"));
  assert.equal(normalize("שָׁלוֹם"), normalize("שלום"));
  assert.equal(normalize("חלום"), normalize("חלומ"));
  assert.equal(normalize("Brawl STARS!!"), "brawl stars");
});

test("similarity is 1 for identical text and low for unrelated text", () => {
  const a = trigrams(normalize("מה אתה מעדיף, פיצה או המבורגר?"));
  assert.equal(similarity(a, a), 1);
  const b = trigrams(normalize("חידה: מה עולה ויורד אבל לא זז מהמקום"));
  assert.ok(similarity(a, b) < 0.2);
});

test("a poll is the same poll whatever the order of its options", () => {
  const a = fingerprintText({ kind: "poll", text: "", pollQuestion: "מה עדיף?", pollOptions: ["פיצה", "המבורגר"] });
  const b = fingerprintText({ kind: "poll", text: "", pollQuestion: "מה עדיף?", pollOptions: ["המבורגר", "פיצה"] });
  assert.equal(a, b);
});

test("index catches identical text, light rewording, and the same idea in other words", () => {
  const first = candidateOf({ kind: "text", text: "חידה: מה עולה ויורד אבל לא זז מהמקום? 🤔" }, "חידת המדרגות");
  const index = new DedupIndex([{ norm_text: first.normText, norm_hash: first.normHash, topic_key: first.topicKey }], T);

  assert.match(index.check(candidateOf({ kind: "text", text: "חידה: מה עולה ויורד אבל לא זז מהמקום?" }, "מדרגות")) ?? "", /identical/);
  assert.match(index.check(candidateOf({ kind: "text", text: "חידה 🧠 מה עולה וגם יורד אבל לא זז מהמקום שלו?" }, "עולה ויורד")) ?? "", /similar text/);
  assert.match(index.check(candidateOf({ kind: "text", text: "נסו לפתור: הן מחברות בין קומות ואף פעם לא הולכות לשום מקום" }, "חידת המדרגות")) ?? "", /same idea/);
  assert.equal(index.check(candidateOf({ kind: "text", text: "מה תמיד מגיע אבל אף פעם לא כאן? מחר!" }, "חידת המחר")), null);
});

test("posts added during a batch are checked against each other", () => {
  const index = new DedupIndex([], T);
  const a = candidateOf({ kind: "text", text: "בדיחה על חתול שלמד לנגן בפסנתר" }, "חתול פסנתרן");
  assert.equal(index.check(a), null);
  index.add(a);
  assert.notEqual(index.check(a), null);
});
