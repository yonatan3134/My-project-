// Ready-made apps written as code (for things that are too big for blocks).
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
];
