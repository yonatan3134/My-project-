// Focus timer (pomodoro) with screen wake lock, plus the guide for locking distracting apps on the phone itself.
import { el } from './util.js';
import { getSetting, setSetting } from './db.js';
import { award } from './xp.js';
import { praise } from './celebrate.js';

let C, tick = null, lock = null;
const PRESETS = [[25, 5, 'קלאסי'], [45, 10, 'עמוק'], [15, 3, 'קצר'], [50, 10, 'מרתון']];
const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

async function wake(on) {
  try {
    if (on && 'wakeLock' in navigator && !lock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); }
    if (!on && lock) { await lock.release(); lock = null; }
  } catch { }
}
document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible' && (await getSetting('focusRun', null))) wake(true); });

function beep() {
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)(); let t = a.currentTime;
    for (const f of [660, 880, 660, 880, 1046]) { const o = a.createOscillator(), g = a.createGain(); o.frequency.value = f; g.gain.setValueAtTime(.25, t); g.gain.exponentialRampToValueAtTime(.001, t + .25); o.connect(g).connect(a.destination); o.start(t); o.stop(t + .26); t += .22; }
  } catch { }
  try { navigator.vibrate?.([300, 120, 300, 120, 600]); } catch { }
}

export async function openFocus(ctx) {
  C = ctx;
  clearInterval(tick);
  let run = await getSetting('focusRun', null); // { phase:'work'|'break', end, total, work, brk, subject }
  let preset = await getSetting('focusPreset', 0);
  const subj = el('input', { type: 'text', placeholder: 'על מה עובדים? (לא חובה)', value: run?.subject || '' });
  const big = el('div', { class: 'clock' }, '25:00');
  const phase = el('div', { class: 'clock-phase' });
  const ring = el('div', { class: 'focus-ring' }, el('div', { class: 'focus-ring-in' }, phase, big));
  const ctl = el('div', { class: 'row' });
  const presetRow = el('div', { class: 'seg seg-4' });
  const sessions = el('div', { class: 'muted center' });

  const drawPresets = () => presetRow.replaceChildren(...PRESETS.map(([w, b, n], i) => el('button', { class: 'seg-btn' + (i === preset ? ' seg-on' : ''), disabled: !!run, onclick: async () => { preset = i; await setSetting('focusPreset', i); draw(); } }, `${n}`, el('small', {}, ` ${w}/${b}`))));
  const start = async () => {
    const [w, b] = PRESETS[preset];
    run = { phase: 'work', end: Date.now() + w * 60000, total: w * 60, work: w, brk: b, subject: subj.value.trim() };
    await setSetting('focusRun', run); wake(true); draw();
  };
  const stop = async () => {
    if (run?.phase === 'work' && !(await C.confirmBox('לעצור את הסשן? הדקות שעברו לא נספרות.', 'לעצור', 'להמשיך'))) return;
    run = null; await setSetting('focusRun', null); wake(false); draw();
  };
  const finishWork = async () => {
    beep();
    const mins = run.work;
    const log = await getSetting('focusLog', []); log.push({ at: Date.now(), mins, subject: run.subject }); await setSetting('focusLog', log.slice(-500));
    await award(mins, 'focus');
    run = { ...run, phase: 'break', end: Date.now() + run.brk * 60000, total: run.brk * 60 };
    await setSetting('focusRun', run);
    await praise(C.child().first, '🧘', { sound: C.sound(), text: `${mins} דקות פוקוס!`, sub: `+${mins} XP · עכשיו הפסקה של ${run.brk} דקות` });
    draw();
  };
  const draw = async () => {
    drawPresets();
    const log = await getSetting('focusLog', []);
    const today = new Date().toDateString();
    const t = log.filter(x => new Date(x.at).toDateString() === today);
    sessions.textContent = t.length ? `היום: ${t.length} סשנים · ${t.reduce((a, x) => a + x.mins, 0)} דקות` : 'עוד אין סשנים היום';
    if (!run) {
      const [w] = PRESETS[preset];
      big.textContent = fmt(w * 60); phase.textContent = 'מוכן?'; ring.style.setProperty('--p', 0); ring.className = 'focus-ring';
      ctl.replaceChildren(el('button', { class: 'btn btn-big btn-go', onclick: start }, '▶ להתחיל'));
    } else {
      ctl.replaceChildren(el('button', { class: 'btn btn-big btn-ghost', onclick: stop }, run.phase === 'work' ? '⏹ לעצור' : '⏭ לדלג על ההפסקה'));
    }
  };
  const loop = async () => {
    if (!document.body.contains(ring)) return clearInterval(tick);
    if (!run) return;
    const left = Math.max(0, (run.end - Date.now()) / 1000);
    big.textContent = fmt(Math.ceil(left));
    phase.textContent = run.phase === 'work' ? (run.subject ? `🎯 ${run.subject}` : '🎯 פוקוס') : '☕ הפסקה';
    ring.className = 'focus-ring ' + (run.phase === 'work' ? 'ring-work' : 'ring-break');
    ring.style.setProperty('--p', (1 - left / run.total) * 100);
    if (left <= 0) {
      if (run.phase === 'work') await finishWork();
      else { beep(); run = null; await setSetting('focusRun', null); wake(false); C.toast('ההפסקה נגמרה. עוד סשן? 💪'); draw(); }
    }
  };
  C.screen(C.topbar('פוקוס ⏱️', () => { clearInterval(tick); C.home(); }),
    el('main', { class: 'page focus' },
      el('section', { class: 'focus-top' }, ring),
      el('section', { class: 'focus-bottom grid' }, presetRow, subj, ctl, sessions,
        el('p', { class: 'muted center' }, 'המסך נשאר דולק בזמן הסשן. ב-Fold אפשר לקפל את המכשיר לחצי (Flex Mode): השעון עולה למעלה והכפתורים יורדים למטה.'),
        el('button', { class: 'btn btn-ghost', onclick: () => phoneGuide() }, '🔒 לחסום את טיקטוק בזמן הלמידה'))));
  if (run) wake(true);
  draw(); loop(); tick = setInterval(loop, 250);
}

export function phoneGuide(ctx) {
  if (ctx) C = ctx;
  C.modal(el('div', { class: 'guide' },
    el('h2', {}, '🔒 לחסום אפליקציות בטלפון'),
    el('p', {}, 'המחברת רצה בתוך Chrome, ולכן אין לה גישה לסגור אפליקציות אחרות. הכלים שכן יכולים לחסום מובנים כבר בגלקסי:'),
    el('div', { class: 'guide-step' }, el('b', {}, '1. טיימר לאפליקציה (חוסם אחרי הזמן)'),
      el('p', {}, 'הגדרות ← רווחה דיגיטלית ובקרת הורים ← לוחצים על טיקטוק ← טיימר לאפליקציה. בוחרים למשל 30 דקות. כשהזמן נגמר, האייקון נהיה אפור והאפליקציה לא נפתחת עד חצות.')),
    el('div', { class: 'guide-step' }, el('b', {}, '2. מצב לימודים בזמנים קבועים'),
      el('p', {}, 'הגדרות ← מצבים ושגרות ← מוסיפים מצב "לימודים". בוחרים שעות (למשל 16:00 עד 18:00) ומשתיקים בו את ההתראות של טיקטוק, אינסטגרם ומשחקים.')),
    el('div', { class: 'guide-step' }, el('b', {}, '3. נעילה שאי אפשר לעקוף: Google Family Link'),
      el('p', {}, 'הורה מתקין את Family Link בטלפון שלו ומחבר אותו לטלפון שלך. ככה ההגבלות נשלטות מהטלפון של ההורה, ואפשר לבקש ממנו זמן נוסף. בסוף כל יום המחברת מכינה לך הודעה מוכנה עם מה שעשית.')),
    el('p', { class: 'muted' }, 'השמות בתפריטים יכולים להשתנות קצת לפי גרסת One UI.')), { wide: true });
}
