// AI building: Claude writes the code (streamed from the "ai" Edge Function) while an image AI
// draws the pictures. Sprites get their background removed here in the browser, then every
// picture is stored in the public "game-assets" bucket so saved and shared games keep working.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const ASSET_TAG = /<script id="app-assets">[\s\S]*?<\/script>\s*/i;

/** The project's HTML with the pictures' addresses defined before any of its own code runs. */
export function withAssets(html, assets) {
  const urls = {};
  const info = [];
  for (const [id, a] of Object.entries(assets || {})) {
    urls[id] = a.url;
    info.push({ id, kind: a.kind, description: a.description });
  }
  const safe = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
  const tag = `<script id="app-assets">window.ASSETS = ${safe(urls)};\nwindow.ASSET_INFO = ${safe(info)};</script>\n`;
  const clean = html.replace(ASSET_TAG, '');
  const head = clean.match(/<head[^>]*>/i);
  if (head) return clean.replace(head[0], head[0] + '\n' + tag);
  return tag + clean;
}

/** Splits a saved project back into its own code and its pictures. */
export function splitAssets(html) {
  const assets = {};
  const m = (html || '').match(ASSET_TAG);
  if (m) {
    try {
      const urls = JSON.parse(m[0].match(/window\.ASSETS = (.*?);\n/)[1]);
      const info = JSON.parse(m[0].match(/window\.ASSET_INFO = (.*?);<\/script>/)[1]);
      for (const i of info) if (urls[i.id]) assets[i.id] = { url: urls[i.id], kind: i.kind, description: i.description };
    } catch { /* an edited tag: keep the code, drop the list */ }
  }
  return { code: (html || '').replace(ASSET_TAG, ''), assets };
}

/** Reads the three parts of Claude's answer, even while it is still arriving. */
export function parseAnswer(text) {
  const message = (text.match(/<message>([\s\S]*?)(<\/message>|$)/) || [])[1]?.trim() || '';
  const assetsDone = /<\/assets>/.test(text);
  let plan = null;
  if (assetsDone) {
    try { plan = JSON.parse(text.match(/<assets>([\s\S]*?)<\/assets>/)[1]); } catch { plan = { style: '', images: [] }; }
  }
  const fence = text.match(/```html\s*\n([\s\S]*?)(```|$)/i);
  const html = fence ? fence[1] : '';
  const complete = !!fence && (/```\s*$/.test(text.trim()) || /<\/html>\s*$/i.test(html.trim()));
  return { message, plan, html, complete };
}

export function createAI(cloud) {
  if (!cloud) return null;
  const url = SUPABASE_URL + '/functions/v1/ai';

  async function headers() {
    const { data } = await cloud.client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw Object.assign(new Error('צריך להתחבר כדי להשתמש ב-AI'), { code: 'login' });
    return { Authorization: 'Bearer ' + token, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
  }

  async function failure(res) {
    let body = {};
    try { body = await res.json(); } catch { /* not JSON */ }
    const msg = body.message || (res.status === 404 ? 'שרת ה-AI עוד לא הותקן ב-Supabase' : `שגיאה מהשרת (${res.status})`);
    return Object.assign(new Error(msg), { code: body.error || res.status });
  }

  /** One streamed answer from Claude. Calls onText with each new piece; resolves with how it ended. */
  async function streamOnce(payload, onText, onStatus, signal) {
    const res = await fetch(url, { method: 'POST', headers: await headers(), body: JSON.stringify({ action: 'code', ...payload }), signal });
    if (!res.ok || !res.body) throw await failure(res);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let ended = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (!chunk.startsWith('data: ')) continue;
        const ev = JSON.parse(chunk.slice(6));
        if (ev.t === 'text') onText(ev.v);
        else if (ev.t === 'status') onStatus(ev.v, ev.provider);
        else if (ev.t === 'done') ended = ev.stop;
        else if (ev.t === 'error') throw new Error(ev.v);
      }
    }
    return ended; // null when the connection was cut before Claude finished
  }

  async function draw(img, style, signal) {
    const res = await fetch(url, { method: 'POST', headers: await headers(), body: JSON.stringify({ action: 'image', ...img, style }), signal });
    if (!res.ok) throw await failure(res);
    return res.json();
  }

  async function store(blob, ext, projectId, id) {
    const { data } = await cloud.client.auth.getUser();
    const path = `${data.user.id}/${projectId}/${id}-${Date.now().toString(36)}.${ext}`;
    const { error } = await cloud.client.storage.from('game-assets').upload(path, blob, { contentType: blob.type, upsert: false });
    if (error) throw new Error('לא הצלחתי לשמור את הציור: ' + error.message);
    return cloud.client.storage.from('game-assets').getPublicUrl(path).data.publicUrl;
  }

  /**
   * Builds or changes a project.
   * @param {{prompt: string, code?: string, assets?: object, projectId: string, signal?: AbortSignal,
   *   onProgress: (p: {phase: string, text: string, message: string, html: string, images: object}) => void}} opts
   */
  async function build(opts) {
    const { prompt, code = '', assets = {}, projectId, signal, onProgress } = opts;
    let text = '';
    let phase = 'thinking';
    let provider = '';
    const images = {}; // id -> {status, url?, kind, description, error?}
    const jobs = [];
    let planSeen = false;
    const report = () => {
      const a = parseAnswer(text);
      onProgress({ phase, provider, text, message: a.message, html: a.html, images });
    };
    const startImages = (plan) => {
      const style = plan.style || '';
      for (const img of (plan.images || []).slice(0, 6)) {
        if (!img || !img.id || !img.description) continue;
        const kind = img.kind === 'background' ? 'background' : 'sprite';
        images[img.id] = { status: 'drawing', kind, description: img.description };
        jobs.push((async () => {
          try {
            const out = await draw({ id: img.id, kind, description: img.description }, style, signal);
            const blob = kind === 'sprite' ? await cutOut(out) : await shrink(out, 1280, 'image/jpeg');
            const link = await store(blob, kind === 'sprite' ? 'png' : 'jpg', projectId, img.id);
            images[img.id] = { status: 'done', url: link, kind, description: img.description, provider: out.provider };
          } catch (err) {
            images[img.id] = { status: 'failed', kind, description: img.description, error: err.message };
          }
          report();
        })());
      }
    };
    const onText = (piece) => {
      text += piece;
      if (!planSeen && /<\/assets>/.test(text)) {
        planSeen = true;
        startImages(parseAnswer(text).plan || {});
      }
      report();
    };
    const onStatus = (s, who) => { phase = s; if (who) provider = who; report(); };
    const assetList = Object.entries(assets).map(([id, a]) => ({ id, kind: a.kind, description: a.description }));

    let ended = await streamOnce({ prompt, code, assets: assetList }, onText, onStatus, signal);
    // A long answer can outlast one server request: ask Claude to carry on from where it stopped.
    for (let i = 0; i < 3 && ended !== 'end_turn' && !parseAnswer(text).complete; i++) {
      phase = 'continuing';
      report();
      ended = await streamOnce({ prompt, code, assets: assetList, partial: text }, onText, onStatus, signal);
    }
    const answer = parseAnswer(text);
    if (!answer.html.trim()) throw new Error(answer.message || 'ה-AI לא החזיר קוד. נסה לנסח אחרת');
    phase = 'drawing';
    report();
    await Promise.all(jobs);
    const merged = { ...assets };
    for (const [id, img] of Object.entries(images)) if (img.status === 'done') merged[id] = { url: img.url, kind: img.kind, description: img.description };
    phase = 'done';
    report();
    return { message: answer.message, code: answer.html, assets: merged, images, cut: !answer.complete };
  }

  return { build };
}

// ---------- pictures ----------
function loadImage(out) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('הציור שהתקבל פגום'));
    img.src = `data:${out.mime};base64,${out.b64}`;
  });
}

async function shrink(out, max, type) {
  const img = await loadImage(out);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, type, 0.85));
}

/**
 * Removes a sprite's flat background: whatever color the border has (magenta was asked for),
 * flood-filled in from the edges so the same color inside the character stays. Edges get soft
 * alpha and lose the background's tint, then the picture is cropped to the character.
 */
export async function cutOut(out, max = 384) {
  const img = await loadImage(out);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * k), h = Math.round(img.height * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const data = g.getImageData(0, 0, w, h);
  const px = data.data;

  // background color: the median of the border pixels
  const border = [];
  for (let x = 0; x < w; x++) border.push(x, x + (h - 1) * w);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  const med = (ch) => { const v = border.map(i => px[i * 4 + ch]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const bg = [med(0), med(1), med(2)];
  const dist = (i) => Math.hypot(px[i * 4] - bg[0], px[i * 4 + 1] - bg[1], px[i * 4 + 2] - bg[2]);

  const HARD = 70, SOFT = 150;
  const seen = new Uint8Array(w * h);
  const queue = [];
  for (const i of border) if (!seen[i] && dist(i) < HARD) { seen[i] = 1; queue.push(i); }
  while (queue.length) {
    const i = queue.pop();
    px[i * 4 + 3] = 0;
    const x = i % w, y = (i / w) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j >= 0 && !seen[j]) {
        seen[j] = 1;
        if (dist(j) < HARD) queue.push(j);
        else seen[j] = 2; // edge of the character
      }
    }
  }
  // soften the edge and take out the background's tint
  for (let i = 0; i < w * h; i++) {
    if (seen[i] !== 2) continue;
    const d = dist(i);
    if (d < SOFT) px[i * 4 + 3] = Math.round(255 * Math.max(0.15, (d - HARD) / (SOFT - HARD)));
    const r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2];
    const spill = Math.min(r, b) - gg;
    if (spill > 0) { px[i * 4] = r - spill * 0.7; px[i * 4 + 2] = b - spill * 0.7; }
  }
  g.putImageData(data, 0, 0);

  // crop to what's left
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (px[(y * w + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const out2 = document.createElement('canvas');
  if (x1 < 0) { out2.width = w; out2.height = h; out2.getContext('2d').drawImage(img, 0, 0, w, h); }
  else {
    const pad = 4;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    out2.width = x1 - x0 + 1; out2.height = y1 - y0 + 1;
    out2.getContext('2d').drawImage(c, x0, y0, out2.width, out2.height, 0, 0, out2.width, out2.height);
  }
  return new Promise(r => out2.toBlob(r, 'image/png'));
}
