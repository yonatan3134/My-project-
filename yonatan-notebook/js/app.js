import { db, getSetting, setSetting, uid } from './db.js';
import { el, todayISO, fmtDate, fmtShort, nextMonday, pace, paceStart, addDays, sheetOrder, dayName, daysBetween, PACE_DAYS } from './util.js';
import { praise, special, STICKERS } from './celebrate.js';
import { award, summary, kindName } from './xp.js';

const APP_VERSION = '1.1';
const $app = document.getElementById('app');
let child = { first: 'יונתן', last: '' };
let sound = true;

// ---------- modules (home tiles) — add new practice areas here ----------
const MODULES = [
  { id: 'hw', icon: '📚', title: 'שיעורי בית', sub: '', open: () => openHomework() },
  { id: 'en', icon: '🇬🇧', title: 'אנגלית', sub: 'מילים, הקראה ודקדוק', open: async () => (await import('./english.js')).openEnglish(geoCtx()) },
  { id: 'exam', icon: '📝', title: 'מבחני מתמטיקה', sub: 'שלב אחרי שלב', open: async () => (await import('./exam.js')).openExam(geoCtx()) },
  { id: 'geo', icon: '📐', title: 'גאומטריה', sub: 'בניית הוכחות', open: async () => (await import('./geo.js')).openGeo(geoCtx()) },
  { id: 'py', icon: '🐍', title: 'פייתון', sub: 'מה יודפס?', open: async () => (await import('./python.js')).openPython(geoCtx()) },
  { id: 'focus', icon: '⏱️', title: 'פוקוס', sub: '', open: async () => (await import('./focus.js')).openFocus(geoCtx()) },
  { id: 'plan', icon: '🗓️', title: 'יומן ומשימות', sub: '', open: async () => (await import('./planner.js')).openPlanner(geoCtx()) },
  { id: 'stats', icon: '📊', title: 'ההתקדמות שלי', sub: '', open: async () => (await import('./planner.js')).openStats(geoCtx()) },
];
const NAV = [['home', '🏠', 'בית'], ['hw', '📚', 'שיעורים'], ['en', '🇬🇧', 'אנגלית'], ['focus', '⏱️', 'פוקוס'], ['stats', '📊', 'התקדמות']];
const NAV_GROUP = { geo: 'home', exam: 'home', py: 'home', plan: 'home' };
function openMod(id) { setNav(NAV_GROUP[id] || id); return id === 'home' ? home() : MODULES.find(m => m.id === id).open(); }
function setNav(id) { document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('nav-on', b.dataset.id === id)); }
function buildNav() {
  const nav = el('nav', { class: 'nav', id: 'nav' }, NAV.map(([id, ic, t]) => el('button', { class: 'nav-btn', 'data-id': id, onclick: () => openMod(id) }, el('span', { class: 'nav-ic' }, ic), el('span', { class: 'nav-t' }, t))));
  document.body.append(nav);
}
// theme: auto / dark / light
async function applyTheme(t) {
  t = t || await getSetting('theme', 'auto');
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0b1020' : '#f3f6ff');
}
// floating +XP, level-up and daily-goal celebrations
function xpFx(e) {
  const d = e.detail;
  const f = el('div', { class: 'xp-float' }, `+${d.xp} XP`); document.body.append(f); setTimeout(() => f.remove(), 1600);
  setTimeout(async () => {
    if (d.levelUp) await praise(child.first, '⚡', { sound, text: `עלית לרמה ${d.levelUp.n}!`, sub: d.levelUp.title });
    if (d.goalReached) await special('goal', child.first, 'עמדת ביעד היומי! אפשר לשלוח להורים מהמסך הראשי 📤', { sound });
  }, 900);
}

// helpers handed to feature modules (geometry, …)
const geoCtx = () => ({ screen, topbar, modal, toast, confirmBox, busy, home, child: () => child, sound: () => sound });

// ---------- helpers ----------
const lazy = {
  parser: () => import('./parser.js'),
  img: () => import('./imgproc.js'),
  pdf: () => import('./pdfgen.js'),
};
function screen(...kids) { document.querySelectorAll('.fab').forEach(f => f.remove()); $app.replaceChildren(...kids); window.scrollTo(0, 0); $app.scrollTo?.(0, 0); }
function topbar(title, back, extra) {
  return el('header', { class: 'topbar' },
    back ? el('button', { class: 'icon-btn', onclick: back, 'aria-label': 'חזרה' }, '→') : el('span'),
    el('h1', {}, title), extra || el('span'));
}
function modal(content, { wide = false, full = false, onClose } = {}) {
  const bg = el('div', { class: 'modal-bg' });
  const box = el('div', { class: 'modal' + (wide ? ' modal-wide' : '') + (full ? ' modal-full' : '') }, content);
  bg.append(box);
  let closed = false;
  const close = () => { if (closed) return; closed = true; bg.remove(); onClose && onClose(); };
  bg.addEventListener('click', e => { if (e.target === bg) close(); });
  document.body.append(bg);
  return close;
}
function toast(msg) {
  const t = el('div', { class: 'toast' }, msg); document.body.append(t);
  setTimeout(() => t.classList.add('show'), 10); setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 2800);
}
function confirmBox(msg, yes = 'כן', no = 'ביטול') {
  return new Promise(res => {
    let v = false;
    const close = modal(el('div', { class: 'confirm' }, el('p', {}, msg),
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: () => { v = true; close(); } }, yes),
        el('button', { class: 'btn btn-ghost', onclick: () => close() }, no))), { onClose: () => res(v) });
  });
}
function busy(msg) {
  const b = el('div', { class: 'busy' }, el('div', { class: 'spinner' }), el('div', {}, msg));
  document.body.append(b); return () => b.remove();
}
const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
const urls = new Set();
function blobUrl(b) { const u = URL.createObjectURL(b); urls.add(u); return u; }
function freeUrls() { for (const u of urls) URL.revokeObjectURL(u); urls.clear(); }
function openLink(url) {
  if (!url) return toast('אין קישור לזה בדף');
  if (!navigator.onLine) return toast('צריך אינטרנט כדי לפתוח את הקישור 🌐');
  window.open(url, '_blank', 'noopener');
}

async function loadSheets() {
  const all = await db.all('sheets');
  return all.sort((a, b) => (b.dueDate.localeCompare(a.dueDate)) || (b.created - a.created));
}
const ids = s => s.exerciseIds || (s.exerciseId ? [s.exerciseId] : []);
async function shotsOf(sheetId) {
  return (await db.byIndex('shots', 'sheetId', sheetId)).map(s => ({ ...s, exerciseIds: ids(s) })).sort((a, b) => a.created - b.created);
}
function doneMap(shots) {
  const m = new Map();
  for (const s of shots) for (const id of s.exerciseIds) if (!m.has(id)) m.set(id, s.date);
  return m;
}
function exInfo(sheet, exId) {
  const o = sheetOrder(sheet).find(o => o.ex.id === exId);
  return o ? { num: o.ex.num, page: o.group.page, table: o.table.title, star: o.ex.star, hint: o.ex.hint } : { num: '?', page: '', table: '' };
}
const numsOf = (sheet, list) => list.map(id => exInfo(sheet, id).num).join(', ');
function sheetLink(sheet, kind) {
  return (sheet.links || []).find(l => l.kind === kind)?.url || null;
}
async function videoUrl(sheet) { return (await getSetting('videoUrl', '')) || sheetLink(sheet, 'video'); }

// ---------- HOME ----------
async function home() {
  freeUrls();
  setNav('home');
  const sheets = (await loadSheets()).filter(s => !s.archived);
  const sub = {};
  sub.hw = 'אין עדיין דף פעיל';
  if (sheets[0]) {
    const p = pace(sheets[0], new Set(doneMap(await shotsOf(sheets[0].id)).keys()));
    sub.hw = `שיעור ${sheets[0].lesson || ''} · ${Math.round(p.ratio * 100)}% בוצע`;
  }
  try {
    const { EXERCISES } = await import('./geo-data.js');
    const gp = await getSetting('geoProgress', {}); const custom = await getSetting('geoCustom', []);
    const pg = (await (await import('./packs.js')).packGeo()).exercises.length;
    sub.geo = `${Object.values(gp).filter(x => x.solved).length} מתוך ${EXERCISES.length + pg + custom.length} הוכחות`;
  } catch { }
  try {
    const { PROBLEMS, EXAM_GEO } = await import('./exam-data.js');
    const ep = await getSetting('examProgress', {}), gp = await getSetting('geoProgress', {});
    const pk = await import('./packs.js');
    const allP = [...PROBLEMS, ...(await pk.packProblems())], allG = [...EXAM_GEO, ...(await pk.packGeo()).exercises.filter(e => e.chapter === 'exam').map(e => e.id)];
    sub.exam = `${allP.filter(p => ep[p.id]?.solved).length + allG.filter(g => gp[g]?.solved).length} מתוך ${allP.length + allG.length} שאלות`;
  } catch { }
  try { const t = await (await import('./python.js')).pyTotals(); sub.py = `${t.done} מתוך ${t.total} שאלות`; } catch { }
  try {
    const en = await import('./english.js'); const pr = await getSetting('enProgress', {});
    const lid = await getSetting('enList', 'unit1'); const lists = [en.UNIT1, ...(await getSetting('enLists', []))]; const l = lists.find(x => x.id === lid) || en.UNIT1;
    sub.en = `${l.words.filter(w => (pr[l.id]?.[w.en]?.box || 0) >= 3).length}/${l.words.length} מילים בכיס · ${l.title}`;
  } catch { }
  const pl = await import('./planner.js');
  const up = await pl.upcoming(3);
  sub.plan = up[0] ? `${up[0].title} · ${pl.whenText(up[0].date)}` : 'אין משימות פתוחות';
  const s = await summary();
  sub.stats = `רמה ${s.level.n} · ${s.total} XP`;
  const fr = await getSetting('focusRun', null);
  sub.focus = fr ? (fr.phase === 'work' ? '🟢 סשן רץ עכשיו' : '☕ בהפסקה') : '25 דקות של ריכוז מלא';

  const today = todayISO();
  const done = s.today.xp >= s.goal;
  const parts = Object.entries(s.today.n || {}).map(([k, n]) => `${kindName(k)}: ${n}`);
  const shareToday = async () => {
    const text = `היי! זה ${child.first} 😊\nהיום (${fmtDate(today)}) הרווחתי ${s.today.xp} XP${parts.length ? ` (${parts.join(', ')})` : ''}${s.streak > 1 ? ` · ${s.streak} ימים ברצף 🔥` : ''}.\nעמדתי ביעד היומי ✅ אפשר זמן מסך? 🙏`;
    try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { if (e.name === 'AbortError') return; }
    location.href = 'https://wa.me/?text=' + encodeURIComponent(text);
  };
  const h = new Date().getHours();
  const hello = h < 5 ? 'לילה טוב' : h < 12 ? 'בוקר טוב' : h < 17 ? 'צהריים טובים' : 'ערב טוב';
  const goalRing = el('div', { class: 'ring', style: `--p:${Math.min(100, s.today.xp / s.goal * 100)}` },
    el('div', { class: 'ring-in' }, el('b', {}, s.today.xp), el('small', {}, `/ ${s.goal} XP`)));
  screen(
    el('header', { class: 'hero' },
      el('div', {}, el('div', { class: 'hero-hello' }, `${hello}, ${child.first}! 👋`),
        el('div', { class: 'hero-date' }, `יום ${dayName(today)}, ${fmtDate(today)}`)),
      el('div', { class: 'hero-side' },
        el('button', { class: 'pill', onclick: () => openMod('stats') }, `🔥 ${s.streak}`),
        el('button', { class: 'pill pill-lvl', onclick: () => openMod('stats') }, `⚡ רמה ${s.level.n}`),
        el('button', { class: 'icon-btn', onclick: settingsScreen, 'aria-label': 'הגדרות' }, '⚙️'))),
    el('div', { class: 'dash' },
      el('div', { class: 'dash-side' },
        el('section', { class: 'card goal-card' + (done ? ' goal-done' : '') }, goalRing,
          el('div', { class: 'grow grid' },
            el('b', { class: 'goal-title' }, done ? '🎉 עמדת ביעד! הרווחת זמן מסך' : s.today.xp ? 'ממשיכים! עוד קצת ליעד' : 'היי, עוד לא התחלנו היום 😉'),
            el('div', { class: 'muted' }, done ? 'אפשר לשלוח להורים מה עשית היום' : `חסרים ${Math.max(0, s.goal - s.today.xp)} XP. כל תשובה נכונה, תרגיל ודקת פוקוס נספרים.`),
            el('div', { class: 'xp-bar' }, el('div', { class: 'xp-fill', style: `width:${s.level.ratio * 100}%` }), el('span', {}, `רמה ${s.level.n} · ${s.level.title} · ${s.level.into}/${s.level.need}`)),
            el('div', { class: 'row row-start' },
              done ? el('button', { class: 'btn', onclick: shareToday }, '📤 לשלוח להורים') : el('button', { class: 'btn', onclick: () => openMod('focus') }, '⏱️ סשן פוקוס'),
              el('button', { class: 'btn btn-ghost', onclick: async () => (await import('./focus.js')).phoneGuide(geoCtx()) }, '🔒 חסימת טיקטוק')))),
        el('section', { class: 'card up-card' }, el('div', { class: 'up-head' }, el('h3', {}, '🗓️ בקרוב'), el('button', { class: 'link-btn', onclick: () => openMod('plan') }, 'הכול ←')),
          up.length ? up.map(x => el('div', { class: 'up-row' + (daysBetween(today, x.date) <= 2 ? ' up-soon' : '') }, el('b', {}, (x.kind === 'test' ? '📝 ' : '✅ ') + x.title), el('span', {}, pl.whenText(x.date))))
            : el('p', { class: 'muted' }, 'אין כלום פתוח 🎉'))),
      el('main', { class: 'tiles' }, MODULES.map(m => el('button', { class: `tile tile-${m.id}`, onclick: () => openMod(m.id) },
        el('div', { class: 'tile-icon' }, m.icon), el('div', { class: 'tile-title' }, m.title), el('div', { class: 'tile-sub' }, sub[m.id] || m.sub))))),
  );
}

// ---------- HOMEWORK DASHBOARD ----------
let currentSheetId = null;
async function openHomework(id) {
  freeUrls();
  const sheets = (await loadSheets()).filter(s => !s.archived);
  if (!sheets.length) return emptyHomework();
  const sheet = sheets.find(s => s.id === (id || currentSheetId)) || sheets[0];
  currentSheetId = sheet.id;
  if (!sheet.links) { // sheets imported before links were supported
    try { const { extractLinks } = await lazy.parser(); sheet.links = await extractLinks(sheet.pdfBytes); await db.put('sheets', sheet); } catch { sheet.links = []; }
  }
  const shots = await shotsOf(sheet.id);
  const done = doneMap(shots);
  const p = pace(sheet, new Set(done.keys()));
  const stickers = await getSetting('stickers', []);
  const daysLeft = daysBetween(todayISO(), sheet.dueDate);
  const start = paceStart(sheet);

  const pct = Math.round(p.ratio * 100), exp = Math.round(p.expected * 100);
  const status = {
    complete: ['🏆', 'סיימת את כל הדף! איזה אלוף!'],
    ahead: ['🚀', 'אתה מקדים את הקצב!'],
    onpace: ['🎯', p.day === 0 ? 'עוד לא התחילו ימי העבודה. כל תרגיל עכשיו הוא בונוס!' : 'אתה בדיוק בקצב!'],
    behind: ['💪', p.missing === 1 ? 'עוד תרגיל אחד וזהו, אתה בקצב של היום' : `עוד ${p.missing} תרגילים ואתה בקצב של היום`],
  }[p.level];

  const ring = el('div', { class: 'ring', style: `--p:${pct}` }, el('div', { class: 'ring-in' }, el('b', {}, `${pct}%`), el('small', {}, `${p.done}/${p.total}`)));
  const paceBar = el('div', { class: 'pacebar' },
    el('div', { class: 'pacebar-fill', style: `width:${pct}%` }),
    el('div', { class: 'pacebar-mark', style: `right:${exp}%` }, el('span', {}, `מצופה עד סוף היום: ${exp}%`)));

  const board = el('div', { class: 'board' }, sheet.tables.map(t => el('section', { class: 'tbl' },
    el('h3', {}, t.title),
    t.groups.map(g => el('div', { class: 'grp' },
      el('div', { class: 'grp-page' }, el('small', {}, 'עמ\''), g.page),
      el('div', { class: 'chips' }, g.exercises.map(e => {
        const d = done.get(e.id);
        return el('button', { class: 'chip' + (d ? ' chip-done' : ''), onclick: () => exerciseMenu(sheet, e.id, !!d) },
          el('span', { class: 'chip-num' }, e.num), e.star ? el('i', { title: 'יש סרטון פתרון' }, '🎬') : null, e.hint ? el('i', { title: 'יש רמזים' }, '💡') : null,
          d ? el('span', { class: 'chip-date' }, '✓ ' + fmtShort(d)) : null);
      })))))));

  const tabs = el('nav', { class: 'tabs' },
    sheets.map(s => el('button', { class: 'tab' + (s.id === sheet.id ? ' tab-on' : ''), onclick: () => openHomework(s.id) }, `שיעור ${s.lesson || '?'}`)),
    el('button', { class: 'tab tab-add', onclick: importFlow }, '+ דף חדש'));

  const vurl = await videoUrl(sheet);
  const links = [...(sheet.links || [])];
  if (vurl && !links.some(l => l.url === vurl)) links.unshift({ label: 'סרטוני פתרון', url: vurl, kind: 'video' });
  const linkIcon = { video: '🎬', hints: '💡', zoom: '🧑‍🏫', other: '🔗' };

  screen(
    topbar('שיעורי בית', home),
    tabs,
    el('main', { class: 'hw' },
      el('section', { class: 'card summary' },
        ring,
        el('div', { class: 'summary-body' },
          el('div', { class: 'status' }, el('span', { class: 'status-icon' }, status[0]), status[1]),
          paceBar,
          el('div', { class: 'meta' },
            el('span', {}, p.rawDay < 1 ? `ימי העבודה: ${fmtShort(start)}–${fmtShort(addDays(sheet.dueDate, -1))}` : `יום ${p.day} מתוך ${PACE_DAYS}`),
            el('span', {}, `הגשה: יום ${dayName(sheet.dueDate)} ${fmtShort(sheet.dueDate)}` + (daysLeft > 0 ? ` (עוד ${daysLeft} ימים)` : daysLeft === 0 ? ' (היום!)' : ''))))),
      el('div', { class: 'actions' },
        el('button', { class: 'btn btn-big btn-cam', onclick: () => captureFlow(sheet) }, '📸 צילמתי תרגילים'),
        el('button', { class: 'btn btn-big btn-doc', onclick: () => submissionScreen(sheet) }, '📄 מסמך להגשה')),
      board,
      links.length ? el('section', { class: 'card links' }, el('h3', {}, '🔗 קישורים מהדף ', el('small', { class: 'muted' }, '(צריך אינטרנט)')),
        el('div', { class: 'link-row' }, links.map(l => el('button', { class: 'chip chip-link', onclick: () => openLink(l.url) }, `${linkIcon[l.kind] || '🔗'} ${l.label}`)))) : null,
      el('section', { class: 'card stickers' }, el('h3', {}, `האוסף שלי (${stickers.length})`),
        el('div', { class: 'sticker-row' }, stickers.length ? stickers.slice(-80).map(s => el('span', {}, s.e)) : el('small', {}, 'כל תרגיל שתסגור יביא לך מדבקה 🎁'))),
    ));
}

function emptyHomework() {
  screen(topbar('שיעורי בית', home),
    el('main', { class: 'empty' },
      el('div', { class: 'empty-icon' }, '📄'),
      el('h2', {}, 'עוד אין דף שיעורי בית'),
      el('p', {}, 'מוסיפים את קובץ ה-PDF שהמורה שלחה, והאפליקציה תבנה ממנו את רשימת התרגילים.'),
      el('button', { class: 'btn btn-big', onclick: importFlow }, '+ הוספת דף חדש')));
}

// exercise action sheet
async function exerciseMenu(sheet, exId, isDone) {
  const I = exInfo(sheet, exId);
  const vurl = I.star ? await videoUrl(sheet) : null;
  const hurl = I.hint ? sheetLink(sheet, 'hints') : null;
  let hh = null; try { hh = await (await import('./packs.js')).hwHints(I.page, I.num); } catch { }
  const close = modal(el('div', { class: 'exmenu' },
    el('h2', {}, `תרגיל ${I.num}`), el('p', { class: 'muted center' }, `${I.table} · עמ' ${I.page}`),
    el('button', { class: 'btn btn-big btn-cam', onclick: () => { close(); captureFlow(sheet, exId); } }, isDone ? '📸 צילום המשך לתרגיל' : '📸 צילום התרגיל'),
    isDone ? el('button', { class: 'btn btn-big btn-ghost', onclick: () => { close(); viewExercise(sheet, exId); } }, '👀 מה צילמתי') : null,
    hh ? el('button', { class: 'btn btn-big btn-hint', onclick: () => { close(); import('./packs.js').then(m => m.hintLadder({ modal }, `תרגיל ${I.num} – איך מתחילים?`, hh)); } }, '🧭 איך מתחילים? (רמזים בלי אינטרנט)') : null,
    I.star ? el('button', { class: 'btn btn-big btn-ghost', onclick: () => openLink(vurl) }, '🎬 סרטון פתרון') : null,
    I.hint ? el('button', { class: 'btn btn-big btn-ghost', onclick: () => openLink(hurl) }, '💡 רמזים') : null,
    I.star || I.hint ? el('p', { class: 'muted center' }, 'סרטונים ורמזים מהאתר עובדים רק כשיש אינטרנט') : null));
}


// ---------- IMPORT ----------
function importFlow() {
  const inp = el('input', { type: 'file', accept: 'application/pdf,.pdf', style: 'display:none' });
  inp.addEventListener('change', async () => {
    const f = inp.files[0]; if (!f) return;
    const stop = busy('קורא את הדף…');
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const { parseSheet } = await lazy.parser();
      const parsed = await parseSheet(bytes);
      stop();
      reviewImport(bytes, parsed, f.name);
    } catch (e) { stop(); console.error(e); toast('לא הצלחתי לקרוא את הקובץ. האם זה PDF?'); }
  });
  document.body.append(inp); inp.click(); setTimeout(() => inp.remove(), 60000);
}

function reviewImport(bytes, parsed, fname) {
  const received = todayISO();
  const st = {
    lesson: parsed.lesson || ((fname.match(/(\d+)/) || [])[1] || ''),
    receivedDate: received, dueDate: nextMonday(received),
    tables: structuredClone(parsed.tables),
  };
  const recInp = el('input', { type: 'date', value: st.receivedDate });
  const dueInp = el('input', { type: 'date', value: st.dueDate });
  const startNote = el('small', { class: 'muted' });
  const updNote = () => { startNote.textContent = `6 ימי העבודה: ${fmtShort(addDays(st.dueDate, -6))}–${fmtShort(addDays(st.dueDate, -1))}`; };
  recInp.addEventListener('change', () => { st.receivedDate = recInp.value; st.dueDate = nextMonday(recInp.value); dueInp.value = st.dueDate; updNote(); });
  dueInp.addEventListener('change', () => { st.dueDate = dueInp.value; updNote(); });
  updNote();
  const lessonInp = el('input', { type: 'text', inputmode: 'numeric', value: st.lesson, class: 'short' });
  const editor = el('div', { class: 'editor' });

  const drawEditor = () => {
    editor.replaceChildren(
      ...st.tables.map((t, ti) => el('section', { class: 'tbl' },
        el('h3', {}, t.title),
        t.groups.map((g, gi) => {
          const add = el('input', { type: 'text', placeholder: '+ מס\'', class: 'add-ex', inputmode: 'text' });
          const addEx = () => {
            const v = add.value.trim(); const num = (v.match(/\d+/) || [])[0]; if (!num) return;
            g.exercises.push({ id: `m${uid()}`, num, star: v.includes('*'), hint: v.includes('#'), box: null, below: null });
            drawEditor();
          };
          add.addEventListener('keydown', e => { if (e.key === 'Enter') addEx(); });
          return el('div', { class: 'grp' },
            el('div', { class: 'grp-page' }, el('small', {}, 'עמ\''), g.page),
            el('div', { class: 'chips' },
              g.exercises.map((e, ei) => el('button', { class: 'chip chip-edit', onclick: () => { g.exercises.splice(ei, 1); if (!g.exercises.length) t.groups.splice(gi, 1); if (!t.groups.length) st.tables.splice(ti, 1); drawEditor(); } },
                el('span', { class: 'chip-num' }, e.num + (e.star ? '*' : '') + (e.hint ? '#' : '')), el('span', { class: 'chip-x' }, '✕'))),
              add, el('button', { class: 'chip chip-plus', onclick: addEx }, '+')));
        }))),
      el('button', { class: 'btn btn-ghost', onclick: () => {
        const page = prompt('מספרי עמודים (למשל 150-152):'); if (!page) return;
        const nums = prompt('תרגילים מופרדים בפסיקים (למשל 1, 4*, 7#):') || '';
        const exs = nums.split(/[,\s]+/).filter(x => /\d/.test(x)).map(x => ({ id: `m${uid()}`, num: x.match(/\d+/)[0], star: x.includes('*'), hint: x.includes('#'), box: null, below: null }));
        if (!st.tables.length) st.tables.push({ id: `m${uid()}`, title: 'תרגילים', groups: [] });
        st.tables[st.tables.length - 1].groups.push({ id: `m${uid()}`, page, exercises: exs, when: null });
        drawEditor();
      } }, '+ קבוצת עמודים'),
    );
  };
  drawEditor();
  const total = () => st.tables.reduce((a, t) => a + t.groups.reduce((b, g) => b + g.exercises.length, 0), 0);

  screen(topbar('דף חדש', () => openHomework()),
    el('main', { class: 'import' },
      el('div', { class: 'import-preview' }, el('img', { src: blobUrl(parsed.previewBlob), alt: 'הדף' })),
      el('div', { class: 'import-form card' },
        parsed.tables.length ? el('p', { class: 'ok' }, `✓ זיהיתי ${total()} תרגילים. אפשר לתקן: לחיצה על תרגיל מוחקת אותו, ו-+ מוסיף.`)
          : el('p', { class: 'warn' }, 'לא הצלחתי לזהות טבלאות בדף הזה. אפשר להוסיף את התרגילים ידנית.'),
        el('label', {}, 'מספר שיעור ', lessonInp),
        el('label', {}, 'תאריך קבלת הדף ', recInp),
        el('label', {}, 'תאריך הגשה ', dueInp),
        startNote,
        editor,
        el('button', { class: 'btn btn-big', onclick: async () => {
          if (!total()) return toast('צריך לפחות תרגיל אחד');
          const sheet = {
            id: uid(), created: Date.now(), archived: false, lesson: lessonInp.value.trim(), fileName: fname,
            receivedDate: st.receivedDate, dueDate: st.dueDate, tables: st.tables, fields: parsed.fields, links: parsed.links || [],
            pageSize: parsed.pageSize, pdfBytes: bytes, previewBlob: parsed.previewBlob, submission: null,
          };
          await db.put('sheets', sheet);
          currentSheetId = sheet.id;
          toast('הדף נשמר! בהצלחה 🍀');
          openHomework(sheet.id);
        } }, 'שמירה ✓'))));
}

// ---------- EXERCISE PICKER (multi-select) ----------
function pickExercises(sheet, done, inSession, preselect = []) {
  return new Promise(res => {
    const sel = new Set(preselect);
    let result = null;
    const okBtn = el('button', { class: 'btn btn-big', onclick: () => { result = [...sel]; close(); } });
    const upd = () => { okBtn.disabled = !sel.size; okBtn.textContent = sel.size > 1 ? `אישור (${sel.size} תרגילים)` : 'אישור'; };
    const close = modal(el('div', { class: 'picker' },
      el('h2', {}, 'אילו תרגילים במלבן הזה?'),
      el('p', { class: 'muted center' }, 'אפשר לבחור כמה תרגילים. תרגיל שכבר צולם יקבל את התמונה כהמשך.'),
      sheet.tables.map(t => el('section', { class: 'tbl' }, el('h3', {}, t.title),
        t.groups.map(g => el('div', { class: 'grp' },
          el('div', { class: 'grp-page' }, el('small', {}, 'עמ\''), g.page),
          el('div', { class: 'chips' }, g.exercises.map(e => {
            const b = el('button', {
              class: 'chip' + (done.has(e.id) ? ' chip-done' : '') + (sel.has(e.id) ? ' chip-sel' : ''),
              onclick: () => { sel.has(e.id) ? sel.delete(e.id) : sel.add(e.id); b.classList.toggle('chip-sel'); upd(); },
            }, el('span', { class: 'chip-num' }, e.num),
              (done.has(e.id) || inSession.has(e.id)) ? el('span', { class: 'chip-date' }, 'המשך') : null);
            return b;
          })))))),
      el('div', { class: 'row sticky-bottom' }, okBtn, el('button', { class: 'btn btn-ghost', onclick: () => close() }, 'ביטול'))),
      { wide: true, onClose: () => res(result) });
    upd();
  });
}

// ---------- CAPTURE FLOW ----------
function chooseSource(title = 'מאיפה התמונה?') {
  return new Promise(res => {
    let fileP = null;
    const pick = (cap) => {
      const inp = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
      if (cap) inp.setAttribute('capture', 'environment');
      fileP = new Promise(r => inp.addEventListener('change', () => { r(inp.files[0] || null); inp.remove(); }));
      document.body.append(inp); inp.click();
      close();
    };
    const close = modal(el('div', { class: 'confirm' }, el('h2', {}, title),
      el('div', { class: 'row' },
        el('button', { class: 'btn btn-big', onclick: () => pick(true) }, '📸 מצלמה'),
        el('button', { class: 'btn btn-big btn-ghost', onclick: () => pick(false) }, '🖼️ מהגלריה'))),
      { onClose: () => res(fileP ? fileP : null) });
  });
}

async function captureFlow(sheet, presetEx, replaceShot = null) {
  const file = await chooseSource(replaceShot ? 'צילום מחדש' : 'מאיפה התמונה?');
  if (!file) return;
  const IP = await lazy.img();
  let stop = busy('טוען את התמונה…');
  const photos = [{ base: await IP.fileToCanvas(file), rects: [] }];
  stop();
  const done = doneMap(await shotsOf(sheet.id));
  let cur = 0;
  const sessionIds = () => new Set(photos.flatMap(p => p.rects.flatMap(r => r.exIds)));

  const view = el('canvas', { class: 'cap-canvas' });
  const wrap = el('div', { class: 'cap-wrap' }, view);
  const list = el('div', { class: 'cap-list' });
  const ptabs = el('div', { class: 'ptabs' });
  const hint = el('div', { class: 'cap-hint' }, replaceShot
    ? `צילום מחדש של ${replaceShot.exerciseIds.length > 1 ? 'תרגילים' : 'תרגיל'} ${numsOf(sheet, replaceShot.exerciseIds)}: גוררים מלבן סביב התרגיל (או "כל התמונה")`
    : 'גוררים עם האצבע מלבן סביב תרגיל (או כמה תרגילים) ובוחרים את המספרים');
  let scale = 1, drag = null;
  const P = () => photos[cur];

  const fit = () => {
    const maxW = wrap.clientWidth || innerWidth - 32, maxH = Math.max(300, innerHeight - 300);
    scale = Math.min(maxW / P().base.width, maxH / P().base.height);
    view.width = Math.round(P().base.width * scale); view.height = Math.round(P().base.height * scale);
    draw();
  };
  const draw = () => {
    const ctx = view.getContext('2d');
    ctx.drawImage(P().base, 0, 0, view.width, view.height);
    const all = drag ? [...P().rects, { ...drag, exIds: null }] : P().rects;
    for (const r of all) {
      const x = r.x * scale, y = r.y * scale, w = r.w * scale, h = r.h * scale;
      ctx.fillStyle = 'rgba(80,140,255,0.14)'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#2f6bff'; ctx.lineWidth = 3; ctx.setLineDash(r.exIds ? [] : [8, 6]); ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
      if (r.exIds) {
        const t = numsOf(sheet, r.exIds);
        ctx.font = 'bold 22px sans-serif'; const tw = ctx.measureText(t).width + 18;
        ctx.fillStyle = '#2f6bff'; ctx.fillRect(x + w - tw, y, tw, 30);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(t, x + w - tw / 2, y + 22); ctx.textAlign = 'start';
      }
    }
  };
  const drawLists = () => {
    if (replaceShot) ptabs.replaceChildren(); else ptabs.replaceChildren(
      ...photos.map((p, i) => el('button', { class: 'tab' + (i === cur ? ' tab-on' : ''), onclick: () => { cur = i; drawLists(); fit(); } },
        `דף ${i + 1}` + (p.rects.length ? ` (${p.rects.length})` : ''))),
      el('button', { class: 'tab tab-add', onclick: addPhoto }, '📸 עוד דף (המשך)'));
    list.replaceChildren(...photos.flatMap((p, pi) => p.rects.map((r, i) => el('button', { class: 'chip chip-edit', onclick: () => { p.rects.splice(i, 1); drawLists(); draw(); } },
      el('span', { class: 'chip-num' }, `${photos.length > 1 ? `דף ${pi + 1}: ` : ''}${r.exIds.length > 1 ? 'תרגילים' : 'תרגיל'} ${numsOf(sheet, r.exIds)}`), el('span', { class: 'chip-x' }, '✕')))));
    nextBtn.disabled = !photos.some(p => p.rects.length);
  };
  const assign = async (r) => {
    if (replaceShot) { P().rects = [{ ...r, exIds: replaceShot.exerciseIds }]; drawLists(); draw(); return; }
    const preset = presetEx && !sessionIds().has(presetEx) ? [presetEx] : [];
    const exIds = await pickExercises(sheet, done, sessionIds(), preset);
    if (exIds && exIds.length) { r.exIds = exIds; P().rects.push(r); }
    drawLists(); draw();
  };
  const addPhoto = async () => {
    const f = await chooseSource('צילום דף נוסף');
    if (!f) return;
    const s = busy('טוען…');
    photos.push({ base: await IP.fileToCanvas(f), rects: [] });
    s(); cur = photos.length - 1; drawLists(); fit();
    toast('סמן את ההמשך ובחר את אותו מספר תרגיל');
  };
  const pos = (e) => { const b = view.getBoundingClientRect(); return { x: (e.clientX - b.left) / scale, y: (e.clientY - b.top) / scale }; };
  view.addEventListener('pointerdown', e => { e.preventDefault(); view.setPointerCapture(e.pointerId); const p = pos(e); drag = { x0: p.x, y0: p.y, x: p.x, y: p.y, w: 0, h: 0 }; });
  view.addEventListener('pointermove', e => {
    if (!drag) return; const p = pos(e); const B = P().base;
    drag.x = Math.max(0, Math.min(drag.x0, p.x)); drag.y = Math.max(0, Math.min(drag.y0, p.y));
    drag.w = Math.min(B.width, Math.max(drag.x0, p.x)) - drag.x; drag.h = Math.min(B.height, Math.max(drag.y0, p.y)) - drag.y; draw();
  });
  view.addEventListener('pointerup', () => {
    if (!drag) return; const r = drag; drag = null; draw();
    if (r.w * scale > 40 && r.h * scale > 30) assign({ x: r.x, y: r.y, w: r.w, h: r.h });
  });
  view.addEventListener('pointercancel', () => { drag = null; draw(); });

  const rot = async (d) => {
    if (P().rects.length && !(await confirmBox('סיבוב ימחק את הסימונים בדף הזה. להמשיך?'))) return;
    P().rects = []; P().base = IP.rotate(P().base, d); drawLists(); fit();
  };
  const nextBtn = el('button', { class: 'btn btn-big', disabled: true, onclick: () => {
    const items = [];
    for (const p of photos) for (const r of p.rects) items.push({ exIds: r.exIds, crop: IP.crop(p.base, r), replaceShot });
    enhanceStep(sheet, items, done);
  } }, 'המשך ←');

  screen(topbar(replaceShot ? 'צילום מחדש' : 'סימון תרגילים', () => openHomework(sheet.id)),
    el('main', { class: 'cap' },
      ptabs,
      el('div', { class: 'cap-tools' },
        el('button', { class: 'btn btn-ghost', onclick: () => rot(-90) }, '↺ סיבוב'),
        el('button', { class: 'btn btn-ghost', onclick: () => rot(90) }, '↻ סיבוב'),
        el('button', { class: 'btn btn-ghost', onclick: () => rot(180) }, '⇅ הפוך'),
        el('button', { class: 'btn btn-ghost', onclick: () => assign({ x: 0, y: 0, w: P().base.width, h: P().base.height }) }, '⬚ כל התמונה')),
      hint, wrap, list, nextBtn));
  drawLists();
  requestAnimationFrame(fit);
}

// ---------- STEP 2: sharpen / clean ----------
const LEVELS = ['בלי', 'קל', 'בינוני', 'חזק'];
async function enhanceStep(sheet, items, done) {
  const IP = await lazy.img();
  const saved = await getSetting('enhOpts', IP.DEFAULT_OPTS);
  const stop = busy('משפר את התמונות…');
  for (const it of items) {
    if (!it.prev) {
      // keep memory sane on tablets: at most ~4.5MP per exercise image
      const px = it.crop.width * it.crop.height, lim = 4.5e6;
      if (px > lim) it.crop = IP.scaleCanvas(it.crop, Math.round(it.crop.width * Math.sqrt(lim / px)));
      it.prev = IP.scaleCanvas(it.crop, 1000);
      it.opts = it.opts || { ...saved };
    }
    await nextFrame();
    it.enhPrev = IP.enhance(it.prev, it.opts);
  }
  stop();

  const cards = items.map(it => {
    const cv = el('canvas', { class: 'rev-canvas' });
    const paint = (src) => { const c = cv.getContext('2d'); cv.width = src.width; cv.height = src.height; c.drawImage(src, 0, 0); };
    paint(it.enhPrev);
    let timer;
    const rerender = () => { clearTimeout(timer); timer = setTimeout(() => { it.enhPrev = IP.enhance(it.prev, it.opts); it.erase = undefined; paint(it.enhPrev); }, 60); };
    const seg = (key, label) => el('div', { class: 'seg-row' }, el('span', { class: 'seg-label' }, label),
      el('div', { class: 'seg' }, LEVELS.map((t, v) => {
        const b = el('button', { class: 'seg-btn' + (it.opts[key] === v ? ' seg-on' : ''), onclick: () => {
          it.opts[key] = v; b.parentElement.querySelectorAll('.seg-btn').forEach((x, i) => x.classList.toggle('seg-on', i === v)); rerender();
        } }, t);
        return b;
      })));
    const cmp = el('button', { class: 'btn btn-ghost' }, '👆 החזק לראות את המקור');
    cmp.addEventListener('pointerdown', () => paint(it.prev));
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => cmp.addEventListener(ev, () => paint(it.enhPrev)));
    const all = el('button', { class: 'link-btn' }, 'החלה על כל התמונות');
    all.addEventListener('click', () => { for (const o of items) if (o !== it) { o.opts = { ...it.opts }; o.erase = undefined; } enhanceStep(sheet, items, done); });
    return el('section', { class: 'card rev' },
      el('h3', {}, `${it.exIds.length > 1 ? 'תרגילים' : 'תרגיל'} ${numsOf(sheet, it.exIds)}`),
      el('div', { class: 'rev-cols' },
        el('div', { class: 'rev-wrap' }, cv),
        el('div', { class: 'rev-ctrl' },
          seg('clean', '🧽 ניקוי רקע'), seg('contrast', '🖊️ כהות הכתב'), seg('sharp', '🔍 חדות'),
          cmp, items.length > 1 ? all : null)));
  });

  screen(topbar('חידוד התמונה', () => captureBack(sheet)),
    el('main', { class: 'review' },
      el('p', { class: 'muted center' }, 'בחר איך התמונה נראית הכי ברורה. הכתב שלך לא משתנה, רק הניקיון והחדות.'),
      el('p', { class: 'center' }, el('button', { class: 'link-btn', onclick: async () => (await import('./handwriting.js')).openHandwriting(geoCtx(), async () => { const o = await getSetting('enhOpts', null); if (o) for (const it of items) { it.opts = { ...o }; it.erase = undefined; } enhanceStep(sheet, items, done); }) }, '✍️ לכוון את הניקוי לכתב שלך')),
      cards,
      el('button', { class: 'btn btn-big', onclick: async () => { await setSetting('enhOpts', items[items.length - 1].opts); eraseStep(sheet, items, done); } }, 'המשך למחיקות ←')));
}
function captureBack(sheet) { confirmBox('לצאת בלי לשמור?', 'יציאה', 'להישאר').then(y => y && openHomework(sheet.id)); }

// ---------- STEP 3: erasures ----------
function makeEraseEditor(it, onChange) {
  const cv = el('canvas', { class: 'rev-canvas erase-canvas' });
  let ds = 1, mode = 'draw', act = null;
  const HR = 18; // handle radius in screen px
  const k = () => { const b = cv.getBoundingClientRect(); return b.width ? cv.width / b.width : 1; };
  const setSize = (w) => { cv.width = Math.max(50, Math.round(w)); ds = cv.width / it.crop.width; cv.height = Math.round(it.crop.height * ds); draw(); };
  const draw = () => {
    const c = cv.getContext('2d');
    c.drawImage(it.enhPrev, 0, 0, cv.width, cv.height);
    const sc = k();
    for (const r of it.erase) {
      const x = r.x * ds, y = r.y * ds, w = r.w * ds, h = r.h * ds;
      c.fillStyle = 'rgba(255,60,90,0.32)'; c.fillRect(x, y, w, h);
      c.strokeStyle = '#e0244a'; c.lineWidth = 2 * sc; c.strokeRect(x, y, w, h);
      const hr = HR * sc * 0.75;
      // delete handle (top-left) and resize handle (bottom-right)
      c.fillStyle = '#e0244a'; c.beginPath(); c.arc(x, y, hr, 0, 7); c.fill();
      c.strokeStyle = '#fff'; c.lineWidth = 2.5 * sc; c.beginPath();
      c.moveTo(x - hr * 0.45, y - hr * 0.45); c.lineTo(x + hr * 0.45, y + hr * 0.45); c.moveTo(x + hr * 0.45, y - hr * 0.45); c.lineTo(x - hr * 0.45, y + hr * 0.45); c.stroke();
      c.fillStyle = '#fff'; c.strokeStyle = '#e0244a'; c.lineWidth = 2 * sc;
      c.fillRect(x + w - hr * 0.8, y + h - hr * 0.8, hr * 1.6, hr * 1.6); c.strokeRect(x + w - hr * 0.8, y + h - hr * 0.8, hr * 1.6, hr * 1.6);
    }
  };
  const pos = e => { const b = cv.getBoundingClientRect(); const s = cv.width / b.width; return { x: (e.clientX - b.left) * s / ds, y: (e.clientY - b.top) * s / ds }; };
  cv.addEventListener('pointerdown', e => {
    if (mode !== 'draw') return;
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    const p = pos(e); const R = HR * k() / ds;
    for (let i = it.erase.length - 1; i >= 0; i--) {
      const r = it.erase[i];
      if (Math.hypot(p.x - r.x, p.y - r.y) < R) { it.erase.splice(i, 1); draw(); onChange && onChange(); return; }
      if (Math.hypot(p.x - (r.x + r.w), p.y - (r.y + r.h)) < R) { act = { t: 'size', r }; return; }
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) { act = { t: 'move', r, dx: p.x - r.x, dy: p.y - r.y }; return; }
    }
    const r = { x: p.x, y: p.y, w: 0, h: 0, on: true }; it.erase.push(r); act = { t: 'new', r, x0: p.x, y0: p.y };
  });
  cv.addEventListener('pointermove', e => {
    if (!act) return; const p = pos(e); const r = act.r; const W = it.crop.width, H = it.crop.height;
    if (act.t === 'new') { r.x = Math.max(0, Math.min(act.x0, p.x)); r.y = Math.max(0, Math.min(act.y0, p.y)); r.w = Math.min(W, Math.max(act.x0, p.x)) - r.x; r.h = Math.min(H, Math.max(act.y0, p.y)) - r.y; }
    else if (act.t === 'move') { r.x = Math.max(0, Math.min(W - r.w, p.x - act.dx)); r.y = Math.max(0, Math.min(H - r.h, p.y - act.dy)); }
    else { r.w = Math.max(6, Math.min(W - r.x, p.x - r.x)); r.h = Math.max(6, Math.min(H - r.y, p.y - r.y)); }
    draw();
  });
  const end = () => {
    if (!act) return;
    if (act.t === 'new' && (act.r.w * ds / k() < 10 || act.r.h * ds / k() < 10)) it.erase.splice(it.erase.indexOf(act.r), 1);
    act = null; draw(); onChange && onChange();
  };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  const setMode = m => { mode = m; cv.style.touchAction = m === 'draw' ? 'none' : 'pan-x pan-y'; };
  setMode('draw');
  return { cv, setSize, draw, setMode };
}

async function finalCanvas(it, IP) {
  const f = it.enhPrev.width / it.crop.width;
  return IP.compact(IP.whiteOut(it.enhPrev, it.erase.map(r => ({ x: r.x * f, y: r.y * f, w: r.w * f, h: r.h * f, on: true }))));
}

async function eraseStep(sheet, items, done) {
  const IP = await lazy.img();
  for (const it of items) if (!it.erase) {
    const f = it.crop.width / it.enhPrev.width;
    it.erase = IP.detectErasures(it.enhPrev, (await getSetting('handProfile', null)) || {}).map(r => ({ x: r.x * f, y: r.y * f, w: r.w * f, h: r.h * f, on: true }));
    it.autoErase = it.erase.map(r => ({ ...r }));
  }
  const editors = [];
  const cards = items.map(it => {
    const ed = makeEraseEditor(it);
    editors.push({ ed, it });
    const zoom = () => openZoom(it, () => ed.draw());
    const reset = async () => { if (await confirmBox('לבטל את כל המחיקות בתמונה הזאת?', 'ביטול מחיקות')) { it.erase.length = 0; ed.draw(); } };
    const restore = () => { it.erase.length = 0; it.erase.push(...it.autoErase.map(r => ({ ...r }))); ed.draw(); };
    const preview = async () => {
      const c = await finalCanvas(it, IP);
      c.className = 'final-prev';
      modal(el('div', { class: 'viewer' }, el('h2', {}, 'ככה זה ייראה במסמך'), c), { wide: true });
    };
    return el('section', { class: 'card rev' },
      el('h3', {}, `${it.exIds.length > 1 ? 'תרגילים' : 'תרגיל'} ${numsOf(sheet, it.exIds)}`),
      el('p', { class: 'rev-note' }, it.autoErase.length
        ? `סימנתי באדום ${it.autoErase.length === 1 ? 'מקום אחד שנראה מחוק' : it.autoErase.length + ' מקומות שנראים מחוקים'}. מה שבאדום יימחק.`
        : 'יש מחיקה להסתיר? גוררים מלבן מעליה.'),
      el('p', { class: 'rev-help' }, 'גרירה = מלבן חדש · גרירת מלבן = הזזה · ⬜ בפינה = שינוי גודל · ✕ = הסרת המלבן'),
      el('div', { class: 'row tools-row' },
        el('button', { class: 'btn btn-ghost', onclick: zoom }, '🔍 הגדלה לדיוק'),
        el('button', { class: 'btn btn-ghost', onclick: reset }, '↺ ביטול כל המחיקות'),
        it.autoErase.length ? el('button', { class: 'btn btn-ghost', onclick: restore }, '🪄 הסימון האוטומטי') : null,
        el('button', { class: 'btn btn-ghost', onclick: preview }, '👁️ איך זה ייראה')),
      el('div', { class: 'rev-wrap' }, ed.cv));
  });

  screen(topbar('מחיקות', () => enhanceStep(sheet, items, done)),
    el('main', { class: 'review' }, cards, el('button', { class: 'btn btn-big', onclick: () => saveCaptures(sheet, items, done) }, 'שמירה ✓')));
  requestAnimationFrame(() => editors.forEach(({ ed }) => ed.setSize(Math.min(900, (ed.cv.parentElement?.clientWidth || innerWidth) - 8))));
}

function openZoom(it, onDone) {
  const ed = makeEraseEditor(it);
  ed.cv.style.maxWidth = 'none';
  const box = el('div', { class: 'zoom-wrap' }, ed.cv);
  const levels = [1, 1.5, 2, 3, 4];
  let li = 2;
  const modeBtn = el('button', { class: 'btn btn-ghost' });
  let mode = 'draw';
  const setMode = (m) => { mode = m; ed.setMode(m); modeBtn.textContent = m === 'draw' ? '✋ מצב הזזת הדף' : '✏️ מצב סימון'; box.classList.toggle('zoom-pan', m === 'pan'); };
  const apply = () => { ed.setSize((box.clientWidth - 4) * levels[li]); };
  const close = modal(el('div', { class: 'zoom' },
    el('div', { class: 'row tools-row' },
      el('button', { class: 'btn btn-ghost', onclick: () => { li = Math.max(0, li - 1); apply(); } }, '➖'),
      el('button', { class: 'btn btn-ghost', onclick: () => { li = Math.min(levels.length - 1, li + 1); apply(); } }, '➕'),
      modeBtn,
      el('button', { class: 'btn btn-ghost', onclick: () => { it.erase.length = 0; ed.draw(); } }, '↺ ביטול כל המחיקות'),
      el('button', { class: 'btn', onclick: () => close() }, '✓ סיום')),
    el('p', { class: 'rev-help' }, 'במצב הזזה גוללים את הדף כדי להגיע למקום הנכון. במצב סימון גוררים ומתקנים מלבנים.'),
    box), { wide: true, full: true, onClose: onDone });
  setMode('pan');
  requestAnimationFrame(apply);
}

async function saveCaptures(sheet, items, done) {
  const IP = await lazy.img();
  const stop = busy('שומר…');
  const before = pace(sheet, new Set(done.keys()));
  const newly = [];
  const today = todayISO();
  let t = Date.now();
  try {
    for (const it of items) {
      await nextFrame();
      const full = IP.enhance(it.crop, it.opts);
      const out = IP.compact(IP.whiteOut(full, it.erase));
      const { blob, w, h } = await IP.toBlob(out);
      if (it.replaceShot) { // keep the original id, date and order — only the picture changes
        const old = await db.get('shots', it.replaceShot.id);
        await db.put('shots', { ...(old || it.replaceShot), exerciseIds: it.replaceShot.exerciseIds, blob, w, h, rescanned: Date.now() });
        continue;
      }
      await db.put('shots', { id: uid(), sheetId: sheet.id, exerciseIds: it.exIds, date: today, created: t++, blob, w, h });
      for (const id of it.exIds) if (!done.has(id) && !newly.includes(id)) newly.push(id);
    }
  } catch (e) { stop(); console.error(e); return toast('הייתה בעיה בשמירה. נסה שוב.'); }
  for (const id of newly) done.set(id, today);
  sheet.submission = null; await db.put('sheets', sheet);
  stop();
  regenSubmission(sheet);
  if (items.every(it => it.replaceShot)) { toast('התמונה הוחלפה ✓ (התאריך נשאר)'); return openHomework(sheet.id); }
  // celebrations
  const stickers = await getSetting('stickers', []);
  const got = newly.map(id => { const e = STICKERS[Math.floor(Math.random() * STICKERS.length)]; stickers.push({ e, d: today, ex: id }); return e; });
  await setSetting('stickers', stickers);
  if (newly.length) await award(15 * newly.length, 'hw', newly.length);
  if (newly.length && newly.length <= 2) for (const e of got) await praise(child.first, e, { sound });
  else if (newly.length > 2) await praise(child.first, got.slice(0, 5).join(''), { sound, text: `וואו! סגרת ${newly.length} תרגילים!`, sub: `${newly.length} מדבקות חדשות נוספו לאוסף` });
  const after = pace(sheet, new Set(done.keys()));
  const recKey = `special:${sheet.id}`; const rec = await getSetting(recKey, {});
  let lvl = null;
  if (after.level === 'complete' && !rec.complete) lvl = 'complete';
  else if (after.level === 'ahead' && rec.ahead !== today && after.day > 0) lvl = 'ahead';
  else if (after.level === 'onpace' && after.day > 0 && rec.onpace !== today && rec.ahead !== today && before.level === 'behind') lvl = 'onpace';
  if (lvl) {
    rec[lvl] = lvl === 'complete' ? true : today; if (lvl === 'ahead') rec.onpace = today;
    await setSetting(recKey, rec);
    await special(lvl, child.first, `${after.done} מתוך ${after.total} תרגילים · ${Math.round(after.ratio * 100)}%`, { sound });
  }
  if (!newly.length) toast('נשמר ✓');
  openHomework(sheet.id);
}

// ---------- VIEW EXERCISE ----------
async function viewExercise(sheet, exId) {
  const shots = (await shotsOf(sheet.id)).filter(s => s.exerciseIds.includes(exId));
  const I = exInfo(sheet, exId);
  const close = modal(el('div', { class: 'viewer' },
    el('h2', {}, `תרגיל ${I.num} · עמ' ${I.page}`),
    shots.map((s, i) => el('figure', {}, el('img', { src: blobUrl(s.blob) }),
      el('figcaption', {}, `${shots.length > 1 ? `חלק ${i + 1} · ` : ''}צולם ב-${fmtDate(s.date)}` + (s.exerciseIds.length > 1 ? ` · באותה תמונה גם: ${numsOf(sheet, s.exerciseIds.filter(x => x !== exId))}` : ''),
        el('button', { class: 'link-btn', onclick: () => { close(); captureFlow(sheet, exId, s); } }, '🔄 צילום מחדש'),
        el('button', { class: 'link-btn', onclick: async () => {
          const others = s.exerciseIds.length > 1 ? ` (התמונה משותפת גם לתרגילים ${numsOf(sheet, s.exerciseIds.filter(x => x !== exId))})` : '';
          if (!(await confirmBox(`למחוק את התמונה הזאת?${others}`, 'מחיקה'))) return;
          await db.del('shots', s.id); sheet.submission = null; await db.put('sheets', sheet); regenSubmission(sheet);
          close(); openHomework(sheet.id);
        } }, '🗑️ מחיקה')))),
    el('div', { class: 'row' },
      el('button', { class: 'btn', onclick: () => { close(); captureFlow(sheet, exId); } }, '📸 צילום המשך'),
      el('button', { class: 'btn btn-ghost', onclick: () => close() }, 'סגירה'))), { wide: true });
}

// ---------- SUBMISSION PDF ----------
const regenJobs = new Map();
function regenSubmission(sheet) {
  const job = (async () => {
    const { buildSubmission } = await lazy.pdf();
    const fresh = await db.get('sheets', sheet.id);
    const bytes = await buildSubmission(fresh, await shotsOf(sheet.id), child);
    fresh.submission = bytes; fresh.submissionAt = Date.now();
    await db.put('sheets', fresh);
    return fresh;
  })();
  regenJobs.set(sheet.id, job);
  job.catch(e => console.error('pdf', e));
  return job;
}
async function getSubmission(sheet) {
  let s = await db.get('sheets', sheet.id);
  if (s.submission) return s.submission;
  try { s = await (regenJobs.get(sheet.id) || regenSubmission(sheet)); } catch { s = {}; }
  if (!s.submission) s = await regenSubmission(sheet);
  return s.submission;
}
function fileNameFor(sheet) { return `שיעורי בית - שיעור ${sheet.lesson || ''} - ${child.first} ${child.last}.pdf`; }

async function submissionScreen(sheet) {
  const stop = busy('מכין את המסמך…');
  let bytes;
  try { bytes = await getSubmission(sheet); } catch (e) { stop(); console.error(e); return toast('הייתה בעיה ביצירת המסמך'); }
  const { loadPdf, renderPageToCanvas } = await lazy.parser();
  const pdf = await loadPdf(bytes);
  const pages = el('div', { class: 'pdf-pages' });
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i);
    pages.append(el('div', { class: 'pdf-page' }, await renderPageToCanvas(pg, 1.3)));
  }
  stop();
  const file = () => new File([bytes], fileNameFor(sheet), { type: 'application/pdf' });
  const download = () => { const a = el('a', { href: blobUrl(file()), download: fileNameFor(sheet) }); document.body.append(a); a.click(); a.remove(); };
  const share = async () => {
    const f = file();
    if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: f.name }); } catch { } }
    else download();
  };
  screen(topbar('מסמך להגשה', () => openHomework(sheet.id)),
    el('main', { class: 'submit' },
      el('div', { class: 'actions' },
        el('button', { class: 'btn btn-big', onclick: share }, '📤 שליחה / שיתוף'),
        el('button', { class: 'btn btn-big btn-ghost', onclick: download }, '💾 שמירה כקובץ')),
      el('p', { class: 'muted' }, `${pdf.numPages} עמודים · מתעדכן אוטומטית בכל צילום`),
      pages));
}

// ---------- SETTINGS (parent) ----------
async function settingsScreen() {
  const sheets = await loadSheets();
  const first = el('input', { type: 'text', value: child.first });
  const last = el('input', { type: 'text', value: child.last });
  const snd = el('input', { type: 'checkbox' }); snd.checked = sound;
  const theme = el('select', {}, ...[['auto', 'לפי הטלפון'], ['dark', 'כהה 🌙'], ['light', 'בהיר ☀️']].map(([v, t]) => el('option', { value: v }, t)));
  theme.value = await getSetting('theme', 'auto');
  theme.addEventListener('change', async () => { await setSetting('theme', theme.value); applyTheme(theme.value); });
  const vurl = el('input', { type: 'url', value: await getSetting('videoUrl', ''), placeholder: 'ריק = הקישור מתוך הדף', dir: 'ltr' });
  let persisted = false; try { persisted = await navigator.storage?.persisted?.(); } catch { }
  const sheetRows = sheets.map(s => {
    const rec = el('input', { type: 'date', value: s.receivedDate });
    const due = el('input', { type: 'date', value: s.dueDate });
    const upd = async () => { s.receivedDate = rec.value; s.dueDate = due.value; s.submission = null; await db.put('sheets', s); regenSubmission(s); toast('עודכן'); };
    rec.addEventListener('change', upd); due.addEventListener('change', upd);
    return el('tr', {},
      el('td', {}, `שיעור ${s.lesson || '?'}`), el('td', {}, rec), el('td', {}, due),
      el('td', {}, el('button', { class: 'link-btn', onclick: async () => { s.archived = !s.archived; await db.put('sheets', s); settingsScreen(); } }, s.archived ? '↩ החזרה' : '📦 לארכיון')),
      el('td', {}, el('button', { class: 'link-btn', onclick: async () => {
        if (!(await confirmBox(`למחוק את שיעור ${s.lesson} וכל התמונות שלו?`, 'מחיקה'))) return;
        for (const sh of await shotsOf(s.id)) await db.del('shots', sh.id);
        await db.del('sheets', s.id); settingsScreen();
      } }, '🗑️')));
  });
  screen(topbar('הגדרות', home),
    el('main', { class: 'settings' },
      el('section', { class: 'card' }, el('h3', {}, 'פרטי התלמיד (למסמך ההגשה)'),
        el('label', {}, 'שם פרטי ', first), el('label', {}, 'שם משפחה ', last),
        el('label', { class: 'inline' }, snd, ' צלילים בחגיגות'),
        el('label', {}, 'מראה ', theme),
        el('button', { class: 'btn btn-ghost', onclick: async () => (await import('./handwriting.js')).openHandwriting(geoCtx(), settingsScreen) }, '✍️ התאמה לכתב שלי'),
        el('button', { class: 'btn', onclick: async () => {
          child = { first: first.value.trim() || 'יונתן', last: last.value.trim() };
          sound = snd.checked;
          await setSetting('child', child); await setSetting('sound', sound);
          for (const s of sheets) { s.submission = null; await db.put('sheets', s); }
          toast('נשמר');
        } }, 'שמירה')),
      el('section', { class: 'card' }, el('h3', {}, '🎬 סרטונים (עובדים רק עם אינטרנט)'),
        el('label', {}, 'אתר הסרטונים ', vurl),
        el('p', { class: 'muted' }, 'הקישור נלקח אוטומטית מהדף של המורה. אם יש לכם כתובת אחרת לאתר (למשל עם כניסה), כתבו אותה כאן. את הסיסמה כדאי לשמור ב-Chrome, לא כאן.'),
        el('button', { class: 'btn', onclick: async () => {
          await setSetting('videoUrl', vurl.value.trim());
          toast('נשמר');
        } }, 'שמירה')),
      el('section', { class: 'card' }, el('h3', {}, 'דפי שיעורי בית'),
        sheets.length ? el('table', { class: 'tbl-list' }, el('tr', {}, el('th', {}, ''), el('th', {}, 'התקבל'), el('th', {}, 'הגשה'), el('th', {}, ''), el('th', {}, '')), sheetRows) : el('p', {}, 'אין דפים'),
        el('p', { class: 'muted' }, 'הקצב מחושב לפי 6 הימים שלפני תאריך ההגשה.'),
        el('button', { class: 'btn btn-ghost', onclick: importFlow }, '+ דף חדש')),
      await (await import('./packs.js')).packsSection({ busy, toast, modal, confirmBox }, settingsScreen),
      el('section', { class: 'card' }, el('h3', {}, 'גיבוי'),
        el('p', { class: 'muted' }, 'כל המידע שמור רק בטלפון. מומלץ לגבות מדי פעם לקובץ.' + (persisted ? ' ✓ האחסון מוגן ממחיקה אוטומטית.' : '')),
        el('div', { class: 'row' },
          el('button', { class: 'btn', onclick: exportBackup }, '⬇️ יצירת קובץ גיבוי'),
          el('button', { class: 'btn btn-ghost', onclick: importBackup }, '⬆️ שחזור מגיבוי'))),
      el('p', { class: 'muted center' }, `המחברת של יונתן · גרסה ${APP_VERSION} · עובד בלי אינטרנט`)));
}

const b64 = async (blobOrBytes) => {
  const blob = blobOrBytes instanceof Blob ? blobOrBytes : new Blob([blobOrBytes]);
  return new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
};
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function exportBackup() {
  const stop = busy('מכין גיבוי…');
  const sheets = await db.all('sheets'), shots = await db.all('shots');
  const out = { v: 2, at: Date.now(), child, sound, stickers: await getSetting('stickers', []), sheets: [], shots: [], kv: {} };
  for (const s of sheets) out.sheets.push({ ...s, pdfBytes: await b64(s.pdfBytes), previewBlob: s.previewBlob ? await b64(s.previewBlob) : null, submission: null });
  for (const s of shots) out.shots.push({ ...s, exerciseIds: ids(s), blob: await b64(s.blob) });
  for (const s of sheets) out.kv[`special:${s.id}`] = await getSetting(`special:${s.id}`, {});
  for (const k of ['videoUrl', 'enhOpts', 'geoProgress', 'geoMode', 'examProgress', 'packs', 'geoCustom', 'activity', 'xpTotal', 'dailyGoal', 'bestStreak', 'enLists', 'enProgress', 'enList', 'ttsSlow', 'pyProgress', 'planner', 'plannerSeeded', 'focusLog', 'focusPreset', 'theme']) out.kv[k] = await getSetting(k, null);
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  stop();
  const a = el('a', { href: blobUrl(blob), download: `גיבוי-מחברת-${todayISO()}.json` }); document.body.append(a); a.click(); a.remove();
}
function importBackup() {
  const inp = el('input', { type: 'file', accept: 'application/json,.json', style: 'display:none' });
  inp.addEventListener('change', async () => {
    const f = inp.files[0]; if (!f) return;
    if (!(await confirmBox('השחזור יחליף את כל המידע הנוכחי. להמשיך?', 'שחזור'))) return;
    const stop = busy('משחזר…');
    try {
      const data = JSON.parse(await f.text());
      await db.clear('sheets'); await db.clear('shots');
      for (const s of data.sheets) await db.put('sheets', { ...s, pdfBytes: unb64(s.pdfBytes), previewBlob: s.previewBlob ? new Blob([unb64(s.previewBlob)], { type: 'image/jpeg' }) : null });
      for (const s of data.shots) await db.put('shots', { ...s, exerciseIds: ids(s), blob: new Blob([unb64(s.blob)], { type: 'image/jpeg' }) });
      await setSetting('stickers', data.stickers || []); await setSetting('child', data.child); await setSetting('sound', data.sound !== false);
      for (const [k, v] of Object.entries(data.kv || {})) if (v !== null) await setSetting(k, v);
      child = data.child; sound = data.sound !== false;
      stop(); toast('שוחזר ✓'); home();
    } catch (e) { stop(); console.error(e); toast('קובץ הגיבוי לא תקין'); }
  });
  document.body.append(inp); inp.click();
}

// ---------- boot ----------
(async function boot() {
  await applyTheme();
  child = await getSetting('child', child);
  sound = await getSetting('sound', true);
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch { }
  try { if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true; sessionStorage.setItem('justUpdated', '1'); location.reload();
    });
    navigator.serviceWorker.register('./sw.js').then(r => r.update()).catch(() => { });
  } } catch { }
  let ju = false; try { ju = sessionStorage.getItem('justUpdated'); if (ju) sessionStorage.removeItem('justUpdated'); } catch { }
  if (ju) { setTimeout(() => toast(`המחברת עודכנה לגרסה ${APP_VERSION} ✓`), 400); }
  addEventListener('online', () => document.querySelectorAll('.fab').forEach(f => f.classList.remove('fab-off')));
  addEventListener('offline', () => document.querySelectorAll('.fab').forEach(f => f.classList.add('fab-off')));
  buildNav();
  window.addEventListener('xp', xpFx);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
  home();
})();

// test hooks
window.__app = { openHomework, captureFlow, submissionScreen, home, db };
