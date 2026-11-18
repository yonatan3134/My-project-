import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import { CONFIG_DIR, DATA_DIR, ROOT } from "./paths.js";

dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });

const FormatsSchema = z.object({
  text: z.number().min(0).default(0),
  poll: z.number().min(0).default(0),
  image: z.number().min(0).default(0),
  video: z.number().min(0).default(0),
});
export type Formats = z.infer<typeof FormatsSchema>;

const ChannelSchema = z.object({
  /** short unique id used in commands and logs */
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  /** the code at the end of https://whatsapp.com/channel/<code> */
  invite: z.string().min(10),
  /**
   * creative - AI writes freely inside the channel concept (riddles, polls, jokes...)
   * fandom   - opinion/engagement posts + posts based on real news items
   * news     - only posts based on real source items; silent when there is nothing new
   * invasion - the "פלישה לערוצים" channel, posts are triggered by other channels
   * off      - the bot never posts here
   */
  mode: z.enum(["creative", "fandom", "news", "invasion", "off"]),
  topic: z.string().default(""),
  rules: z.string().default(""),
  lang: z.string().default("עברית"),
  /** channels with the same group never get the same post */
  group: z.string().optional(),
  formats: FormatsSchema.optional(),
  maxPerDay: z.number().int().positive().optional(),
  news: z
    .object({
      queries: z.array(z.string()).default([]),
      feeds: z.array(z.string().url()).default([]),
    })
    .optional(),
  /** verbatim text from the Sefaria open library, e.g. { "book": "Pirkei_Avot", "chapters": 6, "perDay": 1 } */
  sefaria: z
    .object({
      book: z.string(),
      chapters: z.number().int().positive(),
      perDay: z.number().int().positive().default(1),
      /** start the book again after its last passage (otherwise the passages simply stop) */
      repeat: z.boolean().default(false),
    })
    .optional(),
  enabled: z.boolean().default(true),
  note: z.string().optional(),
});
export type ChannelConfig = z.infer<typeof ChannelSchema>;

const SettingsSchema = z.object({
  timezone: z.string().default("Asia/Jerusalem"),
  /** which AI service writes the posts */
  provider: z.enum(["gemini", "claude"]).default("gemini"),
  /** model id at that service. "gemini-flash-lite-latest" always points at Google's current low-cost model. */
  model: z.string().default("gemini-flash-lite-latest"),
  effort: z.enum(["low", "medium", "high"]).default("medium"),
  /** "3 posts one hour apart, then a 2 hour pause" */
  cycle: z
    .object({
      postsPerBurst: z.number().int().positive().default(3),
      intervalMinutes: z.number().positive().default(60),
      pauseMinutes: z.number().min(0).default(120),
    })
    .default({ postsPerBurst: 3, intervalMinutes: 60, pauseMinutes: 120 }),
  fandomMaxPerDay: z.number().int().positive().default(6),
  newsMaxPerDay: z.number().int().positive().default(4),
  /** per-channel daily caps for the first days after a channel is switched on */
  warmup: z
    .array(z.object({ days: z.number().positive(), maxPerDay: z.number().int().positive() }))
    .default([
      { days: 7, maxPerDay: 4 },
      { days: 7, maxPerDay: 8 },
    ]),
  /** how many channels are switched on in each stage; after the last stage all are on */
  rollout: z
    .array(z.object({ days: z.number().positive(), channels: z.number().int().positive() }))
    .default([
      { days: 3, channels: 5 },
      { days: 4, channels: 15 },
    ]),
  send: z
    .object({
      minGapSeconds: z.number().min(1).default(20),
      maxGapSeconds: z.number().min(1).default(45),
      /** a slot that is later than this is skipped instead of sent late */
      graceMinutes: z.number().positive().default(20),
    })
    .default({ minGapSeconds: 20, maxGapSeconds: 45, graceMinutes: 20 }),
  buffer: z
    .object({
      min: z.number().int().positive().default(4),
      batch: z.number().int().positive().max(12).default(8),
    })
    .default({ min: 4, batch: 8 }),
  followupDelayMinutes: z.tuple([z.number().positive(), z.number().positive()]).default([25, 40]),
  invasion: z
    .object({
      maxPerDay: z.number().int().min(0).default(2),
      emojis: z.array(z.string()).min(1).default(["🔥", "😈", "💫", "👑", "⚡", "💜"]),
    })
    .default({ maxPerDay: 2, emojis: ["🔥", "😈", "💫", "👑", "⚡", "💜"] }),
  /** e.g. { "from": 23, "to": 7 } to stay silent at night. null = post around the clock. */
  quietHours: z.object({ from: z.number().int().min(0).max(23), to: z.number().int().min(0).max(23) }).nullable().default(null),
  dedup: z
    .object({
      similarity: z.number().min(0.2).max(1).default(0.55),
      keySimilarity: z.number().min(0.2).max(1).default(0.7),
      lookback: z.number().int().positive().default(1500),
      keysInPrompt: z.number().int().positive().default(80),
    })
    .default({ similarity: 0.55, keySimilarity: 0.7, lookback: 1500, keysInPrompt: 80 }),
  defaultFormats: z
    .object({ creative: FormatsSchema, fandom: FormatsSchema, news: FormatsSchema })
    .default({
      creative: { text: 5, poll: 3, image: 2, video: 1 },
      fandom: { text: 3, poll: 5, image: 1, video: 0 },
      news: { text: 1, poll: 0, image: 0, video: 0 },
    }),
  dailyReportHour: z.number().int().min(0).max(23).default(20),
});
export type Settings = z.infer<typeof SettingsSchema>;

export interface Env {
  botPhone: string | null;
  ownerPhone: string | null;
  ntfyTopic: string | null;
  pexelsKey: string | null;
  dryRun: boolean;
  fakeLlm: boolean;
  hasAnthropicKey: boolean;
  hasGeminiKey: boolean;
}

export interface AppConfig {
  settings: Settings;
  channels: ChannelConfig[];
  env: Env;
}

function digits(v: string | undefined): string | null {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length >= 8 ? d : null;
}

export const EDITED_CHANNELS_FILE = path.join(DATA_DIR, "channels.json");

export function loadEnv(): Env {
  return {
    botPhone: digits(process.env.BOT_PHONE),
    ownerPhone: digits(process.env.OWNER_PHONE),
    ntfyTopic: process.env.NTFY_TOPIC?.trim() || null,
    pexelsKey: process.env.PEXELS_API_KEY?.trim() || null,
    dryRun: process.env.DRY_RUN === "1",
    fakeLlm: process.env.FAKE_LLM === "1",
    hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim()),
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim()),
  };
}

function readJson(file: string): unknown {
  const raw = fs.readFileSync(file, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${path.basename(file)} is not valid JSON: ${(err as Error).message}`);
  }
}

/** Accepts a full https://whatsapp.com/channel/<code> link or the bare code. */
export function inviteCode(value: string): string {
  const m = value.match(/channel\/([A-Za-z0-9]+)/);
  return (m?.[1] ?? value).trim();
}

export function parseConfig(settingsRaw: unknown, channelsRaw: unknown): { settings: Settings; channels: ChannelConfig[] } {
  const settings = SettingsSchema.parse(settingsRaw ?? {});
  const channels = z.array(ChannelSchema).parse(channelsRaw).map((c) => ({ ...c, invite: inviteCode(c.invite) }));
  const ids = new Set<string>();
  const invites = new Set<string>();
  for (const c of channels) {
    if (ids.has(c.id)) throw new Error(`duplicate channel id "${c.id}" in channels.json`);
    if (invites.has(c.invite)) throw new Error(`channel link appears twice in channels.json (${c.id})`);
    ids.add(c.id);
    invites.add(c.invite);
  }
  if (settings.send.maxGapSeconds < settings.send.minGapSeconds) {
    throw new Error("settings.send.maxGapSeconds must be >= minGapSeconds");
  }
  return { settings, channels };
}

/** Name of the .env variable that holds the key for the configured AI service, and whether it is set. */
export function aiKey(config: Pick<AppConfig, "settings" | "env">): { name: string; present: boolean } {
  return config.settings.provider === "claude"
    ? { name: "ANTHROPIC_API_KEY", present: config.env.hasAnthropicKey }
    : { name: "GEMINI_API_KEY", present: config.env.hasGeminiKey };
}

export function loadConfig(dir: string = CONFIG_DIR): AppConfig {
  const settingsFile = path.join(dir, "settings.json");
  const settingsRaw = fs.existsSync(settingsFile) ? readJson(settingsFile) : {};
  // channels edited on the settings website are kept with the bot's data, so updates from GitHub never overwrite them
  const edited = path.join(DATA_DIR, "channels.json");
  const channelsRaw = readJson(dir === CONFIG_DIR && fs.existsSync(edited) ? edited : path.join(dir, "channels.json"));
  return { ...parseConfig(settingsRaw, channelsRaw), env: loadEnv() };
}

export function formatsFor(channel: ChannelConfig, settings: Settings): Formats {
  if (channel.formats) return channel.formats;
  if (channel.mode === "creative" || channel.mode === "fandom" || channel.mode === "news") {
    return settings.defaultFormats[channel.mode];
  }
  return { text: 1, poll: 0, image: 0, video: 0 };
}
