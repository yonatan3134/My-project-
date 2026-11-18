// XP, levels, streaks, daily goal and achievements — shared by every module.
import { getSetting, setSetting } from './db.js';
import { todayISO, addDays } from './util.js';

export const LEVELS = ['מתחיל', 'חניך', 'לומד', 'מתאמן', 'חרוץ', 'מקצוען', 'מומחה', 'אמן', 'אגדה', 'אלוף העל'];

// level n needs 60*n*(n+1)/2 xp in total: 0, 60, 180, 360, 600 ...
export function levelOf(xp) {
  let n = 0; while (60 * (n + 1) * (n + 2) / 2 <= xp) n++;
  const base = 60 * n * (n + 1) / 2, next = 60 * (n + 1) * (n + 2) / 2;
  return { n: n + 1, title: LEVELS[Math.min(n, LEVELS.length - 1)], into: xp - base, need: next - base, ratio: (xp - base) / (next - base) };
}

export async function activity() { return getSetting('activity', {}); }
export async function goal() { return getSetting('dailyGoal', 100); }

const KIND_NAMES = { hw: 'שיעורי בית', geo: 'גאומטריה', exam: 'מבחנים', en: 'אנגלית', py: 'פייתון', focus: 'פוקוס', plan: 'משימות' };
export const kindName = k => KIND_NAMES[k] || k;

// add xp for a kind of work. Returns { xp, total, levelUp, goalReached }
export async function award(xp, kind, count = 1) {
  if (!xp) return null;
  const act = await activity();
  const d = todayISO();
  const day = act[d] || (act[d] = { xp: 0, n: {} });
  const g = await goal();
  const before = day.xp;
  day.xp += xp; day.n[kind] = (day.n[kind] || 0) + count;
  await setSetting('activity', act);
  const total = (await getSetting('xpTotal', 0)) + xp;
  const lvBefore = levelOf(total - xp).n;
  await setSetting('xpTotal', total);
  const res = { xp, total, levelUp: levelOf(total).n > lvBefore ? levelOf(total) : null, goalReached: before < g && day.xp >= g };
  window.dispatchEvent(new CustomEvent('xp', { detail: res }));
  return res;
}

export function streakOf(act, g) {
  let s = 0, d = todayISO();
  if (!((act[d]?.xp || 0) >= Math.min(g, 20))) d = addDays(d, -1); // today not started yet: count from yesterday
  while ((act[d]?.xp || 0) >= Math.min(g, 20)) { s++; d = addDays(d, -1); }
  return s;
}

export async function summary() {
  const act = await activity(), g = await goal(), total = await getSetting('xpTotal', 0);
  const today = act[todayISO()] || { xp: 0, n: {} };
  return { act, goal: g, total, today, level: levelOf(total), streak: streakOf(act, g), best: await bestStreak(act, g) };
}
async function bestStreak(act, g) {
  const days = Object.keys(act).sort(); let best = 0, cur = 0, prev = null;
  for (const d of days) {
    if ((act[d].xp || 0) < Math.min(g, 20)) { cur = 0; prev = d; continue; }
    cur = prev && addDays(prev, 1) === d ? cur + 1 : 1; prev = d; best = Math.max(best, cur);
  }
  const b = Math.max(best, await getSetting('bestStreak', 0)); await setSetting('bestStreak', b); return b;
}

export const BADGES = [
  { id: 'first', icon: '🐣', name: 'צעד ראשון', desc: 'הרווחת XP ראשון', test: s => s.total > 0 },
  { id: 'goal1', icon: '🎯', name: 'יעד יומי', desc: 'עמדת ביעד היומי', test: s => Object.values(s.act).some(d => d.xp >= s.goal) },
  { id: 's3', icon: '🔥', name: 'רצף 3', desc: '3 ימים ברצף', test: s => s.best >= 3 },
  { id: 's7', icon: '☄️', name: 'שבוע אש', desc: '7 ימים ברצף', test: s => s.best >= 7 },
  { id: 's30', icon: '🌋', name: 'בלתי ניתן לעצירה', desc: '30 ימים ברצף', test: s => s.best >= 30 },
  { id: 'l5', icon: '⚡', name: 'רמה 5', desc: 'הגעת לרמה 5', test: s => s.level.n >= 5 },
  { id: 'l10', icon: '👑', name: 'רמה 10', desc: 'הגעת לרמה 10', test: s => s.level.n >= 10 },
  { id: 'xp1k', icon: '💎', name: '1,000 XP', desc: 'אלף נקודות בסך הכול', test: s => s.total >= 1000 },
  { id: 'en50', icon: '🇬🇧', name: 'מילון מהלך', desc: '50 תשובות נכונות באנגלית', test: s => sumKind(s.act, 'en') >= 50 },
  { id: 'py30', icon: '🐍', name: 'פייתוניסט', desc: '30 שאלות פייתון נכונות', test: s => sumKind(s.act, 'py') >= 30 },
  { id: 'focus', icon: '🧘', name: 'מכונת ריכוז', desc: '10 סשנים של פוקוס', test: s => sumKind(s.act, 'focus') >= 10 },
  { id: 'big', icon: '🚀', name: 'יום מטורף', desc: '300 XP ביום אחד', test: s => Object.values(s.act).some(d => d.xp >= 300) },
];
export const sumKind = (act, k) => Object.values(act).reduce((a, d) => a + (d.n?.[k] || 0), 0);
