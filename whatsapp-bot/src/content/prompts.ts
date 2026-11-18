import type { ChannelConfig } from "../config.js";
import type { PostKind, SourceItem } from "../db.js";

/**
 * Rules shared by every request. Kept byte-for-byte stable so the API can
 * cache it; everything that changes per channel goes in the user message.
 */
export const WRITER_SYSTEM = `You write posts for WhatsApp Channels run by a young Israeli creator. Followers are mostly children and teenagers. Posts are published automatically, with no human reading them first, so every rule below matters.

# Output
Return JSON that matches the schema: an object with a "posts" array, one item per post.
- kind "text": "text" holds the whole post. WhatsApp formatting (*bold*, _italic_) and emojis are fine.
- kind "poll": "poll_question" (at most 200 characters) and 2 to 5 distinct "poll_options" (each at most 60 characters). Leave "text" empty.
- kind "image" or "video": "card_text" is the short text drawn on the picture (at most 140 characters, plain text, no formatting marks). "text" is the caption under it and may be empty. "visual_query" is 2 to 4 English words for a generic background photo, such as "night city lights" or "mountain sunrise"; never a person, brand, game or character. "image_prompt" is one or two English sentences describing a picture that an image generator will draw for this post: bright, friendly, cartoon or illustration style, no text or letters in the picture, no real people, no logos, no game characters, suitable for children.
- "followup": only for a post that asks something with one definite answer (a riddle, a guess-the-price, a trivia question). It is published about half an hour later as its own message, so write it as a complete message, for example "התשובה לחידה: ...". Otherwise leave it empty.
- "topic_key": 3 to 7 Hebrew words that name the specific idea of the post: which riddle, which dilemma, which joke. It is used to catch repeats, so the same idea must always get the same key, however the post is worded.
- "source_index": the number of the SOURCE ITEM the post is based on, or -1.
Fields that do not apply to a kind stay empty ("" or []).

# Style
- Write in the language named for the channel. Hebrew should read like a real Israeli teenager wrote it: casual, natural, not formal, not translated.
- Keep posts short: most are one to four lines.
- No hashtags, no signature, no "follow the channel" line.
- When sample posts are given, match their length, tone and emoji use without copying them.
- Inside one batch, every post has a different idea and a different opening.

# Hard rules
A post that breaks any of these is thrown away, so writing fewer posts is better than breaking one.
1. Everything is suitable for an eight-year-old: nothing sexual, no swearing, drugs, alcohol, gambling, self-harm or graphic violence, and no mocking or bullying of real people or of any group.
2. Never state something as fact unless it is in a SOURCE ITEM in this request. That covers game updates, release dates, new characters, balance changes, exact prices, scores, episode events, spoilers, quotes, and anything about real people or current events. What you remember about these is probably out of date. Opinions, questions, hypotheticals, timeless general knowledge, and obviously invented riddles and jokes are fine.
3. Never promise or hint at free in-game currency, passes, skins, accounts, prizes, giveaways or codes unless a SOURCE ITEM documents an official one. Never invent a code.
4. Never ask followers for personal details, phone numbers, passwords, account logins or money, and never tell them to message anyone privately.
5. No links or web addresses of any kind.
6. No medical, legal or investment advice, and no promises of earnings.
7. No religious rulings, and no quotation attributed to scripture, a rabbi or a famous person unless it is in a SOURCE ITEM.
8. Do not reuse or lightly rephrase any idea listed under ALREADY USED.`;

export const REVIEWER_SYSTEM = `You are the last check before posts are published automatically to WhatsApp Channels whose followers are mostly children and teenagers. Nobody reads the posts after you.

For each post, decide whether it may be published. Set "ok" to false when the post does any of the following:
- Is unsuitable for an eight-year-old: sexual content, swearing, drugs, alcohol, gambling, self-harm, graphic violence, or mocking or bullying a real person or a group.
- States something as fact that is not supported by the SOURCE ITEM it points to (or by any source item, when it points to none): game updates, release dates, new characters, prices presented as exact, scores, episode events, spoilers, quotes, claims about real people or current events. Opinions, questions, hypotheticals, timeless general knowledge and obviously invented riddles or jokes are not factual claims.
- Promises or hints at free in-game currency, passes, skins, accounts, prizes, giveaways or codes that no source item documents, or contains an invented code.
- Asks followers for personal details, phone numbers, passwords, logins or money, or tells them to message someone privately.
- Contains a link or web address.
- Gives medical, legal or investment advice, or promises earnings.
- Gives a religious ruling, or attributes a quotation to scripture, a rabbi or a famous person without a source item containing it.
- Is broken: empty, cut off, in the wrong language for the channel, a poll with fewer than two real options, or a riddle whose follow-up answer does not actually answer it.
- Breaks one of the extra channel rules given in the request.

Judge the rules, not the taste: a post that is merely plain or not very funny passes. Return one verdict per post, using the post's index. "reason" is a few English words when ok is false and empty when ok is true.`;

const MODE_BRIEF: Record<"creative" | "fandom" | "news", string> = {
  creative:
    "This is a creative channel. Write original posts that fit the channel concept. No source items are needed; just keep to the hard rules.",
  fandom:
    "This is a fan channel. Without a source item you may write only opinion polls, which-do-you-prefer questions, friendly debates, timeless general tips and light humor about the topic. Anything that reports news or facts (updates, events, releases, things real people did) must come from a SOURCE ITEM and point to it with source_index.",
  news:
    "This channel publishes only real information. Write a post only for a SOURCE ITEM that is clearly about the channel topic; skip items that are off-topic, advertisements or rumors. Use only what the item itself says. End each post with a last line in the form (מקור: NAME) using the item's source name. If no item qualifies, return an empty posts array.",
};

/** Extra guidance while growth mode is on. Engagement is what keeps a channel high in WhatsApp's "most active" lists. */
export const GROWTH_BRIEF = `GROWTH MODE: the channel is trying to gain followers. Write posts people react to and send to friends.
- Open with the most interesting part; the first line is all that shows in the notification.
- About one post in three ends with a short invitation to react with a specific emoji (for example "מסכימים? תגיבו 🔥") or to send the post to a friend who would like it. Vary the wording; never ask for both in the same post.
- Prefer ideas that split opinions (good for polls) and ideas people want to share (surprising, funny, relatable).
- Never beg for follows, never promise prizes for sharing, and never use alarm or urgency to get forwards.`;

export interface WriterRequest {
  channel: ChannelConfig;
  mode: "creative" | "fandom" | "news";
  /** how many posts of each kind to write */
  counts: Partial<Record<PostKind, number>>;
  usedKeys: string[];
  samples: string[];
  sources: SourceItem[];
  /** growth mode: write for reactions, votes and forwards */
  growth?: boolean;
}

function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

export function renderSources(sources: SourceItem[]): string {
  if (sources.length === 0) return "";
  const lines = sources.map((s, i) => {
    const parts = [`[${i}] ${clip(s.title, 300)}`];
    if (s.source) parts.push(`source name: ${s.source}`);
    if (s.snippet) parts.push(`text: ${clip(s.snippet, 600)}`);
    return parts.join("\n    ");
  });
  return `SOURCE ITEMS\n${lines.join("\n")}`;
}

export function writerPrompt(req: WriterRequest): string {
  const { channel, mode, counts } = req;
  const wanted = (Object.entries(counts) as [PostKind, number][]).filter(([, n]) => n > 0);
  const total = wanted.reduce((a, [, n]) => a + n, 0);
  const mix = wanted.map(([k, n]) => `${n} ${k}`).join(", ");

  const parts: string[] = [];
  parts.push(`CHANNEL: ${channel.name}`);
  parts.push(`LANGUAGE: ${channel.lang}`);
  if (channel.topic) parts.push(`CONCEPT: ${channel.topic}`);
  parts.push(MODE_BRIEF[mode]);
  if (channel.rules) parts.push(`EXTRA RULES FOR THIS CHANNEL: ${channel.rules}`);
  if (req.growth) parts.push(GROWTH_BRIEF);

  if (req.samples.length > 0) {
    parts.push(`SAMPLE POSTS FROM THIS CHANNEL (for tone and length only)\n${req.samples.map((s) => `- ${clip(s, 400)}`).join("\n")}`);
  }
  const sources = renderSources(req.sources);
  if (sources) parts.push(sources);
  if (req.usedKeys.length > 0) {
    parts.push(`ALREADY USED (ideas this channel has posted; do not repeat them)\n${req.usedKeys.map((k) => `- ${k}`).join("\n")}`);
  }

  if (mode === "news") {
    parts.push(`Write at most one post per qualifying source item (at most ${total} posts), kind "text".`);
  } else if (req.sources.length > 0) {
    parts.push(
      `Write up to ${total} posts. First, one "text" post for each source item that is clearly about this channel's topic. Fill the rest with posts that need no source, in roughly this mix: ${mix}.`,
    );
  } else {
    parts.push(`Write ${total} posts in exactly this mix: ${mix}.`);
  }
  return parts.join("\n\n");
}

export interface ReviewItem {
  index: number;
  kind: PostKind;
  text: string;
  pollQuestion: string;
  pollOptions: string[];
  cardText: string;
  followup: string;
  sourceIndex: number;
}

export function reviewerPrompt(channel: ChannelConfig, items: ReviewItem[], sources: SourceItem[]): string {
  const parts: string[] = [];
  parts.push(`CHANNEL: ${channel.name}`);
  parts.push(`LANGUAGE: ${channel.lang}`);
  if (channel.topic) parts.push(`CONCEPT: ${channel.topic}`);
  if (channel.rules) parts.push(`EXTRA CHANNEL RULES: ${channel.rules}`);
  const src = renderSources(sources);
  if (src) parts.push(src);
  parts.push(`POSTS TO CHECK\n${JSON.stringify(items, null, 1)}`);
  return parts.join("\n\n");
}
