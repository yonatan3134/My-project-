// Python course: short concept card + "what does this print?" questions, units unlock one after another.
import { el } from './util.js';
import { getSetting, setSetting } from './db.js';
import { UNITS } from './python-data.js';
import { award } from './xp.js';
import { praise } from './celebrate.js';

let C;
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const code = s => el('pre', { class: 'code', dir: 'ltr' }, s);
const buzz = ms => { try { navigator.vibrate?.(ms); } catch { } };
export const pyTotals = async () => { const p = await getSetting('pyProgress', {}); const all = UNITS.flatMap(u => u.qs); return { done: all.filter(q => p[q.id]?.solved).length, total: all.length }; };

export async function openPython(ctx) {
  C = ctx;
  const prog = await getSetting('pyProgress', {});
  let open = true;
  C.screen(C.topbar('פייתון 🐍', C.home),
    el('main', { class: 'page' },
      el('section', { class: 'card' }, el('h2', {}, 'לומדים לחשוב כמו המחשב'),
        el('p', { class: 'muted' }, 'בכל יחידה יש הסבר קצר ואחריו שאלות של "מה יודפס?". כדי לפתוח את היחידה הבאה צריך לפתור 70% מהיחידה הנוכחית.')),
      el('div', { class: 'units' }, UNITS.map((u, i) => {
        const done = u.qs.filter(q => prog[q.id]?.solved).length;
        const isOpen = open; open = open && done / u.qs.length >= 0.7;
        return el('button', { class: 'unit' + (isOpen ? '' : ' unit-lock') + (done === u.qs.length ? ' unit-done' : ''), disabled: !isOpen, onclick: () => unit(i) },
          el('div', { class: 'unit-n' }, isOpen ? (done === u.qs.length ? '✓' : i + 1) : '🔒'),
          el('div', { class: 'grow' }, el('b', {}, u.title), el('div', { class: 'bar' }, el('div', { class: 'bar-fill', style: `width:${done / u.qs.length * 100}%` }))),
          el('small', {}, `${done}/${u.qs.length}`));
      }))));
}

async function unit(ui) {
  const u = UNITS[ui];
  const prog = await getSetting('pyProgress', {});
  const qs = [...u.qs.filter(q => !prog[q.id]?.solved), ...u.qs.filter(q => prog[q.id]?.solved)];
  let i = -1, xp = 0, clean = 0;
  const top = C.topbar(u.title, () => openPython(C));
  const stage = el('div', { class: 'stage' });
  C.screen(top, el('main', { class: 'page practice' }, stage));
  const next = async () => {
    i++;
    if (i >= qs.length) {
      if (xp) await award(xp, 'py', clean);
      if (clean === qs.length) await praise(C.child().first, '🐍', { sound: C.sound(), text: 'יחידה מושלמת!', sub: `+${xp} XP` });
      return stage.replaceChildren(el('section', { class: 'card center grid' }, el('h2', {}, `סיימת את "${u.title}"`),
        el('div', {}, `${clean} מתוך ${qs.length} בניסיון ראשון · +${xp} XP`),
        el('div', { class: 'row' }, ui + 1 < UNITS.length ? el('button', { class: 'btn', onclick: () => openPython(C) }, 'ליחידות ←') : null,
          el('button', { class: 'btn btn-ghost', onclick: () => unit(ui) }, 'שוב 🔁'))));
    }
    const q = qs[i]; let tried = false;
    const why = el('div', { class: 'why' });
    const opts = shuffle([q.ans, ...q.wrong]);
    top.querySelector('h1').textContent = `${u.title} · ${i + 1}/${qs.length}`;
    stage.replaceChildren(
      el('div', { class: 'muted center' }, 'מה יודפס?'), code(q.code),
      el('div', { class: 'mc' }, opts.map(o => el('button', { class: 'mc-btn mc-code', dir: 'ltr', onclick: async ev => {
        const b = ev.currentTarget;
        if (o === q.ans) {
          b.classList.add('mc-ok'); buzz(30);
          if (!tried) { xp += 6; clean++; }
          const p = await getSetting('pyProgress', {}); p[q.id] = { solved: true, clean: !tried || p[q.id]?.clean }; await setSetting('pyProgress', p);
          why.replaceChildren(el('b', { class: 'good' }, tried ? 'נכון ✓ ' : 'בול! ✓ '), q.why);
          stage.append(el('button', { class: 'btn btn-big', onclick: next }, 'הבא ←'));
          stage.querySelectorAll('.mc-btn').forEach(x => x.disabled = true);
        } else { b.classList.add('mc-bad'); b.disabled = true; tried = true; buzz([60, 40, 60]); why.textContent = 'לא זה. עבור על הקוד שורה אחרי שורה'; }
      } }, el('pre', {}, o)))), why);
  };
  // concept card first
  stage.replaceChildren(el('section', { class: 'card concept' }, el('div', { class: 'muted' }, `יחידה ${ui + 1}`), el('h2', {}, u.title), el('p', {}, u.concept),
    el('button', { class: 'btn btn-big', onclick: next }, 'יאללה לשאלות ←')));
}
