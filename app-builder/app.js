import Anthropic from 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.6.0/+esm';
import { TEMPLATES } from './templates.js';

const MODEL = 'claude-opus-5-5';
const KEY_STORE = 'appBuilder.apiKey';
const PROJECTS_STORE = 'appBuilder.projects';
const CURRENT_STORE = 'appBuilder.current';

const SYSTEM_PROMPT = `You are an app builder. The user (often a young, non-technical person writing in Hebrew) describes an app, game or website, and you build it.

Rules for every answer:
- Reply with ONE complete, self-contained HTML document inside a single \`\`\`html code block. All CSS and JavaScript go inline in that file.
- Before the code block, write one or two short, friendly sentences in the user's language saying what you built or changed. After the code block, write nothing.
- When the user asks for a change, you get the current code. Return the whole updated file, not a diff, and keep everything they did not ask to change.
- Default to Hebrew text with <html lang="he" dir="rtl"> unless the user writes in another language or asks otherwise.
- Make it look polished and modern, work well on phones and desktops, and be fun to use.
- No external network requests, APIs, or build steps. Images: emoji, CSS, inline SVG or canvas drawings. You may load libraries from https://cdn.jsdelivr.net/npm/ only when clearly helpful, pinned to an exact version.
- The page runs in a sandboxed iframe: localStorage, sessionStorage, cookies and IndexedDB throw. Keep state in memory, or wrap any storage access in try/catch so the app still works.
- Make sure the code runs without errors.`;

// ---------- storage helpers ----------
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
  },
};

// ---------- state ----------
let projects = store.get(PROJECTS_STORE, []);
let current = null;
let abortCtrl = null;

const $ = (id) => document.getElementById(id);
const els = {
  main: $('main'), chat: $('chat'), prompt: $('prompt'), status: $('status'),
  send: $('sendBtn'), stop: $('stopBtn'), select: $('projectSelect'),
  frame: $('frame'), empty: $('empty'), code: $('code'), frameWrap: $('frameWrap'),
  settings: $('settings'), keyInput: $('keyInput'),
};

function newId() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

function createProject(name = 'פרויקט חדש', html = '') {
  const p = { id: newId(), name, html, messages: [], updated: Date.now() };
  projects.unshift(p);
  save();
  return p;
}

function save() {
  if (current) current.updated = Date.now();
  store.set(PROJECTS_STORE, projects);
  if (current) store.set(CURRENT_STORE, current.id);
}

// ---------- rendering ----------
function renderProjects() {
  els.select.innerHTML = '';
  for (const p of projects) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (current && p.id === current.id) opt.selected = true;
    els.select.append(opt);
  }
}

function renderChat() {
  els.chat.innerHTML = '';
  if (!current.messages.length) {
    els.chat.append(welcome());
    return;
  }
  for (const m of current.messages) addBubble(m.role, m.text);
}

function welcome() {
  const div = document.createElement('div');
  div.className = 'msg bot welcome';
  div.innerHTML = `<h2>היי! 👋 מה נבנה היום?</h2>
    <p>תאר במילים שלך אפליקציה, משחק או אתר, ואני אבנה אותו. אחר כך אפשר לבקש שינויים: "תעשה את הכפתור אדום", "תוסיף ניקוד"...</p>
    <div class="label">💡 רעיונות</div><div class="chips" id="ideas"></div>
    <div class="label">📦 תבניות מוכנות (עובדות גם בלי מפתח)</div><div class="chips" id="tpls"></div>`;
  const ideas = [
    'משחק שבו תופסים פירות שנופלים עם סל',
    'אתר למסעדת פיצה עם תפריט והזמנה',
    'חידון טריוויה על חיות עם ניקוד',
    'אפליקציית מזג אוויר מצוירת עם מצבי רוח',
    'שעון עצר וטיימר לאימונים',
    'אתר תיק עבודות אישי לצלם',
  ];
  const ideasEl = div.querySelector('#ideas');
  for (const idea of ideas) {
    const b = document.createElement('button');
    b.className = 'chip'; b.textContent = idea;
    b.onclick = () => { els.prompt.value = idea; els.prompt.focus(); };
    ideasEl.append(b);
  }
  const tplEl = div.querySelector('#tpls');
  for (const t of TEMPLATES) {
    const b = document.createElement('button');
    b.className = 'chip'; b.textContent = t.name;
    b.onclick = () => useTemplate(t);
    tplEl.append(b);
  }
  return div;
}

function addBubble(role, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'user' : role === 'error' ? 'err' : 'bot');
  div.textContent = text;
  els.chat.append(div);
  els.chat.scrollTop = els.chat.scrollHeight;
  return div;
}

function showPreview(html) {
  const has = !!html.trim();
  els.empty.hidden = has;
  els.frame.hidden = !has;
  if (has) els.frame.srcdoc = html;
}

function loadProject(p) {
  current = p;
  store.set(CURRENT_STORE, p.id);
  renderProjects();
  renderChat();
  els.code.value = p.html;
  showPreview(p.html);
}

function useTemplate(t) {
  current.html = t.html;
  if (current.name === 'פרויקט חדש') current.name = t.name.replace(/^\S+\s/, '');
  current.messages.push({ role: 'user', text: `התחל מהתבנית: ${t.name}` });
  current.messages.push({ role: 'assistant', text: 'הנה התבנית! 🎉 עכשיו אפשר לבקש שינויים, או לערוך את הקוד בלשונית "קוד".' });
  save();
  loadProject(current);
  setMobileView('stage');
}

// ---------- Claude ----------
function extractHtml(text) {
  const fence = text.match(/```html\s*\n([\s\S]*?)(```|$)/i);
  if (fence) return fence[1];
  const start = text.search(/<!DOCTYPE html|<html/i);
  return start >= 0 ? text.slice(start) : '';
}

function explanation(text) {
  const idx = text.search(/```html/i);
  const before = (idx >= 0 ? text.slice(0, idx) : text).trim();
  return before || 'מוכן! ✨';
}

function buildRequestText(request) {
  if (!current.html.trim()) return request;
  const history = current.messages.filter(m => m.role === 'user').slice(-8).map(m => '- ' + m.text).join('\n');
  return `Earlier requests in this project:\n${history || '(none)'}\n\nCurrent code:\n\`\`\`html\n${current.html}\n\`\`\`\n\nNew request: ${request}`;
}

async function build() {
  const request = els.prompt.value.trim();
  if (!request || abortCtrl) return;
  const apiKey = store.get(KEY_STORE, '');
  if (!apiKey) {
    addBubble('error', 'כדי לבנות מתיאור במילים צריך מפתח Claude API. אפשר להוסיף אותו ב־⚙️ הגדרות, או להתחיל מתבנית מוכנה.');
    openSettings();
    return;
  }

  if (!current.messages.length) els.chat.innerHTML = '';
  if (current.name === 'פרויקט חדש') {
    current.name = request.length > 28 ? request.slice(0, 28) + '…' : request;
    renderProjects();
  }
  const userText = buildRequestText(request);
  current.messages.push({ role: 'user', text: request });
  addBubble('user', request);
  els.prompt.value = '';
  save();

  const bubble = addBubble('assistant', '🤔 חושב...');
  setBusy(true, 'חושב על התכנון...');
  abortCtrl = new AbortController();

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  let text = '';
  let lastPreview = 0;
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userText }],
    }, { signal: abortCtrl.signal });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        text += event.delta.text;
        const html = extractHtml(text);
        bubble.textContent = explanation(text);
        if (html) {
          setBusy(true, `כותב קוד... (${html.split('\n').length} שורות)`);
          els.code.value = html;
          if (Date.now() - lastPreview > 2500) { showPreview(html); lastPreview = Date.now(); }
        }
      }
    }
    const final = await stream.finalMessage();

    if (final.stop_reason === 'refusal') {
      bubble.className = 'msg err';
      bubble.textContent = 'לא יכולתי לבנות את זה. נסה לנסח את הבקשה אחרת 🙏';
      els.code.value = current.html;
      showPreview(current.html);
      current.messages.push({ role: 'error', text: bubble.textContent });
      return;
    }

    const html = extractHtml(text).trim();
    if (!html) {
      bubble.textContent = text.trim() || 'לא התקבל קוד. נסה שוב.';
      current.messages.push({ role: 'assistant', text: bubble.textContent });
      return;
    }
    if (final.stop_reason === 'max_tokens') {
      bubble.textContent = explanation(text) + '\n⚠️ הקוד ארוך מדי ונחתך. נסה לבקש גרסה פשוטה יותר.';
    }
    current.html = html + '\n';
    current.messages.push({ role: 'assistant', text: bubble.textContent });
    els.code.value = current.html;
    showPreview(current.html);
    setMobileView('stage');
  } catch (err) {
    els.code.value = current.html;
    showPreview(current.html);
    let msg;
    if (abortCtrl?.signal.aborted) msg = 'הבנייה נעצרה.';
    else if (err instanceof Anthropic.AuthenticationError) msg = 'המפתח לא תקין. בדוק אותו ב־⚙️ הגדרות.';
    else if (err instanceof Anthropic.RateLimitError) msg = 'יותר מדי בקשות כרגע. חכה דקה ונסה שוב.';
    else if (err instanceof Anthropic.APIConnectionError) msg = 'אין חיבור לשרת. בדוק את האינטרנט ונסה שוב.';
    else if (err instanceof Anthropic.APIError) msg = `שגיאה מהשרת (${err.status ?? ''}): ${err.message}`;
    else msg = 'משהו השתבש: ' + (err?.message || err);
    bubble.className = 'msg err';
    bubble.textContent = msg;
    current.messages.push({ role: 'error', text: msg });
  } finally {
    abortCtrl = null;
    setBusy(false);
    save();
  }
}

function setBusy(busy, status = '') {
  els.send.disabled = busy;
  els.stop.hidden = !busy;
  els.status.textContent = status;
}

// ---------- settings ----------
function openSettings() {
  els.keyInput.value = store.get(KEY_STORE, '');
  els.settings.showModal();
}

// ---------- mobile ----------
function setMobileView(view) {
  els.main.className = 'show-' + view;
  document.querySelectorAll('[data-mview]').forEach(b => b.classList.toggle('on', b.dataset.mview === view));
}

// ---------- wiring ----------
els.send.onclick = build;
els.stop.onclick = () => abortCtrl?.abort();
els.prompt.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) build();
});

$('settingsBtn').onclick = openSettings;
$('closeSettingsBtn').onclick = () => els.settings.close();
$('saveKeyBtn').onclick = () => {
  const key = els.keyInput.value.trim();
  if (key) store.set(KEY_STORE, key); else store.remove(KEY_STORE);
  els.settings.close();
};
$('clearKeyBtn').onclick = () => { store.remove(KEY_STORE); els.keyInput.value = ''; };

els.select.onchange = () => {
  const p = projects.find(x => x.id === els.select.value);
  if (p && !abortCtrl) loadProject(p);
};
$('newBtn').onclick = () => { if (!abortCtrl) loadProject(createProject()); };
$('renameBtn').onclick = () => {
  const name = prompt('שם חדש לפרויקט:', current.name);
  if (name && name.trim()) { current.name = name.trim(); save(); renderProjects(); }
};
$('deleteBtn').onclick = () => {
  if (abortCtrl || !confirm(`למחוק את "${current.name}"?`)) return;
  projects = projects.filter(p => p.id !== current.id);
  if (!projects.length) createProject();
  save();
  loadProject(projects[0]);
};

document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('on', x === b));
  const code = b.dataset.view === 'code';
  els.code.hidden = !code;
  els.frameWrap.hidden = code;
  if (!code) showPreview(current.html);
});
document.querySelectorAll('[data-device]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-device]').forEach(x => x.classList.toggle('on', x === b));
  els.frameWrap.classList.toggle('phone', b.dataset.device === 'phone');
});
document.querySelectorAll('[data-mview]').forEach(b => b.onclick = () => setMobileView(b.dataset.mview));

els.code.addEventListener('input', () => { current.html = els.code.value; save(); });
$('runBtn').onclick = () => { els.frame.srcdoc = ''; showPreview(current.html); };
$('copyBtn').onclick = async () => {
  try { await navigator.clipboard.writeText(current.html); els.status.textContent = 'הקוד הועתק 📋'; }
  catch { els.code.hidden = false; els.code.select(); }
};
$('downloadBtn').onclick = () => {
  if (!current.html.trim()) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([current.html], { type: 'text/html' }));
  a.download = (current.name.replace(/[\\/:*?"<>|]/g, '').trim() || 'app') + '.html';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('openBtn').onclick = () => {
  if (!current.html.trim()) return;
  // Run the app inside a sandboxed iframe so it can't reach this page's storage (where the API key lives).
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.title = current.name;
  win.document.body.style.margin = '0';
  const frame = win.document.createElement('iframe');
  frame.setAttribute('sandbox', els.frame.getAttribute('sandbox'));
  frame.style.cssText = 'border:0;width:100vw;height:100vh;display:block';
  frame.srcdoc = current.html;
  win.document.body.append(frame);
};

// ---------- start ----------
if (!projects.length) createProject();
const savedId = store.get(CURRENT_STORE, null);
loadProject(projects.find(p => p.id === savedId) || projects[0]);
