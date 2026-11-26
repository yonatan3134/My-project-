import { getAllBinaryNodeChildren, getBinaryNodeChild, proto, type BinaryNode, type WASocket } from "baileys";
import type { Store } from "../db.js";
import { fetchChannelRaw } from "./channels.js";

/**
 * "Learn from the phone": the owner posts something in a channel from the
 * WhatsApp app (a question, a status, anything the bot cannot make yet),
 * and the bot reads that post back from WhatsApp exactly as the app sent it.
 * The shape is kept as a template, so the bot can send the same kind of post
 * with its own text. Nobody documents these formats, so copying what the
 * official app does is the most reliable way to get them right.
 */

export interface CapturedPost {
  /** attributes of the <message> node (type, ...) without per-message ids */
  attrs: Record<string, string>;
  /** extra child nodes next to <plaintext> (for example <meta polltype=...>) */
  extra: { tag: string; attrs: Record<string, string> }[];
  /** attributes of the <plaintext> node (for example mediatype) */
  plaintextAttrs: Record<string, string>;
  /** the decoded message, as plain JSON */
  message: Record<string, unknown>;
  /** the top-level kind of message, for example "questionMessage" */
  kind: string;
  text: string;
}

const SKIP_ATTRS = new Set(["id", "server_id", "t", "from", "to", "message_id", "views_count"]);
const SKIP_CHILDREN = new Set(["plaintext", "reactions", "views_count", "forwards_count", "edited"]);

function collect(node: BinaryNode, out: BinaryNode[]): void {
  for (const child of getAllBinaryNodeChildren(node)) {
    if (child.tag === "message") out.push(child);
    else collect(child, out);
  }
}

function firstText(v: unknown): string {
  if (!v || typeof v !== "object") return "";
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (typeof x === "string" && ["text", "conversation", "name", "caption"].includes(k) && x.trim()) return x;
    const inner = firstText(x);
    if (inner) return inner;
  }
  return "";
}

export function parseCaptured(result: BinaryNode | undefined): CapturedPost[] {
  const nodes: BinaryNode[] = [];
  if (result) collect(result, nodes);
  const out: CapturedPost[] = [];
  for (const node of nodes) {
    const plain = getBinaryNodeChild(node, "plaintext");
    if (!plain?.content || !(plain.content instanceof Uint8Array)) continue;
    let message: Record<string, unknown>;
    try {
      message = proto.Message.decode(plain.content).toJSON() as Record<string, unknown>;
    } catch {
      continue;
    }
    const attrs = Object.fromEntries(Object.entries(node.attrs).filter(([k]) => !SKIP_ATTRS.has(k)));
    const extra = getAllBinaryNodeChildren(node)
      .filter((c) => !SKIP_CHILDREN.has(c.tag))
      .map((c) => ({ tag: c.tag, attrs: { ...c.attrs } }));
    const kind = Object.keys(message).find((k) => k !== "messageContextInfo") ?? "unknown";
    out.push({ attrs, extra, plaintextAttrs: { ...plain.attrs }, message, kind, text: firstText(message) });
  }
  return out;
}

/** Message kinds the bot can already make itself; anything else is worth learning. */
const KNOWN = new Set(["conversation", "extendedTextMessage", "imageMessage", "videoMessage", "pollCreationMessageV3", "pollCreationMessage", "pollCreationMessageV5"]);

/** Reads the channel's latest posts and keeps a template for each kind the bot does not know yet. */
export async function learnFromChannel(sock: WASocket, store: Store, jid: string): Promise<{ posts: CapturedPost[]; learned: string[] }> {
  const posts = parseCaptured(await fetchChannelRaw(sock, jid, 15));
  const learned: string[] = [];
  for (const p of posts) {
    const key = p.kind === "questionMessage" ? "question" : !KNOWN.has(p.kind) ? p.kind : null;
    if (!key || learned.includes(key)) continue;
    store.set(`template:${key}`, JSON.stringify(p));
    learned.push(key);
  }
  store.set("capture:last", JSON.stringify(posts.map((p) => ({ ...p, message: shorten(p.message) })).slice(0, 15)));
  return { posts, learned };
}

/** Long strings (thumbnails, keys) are cut so the capture stays readable on the website. */
function shorten(v: unknown): unknown {
  if (typeof v === "string") return v.length > 80 ? `${v.slice(0, 80)}…(${v.length})` : v;
  if (Array.isArray(v)) return v.map(shorten);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shorten(x)]));
  return v;
}

/** Replaces the template's text with ours, wherever the template keeps it. */
function withText(v: unknown, text: string, done: { replaced: boolean }): unknown {
  if (Array.isArray(v)) return v.map((x) => withText(x, text, done));
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => {
        if (!done.replaced && typeof x === "string" && ["text", "conversation", "name", "caption"].includes(k)) {
          done.replaced = true;
          return [k, text];
        }
        return [k, withText(x, text, done)];
      }),
    );
  }
  return v;
}

/** A message node built from a learned template, with new text. Null when there is no template. */
export function fromTemplate(store: Store, key: string, jid: string, id: string, text: string): BinaryNode | null {
  const raw = store.get(`template:${key}`);
  if (!raw) return null;
  const t = JSON.parse(raw) as CapturedPost;
  const done = { replaced: false };
  const message = proto.Message.fromObject(withText(t.message, text, done) as Record<string, unknown>);
  if (!done.replaced) return null;
  return {
    tag: "message",
    attrs: { ...t.attrs, to: jid, id },
    content: [
      ...t.extra.map((e) => ({ tag: e.tag, attrs: e.attrs })),
      { tag: "plaintext", attrs: t.plaintextAttrs, content: proto.Message.encode(message).finish() },
    ],
  };
}

/**
 * While the window is open, keeps every raw frame WhatsApp sends about
 * channels (also ones the library ignores, which is where a channel status
 * would show up). Returns a function that stops listening.
 */
export function watchChannelFrames(sock: WASocket, store: Store, minutes = 10): () => void {
  const frames: unknown[] = [];
  const onFrame = (frame: BinaryNode) => {
    const from = String(frame.attrs?.from ?? "");
    if (!from.endsWith("@newsletter") && !JSON.stringify(frame.attrs ?? {}).includes("newsletter")) return;
    frames.push(describe(frame));
    store.set("capture:frames", JSON.stringify(frames.slice(-25)));
  };
  sock.ws.on("frame", onFrame);
  const stop = () => sock.ws.off("frame", onFrame);
  setTimeout(stop, minutes * 60_000);
  return stop;
}

function describe(node: BinaryNode): unknown {
  const content = Array.isArray(node.content)
    ? node.content.map((c) => describe(c))
    : node.content instanceof Uint8Array
      ? decodeMaybe(node.content)
      : node.content;
  return { tag: node.tag, attrs: node.attrs, content };
}

function decodeMaybe(bytes: Uint8Array): unknown {
  try {
    return shorten(proto.Message.decode(bytes).toJSON());
  } catch {
    return `(${bytes.length} bytes)`;
  }
}
