import { normalize } from "./content/dedup.js";
import type { PostPayload, Store } from "./db.js";
import type { ChannelPost } from "./wa/channels.js";

/** The text WhatsApp shows for a post, as it is matched against the channel's messages. */
export function shownText(p: PostPayload): string {
  if (p.kind === "poll") return p.pollQuestion ?? "";
  if (p.kind === "image" || p.kind === "video") return p.text;
  return p.text;
}

/**
 * Stores the reactions and views WhatsApp reports for the bot's own posts in
 * a channel, matching posts by their text. Returns how many were matched.
 */
export function recordChannelEngagement(store: Store, channelId: string, posts: ChannelPost[], now: number): number {
  const ours = store.sentForMatching(channelId, now - 30 * 24 * 3600_000);
  const byText = new Map<string, number>();
  for (const o of ours) {
    const key = normalize(shownText(o.payload)).slice(0, 120);
    if (key.length >= 6 && !byText.has(key)) byText.set(key, o.id);
  }
  let matched = 0;
  for (const p of posts) {
    const id = byText.get(normalize(p.text).slice(0, 120));
    if (id === undefined) continue;
    store.recordEngagement(id, p.reactions, p.views, now);
    matched++;
  }
  return matched;
}
