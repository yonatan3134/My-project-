/**
 * Finds every channel from config/channels.json on WhatsApp and reports
 * whether the bot's account is an admin there. Also learns each channel's
 * tone from its recent posts.
 */
import { loadConfig } from "../config.js";
import { Store } from "../db.js";
import { DB_PATH } from "../paths.js";
import { postingChannels } from "../scheduler.js";
import { sleep } from "../time.js";
import { recentPostTexts, resolveChannels } from "../wa/channels.js";
import { connectOrExit } from "./shared.js";

const config = loadConfig();
const store = new Store(DB_PATH);
const client = await connectOrExit();
const sock = client.sock!;

console.log(`בודק ${config.channels.filter((c) => c.mode !== "off" && c.enabled).length} ערוצים...\n`);
const reports = await resolveChannels(sock, store, config.channels, Date.now());
const icon = { ok: "✅", not_admin: "🚫", not_found: "❓", error: "⚠️" } as const;
for (const r of reports) console.log(`${icon[r.status]} ${r.id.padEnd(22)} ${r.name}  (${r.detail})`);

const ok = reports.filter((r) => r.status === "ok").length;
console.log(`\n${ok} מתוך ${reports.length} מוכנים לפרסום.`);
const notAdmin = reports.filter((r) => r.status === "not_admin");
if (notAdmin.length > 0) {
  console.log(`\n🚫 ב-${notAdmin.length} ערוצים הבוט עדיין לא מנהל. בכל אחד מהם: פרטי הערוץ > הזמנת מנהלים > לבחור את המספר של הבוט,`);
  console.log("   ואז לאשר את ההזמנה מהטלפון של הבוט. אחר כך להריץ שוב: npm run check");
}

console.log("\nלומד את הסגנון מהפוסטים הקיימים...");
let learned = 0;
for (const c of postingChannels(config.channels)) {
  const jid = store.channel(c.id).jid;
  if (!jid) continue;
  try {
    const texts = await recentPostTexts(sock, jid, 30);
    if (texts.length > 0) {
      store.setStyleSamples(c.id, texts.slice(0, 12), Date.now());
      learned++;
    }
  } catch {
    // best effort
  }
  await sleep(800);
}
console.log(`נמצאו דוגמאות סגנון ב-${learned} ערוצים (בשאר הבוט יכתוב לפי תיאור הערוץ).`);

await client.stop();
store.close();
process.exit(0);
