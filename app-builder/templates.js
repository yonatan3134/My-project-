// Ready-made starter apps that work without an API key.
const base = (title, css, body, js = '') => `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, "Segoe UI", Arial, sans-serif; }
${css}
</style>
</head>
<body>
${body}
${js ? `<script>\n${js}\n</script>` : ''}
</body>
</html>
`;

export const TEMPLATES = [
  {
    id: 'landing',
    name: '🌐 אתר תדמית',
    html: base('העסק שלי', `
body { color: #1b1640; background: #fbfaff; }
nav { display: flex; justify-content: space-between; align-items: center; padding: 18px 6vw; }
nav b { font-size: 1.3rem; color: #6a4cff; }
nav a { margin-inline-start: 18px; color: inherit; text-decoration: none; }
.hero { padding: 80px 6vw; text-align: center; background: linear-gradient(135deg, #6a4cff, #ff6bb5); color: #fff; }
.hero h1 { font-size: clamp(2rem, 6vw, 3.4rem); margin: 0 0 12px; }
.hero p { font-size: 1.2rem; opacity: .9; margin: 0 0 26px; }
.cta { background: #fff; color: #6a4cff; border: none; padding: 14px 30px; border-radius: 999px; font-size: 1.1rem; font-weight: 700; cursor: pointer; }
.features { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; padding: 60px 6vw; }
.card { background: #fff; padding: 26px; border-radius: 18px; box-shadow: 0 8px 26px rgba(80,40,200,.08); }
.card .i { font-size: 2rem; }
footer { text-align: center; padding: 30px; color: #8a85aa; }`,
`<nav><b>⭐ העסק שלי</b><div><a href="#features">שירותים</a><a href="#contact">צור קשר</a></div></nav>
<section class="hero">
  <h1>הפתרון שחיכית לו</h1>
  <p>משפט קצר וקליט שמסביר למה כדאי לבחור בנו.</p>
  <button class="cta" onclick="alert('תודה! נחזור אליך בקרוב 🙌')">דברו איתנו</button>
</section>
<section class="features" id="features">
  <div class="card"><div class="i">⚡</div><h3>מהיר</h3><p>תיאור קצר של היתרון הראשון.</p></div>
  <div class="card"><div class="i">💎</div><h3>איכותי</h3><p>תיאור קצר של היתרון השני.</p></div>
  <div class="card"><div class="i">🤝</div><h3>אמין</h3><p>תיאור קצר של היתרון השלישי.</p></div>
</section>
<footer id="contact">© העסק שלי · 050-0000000</footer>`),
  },
  {
    id: 'todo',
    name: '✅ רשימת משימות',
    html: base('המשימות שלי', `
body { background: linear-gradient(160deg, #e9e4ff, #ffe9f4); min-height: 100vh; display: grid; place-items: start center; padding: 40px 16px; }
.box { width: 100%; max-width: 440px; background: #fff; border-radius: 20px; padding: 22px; box-shadow: 0 10px 30px rgba(80,40,200,.12); }
h1 { margin: 0 0 16px; color: #4b32d6; }
form { display: flex; gap: 8px; }
input { flex: 1; padding: 12px; border: 2px solid #e3def8; border-radius: 12px; font: inherit; }
button { border: none; border-radius: 12px; padding: 0 16px; background: #6a4cff; color: #fff; font: inherit; cursor: pointer; }
ul { list-style: none; padding: 0; margin: 16px 0 0; }
li { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 12px; }
li:hover { background: #f6f3ff; }
li.done span { text-decoration: line-through; color: #aaa; }
li span { flex: 1; }
li .x { background: none; color: #e5484d; font-size: 1.1rem; padding: 0 6px; }
.count { color: #8a85aa; margin-top: 10px; font-size: .9rem; }`,
`<div class="box">
  <h1>📝 המשימות שלי</h1>
  <form id="f"><input id="t" placeholder="מה צריך לעשות?" autocomplete="off"><button>הוסף</button></form>
  <ul id="list"></ul>
  <div class="count" id="count"></div>
</div>`,
`const tasks = [{ text: 'לבנות אפליקציה ראשונה', done: true }, { text: 'להראות לחברים', done: false }];
const list = document.getElementById('list');
function render() {
  list.innerHTML = '';
  tasks.forEach((task, i) => {
    const li = document.createElement('li');
    li.className = task.done ? 'done' : '';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = task.done;
    cb.onchange = () => { task.done = cb.checked; render(); };
    const span = document.createElement('span'); span.textContent = task.text;
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕';
    x.onclick = () => { tasks.splice(i, 1); render(); };
    li.append(cb, span, x); list.append(li);
  });
  const left = tasks.filter(t => !t.done).length;
  document.getElementById('count').textContent = left ? 'נשארו ' + left + ' משימות' : 'הכל בוצע! 🎉';
}
document.getElementById('f').onsubmit = e => {
  e.preventDefault();
  const input = document.getElementById('t');
  if (input.value.trim()) { tasks.push({ text: input.value.trim(), done: false }); input.value = ''; render(); }
};
render();`),
  },
  {
    id: 'memory',
    name: '🧠 משחק זיכרון',
    html: base('משחק זיכרון', `
body { background: #1d1240; color: #fff; min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 24px 12px; }
h1 { margin: 0 0 6px; }
.info { margin-bottom: 16px; opacity: .85; }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; width: 100%; max-width: 400px; }
.card { aspect-ratio: 1; border-radius: 14px; border: none; font-size: 2.2rem; cursor: pointer; background: linear-gradient(135deg, #6a4cff, #ff6bb5); color: transparent; transition: transform .2s; }
.card.open, .card.found { background: #fff; color: initial; transform: rotateY(180deg); }
.card.found { opacity: .55; }
button.again { margin-top: 18px; border: none; border-radius: 999px; padding: 10px 24px; font: inherit; font-weight: 700; cursor: pointer; }`,
`<h1>🧠 משחק זיכרון</h1>
<div class="info">מהלכים: <b id="moves">0</b></div>
<div class="grid" id="grid"></div>
<button class="again" onclick="start()">משחק חדש</button>`,
`const icons = ['🐶','🍕','🚀','🌈','⚽','🎸','🦄','🍉'];
let first = null, lock = false, moves = 0, found = 0;
function start() {
  const deck = [...icons, ...icons].sort(() => Math.random() - .5);
  const grid = document.getElementById('grid');
  grid.innerHTML = ''; first = null; lock = false; moves = 0; found = 0;
  document.getElementById('moves').textContent = 0;
  deck.forEach(icon => {
    const b = document.createElement('button');
    b.className = 'card'; b.textContent = icon;
    b.onclick = () => flip(b);
    grid.append(b);
  });
}
function flip(b) {
  if (lock || b === first || b.classList.contains('found')) return;
  b.classList.add('open');
  if (!first) { first = b; return; }
  document.getElementById('moves').textContent = ++moves;
  if (first.textContent === b.textContent) {
    first.classList.add('found'); b.classList.add('found'); first = null;
    if (++found === icons.length) setTimeout(() => alert('ניצחת ב-' + moves + ' מהלכים! 🏆'), 300);
  } else {
    lock = true;
    setTimeout(() => { first.classList.remove('open'); b.classList.remove('open'); first = null; lock = false; }, 800);
  }
}
start();`),
  },
  {
    id: 'calc',
    name: '🧮 מחשבון',
    html: base('מחשבון', `
body { background: #f0edff; min-height: 100vh; display: grid; place-items: center; }
.calc { width: 300px; background: #1d1240; padding: 18px; border-radius: 26px; box-shadow: 0 20px 40px rgba(40,20,120,.3); direction: ltr; }
.screen { color: #fff; font-size: 2.4rem; text-align: right; padding: 16px 8px; min-height: 80px; word-break: break-all; }
.keys { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.keys button { height: 58px; border: none; border-radius: 16px; font-size: 1.3rem; background: #2e2360; color: #fff; cursor: pointer; }
.keys button.op { background: #6a4cff; }
.keys button.eq { background: #ff6bb5; grid-column: span 2; }
.keys button:active { filter: brightness(1.3); }`,
`<div class="calc">
  <div class="screen" id="s">0</div>
  <div class="keys" id="k"></div>
</div>`,
`const keys = ['C','(',')','÷','7','8','9','×','4','5','6','−','1','2','3','+','0','.','='];
let expr = '';
const screen = document.getElementById('s');
keys.forEach(k => {
  const b = document.createElement('button');
  b.textContent = k;
  if ('÷×−+'.includes(k)) b.className = 'op';
  if (k === '=') b.className = 'eq';
  b.onclick = () => press(k);
  document.getElementById('k').append(b);
});
function press(k) {
  if (k === 'C') expr = '';
  else if (k === '=') {
    try {
      const js = expr.replace(/÷/g, '/').replace(/×/g, '*').replace(/−/g, '-');
      if (!/^[0-9+\\-*/(). ]+$/.test(js)) throw 0;
      expr = String(+Function('return (' + js + ')')().toFixed(10));
    } catch { expr = 'שגיאה'; }
  } else expr = (expr === 'שגיאה' ? '' : expr) + k;
  screen.textContent = expr || '0';
}`),
  },
];
