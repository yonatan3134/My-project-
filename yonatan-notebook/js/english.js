// English: vocabulary lists with pronunciation (Leitner boxes), 6 practice modes and a Present Simple drill.
import { el } from './util.js';
import { getSetting, setSetting, uid } from './db.js';
import { award } from './xp.js';
import { praise, oops } from './celebrate.js';

let C;
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = a => a[Math.floor(Math.random() * a.length)];
const norm = s => s.toLowerCase().replace(/[^a-z' ]/g, '').replace(/\s+/g, ' ').trim();

export const UNIT1 = {
  id: 'unit1', title: 'Unit 1 · Festivals', builtin: true,
  words: [
    ['festival', 'פסטיבל, חג'], ['celebrate', 'לחגוג'], ['celebration', 'חגיגה'], ['tradition', 'מסורת'], ['traditional', 'מסורתי'],
    ['custom', 'מנהג'], ['costume', 'תחפושת'], ['parade', 'מצעד'], ['fireworks', 'זיקוקים'], ['decorate', 'לקשט'],
    ['decoration', 'קישוט'], ['candle', 'נר'], ['lantern', 'פנס'], ['feast', 'סעודה, משתה'], ['gift', 'מתנה'],
    ['holiday', 'חג, חופשה'], ['crowd', 'קהל, המון'], ['colorful', 'צבעוני'], ['ceremony', 'טקס'], ['mask', 'מסכה'],
    ['symbol', 'סמל'], ['take place', 'להתקיים'], ['attend', 'להשתתף, לנכוח'], ['harvest', 'קציר, אסיף'], ['religious', 'דתי'],
    ['national', 'לאומי'], ['event', 'אירוע'], ['festive', 'חגיגי'], ['perform', 'להופיע'], ['prepare', 'להכין'],
    ['gather', 'להתאסף'], ['wish', 'משאלה, לאחל'], ['light', 'להדליק; אור'], ['dress up', 'להתחפש, להתלבש יפה'], ['spectacular', 'מרהיב'],
    ['anniversary', 'יום שנה'], ['occasion', 'הזדמנות, אירוע'], ['visitor', 'מבקר'], ['exciting', 'מרגש'], ['lucky', 'בר מזל'],
  ].map(([en, he]) => ({ en, he })),
};

// ---------- speech ----------
let voice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  voice = vs.find(v => /en[-_]US/i.test(v.lang) && /google/i.test(v.name)) || vs.find(v => /en[-_]US/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
let slow = false;
export function say(text, rate) {
  if (!('speechSynthesis' in window)) return C?.toast('אין במכשיר הקראה באנגלית');
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US'; if (voice) u.voice = voice; u.rate = rate || (slow ? 0.6 : 0.95);
  speechSynthesis.speak(u);
}
const spk = (text, label = '🔊') => el('button', { class: 'icon-btn spk', 'aria-label': 'השמעה', onclick: e => { e.stopPropagation(); say(text); } }, label);
const buzz = ms => { try { navigator.vibrate?.(ms); } catch { } };

// ---------- data ----------
async function lists() {
  const mine = await getSetting('enLists', []);
  return [UNIT1, ...mine];
}
async function progress() { return getSetting('enProgress', {}); }
const boxOf = (prog, l, w) => prog[l.id]?.[w.en]?.box || 0;
async function mark(l, w, ok) {
  const prog = await progress();
  const p = ((prog[l.id] ||= {})[w.en] ||= { box: 0, seen: 0, wrong: 0 });
  p.seen++; if (ok) p.box = Math.min(5, p.box + 1); else { p.box = Math.max(0, p.box - 2); p.wrong++; }
  await setSetting('enProgress', prog);
}
// weaker words come up more often
function weighted(l, prog, n) {
  const pool = l.words.map(w => ({ w, k: Math.random() * (6 - boxOf(prog, l, w)) ** 2 }));
  return pool.sort((a, b) => b.k - a.k).slice(0, n).map(x => x.w);
}

// ---------- screens ----------
export async function openEnglish(ctx, listId) {
  C = ctx; slow = await getSetting('ttsSlow', false);
  const all = await lists(), prog = await progress();
  const want = listId || (await getSetting('enList', 'unit1'));
  const l = all.find(x => x.id === want) || all[0];
  await setSetting('enList', l.id);
  const known = l.words.filter(w => boxOf(prog, l, w) >= 3).length;
  const MODES = [
    ['cards', '🃏', 'כרטיסיות', 'הופכים, שומעים, מסמנים'],
    ['en2he', '🇬🇧→🇮🇱', 'מה הפירוש?', 'מאנגלית לעברית'],
    ['he2en', '🇮🇱→🇬🇧', 'איך אומרים?', 'מעברית לאנגלית'],
    ['listen', '🎧', 'האזנה', 'שומעים ובוחרים'],
    ['type', '⌨️', 'איות', 'מקלידים את המילה'],
    ['grammar', '⏱️', 'Present Simple', 'he plays / does he play?'],
    ['test', '📝', 'מבחן מסכם', '15 שאלות מעורבות + ציון'],
  ];
  const slowBox = el('input', { type: 'checkbox' }); slowBox.checked = slow;
  slowBox.addEventListener('change', async () => { slow = slowBox.checked; await setSetting('ttsSlow', slow); say('festival'); });
  C.screen(C.topbar('אנגלית 🇬🇧', C.home),
    el('main', { class: 'page' },
      el('section', { class: 'card en-head' },
        el('div', { class: 'en-list-row' },
          el('div', {}, el('div', { class: 'muted' }, 'רשימה פעילה'), el('h2', {}, l.title)),
          el('button', { class: 'btn btn-ghost', onclick: () => chooseList(all) }, '📚 החלפה')),
        el('div', { class: 'bar' }, el('div', { class: 'bar-fill', style: `width:${Math.round(known / l.words.length * 100)}%` })),
        el('div', { class: 'muted' }, `${known} מתוך ${l.words.length} מילים כבר בכיס (3 תשובות נכונות ומעלה)`),
        el('label', { class: 'inline' }, slowBox, ' 🐢 הקראה איטית')),
      el('div', { class: 'mode-grid' }, MODES.map(([id, ic, t, s]) => el('button', { class: 'mode', onclick: () => run(l, id) },
        el('div', { class: 'mode-ic' }, ic), el('b', {}, t), el('small', {}, s)))),
      el('section', { class: 'card' }, el('h3', {}, 'כל המילים'),
        el('div', { class: 'word-list' }, l.words.map(w => el('div', { class: 'word-row' },
          spk(w.en), el('b', { dir: 'ltr' }, w.en), el('span', {}, w.he),
          el('span', { class: 'boxes' }, '●'.repeat(boxOf(prog, l, w)) + '○'.repeat(5 - boxOf(prog, l, w)))))))));
}

function chooseList(all) {
  const close = C.modal(el('div', { class: 'picker' }, el('h2', {}, 'רשימות מילים'),
    ...all.map(l => el('div', { class: 'list-pick' },
      el('button', { class: 'btn btn-ghost grow', onclick: () => { close(); openEnglish(C, l.id); } }, `${l.title} · ${l.words.length}`),
      l.builtin ? null : el('button', { class: 'icon-btn', onclick: async () => {
        if (!(await C.confirmBox(`למחוק את "${l.title}"?`, 'מחיקה'))) return;
        await setSetting('enLists', (await getSetting('enLists', [])).filter(x => x.id !== l.id)); close(); openEnglish(C, 'unit1');
      } }, '🗑️'))),
    el('button', { class: 'btn', onclick: () => { close(); newList(); } }, '+ רשימה חדשה')));
}

function newList() {
  const title = el('input', { type: 'text', placeholder: 'למשל: Buying a Ticket עמ׳ 26' });
  const ta = el('textarea', { class: 'ta', rows: 10, dir: 'ltr', placeholder: 'ticket - כרטיס\nstation - תחנה\nplatform = רציף' });
  const close = C.modal(el('div', { class: 'picker' }, el('h2', {}, 'רשימה חדשה'),
    el('label', {}, 'שם ', title),
    el('p', { class: 'muted' }, 'מילה בכל שורה: אנגלית, מקף ותרגום. אפשר להעתיק מהווטסאפ של המורה.'), ta,
    el('button', { class: 'btn', onclick: async () => {
      const words = ta.value.split('\n').map(line => {
        const m = line.match(/^\s*([A-Za-z][A-Za-z '\-]*?)\s*[-–=:\t]\s*(.+)$/) || line.match(/^\s*(.+?)\s*[-–=:\t]\s*([A-Za-z][A-Za-z '\-]*)\s*$/);
        if (!m) return null;
        const [a, b] = [m[1].trim(), m[2].trim()];
        return /[A-Za-z]/.test(a) ? { en: a, he: b } : { en: b, he: a };
      }).filter(Boolean);
      if (words.length < 4) return C.toast('צריך לפחות 4 מילים');
      const l = { id: uid(), title: title.value.trim() || 'רשימה שלי', words };
      await setSetting('enLists', [...(await getSetting('enLists', [])), l]);
      close(); C.toast(`נוספו ${words.length} מילים ✓`); openEnglish(C, l.id);
    } }, 'שמירה')), { wide: true });
}

// ---------- practice rounds ----------
async function run(l, mode) {
  if (mode === 'grammar') return grammar(l);
  const prog = await progress();
  const n = mode === 'test' ? 15 : mode === 'cards' ? Math.min(12, l.words.length) : 10;
  const items = weighted(l, prog, n).map(w => ({ w, mode: mode === 'test' ? pick(['en2he', 'he2en', 'listen', 'type', 'gram']) : mode }));
  let i = 0, score = 0, streak = 0, xp = 0;
  const top = C.topbar('', () => openEnglish(C, l.id));
  const dots = el('div', { class: 'dots' });
  const stage = el('div', { class: 'stage' });
  C.screen(top, el('main', { class: 'page practice' }, dots, stage));
  const title = top.querySelector('h1');

  const next = async ok => {
    if (ok) { score++; streak++; const g = 5 + (streak >= 5 ? 2 : 0); xp += g; buzz(30); }
    else { streak = 0; buzz([60, 40, 60]); }
    i++; i < items.length ? show() : finish();
  };
  const finish = async () => {
    if (xp) await award(xp, 'en', score);
    const pct = Math.round(score / items.length * 100);
    const grade = mode === 'test' ? el('div', { class: 'big-score' }, `${pct}`) : null;
    if (pct >= 80) await praise(C.child().first, pick(['🇬🇧', '🎉', '🏆', '⭐']), { sound: C.sound(), text: pct === 100 ? 'מושלם! 100%' : 'מעולה!', sub: `+${xp} XP` });
    stage.replaceChildren(el('section', { class: 'card center grid' },
      grade, el('h2', {}, `${score} מתוך ${items.length} נכונות`), el('div', { class: 'muted' }, `+${xp} XP`),
      el('div', { class: 'row' }, el('button', { class: 'btn', onclick: () => run(l, mode) }, 'עוד סבב 🔁'),
        el('button', { class: 'btn btn-ghost', onclick: () => openEnglish(C, l.id) }, 'חזרה'))));
  };
  const show = () => {
    dots.replaceChildren(...items.map((_, k) => el('div', { class: 'dot' + (k < i ? ' dot-done' : k === i ? ' dot-now' : '') })));
    const { w, mode: m } = items[i];
    title.textContent = `${i + 1}/${items.length}` + (streak >= 3 ? ` · 🔥${streak}` : '');
    ({ cards, en2he: choice, he2en: choice, listen: choice, type: typing, gram: gramQ }[m])(w, m);
  };

  function cards(w) {
    let flipped = false;
    const face = el('div', { class: 'flash' }, el('div', { class: 'flash-en', dir: 'ltr' }, w.en), el('div', { class: 'muted' }, 'נגיעה להפוך'));
    const flip = () => { flipped = !flipped; face.classList.toggle('flipped', flipped);
      face.replaceChildren(flipped ? el('div', { class: 'flash-he' }, w.he) : el('div', { class: 'flash-en', dir: 'ltr' }, w.en)); };
    face.addEventListener('click', flip);
    say(w.en);
    stage.replaceChildren(face, el('div', { class: 'row' }, spk(w.en)),
      el('div', { class: 'actions' },
        el('button', { class: 'btn btn-bad', onclick: async () => { await mark(l, w, false); next(false); } }, '😅 עוד לא'),
        el('button', { class: 'btn btn-good', onclick: async () => { await mark(l, w, true); next(true); } }, '✅ ידעתי')));
  }

  function choice(w, m) {
    const others = shuffle(l.words.filter(x => x !== w)).slice(0, 3);
    const opts = shuffle([w, ...others]);
    const q = m === 'he2en' ? el('div', { class: 'q-word' }, w.he)
      : m === 'listen' ? el('button', { class: 'listen-btn', onclick: () => say(w.en) }, '🔊', el('small', {}, 'נגיעה לשמוע שוב'))
      : el('div', { class: 'q-word', dir: 'ltr' }, w.en, ' ', spk(w.en));
    if (m !== 'he2en') say(w.en);
    const label = m === 'he2en' ? x => x.en : x => x.he;
    let tried = false;
    const btns = opts.map(o => el('button', { class: 'mc-btn', dir: m === 'he2en' ? 'ltr' : 'rtl', onclick: async ev => {
      const b = ev.currentTarget;
      if (o === w) {
        b.classList.add('mc-ok'); if (m === 'he2en') say(w.en);
        await mark(l, w, !tried); setTimeout(() => next(!tried), 650);
      } else { b.classList.add('mc-bad'); b.disabled = true; if (!tried) { tried = true; buzz([60, 40, 60]); } }
    } }, label(o)));
    stage.replaceChildren(el('div', { class: 'muted center' }, { en2he: 'מה הפירוש?', he2en: 'איך אומרים באנגלית?', listen: 'מה שמעת?' }[m]), q, el('div', { class: 'mc' }, btns));
  }

  function typing(w) {
    const inp = el('input', { type: 'text', class: 'type-in', dir: 'ltr', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    let hints = 0, wrong = false;
    const fb = el('div', { class: 'why' });
    const check = async () => {
      if (norm(inp.value) === norm(w.en)) {
        say(w.en); fb.replaceChildren(el('b', { class: 'good' }, 'נכון! ✓'));
        await mark(l, w, !wrong && hints === 0); setTimeout(() => next(!wrong && hints < 2), 700);
      } else { wrong = true; inp.classList.add('shake'); setTimeout(() => inp.classList.remove('shake'), 400); fb.textContent = 'לא בדיוק. נסה שוב או קח רמז'; buzz([60, 40, 60]); }
    };
    inp.addEventListener('keydown', e => e.key === 'Enter' && check());
    stage.replaceChildren(el('div', { class: 'muted center' }, 'כתוב באנגלית:'), el('div', { class: 'q-word' }, w.he), inp, fb,
      el('div', { class: 'row' },
        el('button', { class: 'btn btn-hint', onclick: () => { hints++; inp.value = w.en.slice(0, Math.min(w.en.length, hints + 1)); inp.focus(); } }, '💡 רמז'),
        el('button', { class: 'btn btn-ghost', onclick: () => say(w.en) }, '🔊 להשמיע'),
        el('button', { class: 'btn', onclick: check }, 'בדיקה')));
    setTimeout(() => inp.focus(), 50);
  }

  function gramQ() {
    const g = makeGrammar();
    stage.replaceChildren(el('div', { class: 'muted center' }, 'Present Simple: בחר את הצורה הנכונה'), grammarCard(g, ok => next(ok)));
  }
  show();
}

// ---------- Present Simple ----------
const SUBJ = [['I', 1], ['You', 1], ['We', 1], ['They', 1], ['My parents', 1], ['The kids', 1], ['He', 3], ['She', 3], ['It', 3], ['My brother', 3], ['Dana', 3], ['Our teacher', 3]];
const VERBS = [['play', 'football after school'], ['watch', 'TV in the evening'], ['go', 'to the festival every year'], ['do', 'homework every day'], ['study', 'English on Sundays'],
  ['celebrate', 'Hanukkah with the family'], ['wear', 'a costume on Purim'], ['have', 'a big feast'], ['light', 'candles at night'], ['fly', 'kites in the spring'],
  ['wash', 'the dishes after dinner'], ['visit', 'grandma on Fridays'], ['eat', 'sufganiyot in December'], ['try', 'new food at the market'], ['fix', 'old bikes'], ['finish', 'school at two']];
const TIME = ['every day', 'usually', 'always', 'never', 'often', 'on weekends'];
function s3(v) {
  if (v === 'have') return 'has'; if (v === 'go') return 'goes'; if (v === 'do') return 'does';
  if (/[^aeiou]y$/.test(v)) return v.slice(0, -1) + 'ies';
  if (/(s|sh|ch|x|z|o)$/.test(v)) return v + 'es';
  return v + 's';
}
function wrong3(v) { return /[^aeiou]y$/.test(v) ? v + 's' : /(s|sh|ch|x|z|o)$/.test(v) ? v + 's' : v + 'es'; }
export function makeGrammar() {
  const [s, p] = pick(SUBJ), [v, rest] = pick(VERBS), kind = pick(['pos', 'pos', 'neg', 'q']);
  const subj = s === 'I' ? 'I' : s;
  if (kind === 'pos') {
    const right = p === 3 ? s3(v) : v;
    const opts = [...new Set([right, p === 3 ? v : s3(v), p === 3 ? wrong3(v) : 'is ' + v, 'are ' + v + 'ing'])];
    return { text: `${subj} ___ (${v}) ${rest}.`, right, opts: shuffle(opts), why: p === 3 ? `${s} = he/she/it, ולכן מוסיפים s לפועל: ${right}` : `עם ${s} הפועל נשאר בלי s: ${v}` };
  }
  if (kind === 'neg') {
    const right = (p === 3 ? "doesn't " : "don't ") + v;
    const opts = [right, (p === 3 ? "don't " : "doesn't ") + v, (p === 3 ? "doesn't " : "don't ") + s3(v), 'not ' + v];
    return { text: `${subj} ___ (not ${v}) ${rest}.`, right, opts: shuffle([...new Set(opts)]), why: `בשלילה: ${p === 3 ? "doesn't" : "don't"} + פועל בלי s` };
  }
  const aux = p === 3 ? 'Does' : 'Do';
  const sl = subj === 'I' ? 'I' : subj.replace(/^(My|Our|The|You|We|They|He|She|It)\b/, m => m.toLowerCase());
  const right = `${aux} ${sl} ${v}`;
  const opts = [right, `${p === 3 ? 'Do' : 'Does'} ${sl} ${v}`, `${aux} ${sl} ${s3(v)}`, `${subj} ${p === 3 ? s3(v) : v}`];
  return { text: `___ ${rest}?`, right, opts: shuffle([...new Set(opts)]), why: `בשאלה: ${aux} + נושא + פועל בלי s` };
}
function grammarCard(g, done) {
  let tried = false;
  const why = el('div', { class: 'why' });
  return el('div', { class: 'grid' },
    el('div', { class: 'q-word gram', dir: 'ltr' }, g.text),
    el('div', { class: 'mc' }, g.opts.map(o => el('button', { class: 'mc-btn', dir: 'ltr', onclick: ev => {
      const b = ev.currentTarget;
      if (o === g.right) { b.classList.add('mc-ok'); say(g.text.replace('___', g.right).replace(/\(.*?\)\s?/, '')); why.replaceChildren(el('b', { class: 'good' }, '✓ '), g.why); setTimeout(() => done(!tried), 1400); }
      else { b.classList.add('mc-bad'); b.disabled = true; tried = true; why.textContent = g.why; buzz([60, 40, 60]); }
    } }, o))), why);
}
async function grammar(l) {
  let n = 0, score = 0;
  const top = C.topbar('Present Simple', () => openEnglish(C, l.id));
  const stage = el('div', { class: 'stage' });
  const tip = el('details', { class: 'card tip' }, el('summary', {}, '📖 תזכורת קצרה'),
    el('div', { html: '<p><b>I / you / we / they</b> + פועל רגיל: <i dir="ltr">They play.</i></p><p><b>he / she / it</b> + פועל עם s: <i dir="ltr">She plays · He watches · It flies · He has</i></p><p>שלילה: <i dir="ltr">don\'t / doesn\'t + verb</i> · שאלה: <i dir="ltr">Do / Does + subject + verb?</i></p><p>מילות זמן: <i dir="ltr">every day, usually, always, never, often, on Sundays</i></p>' }));
  C.screen(top, el('main', { class: 'page practice' }, tip, stage));
  const go = () => {
    top.querySelector('h1').textContent = `Present Simple · ${score}/${n}`;
    stage.replaceChildren(grammarCard(makeGrammar(), async ok => { n++; if (ok) { score++; await award(4, 'en'); } go(); }));
  };
  go();
}
