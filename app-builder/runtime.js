// The small library every generated app ships with. It is stringified into the
// exported HTML file, so the file works on its own (no internet needed).
function appRuntime() {
  const els = Object.create(null);
  const clicks = Object.create(null);
  const starts = [];
  const timers = [];
  const keys = [];
  let pageFn = null;
  let root = null;
  let audio = null;

  function toast(text, kind) {
    let box = document.querySelector('.app-toasts');
    if (!box) { box = document.createElement('div'); box.className = 'app-toasts'; document.body.append(box); }
    const t = document.createElement('div');
    t.className = 'app-toast' + (kind ? ' ' + kind : '');
    t.textContent = String(text);
    box.append(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3000);
  }
  function fail(err) { console.error(err); toast('⚠️ ' + (err && err.message ? err.message : err), 'bad'); }
  function safe(fn) { return (...a) => { try { return fn(...a); } catch (e) { fail(e); } }; }
  function find(name) {
    const el = els[name];
    if (!el) toast('⚠️ לא מצאתי רכיב בשם "' + name + '"', 'bad');
    return el;
  }
  function mk(tag, cls, parent) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    (parent || root).append(el);
    return el;
  }
  function register(name, el) { if (name) { els[name] = el; el.dataset.name = name; } return el; }
  function isDark(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return false;
    const n = parseInt(m[1], 16);
    return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 140;
  }
  function beep(freqs, dur, type) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      freqs.forEach((f, i) => {
        const o = audio.createOscillator(); const g = audio.createGain();
        o.type = type || 'sine'; o.frequency.value = f;
        const t0 = audio.currentTime + i * dur;
        g.gain.setValueAtTime(0.2, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        o.connect(g).connect(audio.destination); o.start(t0); o.stop(t0 + dur);
      });
    } catch (e) { /* no sound available */ }
  }

  const api = {
    page(title, bg, fg, fn) {
      document.title = title || 'האפליקציה שלי';
      document.body.style.background = bg || '#ffffff';
      document.body.style.color = fg && fg !== 'auto' ? fg : (isDark(bg) ? '#ffffff' : '#1b1640');
      pageFn = fn;
    },
    add(parent, kind, name, o) {
      o = o || {};
      let el;
      if (kind === 'title') { el = mk('h1', 'a-title', parent); el.textContent = o.text; }
      else if (kind === 'text') { el = mk('p', 'a-text', parent); el.textContent = o.text; }
      else if (kind === 'button') {
        el = mk('button', 'a-btn', parent); el.textContent = o.text;
        if (o.color) { el.style.background = o.color; el.style.color = isDark(o.color) ? '#fff' : '#1b1640'; }
        el.addEventListener('click', () => (clicks[name] || []).forEach(f => f()));
      } else if (kind === 'emoji') {
        el = mk('div', 'a-emoji', parent); el.textContent = o.text; el.style.fontSize = (o.size || 60) + 'px';
        el.addEventListener('click', () => (clicks[name] || []).forEach(f => f()));
      } else if (kind === 'input') { el = mk('input', 'a-input', parent); el.placeholder = o.text || ''; }
      else if (kind === 'list') {
        el = mk('ul', 'a-list', parent);
      } else if (kind === 'card') {
        el = mk('div', 'a-card', parent);
        const i = mk('div', 'a-card-i', el); i.textContent = o.icon;
        const h = mk('h3', '', el); h.textContent = o.title;
        const p = mk('p', '', el); p.textContent = o.text;
      } else if (kind === 'space') { el = mk('div', 'a-space', parent); }
      else if (kind === 'link') {
        el = mk('a', 'a-link', parent); el.textContent = o.text; el.href = o.url; el.target = '_blank'; el.rel = 'noopener';
      }
      return register(name, el);
    },
    box(parent, name, color, row, fn) {
      const el = mk('div', 'a-box' + (row ? ' row' : ''), parent);
      if (color && color !== 'none') { el.style.background = color; el.style.color = isDark(color) ? '#fff' : '#1b1640'; el.classList.add('filled'); }
      register(name, el);
      fn(el);
      return el;
    },
    area(parent, name, height, color, fn) {
      const el = mk('div', 'a-area', parent);
      el.style.height = (height || 300) + 'px';
      if (color) el.style.background = color;
      register(name, el);
      fn(el);
      [...el.children].forEach((c, i) => {
        c.style.position = 'absolute';
        c.style.left = 'calc(50% - ' + (40 + i * 10) + 'px)'; c.style.top = 'calc(50% - 40px)';
      });
      return el;
    },
    quiz(parent, name, questions, doneText) {
      const el = register(name, mk('div', 'a-quiz', parent));
      let i = 0, score = 0;
      const show = () => {
        el.innerHTML = '';
        if (i >= questions.length) {
          const h = mk('h2', '', el); h.textContent = doneText || 'סיימת!';
          const p = mk('p', 'a-quiz-score', el); p.textContent = 'ענית נכון על ' + score + ' מתוך ' + questions.length;
          if (score === questions.length && questions.length) api.confetti();
          const again = mk('button', 'a-btn', el); again.textContent = '🔁 שחק שוב';
          again.onclick = () => { i = 0; score = 0; show(); };
          return;
        }
        const q = questions[i];
        const n = mk('div', 'a-quiz-n', el); n.textContent = 'שאלה ' + (i + 1) + ' מתוך ' + questions.length;
        const h = mk('h2', '', el); h.textContent = q.q;
        const opts = [q.a, ...q.w.filter(Boolean)].sort(() => Math.random() - 0.5);
        const wrap = mk('div', 'a-quiz-opts', el);
        opts.forEach(o => {
          const b = mk('button', 'a-btn a-quiz-opt', wrap); b.textContent = o;
          b.onclick = () => {
            [...wrap.children].forEach(x => { x.disabled = true; if (x.textContent === q.a) x.classList.add('ok'); });
            if (o === q.a) { score++; beep([660, 880], 0.12); } else { b.classList.add('no'); beep([200], 0.25, 'square'); }
            setTimeout(() => { i++; show(); }, 1100);
          };
        });
      };
      show();
      return el;
    },

    onStart(fn) { starts.push(safe(fn)); },
    onClick(name, fn) { (clicks[name] = clicks[name] || []).push(safe(fn)); },
    every(sec, fn) { timers.push({ sec: Math.max(0.05, Number(sec) || 1), fn: safe(fn) }); },
    onKey(key, fn) { keys.push({ key, fn: safe(fn) }); },

    setText(name, v) {
      const el = find(name); if (!el) return;
      if (el.tagName === 'INPUT') el.value = v; else el.textContent = v;
    },
    text(name) {
      const el = find(name); if (!el) return '';
      return el.tagName === 'INPUT' ? el.value : el.textContent;
    },
    num(name) { const n = parseFloat(api.text(name)); return isNaN(n) ? 0 : n; },
    say(v) { toast(v); },
    bg(c) { document.body.style.background = c; document.body.style.color = isDark(c) ? '#fff' : '#1b1640'; },
    color(name, c) {
      const el = find(name); if (!el) return;
      if (el.tagName === 'BUTTON' || el.classList.contains('a-box') || el.classList.contains('a-area')) {
        el.style.background = c; el.style.color = isDark(c) ? '#fff' : '#1b1640';
      } else el.style.color = c;
    },
    visible(name, on) { const el = find(name); if (el) el.style.visibility = on ? 'visible' : 'hidden'; },
    move(name, dir, steps) {
      const el = find(name); if (!el) return;
      const s = (Number(steps) || 0) * 10;
      const x = (parseFloat(el.dataset.x) || 0) + (dir === 'right' ? s : dir === 'left' ? -s : 0);
      const y = (parseFloat(el.dataset.y) || 0) + (dir === 'down' ? s : dir === 'up' ? -s : 0);
      el.dataset.x = x; el.dataset.y = y;
      el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    },
    jump(name) {
      const el = find(name); if (!el) return;
      const p = el.parentElement;
      if (getComputedStyle(p).position === 'static') p.style.position = 'relative';
      if (!p.classList.contains('a-area') && p.clientHeight < 200) p.style.minHeight = '300px';
      el.style.position = 'absolute'; el.style.transform = '';
      el.dataset.x = 0; el.dataset.y = 0;
      el.style.left = Math.random() * Math.max(0, p.clientWidth - el.offsetWidth) + 'px';
      el.style.top = Math.random() * Math.max(0, p.clientHeight - el.offsetHeight) + 'px';
    },
    size(name, n) {
      const el = find(name); if (!el) return;
      el.style.fontSize = (Number(n) || 16) + 'px';
    },
    listAdd(name, v) {
      const el = find(name); if (!el) return;
      const li = document.createElement('li'); li.textContent = v;
      li.onclick = () => li.classList.toggle('done');
      const x = document.createElement('button'); x.textContent = '✕'; x.className = 'a-x';
      x.onclick = (e) => { e.stopPropagation(); li.remove(); };
      li.append(x); el.append(li);
    },
    listClear(name) { const el = find(name); if (el) el.innerHTML = ''; },
    listSize(name) { const el = find(name); return el ? el.children.length : 0; },
    clearInput(name) { const el = find(name); if (el && el.tagName === 'INPUT') el.value = ''; },
    sound(kind) {
      if (kind === 'buzz') beep([180], 0.3, 'square');
      else if (kind === 'win') beep([523, 659, 784, 1047], 0.12, 'triangle');
      else if (kind === 'jump') beep([300, 600], 0.08, 'triangle');
      else beep([880], 0.15);
    },
    confetti() {
      const colors = ['#ff4d4d', '#ffd93d', '#2ecc71', '#3a86ff', '#ff6bb5', '#8e44ad'];
      for (let i = 0; i < 80; i++) {
        const c = document.createElement('div'); c.className = 'a-confetti';
        c.style.left = Math.random() * 100 + 'vw';
        c.style.background = colors[i % colors.length];
        c.style.animationDelay = Math.random() * 0.6 + 's';
        c.style.animationDuration = 1.6 + Math.random() * 1.4 + 's';
        document.body.append(c);
        setTimeout(() => c.remove(), 3800);
      }
    },
    stopTimers() { timers.forEach(t => clearInterval(t.id)); },

    error: fail,
    start() {
      root = document.getElementById('app');
      try { if (pageFn) pageFn(root); } catch (e) { fail(e); }
      document.addEventListener('keydown', (e) => keys.forEach(k => { if (k.key === e.key) { e.preventDefault(); k.fn(); } }));
      starts.forEach(f => f());
      timers.forEach(t => { t.id = setInterval(t.fn, t.sec * 1000); });
    },
  };
  return api;
}

const RUNTIME_CSS = `
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, "Segoe UI", Arial, sans-serif; min-height: 100vh; transition: background .3s; }
#app { max-width: 900px; margin: 0 auto; padding: 24px 16px 60px; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; }
.a-title { margin: 6px 0; font-size: clamp(1.8rem, 6vw, 2.8rem); }
.a-text { margin: 0; font-size: 1.15rem; line-height: 1.6; max-width: 640px; white-space: pre-wrap; }
.a-btn { border: none; border-radius: 999px; padding: 12px 26px; font: inherit; font-size: 1.05rem; font-weight: 700; cursor: pointer;
  background: #6a4cff; color: #fff; box-shadow: 0 4px 0 rgba(0,0,0,.18); transition: transform .08s; }
.a-btn:active { transform: translateY(2px); box-shadow: 0 2px 0 rgba(0,0,0,.18); }
.a-btn:disabled { cursor: default; opacity: .8; }
.a-emoji { line-height: 1; cursor: pointer; user-select: none; transition: transform .15s, left .25s, top .25s; }
.a-emoji:active { transform: scale(.9); }
.a-input { font: inherit; font-size: 1.05rem; padding: 12px 14px; border: 2px solid rgba(106,76,255,.35); border-radius: 14px; width: min(100%, 360px); text-align: inherit; }
.a-list { list-style: none; padding: 0; margin: 0; width: min(100%, 420px); text-align: start; }
.a-list li { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 14px; margin: 6px 0; border-radius: 12px; background: rgba(106,76,255,.08); cursor: pointer; }
.a-list li.done { text-decoration: line-through; opacity: .55; }
.a-x { border: none; background: none; color: #e5484d; font-size: 1rem; cursor: pointer; }
.a-box { display: flex; flex-direction: column; align-items: center; gap: 12px; width: 100%; }
.a-box.row { flex-direction: row; flex-wrap: wrap; justify-content: center; align-items: stretch; }
.a-box.filled { padding: 20px; border-radius: 20px; }
.a-card { flex: 1 1 200px; max-width: 280px; background: rgba(255,255,255,.9); color: #1b1640; border-radius: 18px; padding: 20px; box-shadow: 0 8px 24px rgba(60,30,160,.12); }
.a-card-i { font-size: 2.2rem; } .a-card h3 { margin: 8px 0 4px; } .a-card p { margin: 0; color: #5b5680; }
.a-space { height: 20px; }
.a-link { color: inherit; font-weight: 700; }
.a-area { position: relative; width: 100%; border-radius: 20px; overflow: hidden; background: rgba(106,76,255,.08); }
.a-quiz { width: min(100%, 520px); background: rgba(255,255,255,.92); color: #1b1640; border-radius: 22px; padding: 22px; box-shadow: 0 10px 30px rgba(60,30,160,.15); }
.a-quiz h2 { margin: 6px 0 16px; }
.a-quiz-n { color: #6b6690; font-size: .9rem; }
.a-quiz-opts { display: grid; gap: 10px; }
.a-quiz-opt.ok { background: #2ecc71; } .a-quiz-opt.no { background: #ff4d4d; }
.a-quiz-score { font-size: 1.3rem; }
.app-toasts { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); display: grid; gap: 8px; z-index: 100; width: max-content; max-width: 90vw; }
.app-toast { background: #1d1240; color: #fff; padding: 12px 20px; border-radius: 14px; font-size: 1.05rem; box-shadow: 0 8px 24px rgba(0,0,0,.25); animation: a-in .25s; transition: opacity .4s; }
.app-toast.bad { background: #b3261e; } .app-toast.out { opacity: 0; }
@keyframes a-in { from { transform: translateY(-10px); opacity: 0; } }
.a-confetti { position: fixed; top: -12px; width: 10px; height: 14px; border-radius: 2px; z-index: 99; animation: a-fall linear forwards; pointer-events: none; }
@keyframes a-fall { to { transform: translateY(105vh) rotate(720deg); } }
`;

export function buildHtml(code, title) {
  const safeTitle = String(title || 'האפליקציה שלי').replace(/[<>&]/g, '');
  const body = code.replace(/<\/script/gi, '<\\/script');
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>${RUNTIME_CSS}</style>
</head>
<body>
<div id="app"></div>
<script>
const app = (${appRuntime.toString()})();
try {
${body}
} catch (e) { app.error(e); }
app.start();
</script>
</body>
</html>
`;
}
