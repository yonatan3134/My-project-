// An offline building assistant. It reads a Hebrew request, recognizes what
// kind of app is wanted (or what change is wanted), and writes blocks.
// It runs fully in the browser: no internet, no API key.
import { COLORS } from './blocks.js';

// ---------- text helpers ----------
const FINALS = { 'ם': 'מ', 'ן': 'נ', 'ץ': 'צ', 'ף': 'פ', 'ך': 'כ' };
const norm = (t) => String(t).replace(/[֑-ׇ]/g, '').replace(/[םןץףך]/g, c => FINALS[c]).toLowerCase();
const has = (text, ...words) => words.some(w => text.includes(norm(w)));

function quoted(raw) {
  const m = raw.match(/["“”״'']([^"“”״'']{1,60})["“”״'']/);
  return m ? m[1].trim() : '';
}
function afterWord(raw, words) {
  for (const w of words) {
    const m = raw.match(new RegExp(w + '\\s*[:\\-]?\\s*(.+)$'));
    if (m) return m[1].replace(/[.!?]+$/, '').trim();
  }
  return '';
}
function numberIn(raw, unitWords) {
  const m = raw.match(new RegExp('(\\d+(?:\\.\\d+)?)\\s*(' + unitWords.join('|') + ')'));
  return m ? parseFloat(m[1]) : null;
}

const TOPICS = [
  ['חתול', '🐱'], ['כלב', '🐶'], ['בלונ', '🎈'], ['בלון', '🎈'], ['פיצה', '🍕'], ['כדורסל', '🏀'], ['כדורגל', '⚽'], ['כדור', '⚽'],
  ['חייזר', '👽'], ['פרפר', '🦋'], ['דגים', '🐟'], ['דג ', '🐟'], ['כוכב', '⭐'], ['יהלומ', '💎'], ['עכבר', '🐭'], ['ארנב', '🐰'],
  ['קופ', '🐵'], ['דינוזאור', '🦖'], ['רובוט', '🤖'], ['פרח', '🌸'], ['תפוח', '🍎'], ['פירות', '🍓'], ['עוגה', '🎂'], ['גלידה', '🍦'],
  ['רוח רפאים', '👻'], ['מפלצת', '👾'], ['חד קרנ', '🦄'], ['נמר', '🐯'], ['אריה', '🦁'], ['דבורה', '🐝'], ['צפרדע', '🐸'],
  ['ינשופ', '🦉'], ['חללית', '🚀'], ['טיל', '🚀'], ['מכונית', '🚗'], ['לב ', '❤️'], ['לבבות', '❤️'], ['שמש', '☀️'], ['פינגווינ', '🐧'],
  ['פנדה', '🐼'], ['סוס', '🐴'], ['פיל', '🐘'], ['כריש', '🦈'], ['תרנגול', '🐔'], ['ממתק', '🍬'], ['סוכרי', '🍭'], ['מטבע', '🪙'],
].map(([w, e]) => [norm(w), e]);

function topicEmoji(t) {
  const hit = TOPICS.find(([w]) => (t + ' ').includes(w));
  if (hit) return hit[1];
  const emoji = t.match(/\p{Extended_Pictographic}/u);
  return emoji ? emoji[0] : null;
}

const COLOR_WORDS = [
  ['כחול לילה', 'כחול לילה'], ['כחול כהה', 'כחול לילה'], ['לילה', 'כחול לילה'], ['חושך', 'כחול לילה'],
  ['תכלת בהיר', 'תכלת בהיר'], ['כחול בהיר', 'תכלת בהיר'], ['ורוד בהיר', 'ורוד בהיר'], ['ירוק בהיר', 'ירוק בהיר'],
  ['סגול בהיר', 'סגול בהיר'], ['צהוב בהיר', 'צהוב בהיר'], ['לבנ', 'לבן'], ['שחור', 'שחור'], ['אפור', 'אפור'],
  ['אדומ', 'אדום'], ['כתומ', 'כתום'], ['צהוב', 'צהוב'], ['ירוק', 'ירוק'], ['תכלת', 'תכלת'], ['כחול', 'כחול'],
  ['סגול', 'סגול'], ['ורוד', 'ורוד'], ['חומ', 'חום'],
].map(([w, c]) => [norm(w), COLORS.find(x => x[0] === c)[1]]);

function colorIn(t) {
  const hit = COLOR_WORDS.find(([w]) => t.includes(w));
  return hit ? hit[1] : null;
}
const LIGHT = { '#3a86ff': '#e8f4ff', '#4cc9f0': '#e8f4ff', '#ff6bb5': '#ffe9f4', '#ff4d4d': '#ffe9f4', '#2ecc71': '#e9fbe9', '#8e44ad': '#f1ecff', '#ffd93d': '#fff8dc', '#ff9f1c': '#fff8dc' };

// ---------- block builders (Blockly JSON) ----------
let vars;
function v(nameStr) {
  if (!vars.has(nameStr)) vars.set(nameStr, 'v_' + Math.random().toString(36).slice(2, 9));
  return { id: vars.get(nameStr) };
}
const chain = (list) => {
  const items = list.filter(Boolean);
  for (let i = items.length - 2; i >= 0; i--) items[i].next = { block: items[i + 1] };
  return items[0] ? { block: items[0] } : undefined;
};
const B = (type, fields = {}, inputs = {}) => {
  const block = { type };
  if (Object.keys(fields).length) block.fields = fields;
  const ins = {};
  for (const [k, val] of Object.entries(inputs)) {
    if (val === undefined || val === null) continue;
    ins[k] = Array.isArray(val) ? chain(val) : { block: val };
  }
  if (Object.keys(ins).length) block.inputs = ins;
  return block;
};
const T = (text) => B('text', { TEXT: String(text) });
const N = (n) => B('math_number', { NUM: n });
const join = (...parts) => ({ type: 'text_join', extraState: { itemCount: parts.length }, inputs: Object.fromEntries(parts.map((p, i) => ['ADD' + i, { block: typeof p === 'object' ? p : T(p) }])) });
const getVar = (n) => B('variables_get', { VAR: v(n) });
const setVar = (n, val) => B('variables_set', { VAR: v(n) }, { VALUE: val });
const changeVar = (n, d) => B('math_change', { VAR: v(n) }, { DELTA: N(d) });
const ifThen = (cond, thenList, elseList) => {
  const blk = B('controls_if', {}, { IF0: cond, DO0: thenList, ELSE: elseList });
  if (elseList) blk.extraState = { hasElse: true };
  return blk;
};
const cmp = (a, op, b) => B('logic_compare', { OP: op }, { A: a, B: b });

const page = (title, bg, content) => B('ui_page', { TITLE: title, BG: bg }, { CONTENT: content });
const uiTitle = (text, nm = 'כותרת') => B('ui_title', { TEXT: text, NAME: nm });
const uiText = (text, nm = 'טקסט') => B('ui_text', { TEXT: text, NAME: nm });
const uiButton = (text, nm, color = '#6a4cff') => B('ui_button', { TEXT: text, COLOR: color, NAME: nm });
const uiEmoji = (e, size, nm) => B('ui_emoji', { TEXT: e, SIZE: size, NAME: nm });
const uiInput = (hint, nm) => B('ui_input', { TEXT: hint, NAME: nm });
const uiBox = (layout, color, nm, content) => B('ui_box', { LAYOUT: layout, COLOR: color, NAME: nm }, { CONTENT: content });
const onClick = (nm, list) => B('ev_click', { NAME: nm }, { DO: list });
const onStart = (list) => B('ev_start', {}, { DO: list });
const every = (sec, list) => B('ev_every', { SEC: sec }, { DO: list });
const say = (val) => B('act_say', {}, { VALUE: typeof val === 'object' ? val : T(val) });
const setText = (nm, val) => B('act_set_text', { NAME: nm }, { VALUE: typeof val === 'object' ? val : T(val) });
const sound = (k) => B('act_sound', { KIND: k });

function workspace(top) {
  return {
    blocks: { languageVersion: 0, blocks: top.map((b, i) => ({ ...b, x: 20, y: 20 + i * 10 })) },
    variables: [...vars].map(([name, id]) => ({ name, id })),
  };
}

// ---------- app recipes ----------
function nameFrom(raw) {
  return quoted(raw) || (raw.match(/בשם\s+([^\s,.!?]+(?:\s+[^\s,.!?]+)?)/) || [])[1] || '';
}

const QUIZ_BANK = {
  animals: { label: 'חיות', words: ['חיות', 'בעלי חיימ', 'חיה'], qs: [
    ['איזו חיה היא הגדולה ביותר בעולם?', 'לוויתן כחול', 'פיל', 'ג׳ירפה'],
    ['כמה רגליים יש לעכביש?', '8', '6', '10'],
    ['איזו חיה ישנה הפוך?', 'עטלף', 'ינשוף', 'קוף'],
    ['מה אוכלת פנדה?', 'במבוק', 'דגים', 'בננות'],
    ['איזו חיה היא הכי מהירה ביבשה?', 'ברדלס', 'אריה', 'סוס'],
  ] },
  israel: { label: 'ישראל', words: ['ישראל', 'הארצ', 'מדינה'], qs: [
    ['מהי בירת ישראל?', 'ירושלים', 'תל אביב', 'חיפה'],
    ['מהו הים הנמוך בעולם?', 'ים המלח', 'הים התיכון', 'ים סוף'],
    ['איזה צבע יש בדגל ישראל חוץ מלבן?', 'כחול', 'אדום', 'ירוק'],
    ['מה ההר הגבוה בישראל?', 'החרמון', 'התבור', 'הכרמל'],
    ['באיזו עיר נמצא נמל אילת?', 'אילת', 'אשדוד', 'עכו'],
  ] },
  space: { label: 'חלל ומדע', words: ['חלל', 'מדע', 'כוכבי', 'כוכב לכת', 'אסטרונ'], qs: [
    ['איזה כוכב לכת הוא הגדול ביותר?', 'צדק', 'מאדים', 'נוגה'],
    ['מה הכוכב הכי קרוב לכדור הארץ?', 'השמש', 'הירח', 'מאדים'],
    ['כמה כוכבי לכת יש במערכת השמש?', '8', '9', '7'],
    ['איזה כוכב לכת נקרא "הכוכב האדום"?', 'מאדים', 'שבתאי', 'כוכב חמה'],
    ['באיזו טמפרטורה רותחים מים?', '100 מעלות', '50 מעלות', '200 מעלות'],
  ] },
  general: { label: 'ידע כללי', words: [], qs: [
    ['כמה ימים יש בשבוע?', '7', '5', '10'],
    ['מה צבע השמיים ביום בהיר?', 'כחול', 'ירוק', 'סגול'],
    ['כמה צלעות יש למשולש?', '3', '4', '5'],
    ['מה ההפך של "חם"?', 'קר', 'גדול', 'מהיר'],
    ['כמה חודשים יש בשנה?', '12', '10', '11'],
  ] },
};
function mathQuestions() {
  const out = [];
  for (let i = 0; i < 5; i++) {
    const a = 2 + Math.floor(Math.random() * 9), b = 2 + Math.floor(Math.random() * 9);
    const mul = i % 2 === 1;
    const r = mul ? a * b : a + b;
    out.push([`כמה זה ${a} ${mul ? '×' : '+'} ${b}?`, String(r), String(r + 1 + (i % 3)), String(Math.max(0, r - 2))]);
  }
  return out;
}
function quiz(raw, t) {
  let qs, label;
  if (has(t, 'חשבונ', 'מתמטיק', 'כפל', 'חיבור', 'תרגיל')) { qs = mathQuestions(); label = 'חשבון'; }
  else {
    const bank = Object.values(QUIZ_BANK).find(b => b.words.some(w => t.includes(norm(w)))) || QUIZ_BANK.general;
    qs = bank.qs; label = bank.label;
  }
  const title = nameFrom(raw) || `חידון ${label}`;
  const bg = colorIn(t) || '#8e44ad';
  return {
    reply: `בניתי חידון ${label} עם ${qs.length} שאלות 🧠. אפשר להוסיף שאלות בבלוקים, או לכתוב לי: שאלה: ... תשובה: ... שגויות: ..., ...`,
    blocks: [page(title, bg, [
      uiTitle('❓ ' + title),
      B('ui_quiz', { NAME: 'חידון', DONE: 'כל הכבוד! 🎉' }, { QUESTIONS: qs.map(q => B('quiz_q', { Q: q[0], A: q[1], W1: q[2], W2: q[3] })) }),
    ])],
  };
}

function todo(raw, t) {
  const title = nameFrom(raw) || (has(t, 'קניות') ? 'רשימת קניות 🛒' : 'המשימות שלי 📝');
  const bg = colorIn(t) || '#f1ecff';
  return {
    reply: 'בניתי רשימה: כותבים, לוחצים "הוסף", ואפשר לסמן פריט כבוצע בלחיצה עליו או למחוק אותו ב-✕.',
    blocks: [
      page(title, bg, [
        uiTitle(title),
        uiBox('row', 'none', 'שורת הוספה', [uiInput('מה להוסיף?', 'תיבה'), uiButton('➕ הוסף', 'הוסף')]),
        B('ui_list', { NAME: 'רשימה' }),
        uiButton('🧹 נקה הכל', 'נקה', '#ff4d4d'),
      ]),
      onClick('הוסף', [ifThen(cmp(B('text_length', {}, { VALUE: B('val_text_of', { NAME: 'תיבה' }) }), 'GT', N(0)), [
        B('act_list_add', { NAME: 'רשימה' }, { VALUE: B('val_text_of', { NAME: 'תיבה' }) }),
        B('act_clear_input', { NAME: 'תיבה' }),
        sound('ding'),
      ])]),
      B('ev_key', { KEY: 'Enter' }, { DO: [
        B('act_list_add', { NAME: 'רשימה' }, { VALUE: B('val_text_of', { NAME: 'תיבה' }) }),
        B('act_clear_input', { NAME: 'תיבה' }),
      ] }),
      onClick('נקה', [B('act_list_clear', { NAME: 'רשימה' })]),
    ],
  };
}

const SITES = [
  { words: ['מסעדה', 'פיצ', 'אוכל', 'בית קפה', 'קפה', 'מאפיה', 'המבורגר', 'פלאפל'], icon: '🍕', kind: 'המסעדה', tagline: 'אוכל טרי, טעים ועשוי באהבה, כל יום', cards: [['🥗', 'מנות טריות', 'מכינים הכל במקום מחומרים טובים'], ['🛵', 'משלוחים', 'עד הבית תוך 30 דקות'], ['⭐', 'אווירה', 'מקום נעים לכל המשפחה']], cta: '📞 להזמנת מקום' },
  { words: ['חנות', 'מוכר', 'מוצרי'], icon: '🛍️', kind: 'החנות', tagline: 'המוצרים הכי שווים, במחירים הכי טובים', cards: [['🚚', 'משלוח מהיר', 'מגיע אליכם תוך יומיים'], ['💳', 'תשלום בטוח', 'קונים בראש שקט'], ['🔁', 'החזרות', 'לא אהבתם? מחזירים בקלות']], cta: '🛒 לקנייה' },
  { words: ['צלמ', 'צילומ', 'תיק עבודות', 'פורטפוליו', 'אמנ', 'ציור'], icon: '📸', kind: 'תיק העבודות', tagline: 'רגעים שנשארים לתמיד', cards: [['🌄', 'נופים', 'צילומי טבע מכל הארץ'], ['👨‍👩‍👧', 'משפחות', 'צילומים שמחים למשפחה'], ['🎉', 'אירועים', 'ימי הולדת, בר מצווה ועוד']], cta: '✉️ צרו קשר' },
  { words: ['מספרה', 'יופי', 'ציפורנ', 'קוסמטיק'], icon: '💇', kind: 'הסלון', tagline: 'יוצאים מאיתנו עם חיוך', cards: [['✂️', 'תספורות', 'לכל הגילאים והסגנונות'], ['💅', 'טיפוח', 'ציפורניים, טיפולי פנים ועוד'], ['☕', 'פינוק', 'קפה עלינו בזמן ההמתנה']], cta: '📅 לקביעת תור' },
  { words: ['כדורגל', 'קבוצה', 'ספורט', 'חוג'], icon: '⚽', kind: 'הקבוצה', tagline: 'משחקים יחד, מנצחים יחד', cards: [['🏆', 'הישגים', 'זכינו בגביע העונה'], ['📅', 'אימונים', 'פעמיים בשבוע אחרי בית הספר'], ['🤝', 'הצטרפות', 'כולם מוזמנים לנסות']], cta: '✋ אני רוצה להצטרף' },
  { words: [], icon: '🚀', kind: 'האתר', tagline: 'משפט קצר וקליט שמסביר למה כדאי לבחור בנו', cards: [['⚡', 'מהיר', 'תיאור קצר של היתרון הראשון'], ['💎', 'איכותי', 'תיאור קצר של היתרון השני'], ['🤝', 'אמין', 'תיאור קצר של היתרון השלישי']], cta: '💬 דברו איתנו' },
];
function website(raw, t) {
  const site = SITES.find(s => s.words.some(w => t.includes(norm(w)))) || SITES[SITES.length - 1];
  const owner = (raw.match(/של\s+([^\s,.!?]+)/) || [])[1];
  const title = nameFrom(raw) || (owner ? `${site.kind} של ${owner}` : site.kind.replace(/^ה/, '') + ' שלי');
  const accent = colorIn(t) || '#8e44ad';
  const bg = LIGHT[accent] || '#ffffff';
  return {
    reply: `בניתי ${site.kind === 'האתר' ? 'אתר' : 'אתר ל' + site.kind.replace(/^ה/, '')} עם כותרת, כרטיסי מידע וכפתור יצירת קשר. אפשר לשנות כל טקסט ישירות בבלוקים ✏️`,
    blocks: [
      page(title, bg, [
        uiBox('col', accent, 'ראשי', [
          uiEmoji(site.icon, 64, 'סמל'),
          uiTitle(title),
          uiText(site.tagline, 'סלוגן'),
          uiButton(site.cta, 'קשר', '#ffffff'),
        ]),
        B('ui_space'),
        uiBox('row', 'none', 'כרטיסים', site.cards.map(c => B('ui_card', { ICON: c[0], TITLE: c[1], TEXT: c[2] }))),
        B('ui_space'),
        uiText('© ' + title + ' · 050-0000000', 'תחתית'),
      ]),
      onClick('קשר', [say('תודה! נחזור אליכם בקרוב 🙌'), sound('ding')]),
    ],
  };
}

function stopwatch(raw, t) {
  const mins = numberIn(raw, ['דקות', 'דקה']);
  const secs = numberIn(raw, ['שניות', 'שניה']);
  const countdown = mins || secs || has(t, 'טיימר', 'ספירה לאחור');
  const total = mins ? mins * 60 : secs || (countdown ? 60 : 0);
  const show = (n) => join('⏱️ ', n, ' שניות');
  return {
    reply: countdown ? `בניתי טיימר של ${total} שניות עם כפתורי התחל, עצור ואיפוס. כשהזמן נגמר יש צליל 🔔` : 'בניתי שעון עצר עם כפתורי התחל, עצור ואיפוס ⏱️',
    blocks: [
      page(countdown ? 'טיימר' : 'שעון עצר', colorIn(t) || '#1d1240', [
        uiTitle(countdown ? '⏳ טיימר' : '⏱️ שעון עצר'),
        B('ui_emoji', { TEXT: `⏱️ ${total} שניות`, SIZE: 48, NAME: 'תצוגה' }),
        uiBox('row', 'none', 'כפתורים', [uiButton('▶️ התחל', 'התחל', '#2ecc71'), uiButton('⏸️ עצור', 'עצור', '#ff9f1c'), uiButton('🔁 אפס', 'אפס', '#ff4d4d')]),
      ]),
      onStart([setVar('שניות', N(total)), setVar('רץ', B('logic_boolean', { BOOL: 'FALSE' }))]),
      onClick('התחל', [setVar('רץ', B('logic_boolean', { BOOL: 'TRUE' }))]),
      onClick('עצור', [setVar('רץ', B('logic_boolean', { BOOL: 'FALSE' }))]),
      onClick('אפס', [setVar('רץ', B('logic_boolean', { BOOL: 'FALSE' })), setVar('שניות', N(total)), setText('תצוגה', show(getVar('שניות')))]),
      every(1, [ifThen(getVar('רץ'), countdown ? [
        changeVar('שניות', -1),
        setText('תצוגה', show(getVar('שניות'))),
        ifThen(cmp(getVar('שניות'), 'LTE', N(0)), [setVar('רץ', B('logic_boolean', { BOOL: 'FALSE' })), sound('win'), say('⏰ הזמן נגמר!')]),
      ] : [changeVar('שניות', 1), setText('תצוגה', show(getVar('שניות')))])]),
    ],
  };
}

function dice(raw, t) {
  const upTo = raw.match(/עד\s*(\d+)/);
  const max = upTo ? Math.max(2, parseInt(upTo[1], 10)) : (has(t, 'הגרל', 'מספר') ? 100 : 6);
  const isDice = max === 6;
  return {
    reply: isDice ? 'בניתי קוביה: לוחצים "הטל" ומקבלים מספר אקראי מ-1 עד 6 🎲' : `בניתי מגריל מספרים מ-1 עד ${max} 🎰`,
    blocks: [
      page(isDice ? 'קוביה' : 'הגרלה', colorIn(t) || '#e9fbe9', [
        uiTitle(isDice ? '🎲 הטלת קוביה' : '🎰 הגרלת מספר'),
        uiEmoji(isDice ? '🎲' : '🎰', 100, 'קוביה'),
        B('ui_emoji', { TEXT: '?', SIZE: 64, NAME: 'תוצאה' }),
        uiButton(isDice ? 'הטל!' : 'הגרל!', 'הטל'),
      ]),
      onClick('הטל', [
        setVar('מספר', B('math_random_int', {}, { FROM: N(1), TO: N(max) })),
        setText('תוצאה', join('', getVar('מספר'))),
        sound('jump'),
        ifThen(cmp(getVar('מספר'), 'EQ', N(max)), [B('act_confetti'), say('וואו! המספר הכי גבוה! 🎉')]),
      ]),
    ],
  };
}

function calculator(raw, t) {
  const op = (label, nm, code, color) => [uiButton(label, nm, color), onClick(nm, [setText('תוצאה', join('= ', B('math_arithmetic', { OP: code }, { A: B('val_number_of', { NAME: 'מספר א' }), B: B('val_number_of', { NAME: 'מספר ב' }) })))])];
  const ops = [op('➕', 'חיבור', 'ADD', '#2ecc71'), op('➖', 'חיסור', 'MINUS', '#ff9f1c'), op('✖️', 'כפל', 'MULTIPLY', '#3a86ff'), op('➗', 'חילוק', 'DIVIDE', '#8e44ad')];
  return {
    reply: 'בניתי מחשבון: כותבים שני מספרים ובוחרים פעולה 🧮',
    blocks: [
      page('מחשבון', colorIn(t) || '#fff8dc', [
        uiTitle('🧮 מחשבון'),
        uiInput('מספר ראשון', 'מספר א'),
        uiInput('מספר שני', 'מספר ב'),
        uiBox('row', 'none', 'פעולות', ops.map(o => o[0])),
        B('ui_emoji', { TEXT: '= ?', SIZE: 48, NAME: 'תוצאה' }),
      ]),
      ...ops.map(o => o[1]),
    ],
  };
}

function greeting(raw, t) {
  return {
    reply: 'בניתי אפליקציית היכרות: כותבים שם ומקבלים ברכה עם זיקוקים 👋',
    blocks: [
      page('נעים להכיר', colorIn(t) || '#ffe9f4', [
        uiEmoji('👋', 90, 'יד'),
        uiTitle('נעים להכיר!'),
        uiInput('איך קוראים לך?', 'שם'),
        uiButton('שלום!', 'שלום'),
        uiText('', 'ברכה'),
      ]),
      onClick('שלום', [setText('ברכה', join('שלום ', B('val_text_of', { NAME: 'שם' }), '! איזה כיף שבאת 😄')), B('act_confetti'), sound('win')]),
    ],
  };
}

function counter(raw, t) {
  const e = topicEmoji(t) || '❤️';
  return {
    reply: `בניתי מונה: כל לחיצה על ה${e} או על הכפתור מוסיפה 1, ובכל 10 יש זיקוקים 🎉`,
    blocks: [
      page('מונה', colorIn(t) || '#ffe9f4', [
        uiEmoji(e, 110, 'דמות'),
        B('ui_emoji', { TEXT: '0', SIZE: 56, NAME: 'מונה' }),
        uiBox('row', 'none', 'כפתורים', [uiButton('👍 עוד אחד', 'פלוס'), uiButton('🔁 אפס', 'אפס', '#8d99ae')]),
      ]),
      onStart([setVar('מספר', N(0))]),
      ...['דמות', 'פלוס'].map(nm => onClick(nm, [
        changeVar('מספר', 1), setText('מונה', join('', getVar('מספר'))), sound('ding'),
        ifThen(cmp(B('math_modulo', {}, { DIVIDEND: getVar('מספר'), DIVISOR: N(10) }), 'EQ', N(0)), [B('act_confetti')]),
      ])),
      onClick('אפס', [setVar('מספר', N(0)), setText('מונה', '0')]),
    ],
  };
}

// ---------- games ----------
const ANIMALS = [
  ['חתול', '🐱'], ['כלב', '🐶'], ['עכבר', '🐭'], ['ארנב', '🐰'], ['קופ', '🐵'], ['דינוזאור', '🦖'], ['רובוט', '🤖'],
  ['חד קרנ', '🦄'], ['נמר', '🐯'], ['אריה', '🦁'], ['דבורה', '🐝'], ['צפרדע', '🐸'], ['ינשופ', '🦉'], ['פינגווינ', '🐧'],
  ['פנדה', '🐼'], ['סוס', '🐴'], ['פיל', '🐘'], ['כריש', '🦈'], ['תרנגול', '🐔'], ['ציפור', '🐦'], ['דג', '🐟'],
  ['חללית', '🚀'], ['טיל', '🚀'], ['מכונית', '🚗'], ['מטוס', '✈️'], ['נינג\'ה', '🥷'], ['גיבור', '🦸'], ['מכשפ', '🧙'],
  ['פרפר', '🦋'], ['רוח רפאימ', '👻'], ['שפנ', '🐇'], ['צב', '🐢'], ['תמנונ', '🐙'], ['דרקונ', '🐉'],
].map(([w, e]) => [norm(w), e]);
const ITEMS = [
  [['פירות', 'פרי', 'תפוח', 'בננ', 'תות'], '🍎 🍌 🍓 🍇 🍒'],
  [['ממתק', 'סוכרי', 'שוקולד', 'עוגיות'], '🍬 🍭 🍫 🍪'],
  [['כוכב'], '⭐ 🌟'],
  [['מטבע', 'כספ', 'זהב'], '🪙 💰'],
  [['יהלומ', 'אבני חנ'], '💎'],
  [['פיצה', 'המבורגר', 'אוכל'], '🍕 🍔 🌭 🍟'],
  [['כדור'], '⚽ 🏀 🎾'],
  [['בלונ'], '🎈'],
  [['לב'], '❤️ 💖'],
  [['גלידה'], '🍦'],
  [['עצמ', 'עצמות'], '🦴'],
  [['גבינה'], '🧀'],
  [['גזר'], '🥕'],
].map(([ws, e]) => [ws.map(norm), e]);
const THEME_NAMES = { space: 'חלל 🌌', sea: 'ים 🌊', sky: 'שמיים ☁️', grass: 'דשא 🌳', night: 'לילה 🌙', desert: 'מדבר 🏜️', candy: 'ממתקים 🍭' };
const THEME_WORDS = [
  ['חלל', 'space'], ['כוכבי לכת', 'space'], ['ימ', 'sea'], ['מימ', 'sea'], ['אוקיינוס', 'sea'], ['מתחת למימ', 'sea'],
  ['שמיימ', 'sky'], ['עננימ', 'sky'], ['דשא', 'grass'], ['יער', 'grass'], ['שדה', 'grass'], ['לילה', 'night'], ['חושכ', 'night'],
  ['מדבר', 'desert'], ['חול', 'desert'], ['ממתקימ', 'candy'], ['סוכריות', 'candy'],
].map(([w, th]) => [norm(w), th]);

// Words with a one-letter Hebrew prefix (ה, ב, ל, ו, מ, ש, כ) removed, so "בחלל" matches "חלל".
function tokens(t) {
  const out = new Set();
  for (const w of t.split(/[\s,.!?]+/).filter(Boolean)) {
    out.add(w);
    if (w.length > 2 && 'הבלומשכ'.includes(w[0])) out.add(w.slice(1));
    if (w.length > 3 && 'הבלומשכ'.includes(w[0]) && 'הבלומשכ'.includes(w[1])) out.add(w.slice(2));
  }
  return out;
}
function themeIn(t) {
  const tk = tokens(t);
  for (const [w, th] of THEME_WORDS) if (w.includes(' ') ? t.includes(w) : tk.has(w)) return th;
  return null;
}
function animalIn(t) {
  const hit = ANIMALS.find(([w]) => t.includes(w));
  return hit ? hit[1] : null;
}
function itemsIn(t) {
  const hit = ITEMS.find(([ws]) => ws.some(w => t.includes(w)));
  return hit ? hit[1] : null;
}

const sp = (emoji, nm, size, x, y, show = true) => B('game_sprite', { EMOJI: emoji, NAME: nm, SIZE: size, X: x, Y: y, SHOW: show ? 'yes' : 'no' });
const gpage = (title, theme, sprites, h = 440) => page(title, '#1d1240', [
  uiTitle(title),
  B('ui_stage', { THEME: theme, HEIGHT: h, NAME: 'במה' }, { SPRITES: sprites }),
]);
const touch = (a, b2, list) => B('ev_touch', { A: a, B: b2 }, { DO: list });
const gv = (nm, dir, speed) => B('game_velocity', { NAME: nm, DIR: dir, SPEED: speed });
const spawnEvery = (sec, nm, where) => every(sec, [B('game_spawn', { NAME: nm, WHERE: where })]);
const lose1 = () => [B('game_effect', { KIND: 'boom', WHO: 'other' }), B('game_remove', { WHO: 'other' }), B('game_lives', { NUM: -1 })];
const collect = (n = 1) => [B('game_effect', { KIND: 'sparkle', WHO: 'other' }), B('game_remove', { WHO: 'other' }), B('game_score', { NUM: n })];
const winAt = (n) => ifThen(cmp(B('val_score'), 'GTE', N(n)), [B('game_over', { RESULT: 'win' })]);
const lives = (n) => B('game_set_lives', { NUM: n });
const timer = (sec) => B('game_timer', { SEC: sec, RESULT: 'win' });
const gameTitle = (raw, fallback) => nameFrom(raw) || fallback;
const GAME_TIP = '\n\n💡 אפשר לבקש: "יותר מהר", "5 חיים", "רקע חלל", "תחליף לכלב", "60 שניות"';

function catchGame(raw, t) {
  const player = animalIn(t) || '🧺';
  const items = itemsIn(t) || '🍎 🍌 🍓 🍇 🍒';
  const theme = themeIn(t) || 'sky';
  const first = items.split(' ')[0];
  return {
    reply: `בניתי משחק תפיסה: ${first} נופלים מלמעלה, זזים עם החצים ותופסים אותם עם ה${player}. נזהרים מה💣! מי שמגיע ל-20 נקודות מנצח.` + GAME_TIP,
    blocks: [
      gpage(gameTitle(raw, `תפוס את ה${first}!`), theme, [sp(player, 'שחקן', 70, 50, 90), sp(items, 'פרס', 46, 50, 0, false), sp('💣', 'פצצה', 46, 50, 0, false)]),
      onStart([B('game_controls', { NAME: 'שחקן', MODE: 'lr', SPEED: 75 }), gv('פרס', 'down', 35), gv('פצצה', 'down', 45), lives(3)]),
      spawnEvery(0.9, 'פרס', 'top'),
      spawnEvery(2.2, 'פצצה', 'top'),
      touch('שחקן', 'פרס', [...collect(), winAt(20)]),
      touch('שחקן', 'פצצה', lose1()),
    ],
  };
}

function dodgeGame(raw, t) {
  const theme = themeIn(t) || 'space';
  const player = animalIn(t) || (theme === 'space' ? '🚀' : '🙂');
  const rocks = itemsIn(t) || (theme === 'space' ? '☄️ 🪨 🌑' : theme === 'sea' ? '🦈 🐙' : '⚽ 🏀 🪨');
  return {
    reply: `בניתי משחק התחמקות: דברים נופלים, ומזיזים את ה${player} עם החצים כדי לא להיפגע. שורדים 30 שניות ומנצחים!` + GAME_TIP,
    blocks: [
      gpage(gameTitle(raw, 'אל תיפגע!'), theme, [sp(player, 'שחקן', 60, 50, 88), sp(rocks, 'אויב', 50, 50, 0, false)]),
      onStart([B('game_controls', { NAME: 'שחקן', MODE: 'lr', SPEED: 85 }), gv('אויב', 'down', 50), lives(3), timer(30)]),
      spawnEvery(0.5, 'אויב', 'top'),
      every(1, [B('game_score', { NUM: 1 })]),
      touch('שחקן', 'אויב', lose1()),
    ],
  };
}

function runnerGame(raw, t) {
  const theme = themeIn(t) === 'desert' ? 'desert' : 'grass';
  const player = animalIn(t) || '🦖';
  const obstacles = theme === 'desert' ? '🌵 🪨' : '🌵 🪨 🍄';
  return {
    reply: `בניתי משחק ריצה: ה${player} רץ, ומכשולים מגיעים מולו. קופצים ברווח או בלחיצה על המסך, ואוספים 🪙. מחזיקים 40 שניות ומנצחים!` + GAME_TIP,
    blocks: [
      gpage(gameTitle(raw, 'קפוץ מעל המכשולים!'), theme, [sp(player, 'שחקן', 60, 80, 70), sp(obstacles, 'מכשול', 48, 0, 0, false), sp('🪙', 'מטבע', 34, 0, 0, false)]),
      onStart([B('game_gravity', { NAME: 'שחקן', STRENGTH: 7 }), B('game_jump', { NAME: 'שחקן', POWER: 11, AIR: 'ground' }), gv('מכשול', 'right', 45), gv('מטבע', 'right', 45), lives(3), timer(40)]),
      spawnEvery(1.7, 'מכשול', 'ground_left'),
      spawnEvery(2.5, 'מטבע', 'left'),
      touch('שחקן', 'מכשול', lose1()),
      touch('שחקן', 'מטבע', collect()),
    ],
  };
}

function flappyGame(raw, t) {
  const theme = themeIn(t) || 'sky';
  const player = animalIn(t) || '🐦';
  return {
    reply: `בניתי משחק מעופף: לוחצים (או רווח) כדי שה${player} יעוף למעלה, ונזהרים מהמכשולים. אוספים ⭐ ומחזיקים 45 שניות!` + GAME_TIP,
    blocks: [
      gpage(gameTitle(raw, 'עוף רחוק!'), theme, [sp(player, 'שחקן', 55, 75, 40), sp('🧱 🌵 🪨', 'מכשול', 60, 0, 0, false), sp('⭐', 'כוכב', 34, 0, 0, false)]),
      onStart([B('game_gravity', { NAME: 'שחקן', STRENGTH: 4 }), B('game_jump', { NAME: 'שחקן', POWER: 6, AIR: 'air' }), gv('מכשול', 'right', 40), gv('כוכב', 'right', 40), lives(3), timer(45)]),
      spawnEvery(1.4, 'מכשול', 'left'),
      spawnEvery(2, 'כוכב', 'left'),
      touch('שחקן', 'מכשול', lose1()),
      touch('שחקן', 'כוכב', collect()),
    ],
  };
}

function shooterGame(raw, t) {
  const theme = themeIn(t) || 'space';
  const player = animalIn(t) || '🚀';
  const enemies = theme === 'sea' ? '🦈 🐙 🦑' : '👾 👽 🛸';
  return {
    reply: `בניתי משחק יריות: זזים עם החצים, יורים ברווח או בלחיצה על המסך, ופוגעים ב${enemies.split(' ')[0]}. 25 פגיעות = ניצחון!` + GAME_TIP,
    blocks: [
      gpage(gameTitle(raw, 'הגנה על כדור הארץ!'), theme, [sp(player, 'שחקן', 60, 50, 90), sp('🔸', 'קליע', 24, 0, 0, false), sp(enemies, 'אויב', 50, 0, 0, false)]),
      onStart([B('game_controls', { NAME: 'שחקן', MODE: 'lr', SPEED: 80 }), gv('אויב', 'down', 25), lives(3)]),
      spawnEvery(1.1, 'אויב', 'top'),
      B('ev_key', { KEY: ' ' }, { DO: [B('game_shoot', { NAME: 'שחקן', BULLET: 'קליע', DIR: 'up' })] }),
      onClick('במה', [B('game_shoot', { NAME: 'שחקן', BULLET: 'קליע', DIR: 'up' })]),
      touch('קליע', 'אויב', [B('game_effect', { KIND: 'boom', WHO: 'other' }), B('game_remove', { WHO: 'other' }), B('game_remove', { WHO: 'me' }), B('game_score', { NUM: 1 }), winAt(25)]),
      touch('שחקן', 'אויב', lose1()),
    ],
  };
}

function collectGame(raw, t) {
  const theme = themeIn(t) || 'night';
  const player = animalIn(t) || '🐭';
  const chaser = player === '🐭' ? '🐱' : player === '🐱' ? '🐶' : '👻';
  const loot = itemsIn(t) || '🪙 💎 ⭐';
  return {
    reply: `בניתי משחק אוצרות: מזיזים את ה${player} עם החצים לכל הכיוונים, אוספים ${loot.split(' ')[0]} ובורחים מה${chaser} שרודף אחריך! מחזיקים 45 שניות.` + GAME_TIP,
    blocks: [
      gpage(gameTitle(raw, 'אסוף ותברח!'), theme, [sp(player, 'שחקן', 55, 50, 55), sp(loot, 'אוצר', 36, 0, 0, false), sp(chaser, 'רודף', 55, 10, 15)]),
      onStart([
        B('game_controls', { NAME: 'שחקן', MODE: 'all', SPEED: 55 }), B('game_chase', { NAME: 'רודף', TARGET: 'שחקן', SPEED: 18 }),
        lives(3), timer(45),
        B('game_spawn', { NAME: 'אוצר', WHERE: 'random' }), B('game_spawn', { NAME: 'אוצר', WHERE: 'random' }), B('game_spawn', { NAME: 'אוצר', WHERE: 'random' }),
      ]),
      spawnEvery(2, 'אוצר', 'random'),
      touch('שחקן', 'אוצר', collect()),
      touch('שחקן', 'רודף', [B('game_effect', { KIND: 'boom', WHO: 'me' }), B('game_lives', { NUM: -1 }), B('game_teleport', { NAME: 'רודף' })]),
    ],
  };
}

function clickGame(raw, t) {
  const e = topicEmoji(t) || '🎈';
  const theme = themeIn(t) || 'sky';
  const secs = numberIn(raw, ['שניות', 'שניה']) || 30;
  return {
    reply: `בניתי משחק לחיצות: ה${e} מתעופף במסך, וצריך ללחוץ עליו כמה שיותר פעמים ב-${secs} שניות.\n\nרוצה סוג אחר? נסה: "משחק שתופסים פירות שנופלים", "משחק ריצה וקפיצה", "משחק יריות בחלל", "משחק ציפור מעופפת", "משחק לאסוף מטבעות ולברוח"` + GAME_TIP,
    blocks: [
      gpage(gameTitle(raw, `תפוס את ה${e}!`), theme, [sp(e, 'דמות', 70, 50, 50)]),
      onStart([gv('דמות', 'right', 35), B('game_edges', { NAME: 'דמות', MODE: 'bounce' }), B('game_timer', { SEC: secs, RESULT: 'win' })]),
      every(1.2, [B('game_teleport', { NAME: 'דמות' })]),
      onClick('דמות', [B('game_effect', { KIND: 'sparkle', WHO: 'me' }), B('game_score', { NUM: 1 }), B('game_teleport', { NAME: 'דמות' })]),
    ],
  };
}

const RECIPES = [
  { words: ['זיכרונ'], code: 'memory' },
  { words: ['חידונ', 'טריוויה', 'שאלות', 'מבחנ'], make: quiz },
  { words: ['משימות', 'רשימת', 'רשימה', 'to do', 'todo', 'קניות'], make: todo },
  { words: ['שעונ עצר', 'סטופר', 'טיימר', 'ספירה לאחור'], make: stopwatch },
  { words: ['מחשבונ'], make: calculator },
  { words: ['קוביה', 'הגרל', 'מספר אקראי', 'מזל'], make: dice },
  { words: ['לירות', 'יורה', 'יריות', 'פולשימ', 'חייזרימ', 'מלחמת'], make: shooterGame },
  { words: ['לעופ', 'מעופפ', 'ציפור', 'כנפ'], make: flappyGame },
  { words: ['ריצה', 'לרוצ', 'רצה ', 'לקפוצ', 'קופצ', 'קפיצות', 'מכשול', 'דינוזאור'], make: runnerGame },
  { words: ['נופל', 'לתפוס', 'לתפוש', 'סל ', 'גשמ של'], make: catchGame },
  { words: ['להתחמק', 'מתחמק', 'התחמקות', 'אסטרואיד', 'מטאור', 'לא לגעת', 'לברוח מ'], make: dodgeGame },
  { words: ['לאסופ', 'לאסוף', 'אוספ', 'אוצר', 'מטבעות', 'רודפ', 'בורח', 'מבוכ', 'מרדפ', 'עמ חצימ', 'בחצימ', 'החצימ', 'חיצימ', 'להזיז', 'מקלדת', 'תנועה'], make: collectGame },
  { words: ['מונה', 'לייק', 'ספירה', 'לספור'], make: counter },
  { words: ['אתר', 'עסק', 'מסעדה', 'חנות', 'תיק עבודות', 'דפ נחיתה', 'פורטפוליו'], make: website },
  { words: ['היכרות', 'ברכה', 'להגיד שלומ', 'שמ שלי'], make: greeting },
  { words: ['משחק', 'תפוס', 'ללחוצ', 'לחיצות'], make: clickGame },
];

// ---------- edits on an existing project ----------
function* walk(block) {
  for (let b = block; b; b = b.next && b.next.block) {
    yield b;
    for (const input of Object.values(b.inputs || {})) if (input.block) yield* walk(input.block);
  }
}
function allBlocks(ws) {
  const out = [];
  for (const top of ws.blocks?.blocks || []) out.push(...walk(top));
  return out;
}
function appendTo(parent, inputName, block) {
  parent.inputs = parent.inputs || {};
  const input = parent.inputs[inputName];
  if (!input || !input.block) { parent.inputs[inputName] = { block }; return; }
  let last = input.block;
  while (last.next && last.next.block) last = last.next.block;
  last.next = { block };
}
function prepend(parent, inputName, block) {
  parent.inputs = parent.inputs || {};
  const first = parent.inputs[inputName]?.block;
  if (first) block.next = { block: first };
  parent.inputs[inputName] = { block };
}
function uniqueName(ws, base) {
  const used = new Set(allBlocks(ws).map(b => b.fields?.NAME).filter(Boolean));
  if (!used.has(base)) return base;
  let i = 2; while (used.has(base + ' ' + i)) i++;
  return base + ' ' + i;
}

function applyEdits(raw, t, ws) {
  const blocks = allBlocks(ws);
  const pg = (ws.blocks?.blocks || []).find(b => b.type === 'ui_page');
  const done = [];
  const top = ws.blocks.blocks;
  const addTop = (b) => top.push({ ...b, x: 20, y: 20 });
  const label = quoted(raw);
  const c = colorIn(t);

  if (pg && has(t, 'רקע') && c) { pg.fields.BG = c; done.push('שיניתי את צבע הרקע 🎨'); }
  else if (pg && c && has(t, 'כפתור')) {
    blocks.filter(b => b.type === 'ui_button').forEach(b => { b.fields.COLOR = c; });
    done.push('צבעתי את הכפתורים 🖌️');
  }

  if (pg && has(t, 'כותרת', 'שמ האפליקציה', 'שמ האתר', 'שמ המשחק') && has(t, 'תשנה', 'שנה', 'תקרא', 'תחליפ', 'תהיה', 'כותרת:')) {
    const text = label || afterWord(raw, ['כותרת ל', 'כותרת']);
    if (text) {
      pg.fields.TITLE = text;
      const tb = blocks.find(b => b.type === 'ui_title');
      if (tb) tb.fields.TEXT = text;
      done.push(`הכותרת עכשיו: "${text}" ✏️`);
    }
  }

  const adding = has(t, 'תוסיפ', 'הוספ', 'להוסיפ', 'תשימ', 'עוד ');
  if (pg && adding && has(t, 'כפתור')) {
    const text = label || afterWord(raw, ['כפתור שכתוב עליו', 'כפתור של', 'כפתור']) || 'לחץ עליי';
    const nm = uniqueName(ws, 'כפתור');
    appendTo(pg, 'CONTENT', uiButton(text, nm, c || '#6a4cff'));
    addTop(onClick(nm, [say(`לחצת על "${text}"! 😄`), sound('ding')]));
    done.push(`הוספתי כפתור "${text}" ואירוע שמופעל כשלוחצים עליו 🔘`);
  }
  if (pg && adding && has(t, 'טקסט', 'משפט', 'פסקה', 'כיתוב')) {
    const text = label || afterWord(raw, ['טקסט', 'משפט', 'פסקה', 'כיתוב']) || 'טקסט חדש';
    appendTo(pg, 'CONTENT', uiText(text, uniqueName(ws, 'טקסט')));
    done.push('הוספתי טקסט 📝');
  }
  if (pg && adding && has(t, 'כרטיס')) {
    const box = blocks.find(b => b.type === 'ui_box' && b.fields.NAME === 'כרטיסים');
    const card = B('ui_card', { ICON: topicEmoji(t) || '⭐', TITLE: label || 'כרטיס חדש', TEXT: 'תיאור קצר' });
    if (box) appendTo(box, 'CONTENT', card); else appendTo(pg, 'CONTENT', card);
    done.push('הוספתי כרטיס 🪪');
  }
  if (pg && adding && has(t, 'תיבת כתיבה', 'שדה')) {
    appendTo(pg, 'CONTENT', uiInput(label || 'כתוב כאן...', uniqueName(ws, 'תיבה')));
    done.push('הוספתי תיבת כתיבה ⌨️');
  }
  if (pg && adding && has(t, 'קישור', 'לינק')) {
    const url = (raw.match(/https?:\/\/\S+/) || [])[0] || 'https://';
    appendTo(pg, 'CONTENT', B('ui_link', { TEXT: label || 'לחצו כאן', URL: url }));
    done.push('הוספתי קישור 🔗');
  }

  const quizBlock = blocks.find(b => b.type === 'ui_quiz');
  if (quizBlock && has(t, 'שאלה')) {
    const q = afterWord(raw, ['שאלה']).split(/תשובה|נכונה/)[0].replace(/[:\-,]+\s*$/, '').trim();
    const a = (raw.match(/(?:תשובה|נכונה)\s*[:\-]?\s*([^,\n]+?)(?=\s*(?:שגוי|לא נכונ|$|\n))/) || [])[1];
    const wrongPart = (raw.match(/(?:שגויות?|לא נכונות?)\s*[:\-]?\s*(.+)$/) || [])[1] || '';
    const wrong = wrongPart.split(/,|\s+ו(?=\S)|\s+או\s+/).map(x => x.trim()).filter(Boolean);
    if (q && a) {
      appendTo(quizBlock, 'QUESTIONS', B('quiz_q', { Q: q, A: a.trim(), W1: wrong[0] || 'לא יודע', W2: wrong[1] || 'אף תשובה' }));
      done.push(`הוספתי שאלה: "${q}" ❓`);
    } else {
      done.push('כדי להוסיף שאלה כתוב כך: שאלה: מה בירת צרפת? תשובה: פריז שגויות: רומא, לונדון');
    }
  }

  // ----- games -----
  const stage = blocks.find(b => b.type === 'ui_stage');
  const sprites = blocks.filter(b => b.type === 'game_sprite');
  const player = sprites.find(b => b.fields.NAME === 'שחקן') || sprites.find(b => b.fields.SHOW === 'yes');
  const theme = themeIn(t);
  if (stage && theme && stage.fields.THEME !== theme) {
    stage.fields.THEME = theme;
    done.push(`שיניתי את עיצוב המשחק ל${THEME_NAMES[theme]}`);
  }
  const lifeCount = numberIn(raw, ['חיימ', 'חיים', 'לבבות']);
  const lifeBlocks = blocks.filter(b => b.type === 'game_set_lives');
  if (lifeCount && lifeBlocks.length) { lifeBlocks.forEach(b => { b.fields.NUM = lifeCount; }); done.push(`עכשיו יש ${lifeCount} חיים ❤️`); }
  const gameFaster = has(t, 'מהר', 'קשה יותר', 'יותר קשה');
  const gameSlower = has(t, 'לאט', 'קל יותר', 'יותר קל');
  if (stage && (gameFaster || gameSlower)) {
    const k = gameFaster ? 1.3 : 0.75;
    blocks.filter(b => b.type === 'game_velocity' && b.fields.NAME !== 'שחקן').forEach(b => { b.fields.SPEED = Math.round(b.fields.SPEED * k); });
    blocks.filter(b => b.type === 'ev_every' && b.inputs?.DO?.block?.type === 'game_spawn').forEach(b => { b.fields.SEC = Math.max(0.2, +(b.fields.SEC / k).toFixed(2)); });
    blocks.filter(b => b.type === 'game_chase').forEach(b => { b.fields.SPEED = Math.round(b.fields.SPEED * k); });
    done.push(gameFaster ? 'עכשיו המשחק מהיר וקשה יותר ⚡' : 'עכשיו המשחק איטי וקל יותר 🐢');
  }

  const emojis = blocks.filter(b => b.type === 'ui_emoji' && /\p{Extended_Pictographic}/u.test(b.fields.TEXT));
  const newEmoji = topicEmoji(t);
  const replacing = has(t, 'במקומ', 'תחליפ', 'תשנה', 'תהפוכ', 'שיהיה', 'יהיה');
  if (newEmoji && player && replacing) {
    player.fields.EMOJI = newEmoji;
    done.push(`עכשיו השחקן הוא ${newEmoji}`);
  } else if (newEmoji && emojis.length && replacing) {
    emojis[0].fields.TEXT = newEmoji;
    done.push(`החלפתי את הדמות ל-${newEmoji}`);
  } else if (newEmoji && stage && adding && !has(t, 'כפתור', 'כרטיס')) {
    appendTo(stage, 'SPRITES', sp(newEmoji, uniqueName(ws, 'דמות'), 60, Math.round(15 + Math.random() * 70), 40));
    done.push(`הוספתי ${newEmoji} למשחק`);
  } else if (newEmoji && pg && adding && !has(t, 'כפתור', 'כרטיס')) {
    const area = blocks.find(b => b.type === 'ui_area');
    const e = uiEmoji(newEmoji, 70, uniqueName(ws, 'דמות'));
    if (area) appendTo(area, 'CONTENT', e); else appendTo(pg, 'CONTENT', e);
    done.push(`הוספתי ${newEmoji}`);
  }

  const sized = [...emojis, ...sprites];
  if (sized.length && has(t, 'תגדיל', 'יותר גדול', 'גדול יותר', 'ענק')) { sized.forEach(b => { b.fields.SIZE = Math.round(b.fields.SIZE * 1.4); }); done.push('הגדלתי 🔍'); }
  if (sized.length && has(t, 'תקטינ', 'יותר קטנ', 'קטנ יותר')) { sized.forEach(b => { b.fields.SIZE = Math.max(16, Math.round(b.fields.SIZE / 1.4)); }); done.push('הקטנתי 🔎'); }

  const movers = blocks.filter(b => b.type === 'ev_every' && b.inputs?.DO?.block?.type === 'act_jump');
  if (movers.length && has(t, 'מהר', 'קשה יותר', 'יותר קשה')) { movers.forEach(b => { b.fields.SEC = Math.max(0.3, +(b.fields.SEC * 0.65).toFixed(2)); }); done.push('עכשיו זה מהיר יותר ⚡'); }
  if (movers.length && has(t, 'לאט', 'קל יותר', 'יותר קל')) { movers.forEach(b => { b.fields.SEC = +(b.fields.SEC * 1.5).toFixed(2); }); done.push('עכשיו זה איטי יותר 🐢'); }

  const secs = numberIn(raw, ['שניות', 'שניה']);
  const timers = blocks.filter(b => b.type === 'game_timer');
  if (secs && timers.length) { timers.forEach(b => { b.fields.SEC = secs; }); done.push(`המשחק נמשך עכשיו ${secs} שניות ⏱️`); }
  if (secs) {
    const timeVarId = (ws.variables || []).find(x => x.name === 'זמן' || x.name === 'שניות')?.id;
    const setters = blocks.filter(b => b.type === 'variables_set' && b.fields.VAR.id === timeVarId && b.inputs?.VALUE?.block?.type === 'math_number');
    if (setters.length) {
      setters.forEach(b => { b.inputs.VALUE.block.fields.NUM = secs; });
      blocks.filter(b => b.type === 'ui_text' && b.fields.NAME === 'שעון').forEach(b => { b.fields.TEXT = `⏱️ זמן: ${secs}`; });
      done.push(`הזמן עכשיו ${secs} שניות ⏱️`);
    }
  }

  const clickEvents = top.filter(b => b.type === 'ev_click');
  if (clickEvents.length && has(t, 'זיקוק', 'קונפטי')) { clickEvents.forEach(b => appendTo(b, 'DO', B('act_confetti'))); done.push('הוספתי זיקוקים בכל לחיצה 🎉'); }
  if (clickEvents.length && has(t, 'צליל', 'סאונד', 'קול', 'מוזיקה') && !has(t, 'בלי')) { clickEvents.forEach(b => prepend(b, 'DO', sound('ding'))); done.push('הוספתי צליל בלחיצה 🔊'); }
  if (has(t, 'בלי צליל', 'בלי סאונד', 'שקט', 'תוריד את הצליל')) {
    const strip = (parent, inputName) => {
      let prev = null; let cur = parent.inputs?.[inputName]?.block;
      while (cur) {
        const nxt = cur.next?.block;
        if (cur.type === 'act_sound') { if (prev) prev.next = nxt ? { block: nxt } : undefined; else if (nxt) parent.inputs[inputName] = { block: nxt }; else delete parent.inputs[inputName]; }
        else prev = cur;
        cur = nxt;
      }
    };
    blocks.forEach(b => { for (const k of Object.keys(b.inputs || {})) strip(b, k); });
    done.push('הורדתי את הצלילים 🔇');
  }

  return done;
}

// ---------- entry point ----------
export const HELP = `אני יכול לבנות משחקים:
🧺 תפיסה: "משחק שתופסים פירות שנופלים"
☄️ התחמקות: "משחק להתחמק מאסטרואידים"
🦖 ריצה וקפיצה: "משחק ריצה עם דינוזאור"
🐦 מעופף: "משחק ציפור שעפה"
🚀 יריות: "משחק יריות בחלל"
🐭 אוצרות ומרדף: "משחק לאסוף מטבעות ולברוח"
🎈 לחיצות: "משחק שלוחצים על בלונים"
🧠 משחק זיכרון, ❓ חידון (חיות, ישראל, חלל, חשבון)

וגם: 🌐 אתר (מסעדה, חנות, צלם...), 📝 רשימת משימות, ⏱️ טיימר, 🎲 קוביה, 🧮 מחשבון, ❤️ מונה, 👋 היכרות

ואז אפשר לבקש שינויים: "יותר מהר", "5 חיים", "רקע חלל", "תחליף לכלב", "60 שניות", "תגדיל", "כותרת: המשחק שלי"`;

/**
 * @param {string} raw  what the user wrote
 * @param {object|null} current  the current Blockly workspace JSON, or null if empty
 * @returns {{reply: string, workspace?: object, code?: string}}
 */
export function assist(raw, current) {
  vars = new Map((current?.variables || []).map(x => [x.name, x.id]));
  const t = norm(raw.trim());
  if (!t) return { reply: HELP };
  if (t === norm('עזרה') || has(t, 'מה אתה יודע', 'מה אפשר', 'מה אתה יכול')) return { reply: HELP };

  const empty = !current || !(current.blocks?.blocks || []).length;
  const recipe = RECIPES.find(r => r.words.some(w => t.includes(norm(w))));
  const editWords = has(t, 'תוסיפ', 'תשנה', 'שנה ', 'תחליפ', 'יותר', 'רקע', 'תגדיל', 'תקטינ', 'במקומ', 'שיהיה', 'תוריד', 'תמחק', 'כותרת', 'שאלה:');
  const wantsNew = empty || has(t, 'חדש', 'תבנה', 'בנה', 'תעשה לי', 'צור', 'תכינ', 'אני רוצה', 'רוצה ') || (recipe && !editWords);

  // Edits first when there's a project and the request isn't clearly "build something new".
  if (!empty && !(wantsNew && recipe && !has(t, 'תוסיפ', 'תשנה', 'תחליפ'))) {
    const ws = JSON.parse(JSON.stringify(current));
    vars = new Map((ws.variables || []).map(x => [x.name, x.id]));
    const done = applyEdits(raw, t, ws);
    if (done.length) {
      ws.variables = [...vars].map(([name, id]) => ({ name, id }));
      return { reply: done.join('\n'), workspace: ws };
    }
  }

  if (recipe) {
    if (recipe.code) return { reply: 'בניתי משחק זיכרון 🧠 (הפרויקט הזה כתוב בקוד, אפשר לערוך אותו בלשונית "קוד")', code: recipe.code, fresh: true };
    vars = new Map();
    const { reply, blocks } = recipe.make(raw, t);
    return { reply: reply + '\n\nתסתכל בבלוקים כדי לראות איך זה עובד, ותשנה מה שבא לך 🧩', workspace: workspace(blocks), fresh: true };
  }

  return { reply: 'לא הבנתי עד הסוף 🤔\n\n' + HELP };
}
