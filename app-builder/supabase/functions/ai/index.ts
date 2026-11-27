// Supabase Edge Function "ai": the app builder's AI.
//   action "code"  – an AI writes (or changes) a complete HTML app or game, streamed back as server-sent events.
//                    Claude if ANTHROPIC_API_KEY is set, else Gemini (free tier) if GEMINI_API_KEY is set, else Pollinations (free).
//   action "image" – draws one picture for the game (Gemini → Cloudflare → Pollinations).
// Keys live in the function's secrets (never in the browser), all optional:
//   ANTHROPIC_API_KEY, GEMINI_API_KEY, CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN, POLLINATIONS_TOKEN
// Optional limits per user per day: AI_DAILY_BUILDS (default 10), AI_DAILY_IMAGES (default 40).
import Anthropic from "npm:@anthropic-ai/sdk@1.6.0";
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const CLAUDE_MODEL = "claude-opus-5-5";
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
  if (!/^Bearer\s+\S+/i.test(authHeader) || !apikey) return json(401, { error: "login", message: "צריך להתחבר כדי להשתמש ב-AI" });
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

// ---------- code: streamed from the first AI that answers ----------
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

type Emit = (text: string) => void;
type CodeProvider = { name: string; ready: () => boolean; run: (msg: string, emit: Emit, signal: AbortSignal) => Promise<string> };

// Tried in order. The first one that answers writes the code; if one fails before writing anything, the next one tries.
const CODE_PROVIDERS: CodeProvider[] = [
  { name: "claude", ready: () => !!Deno.env.get("ANTHROPIC_API_KEY"), run: viaClaude },
  { name: "gemini", ready: () => !!Deno.env.get("GEMINI_API_KEY"), run: viaGeminiText },
  { name: "pollinations", ready: () => true, run: viaPollinationsText },
];

function streamCode(req: Request, body: Record<string, unknown>): Response {
  const enc = new TextEncoder();
  const msg = userMessage(body);
  let ping: number | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      // Thinking can take a while before the first text; keep the connection alive meanwhile.
      ping = setInterval(() => controller.enqueue(enc.encode(": ping\n\n")), 5000);
      const errors: string[] = [];
      try {
        send({ t: "status", v: "thinking" });
        for (const p of CODE_PROVIDERS) {
          if (!p.ready() || req.signal.aborted) continue;
          let wrote = false;
          try {
            const stop = await p.run(msg, (text) => {
              if (!wrote) { wrote = true; send({ t: "status", v: "writing", provider: p.name }); }
              send({ t: "text", v: text });
            }, req.signal);
            send({ t: "done", stop, provider: p.name });
            return;
          } catch (err) {
            const why = (err as Error).message.slice(0, 200);
            console.error(`code via ${p.name} failed: ${why}`);
            // Part of the answer already went out: stop here, the browser asks to continue from it.
            if (wrote) { send({ t: "done", stop: "cut", provider: p.name }); return; }
            errors.push(`${p.name}: ${why}`);
          }
        }
        if (!req.signal.aborted) send({ t: "error", v: "אף שירות AI לא ענה כרגע. נסה שוב עוד דקה (" + errors.join(" | ") + ")" });
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

/** Reads a server-sent-events body and hands each "data:" payload to onData. */
async function readSSE(res: Response, onData: (data: string) => void) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i).replace(/^\r?\n\r?\n/, "");
      const data = chunk.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
      if (data) onData(data);
    }
  }
}

// ----- Claude (paid; used only when ANTHROPIC_API_KEY is set) -----
async function viaClaude(msg: string, emit: Emit, signal: AbortSignal): Promise<string> {
  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  const claude = client.beta.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 64000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [{ role: "user", content: msg }],
  });
  signal.addEventListener("abort", () => claude.abort());
  try {
    for await (const event of claude) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") emit(event.delta.text);
    }
    const final = await claude.finalMessage();
    if (final.stop_reason === "refusal") throw new Error("declined the request");
    return final.stop_reason ?? "end_turn";
  } catch (err) {
    throw new Error(claudeError(err));
  }
}

function claudeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "bad ANTHROPIC_API_KEY";
  if (err instanceof Anthropic.PermissionDeniedError) return "no access to the model";
  if (err instanceof Anthropic.RateLimitError) return "rate limited";
  if (err instanceof Anthropic.APIConnectionError) return "no connection";
  if (err instanceof Anthropic.APIError) return `API error ${err.status ?? "?"}: ${err.message}`;
  return (err as Error).message;
}

// ----- Gemini (free tier with the key from Google AI Studio) -----
const GEMINI = "https://generativelanguage.googleapis.com/v1beta";
let geminiList: { at: number; models: { name: string; methods: string[] }[] } | null = null;

async function geminiModels(): Promise<{ name: string; methods: string[] }[]> {
  if (!geminiList || Date.now() - geminiList.at > 6 * 3600_000) {
    // Model names change often, so ask Google which ones this key can use.
    const res = await fetch(`${GEMINI}/models?pageSize=200&key=${Deno.env.get("GEMINI_API_KEY")}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`list HTTP ${res.status}`);
    const out = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    geminiList = { at: Date.now(), models: (out.models ?? []).map((m) => ({ name: m.name.replace(/^models\//, ""), methods: m.supportedGenerationMethods ?? [] })) };
  }
  return geminiList.models;
}

/** The best text model of each kind (pro, then flash, then flash-lite), newest stable version first. */
async function geminiTextModels(): Promise<string[]> {
  const version = (n: string) => Number((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] ?? 0);
  const tier = (n: string) => (/lite/.test(n) ? 2 : /flash/.test(n) ? 1 : /pro/.test(n) ? 0 : 3);
  const usable = (await geminiModels())
    .filter((m) => /^gemini-/.test(m.name) && m.methods.includes("generateContent"))
    .filter((m) => !/image|tts|audio|embed|live|vision|robotics|computer|native|thinking-exp|learnlm|nano/i.test(m.name))
    .map((m) => m.name)
    .sort((a, b) => tier(a) - tier(b) || version(b) - version(a) || Number(/preview|exp/.test(a)) - Number(/preview|exp/.test(b)) || a.length - b.length);
  const best: string[] = [];
  for (const t of [0, 1, 2]) {
    const pick = usable.filter((n) => tier(n) === t).slice(0, t === 1 ? 2 : 1);
    best.push(...pick);
  }
  return best;
}

async function viaGeminiText(msg: string, emit: Emit, signal: AbortSignal): Promise<string> {
  const key = Deno.env.get("GEMINI_API_KEY");
  const models = await geminiTextModels();
  if (!models.length) throw new Error("no text model for this key");
  let last = "";
  for (const model of models) {
    const res = await fetch(`${GEMINI}/models/${model}:streamGenerateContent?alt=sse&key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: msg }] }],
        generationConfig: { maxOutputTokens: 65536 },
      }),
      signal,
    });
    if (!res.ok) {
      // busy, over the free allowance, or not open to this key: try the next model
      last = `${model} HTTP ${res.status}`;
      if ([429, 403, 404, 500, 503].includes(res.status)) continue;
      throw new Error(last);
    }
    let stop = "end_turn";
    let wrote = false;
    await readSSE(res, (data) => {
      const out = JSON.parse(data) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]; error?: { message?: string } };
      if (out.error) throw new Error(out.error.message ?? "stream error");
      const c = out.candidates?.[0];
      for (const p of c?.content?.parts ?? []) if (p.text && !p.thought) { wrote = true; emit(p.text); }
      if (c?.finishReason === "MAX_TOKENS") stop = "max_tokens";
      else if (c?.finishReason && !["STOP", "FINISH_REASON_UNSPECIFIED"].includes(c.finishReason)) stop = c.finishReason.toLowerCase();
    });
    if (!wrote) { last = `${model}: empty answer (${stop})`; continue; }
    return stop;
  }
  throw new Error(last);
}

// ----- Pollinations (free, no account) -----
async function viaPollinationsText(msg: string, emit: Emit, signal: AbortSignal): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = Deno.env.get("POLLINATIONS_TOKEN");
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch("https://text.pollinations.ai/openai", {
    method: "POST",
    headers,
    body: JSON.stringify({ model: "openai", stream: true, private: true, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: msg }] }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  let stop = "end_turn";
  let wrote = false;
  await readSSE(res, (data) => {
    if (data === "[DONE]") return;
    const out = JSON.parse(data) as { choices?: { delta?: { content?: string }; finish_reason?: string | null }[] };
    const c = out.choices?.[0];
    if (c?.delta?.content) { wrote = true; emit(c.delta.content); }
    if (c?.finish_reason === "length") stop = "max_tokens";
  });
  if (!wrote) throw new Error("empty answer");
  return stop;
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

async function viaGemini(prompt: string, _kind?: string): Promise<Img | null> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return null;
  const names = (await geminiModels())
    .filter((m) => /image/i.test(m.name) && /gemini/i.test(m.name) && m.methods.includes("generateContent"))
    .map((m) => m.name)
    .sort((a, b) => Number(/preview|exp/.test(a)) - Number(/preview|exp/.test(b)) || b.localeCompare(a));
  let last = "no image model for this key";
  for (const model of names.slice(0, 3)) {
    const res = await fetch(`${GEMINI}/models/${model}:generateContent?key=${key}`, {
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
