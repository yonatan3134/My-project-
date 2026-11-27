// Hebrew blocks for building apps, and how each one turns into code.
/* global Blockly, javascript */

export const COLORS = [
  ['לבן', '#ffffff'], ['שחור', '#111111'], ['אפור', '#8d99ae'], ['אדום', '#ff4d4d'], ['כתום', '#ff9f1c'],
  ['צהוב', '#ffd93d'], ['ירוק', '#2ecc71'], ['תכלת', '#4cc9f0'], ['כחול', '#3a86ff'], ['סגול', '#8e44ad'],
  ['ורוד', '#ff6bb5'], ['חום', '#8d5524'], ['כחול לילה', '#1d1240'], ['תכלת בהיר', '#e8f4ff'],
  ['ורוד בהיר', '#ffe9f4'], ['ירוק בהיר', '#e9fbe9'], ['סגול בהיר', '#f1ecff'], ['צהוב בהיר', '#fff8dc'],
];
const BOX_COLORS = [['בלי צבע', 'none'], ...COLORS];
export const THEMES = [['☁️ שמיים', 'sky'], ['🌌 חלל', 'space'], ['🌊 ים', 'sea'], ['🌳 דשא', 'grass'], ['🌙 לילה', 'night'], ['🏜️ מדבר', 'desert'], ['🍭 ממתקים', 'candy']];

const HUE = { page: 260, ui: 200, event: 35, action: 330, value: 160, game: 15 };

const name = (n) => ({ type: 'field_input', name: 'NAME', text: n });
const color = (field, def) => ({ type: 'field_dropdown', name: field, options: COLORS.map(c => [c[0], c[1]]), ...(def ? {} : {}) });

const DEFS = [
  // ----- page & elements -----
  {
    type: 'ui_page',
    message0: '📄 אפליקציה %1 רקע %2',
    args0: [{ type: 'field_input', name: 'TITLE', text: 'האפליקציה שלי' }, color('BG')],
    message1: '%1',
    args1: [{ type: 'input_statement', name: 'CONTENT', check: 'ui' }],
    colour: HUE.page,
    tooltip: 'כאן בונים מה רואים במסך. גוררים לתוכו כותרות, כפתורים ועוד.',
  },
  { type: 'ui_title', message0: '🔠 כותרת %1 שם %2', args0: [{ type: 'field_input', name: 'TEXT', text: 'שלום!' }, name('כותרת')] },
  { type: 'ui_text', message0: '📝 טקסט %1 שם %2', args0: [{ type: 'field_input', name: 'TEXT', text: 'כתוב כאן משהו' }, name('טקסט')] },
  { type: 'ui_button', message0: '🔘 כפתור %1 צבע %2 שם %3', args0: [{ type: 'field_input', name: 'TEXT', text: 'לחץ עליי' }, { type: 'field_dropdown', name: 'COLOR', options: [['סגול רגיל', '#6a4cff'], ...COLORS] }, name('כפתור')] },
  { type: 'ui_emoji', message0: '😀 אימוג\'י %1 גודל %2 שם %3', args0: [{ type: 'field_input', name: 'TEXT', text: '🐱' }, { type: 'field_number', name: 'SIZE', value: 80, min: 10, max: 400 }, name('דמות')] },
  { type: 'ui_input', message0: '⌨️ תיבת כתיבה עם רמז %1 שם %2', args0: [{ type: 'field_input', name: 'TEXT', text: 'כתוב כאן...' }, name('תיבה')] },
  { type: 'ui_list', message0: '📋 רשימה שם %1', args0: [name('רשימה')] },
  { type: 'ui_card', message0: '🪪 כרטיס %1 כותרת %2 טקסט %3', args0: [{ type: 'field_input', name: 'ICON', text: '⭐' }, { type: 'field_input', name: 'TITLE', text: 'כותרת' }, { type: 'field_input', name: 'TEXT', text: 'תיאור קצר' }] },
  { type: 'ui_link', message0: '🔗 קישור %1 לכתובת %2', args0: [{ type: 'field_input', name: 'TEXT', text: 'לחצו כאן' }, { type: 'field_input', name: 'URL', text: 'https://' }] },
  { type: 'ui_space', message0: '↕️ רווח' },
  {
    type: 'ui_box', message0: '📦 קופסה %1 צבע %2 שם %3', args0: [
      { type: 'field_dropdown', name: 'LAYOUT', options: [['בשורה', 'row'], ['בטור', 'col']] },
      { type: 'field_dropdown', name: 'COLOR', options: BOX_COLORS }, name('קופסה')],
    message1: '%1', args1: [{ type: 'input_statement', name: 'CONTENT', check: 'ui' }],
    tooltip: 'מסדרת כמה רכיבים יחד, בשורה או בטור',
  },
  {
    type: 'ui_area', message0: '🎮 זירת משחק גובה %1 צבע %2 שם %3', args0: [
      { type: 'field_number', name: 'HEIGHT', value: 340, min: 100, max: 1000 }, color('COLOR'), name('זירה')],
    message1: '%1', args1: [{ type: 'input_statement', name: 'CONTENT', check: 'ui' }],
    tooltip: 'מקום שבו דמויות יכולות לזוז ולקפוץ',
  },
  {
    type: 'ui_quiz', message0: '❓ חידון שם %1', args0: [name('חידון')],
    message1: '%1', args1: [{ type: 'input_statement', name: 'QUESTIONS', check: 'quiz_q' }],
    message2: 'הודעת סיום %1', args2: [{ type: 'field_input', name: 'DONE', text: 'כל הכבוד! 🎉' }],
  },
  {
    type: 'quiz_q', message0: 'שאלה %1', args0: [{ type: 'field_input', name: 'Q', text: 'כמה זה 2+2?' }],
    message1: '✅ נכונה %1 ❌ שגויה %2 ❌ שגויה %3', args1: [
      { type: 'field_input', name: 'A', text: '4' }, { type: 'field_input', name: 'W1', text: '3' }, { type: 'field_input', name: 'W2', text: '5' }],
    previousStatement: 'quiz_q', nextStatement: 'quiz_q', colour: HUE.ui,
  },

  // ----- events -----
  { type: 'ev_start', message0: '▶️ כשהאפליקציה מתחילה', message1: '%1', args1: [{ type: 'input_statement', name: 'DO' }], colour: HUE.event },
  { type: 'ev_click', message0: '👆 כשלוחצים על %1', args0: [{ type: 'field_input', name: 'NAME', text: 'כפתור' }], message1: '%1', args1: [{ type: 'input_statement', name: 'DO' }], colour: HUE.event },
  { type: 'ev_every', message0: '⏱️ כל %1 שניות', args0: [{ type: 'field_number', name: 'SEC', value: 1, min: 0.1 }], message1: '%1', args1: [{ type: 'input_statement', name: 'DO' }], colour: HUE.event },
  {
    type: 'ev_key', message0: '⌨️ כשלוחצים על המקש %1', args0: [{ type: 'field_dropdown', name: 'KEY', options: [
      ['רווח', ' '], ['חץ ימינה', 'ArrowRight'], ['חץ שמאלה', 'ArrowLeft'], ['חץ למעלה', 'ArrowUp'], ['חץ למטה', 'ArrowDown'], ['Enter', 'Enter']] }],
    message1: '%1', args1: [{ type: 'input_statement', name: 'DO' }], colour: HUE.event,
  },

  // ----- actions -----
  { type: 'act_say', message0: '💬 הצג הודעה %1', args0: [{ type: 'input_value', name: 'VALUE' }] },
  { type: 'act_set_text', message0: '✏️ שנה את הטקסט של %1 ל %2', args0: [{ type: 'field_input', name: 'NAME', text: 'טקסט' }, { type: 'input_value', name: 'VALUE' }] },
  { type: 'act_bg', message0: '🎨 צבע הרקע יהיה %1', args0: [color('COLOR')] },
  { type: 'act_color', message0: '🖌️ הצבע של %1 יהיה %2', args0: [{ type: 'field_input', name: 'NAME', text: 'כפתור' }, color('COLOR')] },
  { type: 'act_visible', message0: '👁️ %1 את %2', args0: [{ type: 'field_dropdown', name: 'ON', options: [['הסתר', 'false'], ['הצג', 'true']] }, { type: 'field_input', name: 'NAME', text: 'דמות' }] },
  { type: 'act_move', message0: '🏃 הזז את %1 %2 %3 צעדים', args0: [{ type: 'field_input', name: 'NAME', text: 'דמות' }, { type: 'field_dropdown', name: 'DIR', options: [['ימינה', 'right'], ['שמאלה', 'left'], ['למעלה', 'up'], ['למטה', 'down']] }, { type: 'field_number', name: 'STEPS', value: 3 }] },
  { type: 'act_jump', message0: '🎲 הקפץ את %1 למקום אקראי', args0: [{ type: 'field_input', name: 'NAME', text: 'דמות' }] },
  { type: 'act_size', message0: '🔍 שנה את הגודל של %1 ל %2', args0: [{ type: 'field_input', name: 'NAME', text: 'דמות' }, { type: 'input_value', name: 'VALUE', check: 'Number' }] },
  { type: 'act_list_add', message0: '➕ הוסף לרשימה %1 את %2', args0: [{ type: 'field_input', name: 'NAME', text: 'רשימה' }, { type: 'input_value', name: 'VALUE' }] },
  { type: 'act_list_clear', message0: '🧹 רוקן את הרשימה %1', args0: [{ type: 'field_input', name: 'NAME', text: 'רשימה' }] },
  { type: 'act_clear_input', message0: '🧽 נקה את תיבת הכתיבה %1', args0: [{ type: 'field_input', name: 'NAME', text: 'תיבה' }] },
  { type: 'act_sound', message0: '🔊 השמע צליל %1', args0: [{ type: 'field_dropdown', name: 'KIND', options: [['דינג', 'ding'], ['ניצחון', 'win'], ['קפיצה', 'jump'], ['באזר', 'buzz']] }] },
  { type: 'act_confetti', message0: '🎉 זיקוקים!' },
  { type: 'act_stop', message0: '⏹️ עצור את כל הטיימרים' },

  // ----- game -----
  {
    type: 'ui_stage', message0: '🎮 במת משחק עיצוב %1 גובה %2 שם %3', args0: [
      { type: 'field_dropdown', name: 'THEME', options: THEMES },
      { type: 'field_number', name: 'HEIGHT', value: 420, min: 200, max: 900 }, name('במה')],
    message1: '%1', args1: [{ type: 'input_statement', name: 'SPRITES', check: 'sprite' }],
    previousStatement: 'ui', nextStatement: 'ui', colour: HUE.game,
    tooltip: 'המקום שבו המשחק קורה. בפנים שמים את הדמויות.',
  },
  {
    type: 'game_sprite', message0: '👾 דמות %1 שם %2 גודל %3', args0: [
      { type: 'field_input', name: 'EMOJI', text: '🐱' }, name('שחקן'), { type: 'field_number', name: 'SIZE', value: 60, min: 10, max: 300 }],
    message1: 'מקום: ↔️ %1 ↕️ %2 %3', args1: [
      { type: 'field_number', name: 'X', value: 50, min: 0, max: 100 }, { type: 'field_number', name: 'Y', value: 80, min: 0, max: 100 },
      { type: 'field_dropdown', name: 'SHOW', options: [['מופיעה מההתחלה', 'yes'], ['מוסתרת (רק ל"צור עוד")', 'no']] }],
    previousStatement: 'sprite', nextStatement: 'sprite', colour: HUE.game,
    tooltip: 'דמות במשחק. אפשר לכתוב כמה אימוג\'ים עם רווח, ובכל פעם תיבחר אחת. ↔️ 0 = שמאל, 100 = ימין. ↕️ 0 = למעלה, 100 = למטה.',
  },
  { type: 'game_controls', message0: '🕹️ %1 זז עם החצים %2 במהירות %3', args0: [{ type: 'field_input', name: 'NAME', text: 'שחקן' }, { type: 'field_dropdown', name: 'MODE', options: [['ימינה ושמאלה', 'lr'], ['לכל הכיוונים', 'all'], ['למעלה ולמטה', 'ud']] }, { type: 'field_number', name: 'SPEED', value: 60, min: 1 }], tooltip: 'בטלפון יופיעו כפתורי חצים מתחת למשחק' },
  { type: 'game_jump', message0: '⏫ %1 קופץ ברווח או בלחיצה, בכוח %2 %3', args0: [{ type: 'field_input', name: 'NAME', text: 'שחקן' }, { type: 'field_number', name: 'POWER', value: 10, min: 1 }, { type: 'field_dropdown', name: 'AIR', options: [['רק מהקרקע', 'ground'], ['גם באוויר (מעופף)', 'air']] }], tooltip: 'צריך גם כוח משיכה כדי שהדמות תיפול חזרה' },
  { type: 'game_gravity', message0: '🌍 כוח משיכה על %1 בחוזק %2', args0: [{ type: 'field_input', name: 'NAME', text: 'שחקן' }, { type: 'field_number', name: 'STRENGTH', value: 6, min: 0 }] },
  { type: 'game_velocity', message0: '➡️ %1 נע %2 במהירות %3', args0: [{ type: 'field_input', name: 'NAME', text: 'אויב' }, { type: 'field_dropdown', name: 'DIR', options: [['למטה', 'down'], ['למעלה', 'up'], ['שמאלה', 'left'], ['ימינה', 'right'], ['עוצר', 'stop']] }, { type: 'field_number', name: 'SPEED', value: 40, min: 0 }] },
  { type: 'game_edges', message0: '🧱 כש %1 מגיע לקצה הוא %2', args0: [{ type: 'field_input', name: 'NAME', text: 'שחקן' }, { type: 'field_dropdown', name: 'MODE', options: [['נעצר', 'stop'], ['עובר לצד השני', 'wrap'], ['קופץ חזרה', 'bounce'], ['נעלם', 'remove']] }] },
  { type: 'game_chase', message0: '🎯 %1 רודף אחרי %2 במהירות %3', args0: [{ type: 'field_input', name: 'NAME', text: 'אויב' }, { type: 'field_input', name: 'TARGET', text: 'שחקן' }, { type: 'field_number', name: 'SPEED', value: 20, min: 0 }] },
  { type: 'game_spawn', message0: '✨ צור עוד %1 %2', args0: [{ type: 'field_input', name: 'NAME', text: 'אויב' }, { type: 'field_dropdown', name: 'WHERE', options: [['למעלה, במקום אקראי', 'top'], ['משמאל, בגובה אקראי', 'left'], ['משמאל, על הקרקע', 'ground_left'], ['מימין, בגובה אקראי', 'right'], ['מימין, על הקרקע', 'ground'], ['במקום אקראי', 'random']] }], tooltip: 'יוצר עוד עותק של דמות. שימושי בתוך "כל X שניות"' },
  { type: 'game_shoot', message0: '🔫 %1 יורה %2 %3', args0: [{ type: 'field_input', name: 'NAME', text: 'שחקן' }, { type: 'field_input', name: 'BULLET', text: 'קליע' }, { type: 'field_dropdown', name: 'DIR', options: [['למעלה', 'up'], ['ימינה', 'right'], ['שמאלה', 'left'], ['למטה', 'down']] }] },
  { type: 'game_teleport', message0: '🎲 שים את %1 במקום אקראי', args0: [{ type: 'field_input', name: 'NAME', text: 'שחקן' }] },
  { type: 'game_remove', message0: '💨 העלם את %1', args0: [{ type: 'field_dropdown', name: 'WHO', options: [['מה שנגעתי בו', 'other'], ['אותי', 'me']] }], tooltip: 'עובד בתוך "כש... נוגע ב..."' },
  { type: 'game_remove_all', message0: '🧹 העלם את כל ה %1', args0: [{ type: 'field_input', name: 'NAME', text: 'אויב' }] },
  { type: 'game_effect', message0: '💥 אפקט %1 על %2', args0: [{ type: 'field_dropdown', name: 'KIND', options: [['פיצוץ', 'boom'], ['נצנצים', 'sparkle'], ['לבבות', 'hearts']] }, { type: 'field_dropdown', name: 'WHO', options: [['מה שנגעתי בו', 'other'], ['אותי', 'me']] }] },
  { type: 'game_score', message0: '⭐ הוסף %1 לניקוד', args0: [{ type: 'field_number', name: 'NUM', value: 1 }] },
  { type: 'game_lives', message0: '❤️ שנה את החיים ב %1', args0: [{ type: 'field_number', name: 'NUM', value: -1 }] },
  { type: 'game_set_lives', message0: '❤️ מתחילים עם %1 חיים', args0: [{ type: 'field_number', name: 'NUM', value: 3, min: 1 }], tooltip: 'כשהחיים נגמרים, המשחק נגמר' },
  { type: 'game_timer', message0: '⏱️ המשחק נמשך %1 שניות ובסוף %2', args0: [{ type: 'field_number', name: 'SEC', value: 30, min: 1 }, { type: 'field_dropdown', name: 'RESULT', options: [['מנצחים', 'win'], ['מפסידים', 'lose']] }] },
  { type: 'game_over', message0: '🏁 סוף המשחק: %1', args0: [{ type: 'field_dropdown', name: 'RESULT', options: [['ניצחת!', 'win'], ['הפסדת', 'lose']] }] },
  { type: 'ev_touch', message0: '💥 כש %1 נוגע ב %2', args0: [{ type: 'field_input', name: 'A', text: 'שחקן' }, { type: 'field_input', name: 'B', text: 'אויב' }], message1: '%1', args1: [{ type: 'input_statement', name: 'DO' }], colour: HUE.event },
  { type: 'val_score', message0: '⭐ הניקוד', output: 'Number', colour: HUE.value },

  // ----- values -----
  { type: 'val_text_of', message0: 'הטקסט של %1', args0: [{ type: 'field_input', name: 'NAME', text: 'תיבה' }], output: 'String', colour: HUE.value },
  { type: 'val_number_of', message0: 'המספר שכתוב ב %1', args0: [{ type: 'field_input', name: 'NAME', text: 'תיבה' }], output: 'Number', colour: HUE.value },
  { type: 'val_list_size', message0: 'כמה פריטים ברשימה %1', args0: [{ type: 'field_input', name: 'NAME', text: 'רשימה' }], output: 'Number', colour: HUE.value },
];

const STATEMENT_UI = ['ui_title', 'ui_text', 'ui_button', 'ui_emoji', 'ui_input', 'ui_list', 'ui_card', 'ui_link', 'ui_space', 'ui_box', 'ui_area', 'ui_quiz'];

for (const d of DEFS) {
  if (STATEMENT_UI.includes(d.type)) { d.previousStatement = 'ui'; d.nextStatement = 'ui'; d.colour = d.colour ?? HUE.ui; }
  if (d.type.startsWith('act_')) { d.previousStatement = null; d.nextStatement = null; d.colour = HUE.action; }
  if (d.type.startsWith('game_') && d.type !== 'game_sprite') { d.previousStatement = null; d.nextStatement = null; d.colour = HUE.game; }
}
Blockly.common.defineBlocksWithJsonArray(DEFS);

// ----- code generation -----
const G = javascript.javascriptGenerator;
const O = javascript.Order;
const s = (v) => JSON.stringify(String(v ?? ''));
const f = (b, n) => b.getFieldValue(n);
const v = (b, n, fallback = "''") => G.valueToCode(b, n, O.NONE) || fallback;
const body = (b, n) => G.statementToCode(b, n);
const gen = G.forBlock;

gen.ui_page = (b) => `app.page(${s(f(b, 'TITLE'))}, ${s(f(b, 'BG'))}, 'auto', (p) => {\n${body(b, 'CONTENT')}});\n`;
gen.ui_title = (b) => `app.add(p, 'title', ${s(f(b, 'NAME'))}, { text: ${s(f(b, 'TEXT'))} });\n`;
gen.ui_text = (b) => `app.add(p, 'text', ${s(f(b, 'NAME'))}, { text: ${s(f(b, 'TEXT'))} });\n`;
gen.ui_button = (b) => `app.add(p, 'button', ${s(f(b, 'NAME'))}, { text: ${s(f(b, 'TEXT'))}, color: ${s(f(b, 'COLOR'))} });\n`;
gen.ui_emoji = (b) => `app.add(p, 'emoji', ${s(f(b, 'NAME'))}, { text: ${s(f(b, 'TEXT'))}, size: ${Number(f(b, 'SIZE'))} });\n`;
gen.ui_input = (b) => `app.add(p, 'input', ${s(f(b, 'NAME'))}, { text: ${s(f(b, 'TEXT'))} });\n`;
gen.ui_list = (b) => `app.add(p, 'list', ${s(f(b, 'NAME'))});\n`;
gen.ui_card = (b) => `app.add(p, 'card', '', { icon: ${s(f(b, 'ICON'))}, title: ${s(f(b, 'TITLE'))}, text: ${s(f(b, 'TEXT'))} });\n`;
gen.ui_link = (b) => `app.add(p, 'link', '', { text: ${s(f(b, 'TEXT'))}, url: ${s(f(b, 'URL'))} });\n`;
gen.ui_space = () => `app.add(p, 'space', '');\n`;
gen.ui_box = (b) => `app.box(p, ${s(f(b, 'NAME'))}, ${s(f(b, 'COLOR'))}, ${f(b, 'LAYOUT') === 'row'}, (p) => {\n${body(b, 'CONTENT')}});\n`;
gen.ui_area = (b) => `app.area(p, ${s(f(b, 'NAME'))}, ${Number(f(b, 'HEIGHT'))}, ${s(f(b, 'COLOR'))}, (p) => {\n${body(b, 'CONTENT')}});\n`;
gen.ui_quiz = (b) => `app.quiz(p, ${s(f(b, 'NAME'))}, [\n${body(b, 'QUESTIONS')}], ${s(f(b, 'DONE'))});\n`;
gen.quiz_q = (b) => `{ q: ${s(f(b, 'Q'))}, a: ${s(f(b, 'A'))}, w: [${s(f(b, 'W1'))}, ${s(f(b, 'W2'))}] },\n`;

gen.ui_stage = (b) => `app.stage(p, ${s(f(b, 'NAME'))}, ${Number(f(b, 'HEIGHT'))}, ${s(f(b, 'THEME'))}, (p) => {\n${body(b, 'SPRITES')}});\n`;
gen.game_sprite = (b) => `app.sprite(p, ${s(f(b, 'NAME'))}, ${s(f(b, 'EMOJI'))}, ${Number(f(b, 'SIZE'))}, ${Number(f(b, 'X'))}, ${Number(f(b, 'Y'))}, ${f(b, 'SHOW') === 'yes'});\n`;
gen.game_controls = (b) => `app.controls(${s(f(b, 'NAME'))}, ${s(f(b, 'MODE'))}, ${Number(f(b, 'SPEED'))});\n`;
gen.game_jump = (b) => `app.jumpOn(${s(f(b, 'NAME'))}, ${Number(f(b, 'POWER'))}, ${s(f(b, 'AIR'))});\n`;
gen.game_gravity = (b) => `app.gravity(${s(f(b, 'NAME'))}, ${Number(f(b, 'STRENGTH'))});\n`;
gen.game_velocity = (b) => `app.velocity(${s(f(b, 'NAME'))}, ${s(f(b, 'DIR'))}, ${Number(f(b, 'SPEED'))});\n`;
gen.game_edges = (b) => `app.edges(${s(f(b, 'NAME'))}, ${s(f(b, 'MODE'))});\n`;
gen.game_chase = (b) => `app.chase(${s(f(b, 'NAME'))}, ${s(f(b, 'TARGET'))}, ${Number(f(b, 'SPEED'))});\n`;
gen.game_spawn = (b) => `app.spawn(${s(f(b, 'NAME'))}, ${s(f(b, 'WHERE'))});\n`;
gen.game_shoot = (b) => `app.shoot(${s(f(b, 'NAME'))}, ${s(f(b, 'BULLET'))}, ${s(f(b, 'DIR'))});\n`;
gen.game_teleport = (b) => `app.teleport(${s(f(b, 'NAME'))});\n`;
gen.game_remove = (b) => `app.removeSprite(${s(f(b, 'WHO'))});\n`;
gen.game_remove_all = (b) => `app.removeAll(${s(f(b, 'NAME'))});\n`;
gen.game_effect = (b) => `app.effect(${s(f(b, 'KIND'))}, ${s(f(b, 'WHO'))});\n`;
gen.game_score = (b) => `app.addScore(${Number(f(b, 'NUM'))});\n`;
gen.game_lives = (b) => `app.addLives(${Number(f(b, 'NUM'))});\n`;
gen.game_set_lives = (b) => `app.setLives(${Number(f(b, 'NUM'))});\n`;
gen.game_timer = (b) => `app.timer(${Number(f(b, 'SEC'))}, ${s(f(b, 'RESULT'))});\n`;
gen.game_over = (b) => `app.gameOver(${s(f(b, 'RESULT'))});\n`;
gen.ev_touch = (b) => `app.onTouch(${s(f(b, 'A'))}, ${s(f(b, 'B'))}, () => {\n${body(b, 'DO')}});\n`;
gen.val_score = () => ['app.gameScore()', O.FUNCTION_CALL];

gen.ev_start = (b) => `app.onStart(() => {\n${body(b, 'DO')}});\n`;
gen.ev_click = (b) => `app.onClick(${s(f(b, 'NAME'))}, () => {\n${body(b, 'DO')}});\n`;
gen.ev_every = (b) => `app.every(${Number(f(b, 'SEC'))}, () => {\n${body(b, 'DO')}});\n`;
gen.ev_key = (b) => `app.onKey(${s(f(b, 'KEY'))}, () => {\n${body(b, 'DO')}});\n`;

gen.act_say = (b) => `app.say(${v(b, 'VALUE')});\n`;
gen.act_set_text = (b) => `app.setText(${s(f(b, 'NAME'))}, ${v(b, 'VALUE')});\n`;
gen.act_bg = (b) => `app.bg(${s(f(b, 'COLOR'))});\n`;
gen.act_color = (b) => `app.color(${s(f(b, 'NAME'))}, ${s(f(b, 'COLOR'))});\n`;
gen.act_visible = (b) => `app.visible(${s(f(b, 'NAME'))}, ${f(b, 'ON') === 'true'});\n`;
gen.act_move = (b) => `app.move(${s(f(b, 'NAME'))}, ${s(f(b, 'DIR'))}, ${Number(f(b, 'STEPS'))});\n`;
gen.act_jump = (b) => `app.jump(${s(f(b, 'NAME'))});\n`;
gen.act_size = (b) => `app.size(${s(f(b, 'NAME'))}, ${v(b, 'VALUE', '60')});\n`;
gen.act_list_add = (b) => `app.listAdd(${s(f(b, 'NAME'))}, ${v(b, 'VALUE')});\n`;
gen.act_list_clear = (b) => `app.listClear(${s(f(b, 'NAME'))});\n`;
gen.act_clear_input = (b) => `app.clearInput(${s(f(b, 'NAME'))});\n`;
gen.act_sound = (b) => `app.sound(${s(f(b, 'KIND'))});\n`;
gen.act_confetti = () => `app.confetti();\n`;
gen.act_stop = () => `app.stopTimers();\n`;

gen.val_text_of = (b) => [`app.text(${s(f(b, 'NAME'))})`, O.FUNCTION_CALL];
gen.val_number_of = (b) => [`app.num(${s(f(b, 'NAME'))})`, O.FUNCTION_CALL];
gen.val_list_size = (b) => [`app.listSize(${s(f(b, 'NAME'))})`, O.FUNCTION_CALL];

export function generateCode(workspace) {
  G.init(workspace);
  return G.workspaceToCode(workspace);
}

export function pageTitle(workspace) {
  const page = workspace.getTopBlocks(false).find(b => b.type === 'ui_page');
  return page ? page.getFieldValue('TITLE') : 'האפליקציה שלי';
}

// ----- toolbox -----
const blk = (type, extra) => ({ kind: 'block', type, ...extra });
const num = (n) => ({ shadow: { type: 'math_number', fields: { NUM: n } } });
const txt = (t) => ({ shadow: { type: 'text', fields: { TEXT: t } } });

export const TOOLBOX = {
  kind: 'categoryToolbox',
  contents: [
    { kind: 'category', name: '📄 מסך', colour: HUE.ui, contents: [
      blk('ui_page'), blk('ui_title'), blk('ui_text'), blk('ui_button'), blk('ui_emoji'), blk('ui_input'),
      blk('ui_list'), blk('ui_card'), blk('ui_link'), blk('ui_space'), blk('ui_box'), blk('ui_area'),
      blk('ui_quiz', { inputs: { QUESTIONS: { block: { type: 'quiz_q' } } } }), blk('quiz_q'),
    ] },
    { kind: 'category', name: '🎮 משחק', colour: HUE.game, contents: [
      { kind: 'label', text: 'מוכנים לשימוש: גוררים ומשנים' },
      blk('ui_stage', { inputs: { SPRITES: { block: { type: 'game_sprite', fields: { EMOJI: '🐱', NAME: 'שחקן', SIZE: 60, X: 50, Y: 85, SHOW: 'yes' },
        next: { block: { type: 'game_sprite', fields: { EMOJI: '👾', NAME: 'אויב', SIZE: 50, X: 50, Y: 0, SHOW: 'no' } } } } } } }),
      blk('ev_start', { inputs: { DO: { block: { type: 'game_controls', fields: { NAME: 'שחקן', MODE: 'lr', SPEED: 60 },
        next: { block: { type: 'game_velocity', fields: { NAME: 'אויב', DIR: 'down', SPEED: 35 }, next: { block: { type: 'game_set_lives', fields: { NUM: 3 } } } } } } } } }),
      blk('ev_every', { fields: { SEC: 1 }, inputs: { DO: { block: { type: 'game_spawn', fields: { NAME: 'אויב', WHERE: 'top' } } } } }),
      blk('ev_touch', { inputs: { DO: { block: { type: 'game_remove', fields: { WHO: 'other' }, next: { block: { type: 'game_effect', fields: { KIND: 'boom', WHO: 'other' },
        next: { block: { type: 'game_lives', fields: { NUM: -1 } } } } } } } } }),
      { kind: 'label', text: 'דמויות ותנועה' },
      blk('ui_stage'), blk('game_sprite'), blk('game_controls'), blk('game_jump'), blk('game_gravity'), blk('game_velocity'),
      blk('game_edges'), blk('game_chase'), blk('game_teleport'),
      { kind: 'label', text: 'יצירה, מגע ואפקטים' },
      blk('ev_touch'), blk('game_spawn'), blk('game_shoot'), blk('game_remove'), blk('game_remove_all'), blk('game_effect'),
      { kind: 'label', text: 'ניקוד, חיים וזמן' },
      blk('game_score'), blk('game_lives'), blk('game_set_lives'), blk('game_timer'), blk('game_over'), blk('val_score'),
    ] },
    { kind: 'category', name: '⚡ אירועים', colour: HUE.event, contents: [
      blk('ev_start'), blk('ev_click'), blk('ev_every'), blk('ev_key'),
    ] },
    { kind: 'category', name: '🎬 פעולות', colour: HUE.action, contents: [
      blk('act_say', { inputs: { VALUE: txt('שלום! 👋') } }),
      blk('act_set_text', { inputs: { VALUE: txt('טקסט חדש') } }),
      blk('act_bg'), blk('act_color'), blk('act_visible'), blk('act_move'), blk('act_jump'),
      blk('act_size', { inputs: { VALUE: num(120) } }),
      blk('act_list_add', { inputs: { VALUE: { block: { type: 'val_text_of' } } } }),
      blk('act_list_clear'), blk('act_clear_input'), blk('act_sound'), blk('act_confetti'), blk('act_stop'),
      blk('val_text_of'), blk('val_number_of'), blk('val_list_size'),
    ] },
    { kind: 'category', name: '🔀 תנאים', colour: '210', contents: [
      blk('controls_if'), blk('controls_if', { extraState: { hasElse: true } }), blk('logic_compare'), blk('logic_operation'),
      blk('logic_negate'), blk('logic_boolean'),
    ] },
    { kind: 'category', name: '🔁 לולאות', colour: '120', contents: [
      blk('controls_repeat_ext', { inputs: { TIMES: num(5) } }),
      blk('controls_for', { inputs: { FROM: num(1), TO: num(10), BY: num(1) } }),
    ] },
    { kind: 'category', name: '🔢 חשבון', colour: '230', contents: [
      blk('math_number'), blk('math_arithmetic', { inputs: { A: num(1), B: num(1) } }),
      blk('math_random_int', { inputs: { FROM: num(1), TO: num(10) } }), blk('math_round'), blk('math_modulo'),
    ] },
    { kind: 'category', name: '🔤 טקסט', colour: '160', contents: [
      blk('text'), blk('text_join'), blk('text_length', { inputs: { VALUE: txt('שלום') } }),
    ] },
    { kind: 'category', name: '📦 משתנים', colour: '330', custom: 'VARIABLE' },
  ],
};
