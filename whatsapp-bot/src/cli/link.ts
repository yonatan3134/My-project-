/**
 * Links the bot to its WhatsApp account. Run once, and again whenever the
 * bot reports that it was logged out.
 */
import qrcode from "qrcode-terminal";
import { loadEnv } from "../config.js";
import { sleep } from "../time.js";
import { WaClient } from "../wa/client.js";

const env = loadEnv();
const client = new WaClient({ allowLinking: true, pairingPhone: env.botPhone });

client.on("pairing_code", (code: string) => {
  const pretty = `${code.slice(0, 4)}-${code.slice(4)}`;
  console.log("\n==============================================");
  console.log(`  קוד החיבור:   ${pretty}`);
  console.log("==============================================");
  console.log("בטלפון של הבוט: וואטסאפ > מכשירים מקושרים > קישור מכשיר >");
  console.log('"קישור באמצעות מספר טלפון" > להקליד את הקוד.\n');
});

client.on("qr", (qr: string) => {
  console.log("\nסרוק את הקוד מהטלפון של הבוט: וואטסאפ > מכשירים מקושרים > קישור מכשיר\n");
  qrcode.generate(qr, { small: true });
  console.log("(כדי לקבל קוד של 8 תווים במקום QR, מלא את BOT_PHONE בקובץ .env)\n");
});

client.on("logged_out", (reason: string) => {
  console.error(`החיבור נדחה: ${reason}. מחק את התיקייה data/auth ונסה שוב.`);
  process.exit(1);
});

console.log("מתחבר לוואטסאפ...");
await client.start();
const ok = await client.waitOpen(5 * 60_000);
if (!ok) {
  console.error("לא התקבל חיבור תוך 5 דקות. הרץ שוב: npm run link");
  process.exit(1);
}
console.log("\n✅ הבוט מחובר. שומר את החיבור...");
await sleep(8_000);
await client.stop();
console.log("נשמר. השלב הבא: npm run check");
process.exit(0);
