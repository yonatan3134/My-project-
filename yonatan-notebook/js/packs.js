// Content packs: new material (geometry proofs, exam questions, homework hints) arrives as one small JSON file
// ("lia-pack") that is imported on the tablet. No reinstall. Every pack is checked before it is saved:
// each proof must be solvable by the app's own checker and every multiple-choice step must be well formed.
import { getSetting, setSetting } from './db.js';
import { el } from './util.js';

const KEY = 'packs';
export const getPacks = () => getSetting(KEY, []);

// ---------- what the rest of the app reads ----------
export async function packGeo() {
  const packs = await getPacks();
  const chapters = [], exercises = [];
  for (const p of packs) {
    for (const c of p.geo?.chapters || []) if (!chapters.some(x => x.id === c.id)) chapters.push(c);
    for (const e of p.geo?.exercises || []) exercises.push({ ...e, pack: p.id });
  }
  return { chapters, exercises };
}
export async function packProblems() {
  return (await getPacks()).flatMap(p => (p.exam?.problems || []).map(x => ({ ...x, pack: p.id })));
}
const hwKey = (page, num) => `${String(page).trim()}/${String(num).replace(/[*#\s]/g, '')}`;
export async function hwHints(page, num) {
  const k = hwKey(page, num);
  for (const p of (await getPacks()).slice().reverse()) {
    const h = p.hw?.hints?.[k];
    if (h) return h;
  }
  return null;
}

// ---------- checking ----------
function checkSteps(steps, where, errs, depth = 0) {
  if (!Array.isArray(steps) || !steps.length) { errs.push(`${where}: אין שלבים`); return; }
  steps.forEach((s, i) => {
    const w = `${where} שלב ${i + 1}`;
    if (!s.q || !Array.isArray(s.o) || s.o.length < 2) { errs.push(`${w}: חסרה שאלה או אפשרויות`); return; }
    if (new Set(s.o).size !== s.o.length) errs.push(`${w}: אפשרויות כפולות`);
    if (s.branch) {
      if (depth > 1 || !Array.isArray(s.branch) || s.branch.length !== s.o.length) { errs.push(`${w}: פיצול לא תקין`); return; }
      s.branch.forEach((b, j) => checkSteps(b, `${w} דרך ${j + 1}`, errs, depth + 1));
      s.why = s.why || s.o.map(() => null); s.work = s.work || '';
      return;
    }
    s.why = Array.isArray(s.why) ? s.why : [];
    while (s.why.length < s.o.length) s.why.push(null);
    s.why[0] = null;
    if (typeof s.work !== 'string') s.work = String(s.o[0]);
    const ticks = [s.q, ...s.o, s.work, ...s.why.filter(Boolean)].join('').split('`').length - 1;
    if (ticks % 2) errs.push(`${w}: סימון נוסחה (\`) לא סגור`);
  });
}

export async function checkPack(pack) {
  const errs = [];
  if (pack?.format !== 'lia-pack') throw new Error('זה לא קובץ חבילה של המחברת');
  if (!pack.id || !pack.title) throw new Error('לחבילה חסר מזהה או שם');
  const { R } = await import('./geo-data.js');
  const { buildModel, validate } = await import('./geo.js');
  const counts = { geo: 0, exam: 0, hw: 0 };
  // geometry
  for (const ex of pack.geo?.exercises || []) {
    const w = `הוכחה ${ex.id || '?'}`;
    // "@sas" style reasons → the app's own wording, so challenge mode offers the same reason names everywhere
    const res = r => typeof r === 'string' && r.startsWith('@') ? (R[r.slice(1).split(' ')[0]] || r) + r.slice(1).replace(/^\S+/, '') : r;
    for (const s of ex.steps || []) { s.r = res(s.r); for (const a of s.alt || []) a.r = res(a.r); }
    for (const d of ex.distractors || []) d.r = res(d.r);
    if (!ex.id || !ex.chapter || !Array.isArray(ex.steps) || ex.steps.length < 2) { errs.push(`${w}: חסרים פרטים`); continue; }
    const ids = new Set(ex.steps.map(s => s.id));
    if (ids.size !== ex.steps.length) { errs.push(`${w}: מזהה שלב כפול`); continue; }
    if (ex.steps.some(s => !s.s || !s.r || (s.deps || []).some(d => !ids.has(d)))) { errs.push(`${w}: שלב לא תקין`); continue; }
    if (!(ex.goals || []).length || ex.goals.some(g => !ids.has(g))) { errs.push(`${w}: יעדים לא תקינים`); continue; }
    if (!ex.fig?.pts || Object.keys(ex.fig.pts).length < 3) { errs.push(`${w}: חסר שרטוט`); continue; }
    try {
      const M = buildModel(ex);
      const K = s => ({ key: `S${s.id}#0` });
      if (!validate(ex, M, ex.steps.map(K), 'normal').ok) { errs.push(`${w}: הפתרון עצמו לא עובר בדיקה`); continue; }
      const bad = (ex.distractors || []).filter((d, i) => validate(ex, M, [...ex.steps.map(K), { key: 'D' + i }], 'normal').ok);
      if (bad.length) { errs.push(`${w}: מסיח שנחשב נכון`); continue; }
      if ((ex.distractors || []).length < 2) { errs.push(`${w}: חסרים מסיחים`); continue; }
    } catch (e) { errs.push(`${w}: ${e.message}`); continue; }
    counts.geo++;
  }
  // exam questions
  for (const p of pack.exam?.problems || []) {
    const w = `שאלה ${p.id || '?'}`;
    if (!p.id || !['alg', 'ana', 'gcalc'].includes(p.topic) || !p.title) { errs.push(`${w}: חסרים פרטים`); continue; }
    const before = errs.length; checkSteps(p.steps, w, errs);
    if (errs.length === before) counts.exam++;
  }
  // homework hints, keyed "page/number" as printed on the teacher's sheet
  const hints = pack.hw?.hints || {};
  for (const [k, h] of Object.entries(hints)) {
    if (!/^\d+\/\d+$/.test(k) || !Array.isArray(h.hints) || !h.hints.length) errs.push(`רמזים ${k}: לא תקין`);
    else counts.hw++;
  }
  return { errs, counts };
}

// ---------- import / list (settings) ----------
export function importPackFlow(C, after) {
  const inp = el('input', { type: 'file', accept: '.json,.liapack,application/json', style: 'display:none' });
  inp.addEventListener('change', async () => {
    const f = inp.files[0]; inp.remove(); if (!f) return;
    const stop = C.busy('בודק את החבילה…');
    let pack, res;
    try { pack = JSON.parse(await f.text()); res = await checkPack(pack); }
    catch (e) { stop(); return C.toast(e.message || 'הקובץ לא תקין'); }
    stop();
    const { errs, counts } = res;
    const total = counts.geo + counts.exam + counts.hw;
    if (!total) return C.modal(el('div', { class: 'viewer' }, el('h2', {}, '😕 החבילה לא נקלטה'), el('ul', {}, errs.slice(0, 12).map(e => el('li', {}, e)))));
    if (errs.length) { // keep only what passed
      pack.geo && (pack.geo.exercises = pack.geo.exercises.filter(x => !errs.some(e => e.startsWith(`הוכחה ${x.id}:`))));
      pack.exam && (pack.exam.problems = pack.exam.problems.filter(x => !errs.some(e => e.startsWith(`שאלה ${x.id} `) || e.startsWith(`שאלה ${x.id}:`))));
    }
    const packs = (await getPacks()).filter(p => p.id !== pack.id);
    pack.importedAt = Date.now();
    packs.push(pack); await setSetting(KEY, packs);
    const parts = [counts.geo && `${counts.geo} הוכחות`, counts.exam && `${counts.exam} שאלות מבחן`, counts.hw && `רמזים ל-${counts.hw} תרגילי בית`].filter(Boolean);
    C.modal(el('div', { class: 'viewer' }, el('h2', {}, '📦 החבילה נקלטה!'), el('p', { class: 'center' }, `"${pack.title}": ${parts.join(', ')}.`),
      errs.length ? el('details', {}, el('summary', {}, `${errs.length} פריטים דולגו כי לא עברו בדיקה`), el('ul', {}, errs.slice(0, 20).map(e => el('li', {}, e)))) : null));
    after && after();
  });
  document.body.append(inp); inp.click();
}

export async function packsSection(C, refresh) {
  const packs = await getPacks();
  return el('section', { class: 'card' }, el('h3', {}, '📦 חבילות תוכן'),
    el('p', { class: 'muted' }, 'פרקי גאומטריה, שאלות מבחן ורמזים לשיעורי בית מגיעים כקובץ חבילה. מורידים אותו ולוחצים "ייבוא חבילה" – בלי להתקין מחדש.'),
    packs.length ? el('table', { class: 'tbl-list' }, packs.map(p => el('tr', {},
      el('td', {}, p.title),
      el('td', { class: 'muted' }, [p.geo?.exercises?.length && `${p.geo.exercises.length} הוכחות`, p.exam?.problems?.length && `${p.exam.problems.length} שאלות`, p.hw?.hints && `${Object.keys(p.hw.hints).length} רמזים`].filter(Boolean).join(' · ')),
      el('td', {}, el('button', { class: 'link-btn', onclick: async () => {
        if (!(await C.confirmBox(`להסיר את החבילה "${p.title}"? ההתקדמות של יונתן נשמרת.`, 'הסרה'))) return;
        await setSetting(KEY, (await getPacks()).filter(x => x.id !== p.id)); refresh();
      } }, '🗑️ הסרה'))))) : el('p', {}, 'עוד אין חבילות.'),
    el('button', { class: 'btn', onclick: () => importPackFlow(C, refresh) }, '📦 ייבוא חבילה'));
}

// ---------- the offline "how do I start?" ladder for a homework exercise ----------
export function hintLadder(C, title, h) {
  const steps = [...h.hints.map((t, i) => ({ t, label: `רמז ${i + 1}` })), ...(h.example ? [{ t: h.example, label: 'דוגמה דומה' }] : [])];
  let shown = 1;
  const box = el('div', { class: 'ladder' });
  const fmt = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, (_, m) => `<bdi class="m" dir="ltr">${m.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '<span class="fr"><span>$1</span><span>$2</span></span>')}</bdi>`).replace(/\n/g, '<br>');
  const draw = () => {
    box.replaceChildren(
      ...(h.topic ? [el('p', { class: 'muted center', html: fmt(h.topic) })] : []),
      ...steps.slice(0, shown).map(s => el('div', { class: 'rung' }, el('b', {}, s.label), el('div', { html: fmt(s.t) }))),
      shown < steps.length ? el('button', { class: 'btn', onclick: () => { shown++; draw(); } }, shown < h.hints.length ? 'עוד רמז 🔍' : 'להראות דוגמה דומה') : el('p', { class: 'muted center' }, 'עכשיו נסה לבד ✏️ – אתה יכול!'));
  };
  draw();
  C.modal(el('div', { class: 'viewer' }, el('h2', {}, title), box));
}
