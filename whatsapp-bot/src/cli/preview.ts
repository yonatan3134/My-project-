/**
 * Writes a batch of posts for one channel and prints them, without sending
 * anything: npm run preview -- <channel-id>
 */
import { loadConfig } from "../config.js";
import { refillChannel } from "../content/generator.js";
import { ClaudeLLM, FakeLLM } from "../content/llm.js";
import { Store } from "../db.js";
import { DB_PATH } from "../paths.js";

const id = process.argv[2];
const config = loadConfig();
const channel = config.channels.find((c) => c.id === id);
if (!channel || !["creative", "fandom", "news"].includes(channel.mode)) {
  const ids = config.channels.filter((c) => ["creative", "fandom", "news"].includes(c.mode)).map((c) => c.id);
  console.error(`שימוש: npm run preview -- <מזהה ערוץ>\nהמזהים: ${ids.join(", ")}`);
  process.exit(1);
}
if (!config.env.fakeLlm && !config.env.hasAnthropicKey) {
  console.error("חסר ANTHROPIC_API_KEY בקובץ .env");
  process.exit(1);
}

// a scratch database, so a preview never touches the real queue
const scratch = new Store(":memory:");
try {
  const real = new Store(DB_PATH);
  scratch.setStyleSamples(channel.id, real.styleSamples(channel.id, 12), Date.now());
  real.close();
} catch {
  // no real database yet
}

let tokens = { input: 0, output: 0 };
const llm = config.env.fakeLlm
  ? new FakeLLM()
  : new ClaudeLLM(config.settings, (u) => {
      tokens = { input: tokens.input + u.inputTokens, output: tokens.output + u.outputTokens };
    });

console.log(`כותב פוסטים לערוץ "${channel.name}" (${channel.mode})...\n`);
const res = await refillChannel({ store: scratch, llm, settings: config.settings }, channel, Date.now());
if (res.llmError) {
  console.error(`שגיאה מול שירות ה-AI: ${res.llmError.message}`);
  process.exit(1);
}

const rows = scratch.db.prepare("SELECT payload FROM queue ORDER BY id").all() as { payload: string }[];
rows.forEach((r, i) => {
  const p = JSON.parse(r.payload) as { kind: string; text: string; pollQuestion?: string; pollOptions?: string[]; cardText?: string; followup?: string };
  console.log(`--- ${i + 1}. ${p.kind} ---`);
  if (p.kind === "poll") console.log(`${p.pollQuestion}\n${(p.pollOptions ?? []).map((o) => `  ○ ${o}`).join("\n")}`);
  else if (p.cardText) console.log(`[על התמונה] ${p.cardText}\n${p.text}`);
  else console.log(p.text);
  if (p.followup) console.log(`[נשלח אחרי חצי שעה] ${p.followup}`);
  console.log();
});
console.log(`אושרו ${res.queued} פוסטים. נפסלו ${res.rejected.length}${res.rejected.length ? `: ${[...new Set(res.rejected)].join("; ")}` : ""}`);
if (channel.mode !== "creative" && rows.length === 0) console.log("(בערוץ מידע זה תקין כשאין כרגע חדשות אמיתיות)");
if (tokens.input > 0) console.log(`שימוש: ${tokens.input} טוקנים קלט, ${tokens.output} טוקנים פלט`);
scratch.close();
