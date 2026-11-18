/**
 * Shows what the schedule looks like over the coming days, without WhatsApp
 * and without the AI service: npm run simulate -- <days>
 */
import { loadConfig } from "../config.js";
import { postingChannels } from "../scheduler.js";
import { simulate } from "../sim.js";
import { DAY, dayKey } from "../time.js";

const days = Math.min(Math.max(Number(process.argv[2] ?? 10) || 10, 1), 40);
const config = loadConfig();
const tz = config.settings.timezone;
const start = Date.UTC(2026, 0, 4, 22, 0, 0);

console.log(`מריץ סימולציה של ${days} ימים (בלי וואטסאפ ובלי AI אמיתי)...\n`);
const { store } = await simulate({ config, days, start });

const rows = store.db
  .prepare("SELECT channel_id, day_key, COUNT(*) AS n FROM queue WHERE status = 'sent' AND is_followup = 0 GROUP BY channel_id, day_key")
  .all() as { channel_id: string; day_key: string; n: number }[];
const byDay = new Map<string, Map<string, number>>();
for (const r of rows) {
  if (!byDay.has(r.day_key)) byDay.set(r.day_key, new Map());
  byDay.get(r.day_key)!.set(r.channel_id, r.n);
}

console.log("יום | ערוצים שפרסמו | סה״כ פוסטים | מקסימום לערוץ");
for (let d = 0; d < days; d++) {
  const key = dayKey(start + d * DAY + 1000, tz);
  const m = byDay.get(key) ?? new Map<string, number>();
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  const max = Math.max(0, ...m.values());
  console.log(`${String(d + 1).padStart(3)} | ${String(m.size).padStart(14)} | ${String(total).padStart(11)} | ${String(max).padStart(13)}`);
}

const lastKey = dayKey(start + (days - 1) * DAY + 1000, tz);
const last = byDay.get(lastKey) ?? new Map<string, number>();
console.log(`\nביום האחרון, לפי ערוץ:`);
for (const c of postingChannels(config.channels)) console.log(`  ${c.id.padEnd(22)} ${String(last.get(c.id) ?? 0).padStart(3)}  (${c.mode})`);

const dups = store.db
  .prepare(
    "SELECT channel_id, COUNT(*) AS n FROM (SELECT channel_id, norm_hash FROM queue WHERE status = 'sent' AND is_followup = 0 GROUP BY channel_id, norm_hash HAVING COUNT(*) > 1) GROUP BY channel_id",
  )
  .all() as { channel_id: string; n: number }[];
const dup = { n: dups.reduce((a, d) => a + d.n, 0) };
const direct = store.db.prepare("SELECT COUNT(*) AS n FROM queue WHERE status = 'sent' AND is_followup = 1").get() as { n: number };
console.log(`\nפוסטים שחזרו על עצמם באותו ערוץ: ${dup.n}${dups.length ? ` (${dups.map((d) => d.channel_id).join(", ")})` : ""}`);
console.log(`הודעות המשך (תשובות לחידות, קריאות לפלישה): ${direct.n}`);
store.close();
