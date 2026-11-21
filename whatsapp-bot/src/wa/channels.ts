import { getAllBinaryNodeChildren, getBinaryNodeChild, normalizeMessageContent, proto, type BinaryNode, type WASocket } from "baileys";
import type { ChannelConfig } from "../config.js";
import type { Store } from "../db.js";
import { sleep } from "../time.js";

export interface ChannelInfo {
  jid: string;
  name: string;
  /** OWNER, ADMIN, SUBSCRIBER or GUEST as WhatsApp reports it for the bot's account */
  role: string | null;
  subscribers: number | null;
}

/**
 * Whether the bot should try to post in a channel. Owners and admins may.
 * When WhatsApp did not report a role at all, the bot still tries: a real
 * lack of permission then shows up as a rejected send, which is better than
 * staying silent everywhere because one field was missing from the answer.
 */
export function canPost(role: string | null | undefined): boolean {
  if (role == null || role === "") return true;
  return role === "OWNER" || role === "ADMIN";
}

/** Looks a channel up by the code at the end of its link. */
export async function lookupChannel(sock: WASocket, invite: string): Promise<ChannelInfo | null> {
  // The library returns WhatsApp's raw answer, which is richer than its declared type.
  const raw = (await sock.newsletterMetadata("invite", invite)) as unknown as Record<string, any> | null;
  if (!raw || typeof raw.id !== "string") return null;
  const thread = raw.thread_metadata ?? {};
  const name = typeof thread.name === "object" ? thread.name?.text : (thread.name ?? raw.name);
  const subs = Number(thread.subscribers_count ?? raw.subscribers);
  return {
    jid: raw.id,
    name: typeof name === "string" ? name : "",
    role: typeof raw.viewer_metadata?.role === "string" ? raw.viewer_metadata.role : null,
    subscribers: Number.isFinite(subs) ? subs : null,
  };
}

export interface ResolveReport {
  id: string;
  name: string;
  status: "ok" | "not_admin" | "not_found" | "error";
  detail: string;
}

/**
 * Finds every configured channel on WhatsApp, remembers its address and
 * checks that the bot's account may post there.
 */
export async function resolveChannels(
  sock: WASocket,
  store: Store,
  channels: ChannelConfig[],
  now: number,
  opts: { maxAgeMs?: number; problemAgeMs?: number; gapMs?: number } = {},
): Promise<ResolveReport[]> {
  const reports: ResolveReport[] = [];
  for (const c of channels) {
    if (c.mode === "off" || !c.enabled) continue;
    const state = store.channel(c.id);
    // a channel where the bot could not post yet is checked again soon: the owner may have just made it an admin
    const fresh = canPost(state.role) ? opts.maxAgeMs : Math.min(opts.maxAgeMs ?? 0, opts.problemAgeMs ?? 10 * 60_000);
    if (fresh && state.jid && state.resolved_at && now - state.resolved_at < fresh) {
      reports.push({ id: c.id, name: c.name, status: canPost(state.role) ? "ok" : "not_admin", detail: state.role ?? "" });
      continue;
    }
    try {
      const info = await lookupChannel(sock, c.invite);
      if (!info) {
        reports.push({ id: c.id, name: c.name, status: "not_found", detail: "the link did not lead to a channel" });
      } else {
        store.updateChannel(c.id, { jid: info.jid, live_name: info.name, role: info.role, resolved_at: now });
        if (info.subscribers !== null) store.recordFollowers(c.id, new Date(now).toISOString().slice(0, 10), info.subscribers);
        reports.push({
          id: c.id,
          name: info.name || c.name,
          status: canPost(info.role) ? "ok" : "not_admin",
          detail: `${info.role ?? "role unknown"}${info.subscribers !== null ? `, ${info.subscribers} followers` : ""}`,
        });
      }
    } catch (err) {
      reports.push({ id: c.id, name: c.name, status: "error", detail: (err as Error).message });
    }
    await sleep(opts.gapMs ?? 1200);
  }
  return reports;
}

function collectMessages(node: BinaryNode, out: BinaryNode[]): void {
  for (const child of getAllBinaryNodeChildren(node)) {
    if (child.tag === "message") out.push(child);
    else collectMessages(child, out);
  }
}

/**
 * Reads the text of a channel's recent posts so new posts can match their
 * tone. Best effort: returns an empty list when WhatsApp's answer has a
 * shape this code does not recognise.
 */
export interface ChannelPost {
  text: string;
  reactions: number;
  views: number;
}

/**
 * Reads a channel's recent posts as WhatsApp returns them: the text (or poll
 * question / caption), the total number of emoji reactions and the view count.
 * Best effort: fields WhatsApp does not send count as 0.
 */
export function parseChannelPosts(result: BinaryNode): ChannelPost[] {
  const nodes: BinaryNode[] = [];
  collectMessages(result, nodes);
  const out: ChannelPost[] = [];
  for (const node of nodes) {
    const plain = getBinaryNodeChild(node, "plaintext");
    if (!plain?.content || !(plain.content instanceof Uint8Array)) continue;
    let text = "";
    try {
      const msg = normalizeMessageContent(proto.Message.decode(plain.content));
      text = (
        msg?.conversation ??
        msg?.extendedTextMessage?.text ??
        msg?.imageMessage?.caption ??
        msg?.videoMessage?.caption ??
        msg?.pollCreationMessageV3?.name ??
        msg?.pollCreationMessage?.name ??
        ""
      ).trim();
    } catch {
      continue;
    }
    let reactions = 0;
    for (const r of getAllBinaryNodeChildren(getBinaryNodeChild(node, "reactions") ?? { tag: "", attrs: {} })) {
      reactions += Number(r.attrs.count ?? 0) || 0;
    }
    const views = Number(getBinaryNodeChild(node, "views_count")?.attrs.count ?? 0) || 0;
    out.push({ text, reactions, views });
  }
  return out;
}

export async function fetchChannelPosts(sock: WASocket, jid: string, count = 50): Promise<ChannelPost[]> {
  return parseChannelPosts((await sock.newsletterFetchMessages(jid, count, 0, 0)) as BinaryNode);
}

export async function recentPostTexts(sock: WASocket, jid: string, count = 30): Promise<string[]> {
  const texts = (await fetchChannelPosts(sock, jid, count))
    .map((p) => p.text)
    .filter((t) => t.length >= 8 && t.length <= 700 && !/https?:\/\//i.test(t));
  return [...new Set(texts)];
}
