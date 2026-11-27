// Supabase Edge Function "ai": the app builder's AI.
//   action "code"  – Claude writes (or changes) a complete HTML app or game, streamed back as server-sent events.
//   action "image" – draws one picture for the game (Gemini → Cloudflare → Pollinations).
// Keys live in the function's secrets (never in the browser):
//   ANTHROPIC_API_KEY (required for "code")
//   GEMINI_API_KEY, CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN, POLLINATIONS_TOKEN (all optional for "image")
// Optional limits per user per day: AI_DAILY_BUILDS (default 10), AI_DAILY_IMAGES (default 40).
import Anthropic from "npm:@anthropic-ai/sdk@1.6.0";
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const MODEL = "claude-opus-5-5";
const DAILY_BUILDS = Number(Deno.env.get("AI_DAILY_BUILDS") ?? 10);
const DAILY_IMAGES = Number(Deno.env.get("AI_DAILY_IMAGES") ?? 40);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const SYSTEM = `You build apps, games and websites for an app-builder used mostly by Hebrew-speaking kids and teens. The user describes what they want (or a change to the current project) and you answer with a complete, working single-file HTML page.

Answer in exactly this order:
1. <message>One or two short, friendly sentences in Hebrew saying what you built or changed, and how to play/use it.</message>
2. <assets>{"style": "...", "images": [...]}</assets>
   Pictures you want an image AI to draw for this project. "style" is one shared art style for every picture (e.g. "bright cartoon, thick outlines, soft shading"). Each image is {"id": "player", "kind": "sprite" | "background", "description": "detailed English description of how it looks"}. Sprites are single characters or objects and arrive on a transparent background; a background is a full scene with no characters. Ask only for pictures the project really uses (at most 6), and only new ones: pictures listed under "existing pictures" can be reused by id as they are. For a plain app or site with no need for pictures, use an empty list.
3. The whole HTML file in one \`\`\`html code block. Nothing after it.

The page:
- Self-contained: all CSS and JavaScript inline. No network requests, except loading the pictures and, when really needed, a library from https://cdn.jsdelivr.net/npm/ pinned to an exact version.
- Pictures: window.ASSETS[id] holds each picture's URL (window.ASSETS is defined before your code runs). A picture can be missing or still loading, so always have a fallback (draw a shape or an emoji) until it loads.
- Hebrew text with <html lang="he" dir="rtl">, unless the user writes in another language.
- Works and looks good on a phone and a computer. Games: a canvas that fills its space and scales, on-screen touch controls as well as the keyboard, a start screen, score, game over and play again. Make it feel alive: smooth movement, juicy feedback, sounds with the Web Audio API.
- It runs inside a sandboxed iframe where localStorage, sessionStorage, cookies and IndexedDB throw; keep state in memory or wrap storage in try/catch.
- Keep the code compact and readable, comfortably under 800 lines, and make sure it runs without errors.
When changing an existing project, keep everything the user did not ask to change and return the whole updated file.`;

type ImageReq = { id: string; kind: "sprite" | "background"; description: string; style?: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  // Who is asking: the user's own session token, checked with Supabase Auth.
  const authHeader = req.headers.get("Authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, apikey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await supabase.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
  if (!userData?.user) return json(401, { error: "login", message: "צריך להתחבר כדי להשתמש ב-AI" });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad_json" });
  }

  // Daily allowance, counted in the database (see supabase/ai.sql).
  const take = async (kind: string, limit: number) => {
    const { data, error } = await supabase.rpc("take_quota", { p_kind: kind, p_limit: limit });
    if (error) throw new Error("quota: " + error.message);
    return data as number | null;
  };

  try {
    if (body.action === "image") {
      const used = await take("image", DAILY_IMAGES);
      if (used == null) return json(429, { error: "quota", message: `הגעת למכסת הציורים להיום (${DAILY_IMAGES}). נסה שוב מחר 🎨` });
      return json(200, await drawImage(body as unknown as ImageReq));
    }
    if (body.action === "code") {
      const partial = typeof body.partial === "string" ? body.partial : "";
      const used = partial ? await take("continue", DAILY_BUILDS * 3) : await take("build", DAILY_BUILDS);
      if (used == null) return json(429, { error: "quota", message: `הגעת למכסת הבניות עם AI להיום (${DAILY_BUILDS}). אפשר להמשיך עם הבלוקים והעוזר הרגיל, ומחר יש עוד 💪` });
      return streamCode(req, body);
    }
    return json(400, { error: "unknown action" });
  } catch (err) {
    console.error(err);
    return json(500, { error: "server", message: "משהו השתבש בשרת: " + (err as Error).message });
  }
});

// ---------- code: Claude, streamed ----------
function userMessage(body: Record<string, unknown>): string {
  const prompt = String(body.prompt ?? "").slice(0, 4000);
  const code = typeof body.code === "string" ? body.code.slice(0, 200_000) : "";
  const assets = Array.isArray(body.assets) ? body.assets.slice(0, 20) : [];
  const partial = typeof body.partial === "string" ? body.partial : "";
  const parts: string[] = [];
  if (code) {
    parts.push(`The current project:\n\`\`\`html\n${code}\n\`\`\``);
    parts.push(`Existing pictures (reuse by id): ${assets.length ? JSON.stringify(assets) : "none"}`);
    parts.push(`Change requested: ${prompt}`);
  } else {
    parts.push(`Build this: ${prompt}`);
  }
  if (partial) {
    parts.push(
      `Your previous answer to this request was cut off. This is everything you wrote so far:\n<previous>\n${partial}\n</previous>\nContinue exactly from the last character of <previous>. Output only the rest, without repeating anything and without any introduction.`,
    );
  }
  return parts.join("\n\n");
}

function streamCode(req: Request, body: Record<string, unknown>): Response {
  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  const enc = new TextEncoder();
  let ping: number | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      // Thinking can take a while before the first text; keep the connection alive meanwhile.
      ping = setInterval(() => controller.enqueue(enc.encode(": ping\n\n")), 5000);
      const claude = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 64000,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM,
        messages: [{ role: "user", content: userMessage(body) }],
      });
      req.signal.addEventListener("abort", () => claude.abort());
      try {
        send({ t: "status", v: "thinking" });
        for await (const event of claude) {
          if (event.type === "content_block_start" && event.content_block.type === "text") send({ t: "status", v: "writing" });
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") send({ t: "text", v: event.delta.text });
        }
        const final = await claude.finalMessage();
        if (final.stop_reason === "refusal") send({ t: "error", v: "ה-AI לא יכול לבנות את זה. נסה לנסח את הבקשה אחרת 🙏" });
        else send({ t: "done", stop: final.stop_reason });
      } catch (err) {
        if (!req.signal.aborted) send({ t: "error", v: claudeError(err) });
      } finally {
        clearInterval(ping);
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() {
      clearInterval(ping);
    },
  });
  return new Response(stream, { headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}

function claudeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "מפתח ה-AI בשרת לא תקין (ANTHROPIC_API_KEY)";
  if (err instanceof Anthropic.PermissionDeniedError) return "למפתח ה-AI אין הרשאה למודל הזה";
  if (err instanceof Anthropic.RateLimitError) return "ה-AI עמוס כרגע. נסה שוב עוד דקה";
  if (err instanceof Anthropic.APIConnectionError) return "אין חיבור ל-AI. נסה שוב";
  if (err instanceof Anthropic.APIError) return `שגיאה מה-AI (${err.status ?? "?"}): ${err.message}`;
  return "משהו השתבש: " + (err as Error).message;
}

// ---------- image: Gemini → Cloudflare → Pollinations ----------
async function drawImage(r: ImageReq) {
  const desc = String(r.description ?? "").slice(0, 800);
  const style = String(r.style ?? "bright, friendly cartoon game art").slice(0, 300);
  if (!desc) throw new Error("no description");
  const prompt = r.kind === "background"
    ? `${desc}. Art style: ${style}. A wide video game background scene with no characters, no text, no letters, no logos.`
    : `${desc}. Art style: ${style}. A single game sprite, centered, the whole object visible with some empty space around it, isolated on a flat solid pure magenta (#FF00FF) background. No ground shadow, no text, no letters, no logos.`;
  const errors: string[] = [];
  for (const provider of [viaGemini, viaCloudflare, viaPollinations]) {
    try {
      const img = await provider(prompt, r.kind);
      if (img) return img;
    } catch (err) {
      errors.push(`${provider.name}: ${(err as Error).message.slice(0, 160)}`);
    }
  }
  throw new Error("no image service answered (" + errors.join(" | ") + ")");
}

type Img = { mime: string; b64: string; provider: string };
const b64 = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

let geminiModels: { at: number; names: string[] } | null = null;
async function viaGemini(prompt: string, _kind?: string): Promise<Img | null> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return null;
  const base = "https://generativelanguage.googleapis.com/v1beta";
  if (!geminiModels || Date.now() - geminiModels.at > 6 * 3600_000) {
    // Image model names change often, so ask Google which ones this key can use.
    const res = await fetch(`${base}/models?pageSize=200&key=${key}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`list HTTP ${res.status}`);
    const list = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    const names = (list.models ?? [])
      .filter((m) => /image/i.test(m.name) && /gemini/i.test(m.name) && (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""))
      .sort((a, b) => Number(/preview|exp/.test(a)) - Number(/preview|exp/.test(b)) || b.localeCompare(a));
    geminiModels = { at: Date.now(), names };
  }
  let last = "no image model for this key";
  for (const model of geminiModels.names.slice(0, 3)) {
    const res = await fetch(`${base}/models/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"] } }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) { last = `${model} HTTP ${res.status}`; continue; }
    const out = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[] };
    const part = out.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (part?.inlineData?.data) return { mime: part.inlineData.mimeType ?? "image/png", b64: part.inlineData.data, provider: "gemini" };
    last = `${model}: no picture`;
  }
  throw new Error(last);
}

async function viaCloudflare(prompt: string, _kind?: string): Promise<Img | null> {
  const account = Deno.env.get("CLOUDFLARE_ACCOUNT_ID");
  const token = Deno.env.get("CLOUDFLARE_API_TOKEN");
  if (!account || !token) return null;
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, steps: 6 }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const out = (await res.json()) as { result?: { image?: string } };
  return out.result?.image ? { mime: "image/jpeg", b64: out.result.image, provider: "cloudflare" } : null;
}

async function viaPollinations(prompt: string, kind?: string): Promise<Img | null> {
  const [w, h] = kind === "background" ? [1280, 720] : [768, 768];
  const seed = Math.floor(Math.random() * 1_000_000);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&nologo=true&safe=true&private=true&model=flux&seed=${seed}`;
  const headers: Record<string, string> = {};
  const token = Deno.env.get("POLLINATIONS_TOKEN");
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) throw new Error("answered without a picture");
  return { mime: type, b64: b64(await res.arrayBuffer()), provider: "pollinations" };
}
