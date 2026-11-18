/**
 * Sends one post of each kind to a single channel, to find out what
 * WhatsApp accepts from this bot: npm run test-channel -- <channel-id>
 */
import { loadConfig } from "../config.js";
import { Store } from "../db.js";
import { renderCard } from "../media/cards.js";
import { ffmpegAvailable, videoFromCard } from "../media/video.js";
import { DB_PATH } from "../paths.js";
import { sleep } from "../time.js";
import { canPost, lookupChannel } from "../wa/channels.js";
import { WaSender, type SendResult } from "../wa/sender.js";
import { connectOrExit } from "./shared.js";

const id = process.argv[2];
const config = loadConfig();
const channel = config.channels.find((c) => c.id === id);
if (!channel) {
  console.error(`שימוש: npm run test-channel -- <מזהה ערוץ>\nהמזהים: ${config.channels.map((c) => c.id).join(", ")}`);
  process.exit(1);
}

const store = new Store(DB_PATH);
const client = await connectOrExit();
const info = await lookupChannel(client.sock!, channel.invite);
if (!info) {
  console.error("הערוץ לא נמצא בוואטסאפ. בדוק את הקישור ב-config/channels.json");
  process.exit(1);
}
if (!canPost(info.role)) {
  console.error(`הבוט לא מנהל בערוץ "${info.name}" (התפקיד שלו: ${info.role ?? "אין"}). הוסף אותו כמנהל ונסה שוב.`);
  process.exit(1);
}
store.updateChannel(channel.id, { jid: info.jid, live_name: info.name, role: info.role, resolved_at: Date.now() });
console.log(`שולח 4 פוסטים לבדיקה לערוץ "${info.name}"...\n`);

const sender = new WaSender(client, store);
const results: [string, SendResult][] = [];
const show = (name: string, r: SendResult) => {
  results.push([name, r]);
  console.log(`${r.ok ? "✅" : "❌"} ${name}${r.ok ? "" : `  ->  ${r.error}`}`);
};

show("טקסט", await sender.text(info.jid, "בדיקה 1/4: הודעת טקסט מהבוט 🤖"));
await sleep(5_000);
show("סקר", await sender.poll(info.jid, "בדיקה 2/4: הסקר הזה מופיע אצלכם?", ["כן", "לא"]));
await sleep(5_000);
const card = await renderCard({ text: "בדיקה 3/4\nתמונה מהבוט 🖼️", footer: channel.name, seed: "test" });
show("תמונה", await sender.image(info.jid, card, "בדיקה 3/4: תמונה"));
await sleep(5_000);
if (await ffmpegAvailable()) {
  const clip = await videoFromCard((await renderCard({ text: "בדיקה 4/4\nסרטון מהבוט 🎬", footer: channel.name, seed: "test-video" })).jpeg);
  show("סרטון", await sender.video(info.jid, clip, "בדיקה 4/4: סרטון"));
} else {
  console.log("⏭ סרטון: ffmpeg לא מותקן בשרת, מדלג");
}

console.log(`\nשיטת העלאת המדיה שעבדה: ${store.get("media_upload_strategy") ?? "אף אחת"}`);
console.log("\nחשוב: פתח עכשיו את הערוץ בטלפון ובדוק מה באמת מופיע שם.");
console.log("מה שסומן ✅ אבל לא מופיע בערוץ: וואטסאפ קיבל את ההודעה ולא הציג אותה.");
console.log("מה שלא עובד, הבוט ישלח אוטומטית כטקסט במקום.");

await sleep(3_000);
await client.stop();
store.close();
process.exit(results.some(([, r]) => !r.ok) ? 2 : 0);
