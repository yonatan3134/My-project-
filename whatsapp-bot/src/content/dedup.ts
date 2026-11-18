import crypto from "node:crypto";
import type { DedupRow, PostPayload } from "../db.js";

const FINAL_LETTERS: Record<string, string> = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };

/**
 * Reduces a text to the letters and digits that carry its meaning, so that
 * two posts that differ only in emojis, punctuation, spacing, vowel points or
 * letter case compare as equal.
 */
export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[֑-ׇ]/g, "") // Hebrew vowel points and cantillation marks
    .replace(/[ךםןףץ]/g, (c) => FINAL_LETTERS[c] ?? c)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hashOf(normalized: string): string {
  return crypto.createHash("sha1").update(normalized).digest("hex");
}

/** The text that identifies a post for repeat detection. */
export function fingerprintText(p: PostPayload): string {
  if (p.kind === "poll") {
    const options = [...(p.pollOptions ?? [])].map(normalize).sort().join(" | ");
    return `${normalize(p.pollQuestion ?? "")} | ${options}`;
  }
  if (p.kind === "image" || p.kind === "video") return normalize(`${p.cardText ?? ""} ${p.text}`);
  return normalize(p.text);
}

export function trigrams(normalized: string): Set<string> {
  const s = ` ${normalized} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}

/** Jaccard similarity of character trigrams: 1 = identical, 0 = nothing in common. */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const g of small) if (large.has(g)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface DedupThresholds {
  similarity: number;
  keySimilarity: number;
}

export interface Candidate {
  normText: string;
  normHash: string;
  topicKey: string;
}

export function candidateOf(p: PostPayload, topicKey: string): Candidate {
  const normText = fingerprintText(p);
  return { normText, normHash: hashOf(normText), topicKey: normalize(topicKey) };
}

/**
 * Compares candidates against history, keeping the pre-computed trigram sets
 * so a whole batch can be checked (and added to) cheaply.
 */
export class DedupIndex {
  private hashes = new Set<string>();
  private texts: Set<string>[] = [];
  private keys: { key: string; grams: Set<string> }[] = [];

  constructor(
    history: DedupRow[],
    private thresholds: DedupThresholds,
  ) {
    for (const h of history) this.add({ normText: h.norm_text, normHash: h.norm_hash, topicKey: h.topic_key });
  }

  add(c: Candidate): void {
    if (c.normHash) this.hashes.add(c.normHash);
    if (c.normText) this.texts.push(trigrams(c.normText));
    if (c.topicKey) this.keys.push({ key: c.topicKey, grams: trigrams(c.topicKey) });
  }

  /** Returns the reason the candidate counts as a repeat, or null when it is new. */
  check(c: Candidate): string | null {
    if (!c.normText) return "empty";
    if (this.hashes.has(c.normHash)) return "identical text";
    if (c.topicKey) {
      const grams = trigrams(c.topicKey);
      for (const k of this.keys) {
        if (k.key === c.topicKey) return `same idea (${c.topicKey})`;
        if (similarity(grams, k.grams) >= this.thresholds.keySimilarity) return `similar idea (${c.topicKey} ~ ${k.key})`;
      }
    }
    const grams = trigrams(c.normText);
    for (const t of this.texts) {
      if (similarity(grams, t) >= this.thresholds.similarity) return "similar text";
    }
    return null;
  }
}
