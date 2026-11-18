// Planner (tests + tasks with countdown) and the stats / achievements screen.
import { el, todayISO, fmtDate, daysBetween, dayName, addDays, parseISO } from './util.js';
import { getSetting, setSetting, uid } from './db.js';
import { award, summary, BADGES, kindName, sumKind } from './xp.js';

let C;
export async function items() {
  if (!(await getSetting('plannerSeeded', false))) {
    await setSetting('planner', [{ id: uid(), kind: 'test', title: 'מבחן אנגלית: Unit 1, Festivals', date: '2026-11-16', done: false }]);
    await setSetting('plannerSeeded', true);
  }
  return getSetting('planner', []);
}
export const whenText = d => {
  const n = daysBetween(todayISO(), d);
  return n < 0 ? `לפני ${-n} ימים` : n === 0 ? 'היום!' : n === 1 ? 'מחר' : `בעוד ${n} ימים · יום ${dayName(d)}`;
};
export async function upcoming(k = 3) {
  return (await items()).filter(x => !x.done && daysBetween(todayISO(), x.date) >= 0).sort((a, b) => a.date.localeCompare(b.date)).slice(0, k);
}

export async function openPlanner(ctx) {
  C = ctx;
  const list = (await items()).sort((a, b) => (a.done - b.done) || a.date.localeCompare(b.date));
  const title = el('input', { type: 'text', placeholder: 'מה צריך לעשות?' });
  const date = el('input', { type: 'date', value: addDays(todayISO(), 1) });
  let kind = 'task';
  const kinds = el('div', { class: 'seg seg-2' });
  const drawKinds = () => kinds.replaceChildren(...[['task', '✅ משימה'], ['test', '📝 מבחן']].map(([k, t]) => el('button', { class: 'seg-btn' + (k === kind ? ' seg-on' : ''), onclick: () => { kind = k; drawKinds(); } }, t)));
  drawKinds();
  const save = async l => { await setSetting('planner', l); };
  C.screen(C.topbar('יומן ומשימות 🗓️', C.home),
    el('main', { class: 'page' },
      el('section', { class: 'card grid' }, el('h3', {}, 'להוסיף'), kinds, title, date,
        el('button', { class: 'btn', onclick: async () => {
          if (!title.value.trim()) return C.toast('צריך לכתוב מה');
          const l = await items(); l.push({ id: uid(), kind, title: title.value.trim(), date: date.value || todayISO(), done: false });
          await save(l); openPlanner(C);
        } }, '+ הוספה')),
      list.length ? el('section', { class: 'card plan-list' }, list.map(x => {
        const n = daysBetween(todayISO(), x.date);
        return el('div', { class: 'plan-row' + (x.done ? ' plan-done' : n < 0 ? ' plan-late' : n <= 2 ? ' plan-soon' : '') },
          el('button', { class: 'check' + (x.done ? ' check-on' : ''), onclick: async () => {
            const l = await items(); const it = l.find(y => y.id === x.id); it.done = !it.done; await save(l);
            if (it.done && !it.xp) { it.xp = true; await save(l); await award(x.kind === 'test' ? 30 : 15, 'plan'); C.toast(`+${x.kind === 'test' ? 30 : 15} XP 💪`); }
            openPlanner(C);
          } }, x.done ? '✓' : ''),
          el('div', { class: 'grow' }, el('b', {}, (x.kind === 'test' ? '📝 ' : '') + x.title), el('div', { class: 'muted' }, `${fmtDate(x.date)} · ${whenText(x.date)}`)),
          el('button', { class: 'icon-btn small', onclick: async () => { await save((await items()).filter(y => y.id !== x.id)); openPlanner(C); } }, '🗑️'));
      })) : el('p', { class: 'muted center' }, 'אין כלום ביומן 🎉')));
}

// ---------- stats ----------
export async function openStats(ctx) {
  C = ctx;
  const s = await summary();
  const weeks = 12, start = addDays(todayISO(), -parseISO(todayISO()).getDay() - 7 * (weeks - 1));
  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i), x = s.act[d]?.xp || 0;
    const lv = x === 0 ? 0 : x < s.goal * .4 ? 1 : x < s.goal ? 2 : x < s.goal * 2 ? 3 : 4;
    cells.push(el('div', { class: `hm hm${lv}` + (d === todayISO() ? ' hm-today' : '') + (d > todayISO() ? ' hm-future' : ''), title: `${fmtDate(d)}: ${x} XP` }));
  }
  const kinds = ['hw', 'geo', 'exam', 'en', 'py', 'focus', 'plan'];
  const goalSel = el('select', {}, ...[50, 100, 150, 200, 300].map(v => { const o = el('option', { value: v }, `${v} XP`); if (v === s.goal) o.selected = true; return o; }));
  goalSel.addEventListener('change', async () => { await setSetting('dailyGoal', +goalSel.value); C.toast('היעד עודכן'); openStats(C); });
  const got = BADGES.filter(b => b.test(s));
  C.screen(C.topbar('ההתקדמות שלי 📊', C.home),
    el('main', { class: 'page' },
      el('section', { class: 'card lvl-card' },
        el('div', { class: 'lvl-badge' }, s.level.n),
        el('div', { class: 'grow' }, el('b', {}, `רמה ${s.level.n} · ${s.level.title}`),
          el('div', { class: 'bar' }, el('div', { class: 'bar-fill', style: `width:${s.level.ratio * 100}%` })),
          el('div', { class: 'muted' }, `${s.level.into}/${s.level.need} XP לרמה הבאה · סה״כ ${s.total.toLocaleString()} XP`))),
      el('div', { class: 'stat-row' },
        stat('🔥', s.streak, 'ימים ברצף'), stat('🏅', s.best, 'שיא רצף'), stat('⚡', s.today.xp, 'XP היום'), stat('🎖️', `${got.length}/${BADGES.length}`, 'הישגים')),
      el('section', { class: 'card' }, el('h3', {}, '12 השבועות האחרונים'), el('div', { class: 'heat' }, cells),
        el('div', { class: 'muted heat-leg' }, 'פחות ', ...[0, 1, 2, 3, 4].map(i => el('span', { class: `hm hm${i}` })), ' יותר')),
      el('section', { class: 'card' }, el('h3', {}, 'לפי תחום (סה״כ פעולות)'),
        el('div', { class: 'kind-list' }, kinds.map(k => el('div', { class: 'kind-row' }, el('span', {}, kindName(k)), el('b', {}, sumKind(s.act, k)))))),
      el('section', { class: 'card' }, el('h3', {}, 'הישגים'),
        el('div', { class: 'badges' }, BADGES.map(b => el('div', { class: 'badge' + (got.includes(b) ? '' : ' badge-off') }, el('div', { class: 'badge-ic' }, b.icon), el('b', {}, b.name), el('small', {}, b.desc))))),
      el('section', { class: 'card' }, el('label', {}, 'יעד יומי ', goalSel), el('p', { class: 'muted' }, 'יום נכנס לרצף אם הרווחת בו לפחות 20 XP.'))));
}
const stat = (ic, v, t) => el('div', { class: 'stat' }, el('div', { class: 'stat-ic' }, ic), el('b', {}, v), el('small', {}, t));
