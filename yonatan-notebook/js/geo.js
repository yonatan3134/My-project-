// Geometry proof practice: the book page on one side, a shuffled bank of statements/reasons on the other.
// The girl builds the proof table (right statements only, logical order) and taps "ביצעתי" to check.
import { el, todayISO, statusOf, errsOf } from './util.js';
import { getSetting, setSetting, uid } from './db.js';
import { EXERCISES, CHAPTERS, EXTRA_REASONS, R } from './geo-data.js';
import { praise, special, STICKERS } from './celebrate.js';
import { renderFigure, objectsOf, PALETTE } from './geo-fig.js';

let C; // helpers from app.js: screen, topbar, modal, toast, confirmBox, busy, home, child(), sound()
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmt = s => esc(s).replace(/`([^`]+)`/g, '<bdi class="m" dir="ltr">$1</bdi>');
const plain = s => String(s).replace(/`/g, '');
const H = (tag, attrs, html) => el(tag, { ...attrs, html });
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

async function allExercises() {
  const custom = await getSetting('geoCustom', []);
  let fromPacks = [];
  try { fromPacks = (await (await import('./packs.js')).packGeo()).exercises; } catch { }
  return [...EXERCISES, ...fromPacks.filter(e => !EXERCISES.some(x => x.id === e.id)), ...custom.map(c => ({ ...c, custom: true }))];
}
// every book exercise lands in its chapter by page number, so new packs merge into the right place
const BOOK = [
  { id: 'sas', from: 313, to: 315, upto: { 315: 9 } }, { id: 'asa', from: 315, to: 316 }, { id: 'sss', from: 317, to: 317 }, { id: 'asa', from: 318, to: 318 },
  { id: 'more', from: 319, to: 323 }, { id: 'iso', from: 324, to: 328 }, { id: 'equi', from: 329, to: 332 }, { id: 'ineq', from: 333, to: 340 },
];
export function chapterOf(e) {
  if (e.chapter === 'exam' || e.custom || !e.page) return e.chapter;
  const pg = +e.page, n = +e.num;
  for (const b of BOOK) if (pg >= b.from && pg <= b.to && !(b.upto && b.upto[pg] !== undefined && n > b.upto[pg])) return b.id;
  return e.chapter;
}
const byBook = (a, b) => (+a.page || 0) - (+b.page || 0) || (+a.num || 0) - (+b.num || 0);
async function allChapters() {
  const out = [...CHAPTERS];
  try { for (const c of (await (await import('./packs.js')).packGeo()).chapters) if (!out.some(x => x.id === c.id)) out.push(c); } catch { }
  return out;
}
const progress = () => getSetting('geoProgress', {});
const imgSrc = (ex) => ex.imgBlob ? URL.createObjectURL(ex.imgBlob) : ex.img;

// ---------------- list ----------------
export async function openGeo(ctx) {
  C = ctx;
  const list = await allExercises();
  const prog = await progress();
  const solved = list.filter(e => prog[e.id]?.solved).length;
  const chapters = await allChapters();
  for (const e of list) e.chap = chapterOf(e);
  for (const e of list) if (!chapters.some(c => c.id === e.chap)) chapters.push({ id: e.chap, title: e.chapterTitle || e.chap, sub: '' });
  C.screen(
    C.topbar('תרגול גאומטריה', C.home),
    el('main', { class: 'geo-list' },
      el('section', { class: 'card geo-head' },
        el('div', { class: 'geo-score' }, el('b', {}, `${solved}/${list.length}`), el('small', {}, 'הוכחות נפתרו')),
        el('p', {}, 'בוחרים טענות ונימוקים מהבנק, מסדרים אותם בסדר הנכון ולוחצים "ביצעתי". זהירות: חלק מהכרטיסים לא שייכים להוכחה!'),
        el('div', { class: 'row' },
          el('button', { class: 'btn btn-ghost', onclick: showExample }, '📝 דוגמה לפתרון'),
          el('button', { class: 'btn btn-ghost', onclick: () => C.toast('פרקים חדשים מגיעים כחבילה: ⚙️ הגדרות ← 📦 ייבוא חבילה') }, '📦 איך מוסיפים פרקים?'))),
      chapters.map(ch => {
        const exs = list.filter(e => e.chap === ch.id).sort((a, b) => ch.id === 'exam' ? 0 : byBook(a, b));
        if (!exs.length) return null;
        return el('section', { class: 'tbl' }, el('h3', {}, ch.title, ' ', el('small', { class: 'muted' }, ch.sub)),
          el('div', { class: 'geo-grid' }, exs.map(e => {
            const p = prog[e.id] || {};
            const st = statusOf(prog[e.id], true);
            return el('button', { class: 'geo-tile' + (st === 'clean' ? ' geo-solved' : st === 'try' ? ' geo-try' : ''), onclick: () => openExercise(e.id) },
              el('div', { class: 'geo-tile-num' + (e.chapter === 'exam' ? ' ex-tile-t' : '') }, e.chapter === 'exam' ? e.num : `${e.page}/${e.num}`),
              el('div', { class: 'geo-tile-st' }, st === 'clean' ? '✓ בלי טעויות' : p.solved ? `✓ נפתר (${errsOf(p, true)} טעויות)` : p.tries ? '✏️ בתהליך' : 'חדש'),
              e.marked ? el('i', { title: 'סומן בספר' }, '📌') : null,
              e.custom ? el('span', { class: 'geo-del', onclick: async (ev) => { ev.stopPropagation(); await deleteCustom(e.id); } }, '🗑️') : null);
          })));
      })));
}

async function deleteCustom(id) {
  if (!(await C.confirmBox('למחוק את התרגיל הזה?', 'מחיקה'))) return;
  const custom = (await getSetting('geoCustom', [])).filter(c => c.id !== id);
  await setSetting('geoCustom', custom); openGeo(C);
}

function showExample() {
  C.modal(el('div', { class: 'viewer' }, el('h2', {}, 'ככה כותבים הוכחה'),
    el('p', { class: 'muted center' }, 'נתון, צ"ל, ואז טבלה של טענה ונימוק. כל שורה מסתמכת רק על שורות שכבר הופיעו לפניה.'),
    el('img', { src: 'geo/example.jpg', class: 'geo-example' })), { wide: true });
}

// ---------------- validation ----------------
// A proof is right when: every row is a true step with an accepted reason, every row comes after the rows it
// relies on, and the goals (with everything they rely on) are all there. Any other order is fine.
const variantsOf = st => [{ r: st.r, deps: st.deps || [] }, ...(st.alt || []).map(a => ({ r: a.r, deps: a.deps || [] }))];
export function buildModel(ex) {
  const steps = ex.steps.map(s => ({ ...s, deps: s.deps || [], vars: variantsOf(s) }));
  const byId = new Map(steps.map(s => [s.id, s]));
  const goals = (ex.goals && ex.goals.length ? ex.goals : steps.filter(s => !s.opt).map(s => s.id)).filter(g => byId.has(g));
  const cards = [
    ...steps.flatMap(s => s.vars.map((v, vi) => ({ key: `S${s.id}#${vi}`, stepId: s.id, vi, s: s.s, r: v.r }))),
    ...(ex.distractors || []).map((d, i) => ({ key: 'D' + i, stepId: null, s: d.s, r: d.r, why: d.why })),
  ];
  const stm = new Map();
  for (const s of steps) if (!stm.has(s.s)) stm.set(s.s, { key: 'T' + stm.size, s: s.s, stepId: s.id });
  for (const d of ex.distractors || []) if (!stm.has(d.s)) stm.set(d.s, { key: 'T' + stm.size, s: d.s, stepId: null, why: d.why });
  const statements = [...stm.values()];
  const reasons = [...new Set([...steps.flatMap(s => s.vars.map(v => v.r)), ...(ex.distractors || []).map(d => d.r), ...EXTRA_REASONS])];
  return { steps, byId, goals, cards, statements, reasons };
}

export function validate(ex, M, rows, mode) {
  if (mode === 'viz') mode = 'normal';
  const resolved = rows.map(row => {
    if (mode === 'normal') {
      const c = M.cards.find(c => c.key === row.key);
      if (!c) return { err: 'כרטיס לא מוכר' };
      if (!c.stepId) return { err: c.why || 'הכרטיס הזה לא שייך להוכחה.' };
      return { sid: c.stepId, vi: c.vi };
    }
    const t = M.statements.find(t => t.key === row.key);
    if (!t) return { err: 'כרטיס לא מוכר' };
    if (!t.stepId) return { err: t.why || 'הטענה הזאת לא שייכת להוכחה.' };
    if (!row.reason) return { err: 'חסר נימוק לשורה הזאת. לחץ על "בחר נימוק".', sid: t.stepId };
    const vi = M.byId.get(t.stepId).vars.findIndex(v => v.r === row.reason);
    if (vi < 0) {
      const why = (ex.distractors || []).find(d => d.s === t.s && d.r === row.reason)?.why;
      return { err: why || 'הנימוק לא מתאים לטענה הזאת.', sid: t.stepId };
    }
    return { sid: t.stepId, vi };
  });
  const first = new Map();
  resolved.forEach((r, i) => { if (r.sid && !r.err && !first.has(r.sid)) first.set(r.sid, { i, vi: r.vi }); });
  const res = resolved.map((r, i) => {
    if (r.err) return { ok: false, msg: r.err };
    if (first.get(r.sid).i !== i) return { ok: false, msg: 'הטענה הזאת כבר מופיעה בטבלה.' };
    const deps = M.byId.get(r.sid).vars[r.vi].deps;
    const late = deps.filter(d => !first.has(d) || first.get(d).i > i);
    if (late.length) return { ok: false, msg: 'אי אפשר לכתוב את זה עדיין. קודם צריך שיופיעו: ' + late.map(d => M.byId.get(d).s).join(' ; ') };
    return { ok: true };
  });
  const needed = new Set(), queue = [...M.goals];
  while (queue.length) {
    const id = queue.shift(); if (needed.has(id)) continue; needed.add(id);
    const st = M.byId.get(id); const f = first.get(id);
    for (const d of (f ? st.vars[f.vi] : st.vars[0]).deps) queue.push(d);
  }
  const missing = M.steps.filter(s => needed.has(s.id) && !first.has(s.id));
  return { res, missing, needed, first, ok: rows.length > 0 && res.every(r => r.ok) && !missing.length };
}

// ---------------- exercise screen ----------------
export async function openExercise(id, ctx, opts = {}) {
  if (ctx) C = ctx;
  const back = opts.back || (() => openGeo(C));
  const inExamList = !!opts.back;
  const list = await allExercises();
  const idx = list.findIndex(e => e.id === id);
  const ex = list[idx];
  if (!ex) return openGeo(C);
  const M = buildModel(ex);
  const progAll = await progress();
  const sameCh = list.filter(e => chapterOf(e) === chapterOf(ex)).sort(byBook);
  const nextEx = ex.chapter === 'exam' ? null : sameCh.slice(sameCh.findIndex(e => e.id === ex.id) + 1).find(e => statusOf(progAll[e.id], true) !== 'clean');
  let attemptFails = 0;
  let mode = await getSetting('geoMode', 'viz');
  let rows = [];               // {key, reason}
  let bankOrder = [];
  let result = null;
  let hintKey = null;
  const cardMode = () => mode !== 'challenge';
  const reshuffle = () => { bankOrder = shuffle((cardMode() ? M.cards : M.statements).map(c => c.key)); };
  reshuffle();

  const table = el('div', { class: 'proof' });
  const figBox = el('div', { class: 'card geo-fig' });
  const rowColor = i => PALETTE[i % PALETTE.length];
  let focus = null; // tap a row number in the visual mode to show only that row
  const drawFig = () => {
    if (!ex.fig) return;
    const hl = mode === 'viz' ? rows.map((row, i) => ({ color: rowColor(i), ...objectsOf(textOf(row).s, ex.fig) })).filter((h, i) => focus === null || focus === i) : [];
    figBox.innerHTML = renderFigure(ex.fig, hl);
  };
  const bank = el('div', { class: 'bank-list' });
  const feedback = el('div', { class: 'proof-fb' });
  const modeSeg = el('div', { class: 'seg seg2' });

  const drawMode = () => modeSeg.replaceChildren(
    ...[['viz', '🎨 עם צביעה'], ['normal', '🙂 טענה + נימוק'], ['challenge', '🔥 אתגר']].map(([m, t]) =>
      el('button', { class: 'seg-btn' + (mode === m ? ' seg-on' : ''), onclick: async () => {
        if (mode === m) return;
        const keep = (mode === 'challenge') === (m === 'challenge');
        if (!keep && rows.length && !(await C.confirmBox('החלפת רמה תנקה את הטבלה. להמשיך?', 'כן'))) return;
        mode = m; if (!keep) rows = []; result = null; await setSetting('geoMode', m); reshuffle(); drawAll();
      } }, t)));

  const textOf = (row) => cardMode()
    ? M.cards.find(c => c.key === row.key)
    : { ...M.statements.find(t => t.key === row.key), r: row.reason };

  const changed = () => { focus = null; result = null; feedback.replaceChildren(); drawTable(); drawBank(); };

  const pickReason = (row) => {
    const close = C.modal(el('div', { class: 'picker' },
      el('h2', {}, 'איזה נימוק?'),
      H('p', { class: 'center' }, fmt(textOf(row).s)),
      el('div', { class: 'reason-list' }, shuffle(M.reasons).map(r =>
        H('button', { class: 'reason-btn' + (row.reason === r ? ' seg-on' : ''), onclick: () => { row.reason = r; close(); changed(); } }, fmt(r))))), { wide: true });
  };

  const drawTable = () => {
    const head = el('div', { class: 'proof-row proof-head' }, el('div', {}, ''), el('div', {}, 'טענה'), el('div', {}, 'נימוק'), el('div', {}, ''));
    const body = rows.map((row, i) => {
      const t = textOf(row);
      const st = result?.res[i];
      const reasonCell = cardMode() ? H('div', { class: 'proof-r' }, fmt(t.r))
        : el('div', { class: 'proof-r' }, H('button', { class: 'reason-pick' + (row.reason ? '' : ' reason-empty'), onclick: () => pickReason(row) }, row.reason ? fmt(row.reason) : 'בחר נימוק ▾'));
      return el('div', { class: 'proof-row' + (st ? (st.ok ? ' row-ok' : ' row-bad') : '') },
        el('div', { class: 'proof-n' + (mode === 'viz' && focus === i ? ' proof-focus' : ''), style: mode === 'viz' ? `background:${rowColor(i)};color:#fff;border-radius:8px;cursor:pointer;opacity:${focus === null || focus === i ? 1 : .45}` : '',
          onclick: () => { if (mode !== 'viz') return; focus = focus === i ? null : i; drawTable(); } }, st ? (st.ok ? '✓' : '✗') : `${i + 1}`),
        H('div', { class: 'proof-s' }, fmt(t.s)),
        reasonCell,
        el('div', { class: 'proof-ctl' },
          el('button', { class: 'mini', disabled: i === 0, onclick: () => { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; changed(); } }, '▲'),
          el('button', { class: 'mini', disabled: i === rows.length - 1, onclick: () => { [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; changed(); } }, '▼'),
          el('button', { class: 'mini mini-x', onclick: () => { rows.splice(i, 1); changed(); } }, '✕')),
        st && !st.ok ? H('div', { class: 'proof-msg' }, fmt(st.msg)) : null);
    });
    const qed = result?.ok ? el('div', { class: 'proof-row row-ok proof-qed' }, el('div', {}, ''), el('div', {}, 'מ.ש.ל ✓'), el('div', {}), el('div', {})) : null;
    table.replaceChildren(head, ...(rows.length ? body : [el('div', { class: 'proof-empty' }, 'הטבלה ריקה. לחץ על כרטיס מהבנק כדי להוסיף שורה.')]), qed || '');
    drawFig();
  };

  const drawBank = () => {
    const used = new Set(rows.map(r => r.key));
    const items = bankOrder.filter(k => !used.has(k)).map(k => {
      const c = cardMode() ? M.cards.find(c => c.key === k) : M.statements.find(t => t.key === k);
      return el('button', { class: 'bank-card' + (hintKey === k ? ' bank-hint' : ''), onclick: () => { rows.push({ key: k, reason: null }); hintKey = null; changed(); } },
        H('div', { class: 'bank-s' }, fmt(c.s)),
        cardMode() ? H('div', { class: 'bank-r' }, '<span class="muted">נימוק: </span>' + fmt(c.r)) : null);
    });
    bank.replaceChildren(...(items.length ? items : [el('div', { class: 'proof-empty' }, 'כל הכרטיסים בטבלה')]));
  };

  const drawAll = () => { drawMode(); drawTable(); drawBank(); feedback.replaceChildren(); };

  const check = async () => {
    if (!rows.length) { C.toast('עוד אין שורות בטבלה'); return; }
    result = validate(ex, M, rows, mode);
    drawTable();
    const prog = await progress();
    const p = prog[ex.id] = prog[ex.id] || { tries: 0 };
    const e0 = errsOf(p, true);
    p.tries++;
    if (!result.ok) { p.errs = e0 + 1; attemptFails++; } else p.errs = e0;
    if (result.ok) {
      const first = !p.solved;
      p.solved = true; p.date = todayISO(); p.mode = mode;
      if (attemptFails === 0) p.clean = true;
      await setSetting('geoProgress', prog);
      feedback.replaceChildren(el('div', { class: 'fb-ok' }, el('b', {}, 'כל הכבוד! ההוכחה נכונה ומסודרת 🎉'),
        opts.onSolved ? el('button', { class: 'btn', onclick: opts.onSolved }, opts.solvedLabel || 'המשך ←')
          : inExamList ? el('button', { class: 'btn', onclick: back }, 'לרשימת השאלות')
          : nextEx ? el('button', { class: 'btn', onclick: () => openExercise(nextEx.id) }, 'לתרגיל הבא ←') : null));
      if (first) {
        const e = STICKERS[Math.floor(Math.random() * STICKERS.length)];
        const st = await getSetting('stickers', []); st.push({ e, d: p.date, ex: 'geo:' + ex.id }); await setSetting('stickers', st);
        await (await import('./xp.js')).award(40, 'geo');
        await praise(C.child().first, e, { sound: C.sound(), text: 'הוכחה מושלמת!', sub: '+40 XP · מדבקה חדשה' });
        const all = await allExercises();
        const chap = all.filter(x => chapterOf(x) === chapterOf(ex));
        if (chap.every(x => prog[x.id]?.solved)) await special('complete', C.child().first, `פתרת את כל ההוכחות בפרק ${(await allChapters()).find(c => c.id === chapterOf(ex))?.title || ''}`, { sound: C.sound() });
      }
    } else {
      await setSetting('geoProgress', prog);
      const bad = result.res.filter(r => !r.ok).length;
      const lines = [];
      if (bad) lines.push(`יש ${bad === 1 ? 'שורה אחת שצריך לתקן' : bad + ' שורות שצריך לתקן'} (מסומנות באדום, עם הסבר).`);
      if (result.missing.length) lines.push(result.missing.length === 1 ? 'חסרה עוד שורה אחת בהוכחה.' : `חסרות עוד ${result.missing.length} שורות בהוכחה.`);
      feedback.replaceChildren(el('div', { class: 'fb-bad' }, el('b', {}, 'כמעט! 💪'), ...lines.map(l => el('div', {}, l)),
        el('small', { class: 'muted' }, 'אפשר לבקש 💡 רמז')));
    }
  };

  const hint = () => {
    const r = validate(ex, M, rows, mode);
    if (r.res.some(x => !x.ok)) { C.toast('יש בטבלה שורה שצריך לתקן. לחץ "ביצעתי" כדי לראות איזו'); return; }
    const next = M.steps.find(s => r.needed.has(s.id) && !r.first.has(s.id) && s.vars.some(v => v.deps.every(d => r.first.has(d))));
    if (!next) { C.toast(r.ok ? 'ההוכחה כבר שלמה, לחץ "ביצעתי"!' : 'כל השורות כבר בטבלה. בדוק את הסדר'); return; }
    hintKey = cardMode()
      ? (M.cards.find(c => c.stepId === next.id && next.vars[c.vi].deps.every(d => r.first.has(d))) || M.cards.find(c => c.stepId === next.id)).key
      : M.statements.find(t => t.stepId === next.id).key;
    drawBank();
    C.toast('💡 הכרטיס המהבהב יכול להיות השורה הבאה');
    bank.querySelector('.bank-hint')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };


  const zoom = () => C.modal(el('div', { class: 'viewer' }, el('img', { src: imgSrc(ex), class: 'geo-zoom' })), { wide: true });

  C.screen(
    C.topbar(ex.chapter === 'exam' ? `מבחן רבע · ${ex.num}` : `עמ׳ ${ex.page} · תרגיל ${ex.num}`, back,
      !inExamList && nextEx ? el('button', { class: 'icon-btn', onclick: () => openExercise(nextEx.id), 'aria-label': 'הבא' }, '←') : null),
    el('main', { class: 'geo' },
      el('section', { class: 'geo-q' },
        ex.fig ? figBox
          : el('div', { class: 'card geo-img', onclick: zoom }, el('img', { src: imgSrc(ex), alt: 'התרגיל מהספר' }), el('small', { class: 'muted' }, '🔍 נגיעה להגדלה')),
        el('div', { class: 'card geo-gp' },
          el('div', {}, el('b', {}, 'נתון: '), ...ex.given.map((g, i) => H('span', {}, (i ? ' · ' : '') + fmt(g)))),
          el('div', {}, el('b', {}, 'צ"ל: '), ...ex.prove.map((g, i) => H('span', {}, (i ? ' · ' : '') + fmt(g)))),
          ex.note ? el('small', { class: 'muted' }, ex.note) : null),
        el('div', { class: 'row geo-tools' },
          el('button', { class: 'btn btn-ghost', onclick: hint }, '💡 רמז'),
          ex.fig && (ex.img || ex.imgBlob) ? el('button', { class: 'btn btn-ghost', onclick: zoom }, '📷 מהספר') : null,
          el('button', { class: 'btn btn-ghost', onclick: showExample }, '📝 דוגמה'),
          null),
        el('button', { class: 'link-btn', onclick: () => reportProblem(ex) }, '🚩 נראה לי שיש טעות בתרגיל')),
      el('section', { class: 'geo-work' },
        modeSeg,
        el('div', { class: 'card proof-card' }, table,
          el('div', { class: 'proof-actions' },
            el('button', { class: 'btn btn-ghost', onclick: async () => { if (rows.length && await C.confirmBox('לנקות את הטבלה?', 'ניקוי')) { rows = []; changed(); } } }, '↺ ניקוי'),
            el('button', { class: 'btn btn-big btn-check', onclick: check }, '✓ ביצעתי')),
          feedback),
        el('div', { class: 'card bank' },
          el('div', { class: 'bank-head' }, el('b', {}, cardMode() ? 'בנק טענות ונימוקים' : 'בנק טענות'),
            el('button', { class: 'link-btn', onclick: () => { reshuffle(); drawBank(); } }, 'ערבוב 🔀')),
          el('small', { class: 'muted' }, 'זהירות: חלק מהכרטיסים לא שייכים להוכחה!'),
          bank))));
  drawAll();
}

async function reportProblem(ex) {
  const close = C.modal(el('div', { class: 'confirm' }, el('h2', {}, 'יש טעות בתרגיל?'),
    el('p', {}, `תודה! ספרי להורה: עמוד ${ex.page || ''} תרגיל ${ex.num}. התיקון יגיע בחבילה הבאה.`),
    el('button', { class: 'btn btn-ghost', onclick: () => close() }, 'סגירה')));
}
