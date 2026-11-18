export const pad2 = n => String(n).padStart(2, '0');
export function todayISO(d = new Date()) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
export function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function fmtDate(s) { const d = parseISO(s); return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`; }
export function fmtShort(s) { const d = parseISO(s); return `${d.getDate()}/${d.getMonth() + 1}`; }
export function daysBetween(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 86400000); }
export const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export function dayName(s) { return DAY_NAMES[parseISO(s).getDay()]; }

// Due date: the next Monday after the day the sheet was received.
export function nextMonday(iso) {
  const d = parseISO(iso);
  const add = ((1 - d.getDay() + 7) % 7) || 7;
  d.setDate(d.getDate() + add);
  return todayISO(d);
}

export const PACE_DAYS = 6;

export function allExercises(sheet) {
  return sheetOrder(sheet).map(o => o.ex);
}
export function sheetOrder(sheet) {
  const out = [];
  for (const table of sheet.tables) for (const group of table.groups) for (const ex of group.exercises) out.push({ table, group, ex });
  return out;
}

export function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return todayISO(d); }

// The 6 working days are the 6 days before the due date (due Monday 16/11 -> days 10/11..15/11).
export function paceStart(sheet) { return addDays(sheet.dueDate, -PACE_DAYS); }

// Progress against the expected pace: by the end of day k, k/6 of the sheet should be done.
export function pace(sheet, doneIds, today = todayISO()) {
  const total = allExercises(sheet).length || 1;
  const done = allExercises(sheet).filter(e => doneIds.has(e.id)).length;
  const rawDay = daysBetween(paceStart(sheet), today) + 1;
  const day = Math.min(PACE_DAYS, Math.max(0, rawDay));
  const expectedCount = Math.ceil(total * day / PACE_DAYS);
  const ratio = done / total, expected = day / PACE_DAYS;
  let level = 'behind';
  if (done >= total) level = 'complete';
  else if (day < PACE_DAYS && done >= Math.ceil(total * (day + 1) / PACE_DAYS)) level = 'ahead';
  else if (done >= expectedCount) level = 'onpace';
  return { total, done, day, rawDay, ratio, expected, expectedCount, missing: Math.max(0, expectedCount - done), level };
}

export const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};

// progress colour for an exam question / proof: clean = solved with no mistakes (green), try = attempted with mistakes (yellow)
export function statusOf(p, isGeo) {
  if (!p) return 'new';
  const errs = p.errs ?? (isGeo ? Math.max(0, (p.tries || 0) - (p.solved ? 1 : 0)) : p.mistakes || 0);
  if (p.clean || (p.solved && errs === 0)) return 'clean';
  if (p.solved || p.tries || errs) return 'try';
  return 'new';
}
export function errsOf(p, isGeo) { return !p ? 0 : p.errs ?? (isGeo ? Math.max(0, (p.tries || 0) - (p.solved ? 1 : 0)) : p.mistakes || 0); }
// weighted pick for practice: never a clean one (unless nothing else), more mistakes = more likely
export function weightedPick(items, statusFn, errsFn) {
  let pool = items.filter(i => statusFn(i) !== 'clean');
  if (!pool.length) pool = items;
  const w = pool.map(i => statusFn(i) === 'new' ? 3 : 3 + Math.min(errsFn(i), 12));
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let k = 0; k < pool.length; k++) { r -= w[k]; if (r <= 0) return pool[k]; }
  return pool[pool.length - 1];
}
