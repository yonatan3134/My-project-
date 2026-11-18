import type { AppConfig, ChannelConfig } from "./config.js";
import { refillChannel } from "./content/generator.js";
import { FakeLLM, type LLM } from "./content/llm.js";
import type { FetchText } from "./content/sources.js";
import type { PostPayload } from "./db.js";
import { Store } from "./db.js";
import type { CardImage } from "./media/cards.js";
import type { VideoClip } from "./media/video.js";
import { Scheduler, type MediaMaker } from "./scheduler.js";
import { DAY, HOUR } from "./time.js";
import { DryRunSender, type Sender } from "./wa/sender.js";

/** Small deterministic random generator, so a simulation gives the same result every time. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Media stand-in: no rendering, so a simulated week runs in seconds. */
export const stubMedia: MediaMaker = {
  async image(_p: PostPayload, _c: ChannelConfig): Promise<CardImage> {
    return { jpeg: Buffer.alloc(1), thumbnail: "", width: 1, height: 1 };
  },
  async video(_p: PostPayload, _c: ChannelConfig): Promise<VideoClip> {
    return { mp4: Buffer.alloc(1), thumbnail: "", seconds: 1, width: 1, height: 1 };
  },
};

/** Feeds that produce one new headline every `everyHours`, and a small Sefaria chapter. */
export function stubFetcher(clock: () => number, everyHours = 6): FetchText {
  return async (url) => {
    if (url.includes("sefaria.org")) {
      const chapter = url.match(/\.(\d+)\?/)?.[1] ?? "1";
      return JSON.stringify({ heRef: `משנה אבות, פרק ${chapter}`, he: [1, 2, 3].map((i) => `טקסט בדיקה של פרק ${chapter} משנה ${i}`) });
    }
    const bucket = Math.floor(clock() / (everyHours * HOUR));
    const date = new Date(bucket * everyHours * HOUR).toUTCString();
    const key = `${bucket}-${url.length}`;
    return `<?xml version="1.0"?><rss><channel><title>בדיקה</title>
      <item><title>כותרת בדיקה ${key} - מקור בדיקה</title><link>https://example.com/${key}</link>
      <guid>${key}</guid><pubDate>${date}</pubDate><source url="https://example.com">מקור בדיקה</source></item>
    </channel></rss>`;
  };
}

export interface SimOptions {
  config: AppConfig;
  days: number;
  start?: number;
  llm?: LLM;
  sender?: Sender;
  store?: Store;
  seed?: number;
  /** called on every simulated step, e.g. to break the connection for a while */
  onStep?: (now: number) => void;
  isConnected?: (now: number) => boolean;
}

export interface SimResult {
  store: Store;
  scheduler: Scheduler;
  sender: Sender;
  end: number;
}

/**
 * Runs the real scheduler and the real content pipeline against a virtual
 * clock, with a stand-in model and nothing sent anywhere.
 */
export async function simulate(opts: SimOptions): Promise<SimResult> {
  const { config } = opts;
  const store = opts.store ?? new Store(":memory:");
  const start = opts.start ?? Date.UTC(2026, 0, 4, 22, 0, 0); // midnight in Israel
  let clock = start;
  const now = () => clock;
  const sender = opts.sender ?? new DryRunSender({ saveMedia: false, quiet: true });
  const llm = opts.llm ?? new FakeLLM();

  for (const c of config.channels) {
    if (!store.channel(c.id).jid) store.updateChannel(c.id, { jid: `sim-${c.id}@newsletter`, role: "ADMIN", resolved_at: start });
  }

  const scheduler = new Scheduler({
    store,
    config,
    sender,
    media: stubMedia,
    now,
    random: seededRandom(opts.seed ?? 1),
    isConnected: () => (opts.isConnected ? opts.isConnected(clock) : true),
  });
  const gen = { store, llm, settings: config.settings, fetcher: stubFetcher(now), videoAvailable: true };

  const end = start + opts.days * DAY;
  const STEP = 15_000;
  let sinceRefill = Infinity;
  for (; clock < end; clock += STEP) {
    opts.onStep?.(clock);
    if (sinceRefill >= 90_000) {
      sinceRefill = 0;
      if (!scheduler.isPaused()) {
        for (const channel of scheduler.activeChannels(clock)) await refillChannel(gen, channel, clock);
      }
      store.expireStaleNews(clock, 36 * HOUR);
    }
    sinceRefill += STEP;
    await scheduler.tick();
  }
  return { store, scheduler, sender, end };
}
