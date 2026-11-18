// "התאמה לכתב שלי": learns the pen type, line darkness, stroke width and normal writing density
// from one photo of Yonatan's notebook, then tunes photo cleaning + erasure detection to it.
import { el } from './util.js';
import { getSetting, setSetting } from './db.js';

let C;
const lumOf = (d, p) => 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
const pct = (arr, q) => { if (!arr.length) return 0; const a = Float32Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.floor(a.length * q))]; };

export function analyze(IP, src) {
  const small = IP.scaleCanvas(src, 1400);
  const base = IP.enhance(small, { clean: 0, contrast: 0, sharp: 0 });
  const W = base.width, H = base.height, N = W * H;
  const d = base.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const ink = new Uint8Array(N); const lums = [], sats = [], blues = [];
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    const r = d[p], g = d[p + 1], b = d[p + 2], l = lumOf(d, p), sat = Math.max(r, g, b) - Math.min(r, g, b);
    const grid = b - r > 8 && l > 160 && sat < 80;
    if (l < 190 && !grid) { ink[i] = 1; if (i % 3 === 0) { lums.push(l); sats.push(sat); blues.push(b - r); } }
  }
  const inkCount = ink.reduce((a, v) => a + v, 0);
  if (inkCount / N < 0.003) return null;
  let perim = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x; if (!ink[i]) continue;
    if (!ink[i - 1] || !ink[i + 1] || !ink[i - W] || !ink[i + W]) perim++;
  }
  const width = 2 * inkCount / Math.max(1, perim);              // average stroke width in px (at 1400px page)
  const dark = pct(lums, 0.5), sat = pct(sats, 0.5), blue = pct(blues, 0.5);
  const pen = sat > 35 && blue > 15 ? 'blue' : dark > 105 && sat < 30 ? 'pencil' : 'dark';
  const thin = width < 2.4, thick = width > 4.2;
  const opts = {
    clean: thin ? 1 : 2,
    contrast: pen === 'pencil' ? (dark > 135 ? 3 : 2) : dark > 95 ? 2 : 1,
    sharp: thin || pen === 'pencil' ? 2 : thick ? 0 : 1,
  };
  const inkThr = pen === 'pencil' ? 200 : 185;
  // how dense is normal writing? erasure detection must stay above it
  const enh = IP.enhance(small, opts);
  // lowest erasure threshold at which his normal writing is NOT flagged, plus a safety margin
  let eraseHot = 0.38;
  for (let t = 0.38; t <= 0.8; t += 0.03) { eraseHot = t; if (!IP.detectErasures(enh, { eraseHot: t, eraseRing: t * 0.58, inkThr }).length) break; }
  eraseHot = Math.min(0.85, eraseHot === 0.38 ? 0.38 : eraseHot + 0.05);
  const p97 = eraseHot;
  return { pen, dark: Math.round(dark), width: +width.toFixed(1), opts, inkThr, eraseHot: +eraseHot.toFixed(2), eraseRing: +(eraseHot * 0.58).toFixed(2), density: +p97.toFixed(2), at: Date.now() };
}

const PEN = { pencil: '✏️ עיפרון', blue: '🖊️ עט כחול', dark: '🖋️ עט כהה' };
const LEVELS = ['כבוי', 'רגיל', 'חזק', 'מקסימום'];

export async function openHandwriting(ctx, back) {
  C = ctx; back = back || C.home;
  const IP = await import('./imgproc.js');
  let prof = await getSetting('handProfile', null), src = null;
  const file = el('input', { type: 'file', accept: 'image/*', hidden: true });
  const before = el('canvas', { class: 'rev-canvas' }), after = el('canvas', { class: 'rev-canvas' });
  const info = el('div', { class: 'hand-info' }), ctl = el('div', { class: 'grid' }), view = el('div', { class: 'hand-view', hidden: true });
  const paint = (cv, s, rects) => {
    cv.width = s.width; cv.height = s.height; const g = cv.getContext('2d'); g.drawImage(s, 0, 0);
    if (rects) { g.lineWidth = Math.max(3, s.width / 250); g.strokeStyle = '#e0405f'; for (const r of rects) g.strokeRect(r.x, r.y, r.w, r.h); }
  };
  const render = () => {
    if (!src || !prof) return;
    const small = IP.scaleCanvas(src, 1100);
    const enh = IP.enhance(small, prof.opts);
    paint(before, small); paint(after, enh, IP.detectErasures(enh, prof));
    info.replaceChildren(
      chip('סוג כתיבה', PEN[prof.pen]), chip('עובי קו', prof.width < 2.4 ? 'דק' : prof.width > 4.2 ? 'עבה' : 'בינוני'),
      chip('כהות', prof.dark > 120 ? 'חלש' : prof.dark > 80 ? 'בינוני' : 'כהה'), chip('זיהוי מחיקות', prof.eraseHot <= 0.4 ? 'רגיל' : prof.eraseHot <= 0.55 ? 'מותאם לכתב צפוף' : 'מותאם לכתב צפוף מאוד'));
    ctl.replaceChildren(seg('clean', '🧽 ניקוי רקע'), seg('contrast', '🖊️ הכהיית הכתב'), seg('sharp', '🔍 חדות'),
      el('div', { class: 'seg-row' }, el('span', { class: 'seg-label' }, '🧹 רגישות למחיקות'),
        el('div', { class: 'seg seg-3' }, [['פחות', 1.2], ['מותאם', 1], ['יותר', 0.85]].map(([t, f]) => el('button', { class: 'seg-btn' + ((prof.eraseF || 1) === f ? ' seg-on' : ''), onclick: () => {
          const baseHot = prof.eraseBase || prof.eraseHot; prof.eraseBase = baseHot; prof.eraseF = f;
          prof.eraseHot = Math.min(0.85, +(baseHot * f).toFixed(2)); prof.eraseRing = +(prof.eraseHot * 0.58).toFixed(2); render();
        } }, t)))));
    view.hidden = false;
  };
  const seg = (key, label) => el('div', { class: 'seg-row' }, el('span', { class: 'seg-label' }, label),
    el('div', { class: 'seg' }, LEVELS.map((t, v) => el('button', { class: 'seg-btn' + (prof.opts[key] === v ? ' seg-on' : ''), onclick: () => { prof.opts[key] = v; render(); } }, t))));
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    const stop = C.busy('לומד את הכתב שלך…');
    try {
      src = await IP.fileToCanvas(f, 2400);
      await new Promise(r => setTimeout(r, 30));
      const p = analyze(IP, src);
      if (!p) { C.toast('לא מצאתי כתב בתמונה. צלם דף עם הרבה כתב, מקרוב'); return; }
      prof = p; render();
    } finally { stop(); file.value = ''; }
  });
  C.screen(C.topbar('התאמה לכתב שלי ✍️', back),
    el('main', { class: 'page' },
      el('section', { class: 'card grid' },
        el('p', {}, 'צלם דף מהמחברת שיש בו הרבה כתב רגיל שלך, בלי מחיקות. המחברת לומדת ממנו באיזה כלי אתה כותב (עיפרון או עט), כמה הקו עבה וכהה וכמה צפוף אתה כותב.'),
        el('p', { class: 'muted' }, 'לפי זה היא מכוונת את ניקוי התמונות כך שהכתב שלך לא יימחק ולא יהפוך לכתם, ואת זיהוי המחיקות כך שכתב צפוף לא יסומן בטעות כמחיקה.'),
        prof ? el('div', { class: 'ok-line' }, `✓ יש כבר כיול שמור (${PEN[prof.pen]}). אפשר לצלם שוב כדי לעדכן.`) : null,
        el('button', { class: 'btn btn-big', onclick: () => file.click() }, '📷 לצלם או לבחור דף'), file),
      el('div', { class: 'grid' }, view),
    ));
  view.append(
    el('section', { class: 'card grid' }, el('h3', {}, 'מה למדתי'), info, ctl),
    el('section', { class: 'card' }, el('h3', {}, 'לפני ואחרי'), el('p', { class: 'muted' }, 'אם מופיע מלבן אדום על כתב רגיל, הורד את הרגישות למחיקות.'),
      el('div', { class: 'rev-cols' }, el('div', { class: 'rev-wrap' }, before), el('div', { class: 'rev-wrap' }, after))),
    el('button', { class: 'btn btn-big btn-go', onclick: async () => {
      await setSetting('handProfile', prof); await setSetting('enhOpts', { ...prof.opts });
      C.toast('נשמר! מעכשיו כל צילום מותאם לכתב שלך ✍️'); back();
    } }, '💾 לשמור את ההתאמה'));
  if (prof && !src) { info.replaceChildren(chip('סוג כתיבה', PEN[prof.pen]), chip('עובי קו', `${prof.width}px`)); }
}
const chip = (k, v) => el('div', { class: 'hand-chip' }, el('small', {}, k), el('b', {}, v));
