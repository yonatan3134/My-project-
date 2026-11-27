/* global Blockly */
import { TOOLBOX, generateCode, pageTitle } from './blocks.js';
import { buildHtml } from './runtime.js';
import { assist } from './assistant.js';
import { TEMPLATES } from './templates.js';
import { createCloud, errorText } from './cloud.js';

const PROJECTS_STORE = 'appBuilder.projects';
const CURRENT_STORE = 'appBuilder.current';

// ---------- storage ----------
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

const STARTER = {
  blocks: { languageVersion: 0, blocks: [
    { type: 'ui_page', x: 20, y: 20, fields: { TITLE: 'האפליקציה שלי', BG: '#f1ecff' }, inputs: { CONTENT: { block: {
      type: 'ui_title', fields: { TEXT: 'שלום עולם! 👋', NAME: 'כותרת' }, next: { block: {
        type: 'ui_button', fields: { TEXT: 'לחץ עליי', COLOR: '#6a4cff', NAME: 'כפתור' } } } } } } },
    { type: 'ev_click', x: 20, y: 200, fields: { NAME: 'כפתור' }, inputs: { DO: { block: {
      type: 'act_say', inputs: { VALUE: { block: { type: 'text', fields: { TEXT: 'כל הכבוד! 🎉' } } } }, next: { block: { type: 'act_confetti' } } } } } },
  ] },
};

// ---------- state ----------
let projects = [];
let current = null;
let loading = false;
let renderTimer = null;

const $ = (id) => document.getElementById(id);
const els = {
  main: $('main'), chat: $('chat'), prompt: $('prompt'), select: $('projectSelect'),
  frame: $('frame'), frameWrap: $('frameWrap'), code: $('code'), codeHint: $('codeHint'),
  blocksPane: $('blocksPane'), codePane: $('codePane'), codeNote: $('codeNote'), toCodeBtn: $('toCodeBtn'),
  accountBtn: $('accountBtn'), sync: $('syncStatus'), auth: $('authDialog'),
};

// ---------- cloud ----------
const SYNC_TEXT = { pending: '⏳', saving: '☁️ שומר...', saved: '☁️ נשמר', error: '⚠️ לא נשמר' };
const cloud = createCloud({
  onStatus(state, detail) {
    els.sync.textContent = SYNC_TEXT[state] || '';
    els.sync.title = state === 'error' ? detail + '\nהפרויקט שמור במכשיר, ננסה שוב בעוד רגע' : '';
    els.sync.classList.toggle('bad', state === 'error');
    if (state === 'saved') saveLocalOnly(); // remember which projects already reached the cloud
  },
});
const userKey = (base) => (cloud?.user ? base + '.' + cloud.user.id : base);
const normalize = (p) => ({ mode: p.blocks ? 'blocks' : 'code', messages: [], updated: 0, ...p });
const readLocal = () => store.get(userKey(PROJECTS_STORE), []).map(normalize);
// An untouched starter project: nothing worth keeping in it yet.
const isPristine = (p) => !!p.untouched && !p.messages.length;

const ws = Blockly.inject('blockly', {
  toolbox: TOOLBOX,
  rtl: true,
  renderer: 'zelos',
  media: 'vendor/blockly/media/',
  trashcan: true,
  grid: { spacing: 24, length: 2, colour: '#e3def8', snap: true },
  zoom: { controls: true, wheel: true, startScale: 0.8, maxScale: 2, minScale: 0.3 },
  move: { scrollbars: true, drag: true, wheel: false },
});

// Show the top-right corner of the blocks (where Hebrew blocks start), not the middle.
function showStart() {
  Blockly.svgResize(ws);
  const mm = ws.getMetricsManager();
  const content = mm.getContentMetrics(true);
  const view = mm.getViewMetrics(true);
  if (!content.width) return;
  const scale = ws.scale;
  const left = content.left + content.width + 30 - view.width;
  const top = content.top - 30;
  ws.scroll(-left * scale, -top * scale);
}

function newId() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

function createProject({ name = 'פרויקט חדש', mode = 'blocks', blocks = STARTER, html = '' } = {}) {
  const p = { id: newId(), name, mode, blocks: mode === 'blocks' ? JSON.parse(JSON.stringify(blocks)) : null, html, messages: [], updated: Date.now(), untouched: blocks === STARTER && mode === 'blocks' };
  projects.unshift(p);
  save(p);
  return p;
}

function save(p = current) {
  if (p) {
    p.updated = Date.now();
    if (!isPristine(p)) cloud?.queue(p); // an untouched starter project doesn't need to reach the cloud
  }
  store.set(userKey(PROJECTS_STORE), projects);
  if (current) store.set(userKey(CURRENT_STORE), current.id);
}

function saveLocalOnly() {
  store.set(userKey(PROJECTS_STORE), projects);
}

// ---------- building the app ----------
function currentHtml() {
  if (current.mode === 'code') return current.html;
  return buildHtml(generateCode(ws), pageTitle(ws));
}

function render() {
  const html = currentHtml();
  if (current.mode === 'blocks') {
    current.html = html;
    els.code.value = html;
  }
  els.frame.srcdoc = html;
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 400);
}

ws.addChangeListener((e) => {
  if (loading || e.isUiEvent || !current || current.mode !== 'blocks') return;
  current.blocks = Blockly.serialization.workspaces.save(ws);
  delete current.untouched;
  const title = pageTitle(ws);
  if (current.name === 'פרויקט חדש' && title && title !== 'האפליקציה שלי') { current.name = title; renderProjects(); }
  save();
  scheduleRender();
});

// ---------- projects ----------
function renderProjects() {
  els.select.innerHTML = '';
  for (const p of projects) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = (p.mode === 'code' ? '</> ' : '🧩 ') + p.name;
    opt.selected = current && p.id === current.id;
    els.select.append(opt);
  }
}

function loadBlocks(json) {
  loading = true;
  Blockly.Events.disable(); // loading isn't a change by the user
  try {
    ws.clear();
    if (json) Blockly.serialization.workspaces.load(json, ws);
  } catch (err) {
    console.error(err);
    addBubble('bot', '⚠️ חלק מהבלוקים לא נטענו.');
  } finally {
    Blockly.Events.enable();
    loading = false;
  }
  ws.clearUndo();
  showStart();
}

function loadProject(p) {
  current = p;
  store.set(userKey(CURRENT_STORE), p.id);
  renderProjects();
  renderChat();
  const isCode = p.mode === 'code';
  els.codeNote.hidden = !isCode;
  els.code.readOnly = !isCode;
  els.toCodeBtn.hidden = isCode;
  els.codeHint.textContent = isCode ? 'עורכים כאן את הקוד ישירות' : 'הקוד נוצר אוטומטית מהבלוקים (קריאה בלבד)';
  loadBlocks(isCode ? null : p.blocks);
  if (isCode) els.code.value = p.html;
  render();
}

// ---------- assistant chat ----------
function addBubble(role, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'user' : 'bot');
  div.textContent = text;
  els.chat.append(div);
  els.chat.scrollTop = els.chat.scrollHeight;
  return div;
}

function renderChat() {
  els.chat.innerHTML = '';
  const w = document.createElement('div');
  w.className = 'msg bot welcome';
  w.innerHTML = '<b>היי! 👋 אני העוזר שלך</b>כתוב לי מה לבנות ואני אבנה את זה מבלוקים. אחר כך אפשר לגרור בלוקים ולשנות הכל, או לבקש ממני שינויים.';
  const chips = document.createElement('div');
  chips.className = 'chips';
  const ideas = ['משחק שתופסים בו חתולים', 'חידון על חיות', 'אתר למסעדת פיצה', 'רשימת משימות', 'טיימר של 5 דקות', 'קוביה', 'מחשבון', 'משחק זיכרון', 'משחק עם חצים', 'מה אתה יודע?'];
  for (const idea of ideas) {
    const b = document.createElement('button');
    b.className = 'chip'; b.textContent = idea;
    b.onclick = () => send(idea);
    chips.append(b);
  }
  w.append(chips);
  els.chat.append(w);
  for (const m of current.messages) addBubble(m.role, m.text);
}

function send(textArg) {
  const text = (textArg ?? els.prompt.value).trim();
  if (!text) return;
  els.prompt.value = '';

  const blocksNow = current.mode === 'blocks' ? Blockly.serialization.workspaces.save(ws) : null;
  const pristine = isPristine(current);
  const result = assist(text, pristine ? null : blocksNow);

  // A brand-new app goes into a new project, so nothing the user made gets overwritten.
  if (result.fresh) {
    const keep = !pristine && (current.mode === 'code' || (blocksNow?.blocks?.blocks || []).length);
    let target = current;
    if (result.code) {
      const tpl = TEMPLATES.find(t => t.id === result.code);
      if (keep) target = createProject({ name: tpl.name.replace(/^\S+\s/, ''), mode: 'code', html: tpl.html });
      else Object.assign(target, { name: tpl.name.replace(/^\S+\s/, ''), mode: 'code', blocks: null, html: tpl.html, untouched: false });
    } else {
      const title = result.workspace.blocks.blocks.find(b => b.type === 'ui_page')?.fields?.TITLE || 'פרויקט חדש';
      if (keep) target = createProject({ name: title, blocks: result.workspace });
      else Object.assign(target, { name: title, mode: 'blocks', blocks: result.workspace, untouched: false });
    }
    target.messages.push({ role: 'user', text }, { role: 'bot', text: result.reply + (keep ? '\n\n(שמרתי את זה כפרויקט חדש, הפרויקט הקודם נשאר ברשימה)' : '') });
    save();
    loadProject(target);
    if (!result.code) { ws.cleanUp(); showStart(); }
    return;
  }

  current.messages.push({ role: 'user', text });
  addBubble('user', text);
  if (result.workspace && current.mode === 'blocks') {
    loadBlocks(result.workspace);
    current.blocks = Blockly.serialization.workspaces.save(ws);
    render();
  } else if (result.workspace) {
    result.reply = 'הפרויקט הזה כתוב בקוד, אז אני לא יכול לשנות אותו מבלוקים. אפשר ליצור פרויקט בלוקים חדש ➕';
  }
  current.messages.push({ role: 'bot', text: result.reply });
  addBubble('bot', result.reply);
  save();
}

// ---------- wiring ----------
$('sendBtn').onclick = () => send();
els.prompt.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

els.select.onchange = () => {
  const p = projects.find(x => x.id === els.select.value);
  if (p) loadProject(p);
};
$('newBtn').onclick = () => loadProject(createProject());
$('newBlocksBtn').onclick = () => loadProject(createProject());
$('renameBtn').onclick = () => {
  const name = prompt('שם חדש לפרויקט:', current.name);
  if (name && name.trim()) { current.name = name.trim(); delete current.untouched; save(); renderProjects(); }
};
$('deleteBtn').onclick = () => {
  if (!confirm(`למחוק את "${current.name}"?`)) return;
  const gone = current.id;
  projects = projects.filter(p => p.id !== gone);
  cloud?.remove(gone);
  if (!projects.length) createProject();
  saveLocalOnly();
  loadProject(projects[0]);
};

$('undoBtn').onclick = () => ws.undo(false);
$('redoBtn').onclick = () => ws.undo(true);
$('tidyBtn').onclick = () => ws.cleanUp();

document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === b));
  const code = b.dataset.tab === 'code';
  els.codePane.hidden = !code;
  els.blocksPane.hidden = code;
  if (!code) showStart();
});
document.querySelectorAll('[data-device]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-device]').forEach(x => x.classList.toggle('on', x === b));
  els.frameWrap.classList.toggle('phone', b.dataset.device === 'phone');
});
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('on', x === b));
  els.main.className = 'v-' + b.dataset.view;
  if (b.dataset.view === 'work') showStart();
});
window.addEventListener('resize', () => Blockly.svgResize(ws));

els.code.addEventListener('input', () => {
  if (current.mode !== 'code') return;
  current.html = els.code.value;
  save();
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => { els.frame.srcdoc = current.html; }, 800);
});
els.toCodeBtn.onclick = () => {
  if (!confirm('להמיר את הפרויקט לקוד חופשי? אחרי זה לא תוכל לערוך אותו בבלוקים (העותק בבלוקים יישמר כפרויקט נפרד).')) return;
  const copy = createProject({ name: current.name + ' (קוד)', mode: 'code', html: currentHtml() });
  loadProject(copy);
  document.querySelector('[data-tab="code"]').click();
};

$('runBtn').onclick = () => { els.frame.srcdoc = ''; render(); };
$('downloadBtn').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([currentHtml()], { type: 'text/html' }));
  a.download = (current.name.replace(/[\\/:*?"<>|]/g, '').trim() || 'app') + '.html';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('openBtn').onclick = () => {
  // The app runs inside a sandboxed iframe so it can't reach this page's saved projects.
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.title = current.name;
  win.document.body.style.margin = '0';
  const frame = win.document.createElement('iframe');
  frame.setAttribute('sandbox', els.frame.getAttribute('sandbox'));
  frame.style.cssText = 'border:0;width:100vw;height:100vh;display:block';
  frame.srcdoc = currentHtml();
  win.document.body.append(frame);
};

// ---------- accounts & syncing ----------
function openSaved() {
  if (!projects.length) createProject();
  const savedId = store.get(userKey(CURRENT_STORE), null);
  loadProject(projects.find(p => p.id === savedId) || projects[0]);
}

// Projects made before signing in move into the account, so nothing is lost.
function adoptGuestProjects() {
  const guest = store.get(PROJECTS_STORE, []).map(normalize).filter(p => !isPristine(p));
  if (!guest.length) return 0;
  const have = new Set(projects.map(p => p.id));
  for (const p of guest) if (!have.has(p.id)) { p.synced = false; projects.push(p); }
  store.set(PROJECTS_STORE, []);
  saveLocalOnly();
  return guest.length;
}

async function syncFromCloud() {
  let remote;
  try {
    remote = await cloud.list();
  } catch (err) {
    els.sync.textContent = SYNC_TEXT.error;
    els.sync.title = errorText(err);
    return;
  }
  const remoteById = new Map(remote.map(r => [r.id, { ...r, synced: true }]));
  const merged = [];
  const toUpload = [];
  for (const l of projects) {
    const r = remoteById.get(l.id);
    if (r) { merged.push(r.updated >= l.updated ? r : l); if (l.updated > r.updated) toUpload.push(l); remoteById.delete(l.id); }
    else if (l.synced) { /* deleted on another device */ }
    else if (!isPristine(l) || !remote.length) { merged.push(l); if (!isPristine(l)) toUpload.push(l); }
  }
  merged.push(...remoteById.values());
  merged.sort((a, b) => b.updated - a.updated);
  const currentId = current?.id;
  const before = current;
  projects = merged;
  if (toUpload.length) {
    els.sync.textContent = SYNC_TEXT.saving;
    const error = await cloud.upload(toUpload);
    if (error) { els.sync.textContent = SYNC_TEXT.error; els.sync.title = errorText(error); }
    else { toUpload.forEach(p => { p.synced = true; }); els.sync.textContent = SYNC_TEXT.saved; }
  } else els.sync.textContent = SYNC_TEXT.saved;
  saveLocalOnly();
  const same = projects.find(p => p.id === currentId);
  if (!same) openSaved();
  else if (same !== before) loadProject(same);
  else renderProjects();
}

async function setUser(user) {
  cloud.setUser(user);
  els.sync.textContent = '';
  els.sync.title = '';
  projects = readLocal();
  const moved = user ? adoptGuestProjects() : 0;
  openSaved();
  renderAccount();
  if (user) {
    await syncFromCloud();
    if (moved) addBubble('bot', `☁️ העברתי ${moved} פרויקטים לחשבון שלך. עכשיו הם יופיעו בכל מכשיר שתתחבר ממנו.`);
  }
}

function renderAccount() {
  els.accountBtn.hidden = !cloud;
  const u = cloud?.user;
  els.accountBtn.textContent = u ? '👤 ' + u.email.split('@')[0] : '👤 התחברות';
  els.accountBtn.title = u ? u.email : 'התחברות ושמירה בענן';
}

// ----- the sign-in dialog -----
const A = {
  title: $('authTitle'), note: $('authNote'), email: $('authEmail'), pass: $('authPass'), err: $('authErr'),
  ok: $('authOk'), submit: $('authSubmit'), alt: $('authAlt'), forgot: $('authForgot'), signOut: $('authSignOut'),
  form: $('authForm'), who: $('authWho'),
};
let authMode = 'login';
const AUTH_MODES = {
  login: { title: '👤 התחברות', submit: 'התחבר', alt: 'אין לך חשבון? להרשמה', note: 'מתחברים כדי לשמור את הפרויקטים בענן ולפתוח אותם מכל מכשיר.' },
  signup: { title: '✨ הרשמה', submit: 'צור חשבון', alt: 'כבר יש לך חשבון? להתחברות', note: 'ההרשמה בחינם. אחרי ההרשמה יגיע אליך מייל לאישור.' },
  reset: { title: '🔑 שכחתי סיסמה', submit: 'שלח לי קישור', alt: 'חזרה להתחברות', note: 'נשלח לך מייל עם קישור לבחירת סיסמה חדשה.' },
  newpass: { title: '🔑 סיסמה חדשה', submit: 'שמור סיסמה', alt: '', note: 'בחר סיסמה חדשה לחשבון שלך.' },
  account: { title: '👤 החשבון שלי', submit: '', alt: '', note: 'הפרויקטים שלך נשמרים בענן ויופיעו בכל מכשיר שתתחבר ממנו.' },
};
function openAuth(mode) {
  authMode = mode;
  const m = AUTH_MODES[mode];
  A.title.textContent = m.title;
  A.note.textContent = m.note;
  A.err.textContent = ''; A.ok.textContent = '';
  A.form.hidden = mode === 'account';
  A.email.hidden = mode === 'newpass';
  A.pass.hidden = mode === 'reset';
  A.pass.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  A.submit.textContent = m.submit;
  A.alt.textContent = m.alt; A.alt.hidden = !m.alt;
  A.forgot.hidden = mode !== 'login';
  A.signOut.hidden = mode !== 'account';
  A.who.textContent = mode === 'account' ? cloud.user.email : '';
  if (!els.auth.open) els.auth.showModal();
  setTimeout(() => (mode === 'newpass' ? A.pass : A.email).focus(), 50);
}

els.accountBtn.onclick = () => openAuth(cloud.user ? 'account' : 'login');
A.alt.onclick = () => openAuth(authMode === 'login' ? 'signup' : 'login');
A.forgot.onclick = () => openAuth('reset');
$('authClose').onclick = () => els.auth.close();
A.signOut.onclick = async () => {
  A.signOut.disabled = true;
  const error = await cloud.signOut();
  A.signOut.disabled = false;
  if (error) { A.err.textContent = errorText(error); return; }
  els.auth.close();
};
A.form.onsubmit = async (e) => {
  e.preventDefault();
  const email = A.email.value.trim();
  const password = A.pass.value;
  A.err.textContent = ''; A.ok.textContent = '';
  if (authMode !== 'newpass' && !/^\S+@\S+\.\S+$/.test(email)) { A.err.textContent = 'כתוב כתובת מייל תקינה'; return; }
  if (authMode !== 'reset' && password.length < 6) { A.err.textContent = 'הסיסמה צריכה להיות לפחות 6 תווים'; return; }
  A.submit.disabled = true;
  try {
    if (authMode === 'login') {
      const error = await cloud.signIn(email, password);
      if (error) A.err.textContent = errorText(error); else els.auth.close();
    } else if (authMode === 'signup') {
      const res = await cloud.signUp(email, password);
      if (res.error) A.err.textContent = errorText(res.error);
      else if (res.needsConfirm) A.ok.textContent = '📧 שלחנו לך מייל. לחץ על הקישור שבו כדי לאשר את החשבון, ואז התחבר.';
      else els.auth.close();
    } else if (authMode === 'reset') {
      const error = await cloud.resetPassword(email);
      if (error) A.err.textContent = errorText(error); else A.ok.textContent = '📧 אם יש חשבון עם המייל הזה, נשלח אליו קישור.';
    } else if (authMode === 'newpass') {
      const error = await cloud.newPassword(password);
      if (error) A.err.textContent = errorText(error); else { A.ok.textContent = '✅ הסיסמה עודכנה'; setTimeout(() => els.auth.close(), 1200); }
    }
  } finally {
    A.submit.disabled = false;
  }
};

// ---------- start ----------
async function start() {
  if (cloud) {
    let user = null;
    try { user = await cloud.session(); } catch { /* offline: keep working locally */ }
    await setUser(user);
    cloud.onAuth((event, u) => {
      if ((u?.id ?? null) !== (cloud.user?.id ?? null)) setUser(u).then(() => { if (event === 'PASSWORD_RECOVERY') openAuth('newpass'); });
      else if (event === 'PASSWORD_RECOVERY') openAuth('newpass');
    });
  } else {
    projects = readLocal();
    openSaved();
    renderAccount();
  }
}
start();
