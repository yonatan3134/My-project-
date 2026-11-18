import crypto from "node:crypto";
import { XMLParser } from "fast-xml-parser";

export interface FeedItem {
  guid: string;
  title: string;
  source: string;
  snippet: string;
  link: string;
  publishedAt: number;
}

export type FetchText = (url: string) => Promise<string>;

export const fetchText: FetchText = async (url) => {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; feed-reader)", Accept: "application/rss+xml, application/xml, application/json, text/xml, */*" },
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
  return res.text();
};

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      const key = e.toLowerCase();
      if (key in NAMED_ENTITIES) return NAMED_ENTITIES[key] ?? m;
      if (key.startsWith("#x")) return String.fromCodePoint(parseInt(key.slice(2), 16));
      if (key.startsWith("#")) return String.fromCodePoint(parseInt(key.slice(1), 10));
      return m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function textOf(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return textOf(v[0]);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return textOf(o["#text"] ?? o["@_href"] ?? "");
  }
  return "";
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", trimValues: true });

/** Reads RSS 2.0 and Atom feeds (including Google News search feeds). */
export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml) as Record<string, any>;
  const rssItems = asArray<Record<string, unknown>>(doc?.rss?.channel?.item);
  const atomEntries = asArray<Record<string, unknown>>(doc?.feed?.entry);
  const feedTitle = stripHtml(textOf(doc?.rss?.channel?.title ?? doc?.feed?.title));
  const out: FeedItem[] = [];

  for (const it of rssItems) {
    let title = stripHtml(textOf(it.title));
    const source = stripHtml(textOf(it.source)) || feedTitle;
    // Google News appends " - Publisher" to every headline.
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
    let snippet = stripHtml(textOf(it.description));
    if (snippet.startsWith(title)) snippet = snippet.slice(title.length).trim();
    if (snippet === source) snippet = "";
    const link = textOf(it.link);
    const date = Date.parse(textOf(it.pubDate));
    if (!title) continue;
    out.push({
      guid: guidOf(textOf(it.guid) || link || title),
      title,
      source,
      snippet,
      link,
      publishedAt: Number.isNaN(date) ? 0 : date,
    });
  }

  for (const e of atomEntries) {
    const title = stripHtml(textOf(e.title));
    if (!title) continue;
    const links = asArray<unknown>(e.link);
    const link = textOf(links.find((l) => typeof l === "object" && (l as Record<string, unknown>)["@_rel"] !== "self") ?? links[0]);
    const date = Date.parse(textOf(e.published ?? e.updated));
    out.push({
      guid: guidOf(textOf(e.id) || link || title),
      title,
      source: feedTitle,
      snippet: stripHtml(textOf(e.summary ?? e.content)),
      link,
      publishedAt: Number.isNaN(date) ? 0 : date,
    });
  }
  return out;
}

function guidOf(raw: string): string {
  return crypto.createHash("sha1").update(raw).digest("hex");
}

export function googleNewsUrl(query: string): string {
  const q = encodeURIComponent(`${query} when:2d`);
  return `https://news.google.com/rss/search?q=${q}&hl=he&gl=IL&ceid=IL:he`;
}

const MAX_AGE_MS = 48 * 3600_000;

/** New items for a channel from its search queries and feeds. Failures of one source don't stop the others. */
export async function collectItems(
  news: { queries: string[]; feeds: string[] },
  now: number,
  fetcher: FetchText = fetchText,
): Promise<{ items: FeedItem[]; errors: string[] }> {
  const urls = [...news.queries.map(googleNewsUrl), ...news.feeds];
  const items: FeedItem[] = [];
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const parsed = parseFeed(await fetcher(url));
      for (const it of parsed) {
        if (it.publishedAt !== 0 && now - it.publishedAt > MAX_AGE_MS) continue;
        items.push(it);
      }
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  const seen = new Set<string>();
  return { items: items.filter((i) => (seen.has(i.guid) ? false : (seen.add(i.guid), true))).slice(0, 30), errors };
}

// ---- Sefaria (open library of Jewish texts) --------------------------------

const ONES = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
const TENS = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];

/** 1 -> א׳, 15 -> ט״ו, 23 -> כ״ג */
export function hebrewNumeral(n: number): string {
  if (n <= 0 || n >= 100) return String(n);
  let letters = n % 100 === 15 ? "טו" : n % 100 === 16 ? "טז" : `${TENS[Math.floor(n / 10)] ?? ""}${ONES[n % 10] ?? ""}`;
  letters = letters.length === 1 ? `${letters}׳` : `${letters.slice(0, -1)}״${letters.slice(-1)}`;
  return letters;
}

export interface SefariaChapter {
  heRef: string;
  segments: string[];
}

export async function fetchSefariaChapter(book: string, chapter: number, fetcher: FetchText = fetchText): Promise<SefariaChapter> {
  const url = `https://www.sefaria.org/api/texts/${encodeURIComponent(book)}.${chapter}?context=0&commentary=0&pad=0`;
  const data = JSON.parse(await fetcher(url)) as { he?: unknown; heRef?: unknown; error?: unknown };
  if (data.error) throw new Error(`Sefaria: ${String(data.error)}`);
  const he = Array.isArray(data.he) ? data.he : typeof data.he === "string" ? [data.he] : [];
  const segments = he.map((s) => stripHtml(String(s))).filter((s) => s.length > 0);
  if (segments.length === 0) throw new Error(`Sefaria returned no Hebrew text for ${book} ${chapter}`);
  return { heRef: typeof data.heRef === "string" ? data.heRef : `${book} ${chapter}`, segments };
}
