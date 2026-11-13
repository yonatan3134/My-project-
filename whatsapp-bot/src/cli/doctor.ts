/**
 * Checks everything the bot depends on and prints what is missing:
 * npm run doctor
 */
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { ApiError, GoogleGenAI } from "@google/genai";
import { aiKey, loadConfig, type AppConfig } from "../config.js";
import { collectItems, fetchSefariaChapter } from "../content/sources.js";
import { renderCard } from "../media/cards.js";
import { ffmpegAvailable, videoFromCard } from "../media/video.js";
import { AUTH_DIR, ensureDirs } from "../paths.js";

let failures = 0;
const ok = (msg: string) => console.log(`✅ ${msg}`);
const warn = (msg: string) => console.log(`⚠️  ${msg}`);
const bad = (msg: string) => {
  failures++;
  console.log(`❌ ${msg}`);
};

ensureDirs();
const major = Number(process.versions.node.split(".")[0]);
if (major >= 20) ok(`Node ${process.versions.node}`);
else bad(`Node ${process.versions.node}: נדרשת גרסה 20 ומעלה`);

let config: AppConfig | null = null;
try {
  config = loadConfig();
  const modes = new Map<string, number>();
  for (const c of config.channels) modes.set(c.mode, (modes.get(c.mode) ?? 0) + 1);
  ok(`קובצי ההגדרות תקינים: ${config.channels.length} ערוצים (${[...modes].map(([m, n]) => `${m}: ${n}`).join(", ")})`);
} catch (err) {
  bad(`קובצי ההגדרות: ${(err as Error).message}`);
}

if (config) {
  const { env, settings } = config;
  if (env.ownerPhone) ok("OWNER_PHONE מוגדר");
  else warn("OWNER_PHONE לא מוגדר: לא תוכל לשלוח לבוט פקודות כמו 'עצור'");
  if (env.ntfyTopic) ok("NTFY_TOPIC מוגדר: התראות יגיעו לטלפון");
  else warn("NTFY_TOPIC לא מוגדר: אם הבוט יתנתק מוואטסאפ לא תקבל על זה התראה");

  const key = aiKey(config);
  if (!key.present) {
    bad(`${key.name} חסר בקובץ .env`);
  } else if (settings.provider === "gemini") {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "" });
      const model = await ai.models.get({ model: settings.model });
      ok(`Gemini עונה, המודל ${model.name ?? settings.model} זמין`);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 401 || status === 403 || (status === 400 && /API key/i.test((err as Error).message))) bad("מפתח Gemini לא תקין (GEMINI_API_KEY)");
      else if (status === 404) bad(`המודל ${settings.model} לא קיים. בדוק את "model" ב-config/settings.json`);
      else bad(`Gemini: ${(err as Error).message.slice(0, 200)}`);
    }
  } else {
    try {
      const model = await new Anthropic().models.retrieve(settings.model);
      ok(`שירות ה-AI עונה, המודל ${model.id} זמין`);
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) bad("מפתח ה-AI לא תקין (ANTHROPIC_API_KEY)");
      else if (err instanceof Anthropic.NotFoundError) bad(`המודל ${settings.model} לא קיים. בדוק את "model" ב-config/settings.json`);
      else bad(`שירות ה-AI: ${(err as Error).message}`);
    }
  }

  const withNews = config.channels.find((c) => c.news && c.news.queries.length > 0);
  if (withNews?.news) {
    const { items, errors } = await collectItems({ queries: withNews.news.queries.slice(0, 1), feeds: [] }, Date.now());
    if (errors.length > 0) bad(`מקור החדשות (Google News): ${errors[0]}`);
    else ok(`מקור החדשות עונה: ${items.length} כותרות מהיומיים האחרונים עבור "${withNews.news.queries[0]}"`);
  }

  const withSefaria = config.channels.find((c) => c.sefaria);
  if (withSefaria?.sefaria) {
    try {
      const ch = await fetchSefariaChapter(withSefaria.sefaria.book, 1);
      ok(`מאגר ספריא עונה: ${ch.heRef}, ${ch.segments.length} קטעים`);
    } catch (err) {
      bad(`מאגר ספריא: ${(err as Error).message}`);
    }
  }

  if (env.pexelsKey) {
    try {
      const res = await fetch("https://api.pexels.com/v1/search?query=sky&per_page=1", { headers: { Authorization: env.pexelsKey }, signal: AbortSignal.timeout(15_000) });
      if (res.ok) ok("מפתח Pexels תקין");
      else bad(`מפתח Pexels נדחה (HTTP ${res.status})`);
    } catch (err) {
      bad(`Pexels: ${(err as Error).message}`);
    }
  } else {
    ok("בלי Pexels: תמונות וסרטונים ייווצרו על רקע צבעוני");
  }
}

try {
  const card = await renderCard({ text: "בדיקת עברית 🤖 Test", footer: "בדיקה", seed: "doctor" });
  if (card.jpeg.length > 5_000) ok("יצירת תמונות עובדת");
  else bad("יצירת תמונות: התמונה יצאה ריקה. חסרים פונטים? (fonts-noto-core)");
  if (await ffmpegAvailable()) {
    const clip = await videoFromCard(card.jpeg, 2);
    ok(`יצירת סרטונים עובדת (${Math.round(clip.mp4.length / 1024)}KB)`);
  } else {
    warn("ffmpeg לא מותקן: סרטונים יישלחו כתמונות. התקנה: apt-get install -y ffmpeg");
  }
} catch (err) {
  bad(`יצירת מדיה: ${(err as Error).message}`);
}

if (fs.existsSync(path.join(AUTH_DIR, "creds.json"))) ok("יש חיבור שמור לוואטסאפ (לבדיקה מלאה: npm run check)");
else warn("הבוט עדיין לא חובר לוואטסאפ. הרץ: npm run link");

console.log(failures === 0 ? "\nהכול תקין." : `\nנמצאו ${failures} בעיות שצריך לתקן.`);
process.exit(failures === 0 ? 0 : 1);
