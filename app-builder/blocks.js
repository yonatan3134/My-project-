// Hebrew blocks for building apps, and how each one turns into code.
/* global Blockly, javascript */

export const COLORS = [
  ['לבן', '#ffffff'], ['שחור', '#111111'], ['אפור', '#8d99ae'], ['אדום', '#ff4d4d'], ['כתום', '#ff9f1c'],
  ['צהוב', '#ffd93d'], ['ירוק', '#2ecc71'], ['תכלת', '#4cc9f0'], ['כחול', '#3a86ff'], ['סגול', '#8e44ad'],
  ['ורוד', '#ff6bb5'], ['חום', '#8d5524'], ['כחול לילה', '#1d1240'], ['תכלת בהיר', '#e8f4ff'],
  ['ורוד בהיר', '#ffe9f4'], ['ירוק בהיר', '#e9fbe9'], ['סגול בהיר', '#f1ecff'], ['צהוב בהיר', '#fff8dc'],
];
const BOX_COLORS = [['בלי צבע', 'none'], ...COLORS];

const HUE = { page: 260, ui: 200, event: 35, action: 330, value: 160 };

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

  // ----- values -----
  { type: 'val_text_of', message0: 'הטקסט של %1', args0: [{ type: 'field_input', name: 'NAME', text: 'תיבה' }], output: 'String', colour: HUE.value },
  { type: 'val_number_of', message0: 'המספר שכתוב ב %1', args0: [{ type: 'field_input', name: 'NAME', text: 'תיבה' }], output: 'Number', colour: HUE.value },
  { type: 'val_list_size', message0: 'כמה פריטים ברשימה %1', args0: [{ type: 'field_input', name: 'NAME', text: 'רשימה' }], output: 'Number', colour: HUE.value },
];

const STATEMENT_UI = ['ui_title', 'ui_text', 'ui_button', 'ui_emoji', 'ui_input', 'ui_list', 'ui_card', 'ui_link', 'ui_space', 'ui_box', 'ui_area', 'ui_quiz'];

for (const d of DEFS) {
  if (STATEMENT_UI.includes(d.type)) { d.previousStatement = 'ui'; d.nextStatement = 'ui'; d.colour = d.colour ?? HUE.ui; }
  if (d.type.startsWith('act_')) { d.previousStatement = null; d.nextStatement = null; d.colour = HUE.action; }
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
