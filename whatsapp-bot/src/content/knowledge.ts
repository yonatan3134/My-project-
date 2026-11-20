import fs from "node:fs";
import path from "node:path";
import type { ChannelConfig } from "../config.js";
import type { Store } from "../db.js";
import { CONFIG_DIR } from "../paths.js";

export const KNOWLEDGE_DIR = path.join(CONFIG_DIR, "knowledge");

/** Knowledge files the owner can switch on for a channel (config/knowledge/<name>.md). */
export function knowledgeFiles(): { name: string; title: string; pdf: boolean }[] {
  if (!fs.existsSync(KNOWLEDGE_DIR)) return [];
  return fs
    .readdirSync(KNOWLEDGE_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const name = f.slice(0, -3);
      const first = fs.readFileSync(path.join(KNOWLEDGE_DIR, f), "utf8").split("\n").find((l) => l.startsWith("# "));
      return { name, title: first ? first.slice(2).trim() : name, pdf: fs.existsSync(path.join(KNOWLEDGE_DIR, `${name}.pdf`)) };
    });
}

const cache = new Map<string, { at: number; text: string }>();

function readKnowledge(name: string): string | null {
  if (!/^[a-z0-9-]+$/.test(name)) return null;
  const file = path.join(KNOWLEDGE_DIR, `${name}.md`);
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  const hit = cache.get(name);
  if (hit && hit.at === stat.mtimeMs) return hit.text;
  const text = fs.readFileSync(file, "utf8").trim();
  cache.set(name, { at: stat.mtimeMs, text });
  return text;
}

/** The knowledge file switched on for a channel on the website, if any. */
export function channelKnowledge(store: Store, channelId: string): string | null {
  const name = store.get(`knowledge:${channelId}`);
  return name ? name : null;
}

/**
 * The channel as the AI sees it while a knowledge file is on: the file is
 * added to the channel's rules, as the only source of facts, and the posts
 * become riddles, trivia and "who am I?" questions built from it. Both the
 * writer and the reviewer receive it this way.
 */
export function withKnowledge(store: Store, channel: ChannelConfig): ChannelConfig {
  const name = channelKnowledge(store, channel.id);
  const text = name ? readKnowledge(name) : null;
  if (!text) return channel;
  const brief = [
    "A KNOWLEDGE FILE is switched on for this channel. Most posts are riddles, trivia questions and \"who am I?\" puzzles built from it.",
    "Put the answer in \"followup\" (for example \"התשובה: ...\"). A poll may be a trivia question whose options include the right answer, with the answer in \"followup\".",
    "Every fact in a post must appear in the KNOWLEDGE FILE. Do not add facts from memory, even about the same topic.",
    "",
    "KNOWLEDGE FILE:",
    text,
  ].join("\n");
  return { ...channel, rules: [channel.rules, brief].filter(Boolean).join("\n\n") };
}
