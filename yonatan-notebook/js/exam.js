// Quarter-exam practice: algebra / analytic geometry as chains of multiple-choice steps,
// geometry questions through the proof builder.
import { el, todayISO, statusOf, errsOf, weightedPick } from './util.js';
import { renderFigure } from './geo-fig.js';
import { getSetting, setSetting } from './db.js';
import { PROBLEMS as BASE, TOPICS, EXAM_GEO } from './exam-data.js';
import { packProblems, packGeo } from './packs.js';
let PROBLEMS = BASE;
import { praise, oops, STICKERS } from './celebrate.js';
import { SVG } from './exam-svg.js';

let C;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mathHtml = m => m.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '<span class="fr"><span>$1</span><span>$2</span></span>');
export const fmtX = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, (_, m) => `<bdi class="m" dir="ltr">${mathHtml(m)}</bdi>`);
const H = (tag, attrs, html) => el(tag, { ...attrs, html });
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const GOOD = ['נכון! ✓', 'מצוין!', 'בדיוק!', 'יפה מאוד!', 'כן! ממשיכים', 'אלוף!', 'נכון מאוד!', 'יופי!'];
const pick = a => a[Math.floor(Math.random() * a.length)];

async function geoList() {
  const { EXERCISES } = await import('./geo-data.js');
  let extra = [];
  try { extra = (await packGeo()).exercises.filter(e => e.chapter === 'exam'); } catch { }
  return [...EXAM_GEO.map(id => EXERCISES.find(e => e.id === id)).filter(Boolean), ...extra];
}

// ---------------- list ----------------
let queue = []; // random exam: remaining items
let examMode = false;
export async function openExam(ctx) {
  try { const extra = await packProblems(); PROBLEMS = [...BASE, ...extra.filter(p => !BASE.some(b => b.id === p.id))]; } catch { PROBLEMS = BASE; }
  C = ctx; queue = []; examMode = false;
  const prog = await getSetting('examProgress', {});
  const gprog = await getSetting('geoProgress', {});
  const geos = await geoList();
  const total = PROBLEMS.length + geos.length;
  const solved = PROBLEMS.filter(p => prog[p.id]?.solved).length + geos.filter(g => gprog[g.id]?.solved).length;
  const tile = (item, isGeo) => {
    const p = isGeo ? gprog[item.id] : prog[item.id];
    const st = statusOf(p, isGeo);
    return el('button', { class: 'geo-tile ex-tile' + (st === 'clean' ? ' geo-solved' : st === 'try' ? ' geo-try' : ''), onclick: () => isGeo ? openGeoQ(item.id) : runProblem(item.id) },
      el('div', { class: 'ex-tile-t' }, isGeo ? item.num : item.title),
      el('div', { class: 'geo-tile-st' }, st === 'clean' ? '✓ בלי טעויות' : st === 'try' ? (p.solved ? `✓ נפתר (${errsOf(p, isGeo)} טעויות)` : '✏️ ניסיתי') : isGeo ? 'בניית הוכחה' : `${item.steps.length} שלבים`));
  };
  C.screen(
    C.topbar('מבחני רבע', C.home),
    el('main', { class: 'geo-list' },
      el('section', { class: 'card geo-head' },
        el('div', { class: 'geo-score' }, el('b', {}, `${solved}/${total}`), el('small', {}, 'שאלות נפתרו')),
        el('p', {}, 'כל שאלה מפורקת לשלבים קטנים: בוחרים בכל שלב את התשובה הנכונה מתוך כמה אפשרויות, עד הסוף. בגאומטריה בונים הוכחה.'),
        el('button', { class: 'btn btn-big', onclick: randomExam }, '🎲 מבחן אקראי')),
      ...TOPICS.filter(t => t.id === 'geo' ? geos.length : PROBLEMS.some(p => p.topic === t.id)).map(t => el('section', { class: 'tbl ex-topic', style: `border-top: 6px solid ${t.color}` },
        el('h3', {}, `${t.icon} ${t.title}`),
        el('div', { class: 'geo-grid' }, t.id === 'geo' ? geos.map(g => tile(g, true)) : PROBLEMS.filter(p => p.topic === t.id).map(p => tile(p, false)))))));
}

async function randomExam() {
  const geos = await geoList();
  const prog = await getSetting('examProgress', {}), gprog = await getSetting('geoProgress', {});
  const pickP = list => weightedPick(list, p => statusOf(prog[p.id], false), p => errsOf(prog[p.id], false));
  examMode = true;
  queue = [
    { kind: 'p', id: pickP(PROBLEMS.filter(p => p.topic === 'alg')).id },
    { kind: 'p', id: pickP(PROBLEMS.filter(p => p.topic === 'ana')).id },
    { kind: 'g', id: weightedPick(geos, g => statusOf(gprog[g.id], true), g => errsOf(gprog[g.id], true)).id },
  ];
  C.toast('מבחן אקראי: 3 שאלות – קודם מה שעוד לא הצליח. בהצלחה! 🍀');
  nextInQueue();
}
function nextInQueue() {
  const it = queue.shift();
  if (!it) { C.toast('סיימת את המבחן! 🎉'); return openExam(C); }
  if (it.kind === 'p') runProblem(it.id, queue.length + 1); else openGeoQ(it.id);
}
async function openGeoQ(id) {
  const { openExercise } = await import('./geo.js');
  const inExam = examMode;
  openExercise(id, C, { back: () => openExam(C), onSolved: inExam ? nextInQueue : null, solvedLabel: inExam ? (queue.length ? 'לשאלה הבאה ←' : 'סיום המבחן 🎉') : null });
}

// ---------------- coordinate sketch ----------------
export function renderPlot(pl) {
  const W = 320, Hh = 280, P = 22;
  const [x0, x1] = pl.x, [y0, y1] = pl.y;
  const sx = v => P + (v - x0) / (x1 - x0) * (W - 2 * P), sy = v => Hh - P - (v - y0) / (y1 - y0) * (Hh - 2 * P);
  const o = [];
  const ln = (a, b, c, st = '#334155', w = 2, dash = '') => o.push(`<line x1="${a.toFixed(1)}" y1="${b.toFixed(1)}" x2="${c[0].toFixed(1)}" y2="${c[1].toFixed(1)}" stroke="${st}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ''} stroke-linecap="round"/>`);
  // axes
  ln(sx(x0), sy(0), [sx(x1), sy(0)], '#64748b', 1.6); ln(sx(0), sy(y0), [sx(0), sy(y1)], '#64748b', 1.6);
  o.push(`<path d="M ${sx(x1)} ${sy(0)} l -7 -4 m 7 4 l -7 4" stroke="#64748b" fill="none" stroke-width="1.6"/>`);
  o.push(`<path d="M ${sx(0)} ${sy(y1)} l -4 7 m 4 -7 l 4 7" stroke="#64748b" fill="none" stroke-width="1.6"/>`);
  o.push(`<text x="${sx(x1) - 4}" y="${sy(0) + 16}" font-size="13" fill="#64748b">x</text><text x="${sx(0) + 7}" y="${sy(y1) + 10}" font-size="13" fill="#64748b">y</text>`);
  for (const [m, b] of pl.lines || []) {
    // clip y = m x + b to the box
    const pts = [];
    for (const x of [x0, x1]) { const y = m * x + b; if (y >= y0 && y <= y1) pts.push([x, y]); }
    if (m) for (const y of [y0, y1]) { const x = (y - b) / m; if (x > x0 && x < x1) pts.push([x, y]); }
    if (pts.length >= 2) ln(sx(pts[0][0]), sy(pts[0][1]), [sx(pts[1][0]), sy(pts[1][1])], '#334155', 2.2);
  }
  const Pt = pl.pts || {};
  for (const [a, b] of pl.segs || []) ln(sx(Pt[a][0]), sy(Pt[a][1]), [sx(Pt[b][0]), sy(Pt[b][1])], '#334155', 2.2);
  for (const [a, b] of pl.dashed || []) ln(sx(Pt[a][0]), sy(Pt[a][1]), [sx(Pt[b][0]), sy(Pt[b][1])], '#64748b', 1.6, '5 4');
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  for (const [n, [x, y]] of Object.entries(Pt)) {
    const X = sx(x), Y = sy(y);
    let dx = X - sx(cx), dy = Y - sy(cy); const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    if (n === 'O') { dx = -0.8; dy = 0.8; }
    o.push(`<circle cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="3.2" fill="#0f172a"/>`);
    o.push(`<text x="${(X + dx * 13 - 4).toFixed(1)}" y="${(Y + dy * 13 + 5).toFixed(1)}" font-size="14" font-weight="700" fill="#0f172a" font-family="Times New Roman, serif">${n}</text>`);
  }
  return `<svg viewBox="0 0 ${W} ${Hh}" class="geo-svg">${o.join('')}</svg>`;
}

// ---------------- step-by-step player ----------------
async function runProblem(id, remaining = 0) {
  const p = PROBLEMS.find(x => x.id === id);
  if (!p) return openExam(C);
  let k = 0, mistakes = 0;
  const work = el('div', { class: 'work' });
  const stepBox = el('div', { class: 'card step-card' });
  const dots = el('div', { class: 'dots' });
  // "the equation now": follows the solution step by step (algebra)
  const steps = p.steps.slice(); // branch steps splice the chosen way in
  const hasNow = JSON.stringify(p.steps).includes('"now"');
  const nowBody = H('div', { class: 'now-eq' }, p.eq ? fmtX(p.eq) : '');
  const nowBox = hasNow ? el('div', { class: 'card now-card' }, el('div', { class: 'now-title' }, '🔎 המשוואה עכשיו'), nowBody) : null;
  const setNow = (t) => { nowBody.innerHTML = fmtX(t); nowBody.classList.remove('now-flash'); void nowBody.offsetWidth; nowBody.classList.add('now-flash'); };
  const drawDots = () => dots.replaceChildren(...steps.map((_, i) => el('span', { class: 'dot' + (i < k ? ' dot-done' : i === k ? ' dot-now' : '') })));

  const addWork = (s) => {
    const line = H('div', { class: 'work-line' }, (s.part ? `<span class="part">${s.part}</span>` : '') + fmtX(s.work));
    work.append(line); line.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const showStep = () => {
    drawDots();
    if (k >= steps.length) return finish();
    const s = steps[k];
    const why = el('div', { class: 'why' });
    const opts = s.branch ? s.o.map((t, i) => ({ t, i })) : shuffle(s.o.map((t, i) => ({ t, i })));
    let locked = false;
    stepBox.replaceChildren(
      el('div', { class: 'step-head' }, s.part ? el('span', { class: 'part' }, `סעיף ${s.part}`) : null, el('small', { class: 'muted' }, `שלב ${k + 1} מתוך ${steps.length}`)),
      H('div', { class: 'step-q' }, fmtX(s.q)),
      el('div', { class: 'mc' + (s.o.some(t => t.length > 38) ? ' mc-wide' : '') }, opts.map(({ t, i }) => {
        const b = H('button', { class: 'mc-btn', onclick: async () => {
          if (locked || b.disabled) return;
          if (s.branch) { // a choice of method: every option is right
            locked = true; b.classList.add('mc-ok');
            why.replaceChildren(el('b', { class: 'good' }, 'בחירה טובה! ממשיכים בדרך הזאת'));
            addWork({ part: s.part, work: 'דרך הפתרון: ' + t });
            steps.splice(k, 1, ...s.branch[i]);
            setTimeout(showStep, 750);
            return;
          }
          if (i === 0) {
            locked = true; b.classList.add('mc-ok');
            why.replaceChildren(el('b', { class: 'good' }, pick(GOOD)));
            addWork(s); if (s.now) setNow(s.now); k++;
            setTimeout(showStep, 750);
          } else {
            mistakes++; b.classList.add('mc-bad'); b.disabled = true;
            { const pr = await getSetting('examProgress', {}); const q = pr[p.id] = pr[p.id] || {}; q.errs = (q.errs ?? q.mistakes ?? 0) + 1; q.tries = (q.tries || 0) + 1; await setSetting('examProgress', pr); }
            why.innerHTML = s.why?.[i] ? '💡 ' + fmtX(s.why[i]) : '';
            await oops(C.sound());
          }
        } }, fmtX(t));
        return b;
      })),
      why);
  };

  const finish = async () => {
    const prog = await getSetting('examProgress', {});
    const first = !prog[p.id]?.solved;
    const old = prog[p.id] || {};
    prog[p.id] = { ...old, solved: true, date: todayISO(), mistakes: Math.min(mistakes, old.mistakes ?? 99), clean: old.clean || mistakes === 0, errs: old.errs ?? mistakes };
    await setSetting('examProgress', prog);
    stepBox.replaceChildren(el('div', { class: 'fb-ok' },
      el('b', {}, mistakes ? `סיימת! (${mistakes} ניסיונות חוזרים בדרך, וזה בסדר גמור)` : 'סיימת בלי אף טעות! 🌟'),
      el('div', { class: 'row' },
        examMode ? el('button', { class: 'btn', onclick: nextInQueue }, queue.length ? 'לשאלה הבאה ←' : 'סיום המבחן 🎉') : el('button', { class: 'btn', onclick: () => openExam(C) }, 'לרשימת השאלות'),
        el('button', { class: 'btn btn-ghost', onclick: () => runProblem(p.id) }, '↺ שוב מההתחלה'))));
    const e = STICKERS[Math.floor(Math.random() * STICKERS.length)];
    await (await import('./xp.js')).award(first ? (mistakes ? 20 : 35) : 8, 'exam');
    if (first) { const st = await getSetting('stickers', []); st.push({ e, d: prog[p.id].date, ex: 'exam:' + p.id }); await setSetting('stickers', st); }
    await praise(C.child().first, e, { sound: C.sound(), text: mistakes ? 'פתרת את כל השאלה!' : 'מושלם! בלי טעויות!', sub: first ? 'מדבקה חדשה נוספה לאוסף' : 'כל הכבוד!' });
  };

  const topic = TOPICS.find(t => t.id === p.topic);
  C.screen(
    C.topbar(p.title, () => openExam(C)),
    el('main', { class: 'geo exam' },
      el('section', { class: 'geo-q' },
        el('div', { class: 'card q-card', style: `border-top: 6px solid ${topic.color}` },
          el('div', { class: 'q-topic' }, `${topic.icon} ${topic.title}`),
          H('p', {}, fmtX(p.text)),
          p.eq ? H('div', { class: 'q-eq' }, fmtX(p.eq)) : null,
          p.parts ? el('div', { class: 'q-parts' }, p.parts.map(t => H('div', {}, fmtX(t)))) : null,
          p.plot ? H('div', { class: 'q-plot' }, renderPlot(p.plot)) : null,
          p.svg && SVG[p.svg] ? H('div', { class: 'q-plot' }, SVG[p.svg]) : null,
          p.fig ? H('div', { class: 'q-plot geo-fig' }, renderFigure(p.fig)) : null)),
      el('section', { class: 'geo-work' },
        dots,
        nowBox,
        el('div', { class: 'card' }, el('h3', {}, '📝 הפתרון שלי'), work),
        stepBox)));
  showStep();
}
