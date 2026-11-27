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

  // ================= game engine =================
  // Positions are in percent of the stage (x: 0 = left, 100 = right; y: 0 = top, 100 = bottom).
  // Speeds are percent per second.
  const THEMES = {
    sky: { floor: 100, decor: ['☁️', 5, 'drift'] },
    space: { floor: 100, decor: ['dot', 40, 'twinkle'] },
    sea: { floor: 100, decor: ['bubble', 14, 'rise'] },
    grass: { floor: 86, decor: ['☁️', 4, 'drift'] },
    night: { floor: 100, decor: ['dot', 30, 'twinkle'] },
    desert: { floor: 86, decor: ['☁️', 2, 'drift'] },
    candy: { floor: 100, decor: ['🍬', 8, 'drift'] },
  };
  let game = null;
  const touchDefs = []; // "when X touches Y" can be registered before the stage exists
  let ctx = { me: null, other: null };
  let spriteId = 0;
  const held = new Set();
  const pick = (s) => { const parts = String(s).trim().split(/\s+/).filter(Boolean); return parts[Math.floor(Math.random() * parts.length)] || '⭐'; };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const group = (name) => game ? game.sprites.filter(s => s.alive && s.name === name) : [];
  const beh = (name) => (game.beh[name] = game.beh[name] || {});

  function needGame() {
    if (!game) toast('⚠️ צריך קודם לשים "במת משחק" במסך', 'bad');
    return game;
  }
  function half(s) {
    const W = game.el.clientWidth || 1, H = game.el.clientHeight || 1;
    return { w: (s.size * 0.5) / W * 100, h: (s.size * 0.5) / H * 100 };
  }
  function place(s) {
    s.el.style.left = s.x + '%';
    s.el.style.top = s.y + '%';
  }
  function makeSprite(name, x, y, spawned) {
    const def = game.defs[name];
    if (!def) { toast('⚠️ אין דמות בשם "' + name + '"', 'bad'); return null; }
    const b = beh(name);
    const s = {
      id: ++spriteId, name, size: def.size, x, y, alive: true, spawned,
      vx: b.vx || 0, vy: b.vy || 0, g: b.g || 0, edge: b.edge || (spawned ? 'remove' : 'stop'), onGround: false,
    };
    s.el = document.createElement('div');
    s.el.className = 'a-sprite';
    s.el.textContent = pick(def.emoji);
    s.el.style.fontSize = s.size + 'px';
    s.el.addEventListener('pointerdown', (e) => {
      if (!game.running || game.over) return;
      e.stopPropagation();
      (clicks[name] || []).forEach(f => withCtx(s, null, f));
    });
    game.el.append(s.el);
    place(s);
    game.sprites.push(s);
    return s;
  }
  function withCtx(me, other, fn) {
    const prev = ctx;
    ctx = { me, other };
    try { fn(); } finally { ctx = prev; }
  }
  function kill(s, fx) {
    if (!s || !s.alive) return;
    s.alive = false;
    if (fx) burst(s, fx);
    s.el.classList.add('gone');
    setTimeout(() => s.el.remove(), 200);
  }
  function burst(s, kind) {
    const marks = { boom: ['💥', '✨', '🔥'], sparkle: ['✨', '⭐', '💫'], hearts: ['❤️', '💖', '💕'] }[kind] || ['✨'];
    for (let i = 0; i < 8; i++) {
      const p = document.createElement('span');
      p.className = 'a-particle';
      p.textContent = marks[i % marks.length];
      const a = (i / 8) * Math.PI * 2;
      p.style.left = s.x + '%'; p.style.top = s.y + '%';
      p.style.setProperty('--dx', Math.cos(a) * rnd(30, 70) + 'px');
      p.style.setProperty('--dy', Math.sin(a) * rnd(30, 70) + 'px');
      game.el.append(p);
      setTimeout(() => p.remove(), 700);
    }
  }
  function floatText(text, s) {
    const f = document.createElement('div');
    f.className = 'a-float';
    f.textContent = text;
    f.style.left = (s ? s.x : 50) + '%';
    f.style.top = (s ? s.y : 20) + '%';
    game.el.append(f);
    setTimeout(() => f.remove(), 900);
  }
  function hud() {
    game.hudScore.textContent = '⭐ ' + game.score;
    game.hudLives.hidden = game.lives == null;
    if (game.lives != null) game.hudLives.textContent = game.lives > 6 ? '❤️ ' + game.lives : '❤️'.repeat(Math.max(0, game.lives)) || '💔';
    game.hudTime.hidden = game.timeLeft == null;
    if (game.timeLeft != null) game.hudTime.textContent = '⏱️ ' + Math.max(0, Math.ceil(game.timeLeft));
  }
  function endGame(win) {
    if (!game || game.over) return;
    game.over = true;
    const o = document.createElement('div');
    o.className = 'a-overlay';
    o.innerHTML = '<div class="a-over-emoji"></div><h2></h2><p></p><button class="a-btn">🔁 שחק שוב</button>';
    o.querySelector('.a-over-emoji').textContent = win ? '🏆' : '💥';
    o.querySelector('h2').textContent = win ? 'ניצחת!' : 'נגמר המשחק';
    o.querySelector('p').textContent = 'הניקוד שלך: ' + game.score;
    o.querySelector('button').onclick = (e) => { e.stopPropagation(); location.reload(); };
    game.el.append(o);
    if (win) { api.confetti(); beep([523, 659, 784, 1047], 0.12, 'triangle'); } else beep([400, 300, 200], 0.18, 'sawtooth');
  }
  function press(k) {
    if (!game) return;
    if (!game.running) { startGame(); return; }
    if (held.has(k)) return;
    held.add(k);
    if (k === ' ' || k === 'ArrowUp') doJumps();
  }
  function doJumps() {
    for (const j of game.jumps) for (const s of group(j.name)) {
      if (j.air || s.onGround || s.g === 0) { s.vy = -j.power * 12; s.onGround = false; beep([300, 600], 0.06, 'triangle'); }
    }
  }
  function startGame() {
    if (game.running) return;
    game.running = true;
    game.startEl.remove();
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch (e) { /* no sound */ }
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!game.over) step(dt);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  function step(dt) {
    const W = game.el.clientWidth || 1, H = game.el.clientHeight || 1;
    // controls
    for (const c of game.controls) for (const s of group(c.name)) {
      const lr = (held.has('ArrowRight') ? 1 : 0) - (held.has('ArrowLeft') ? 1 : 0);
      const ud = (held.has('ArrowDown') ? 1 : 0) - (held.has('ArrowUp') ? 1 : 0);
      if (c.mode !== 'ud') s.vx = lr * c.speed;
      if (c.mode !== 'lr' && !s.g) s.vy = ud * c.speed;
    }
    // chasing
    for (const c of game.chase) {
      const targets = group(c.target);
      for (const s of group(c.name)) {
        let best = null, bd = Infinity;
        for (const t of targets) { const d = (t.x - s.x) ** 2 + (t.y - s.y) ** 2; if (d < bd) { bd = d; best = t; } }
        if (!best) { s.vx = 0; if (!s.g) s.vy = 0; continue; }
        const dx = best.x - s.x, dy = best.y - s.y, len = Math.hypot(dx, dy) || 1;
        s.vx = dx / len * c.speed;
        if (!s.g) s.vy = dy / len * c.speed;
      }
    }
    // movement and edges
    const floor = game.floor;
    for (const s of game.sprites) {
      if (!s.alive) continue;
      if (s.g) s.vy += s.g * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const h = half(s);
      s.onGround = false;
      if (s.edge === 'remove') {
        if (s.x < -h.w - 10 || s.x > 100 + h.w + 10 || s.y < -h.h - 10 || s.y > 100 + h.h + 10) kill(s);
      } else if (s.edge === 'wrap') {
        if (s.x < -h.w) s.x = 100 + h.w; else if (s.x > 100 + h.w) s.x = -h.w;
        if (s.y < -h.h) s.y = floor + h.h; else if (s.y > floor + h.h) s.y = -h.h;
      } else {
        const bounce = s.edge === 'bounce';
        if (s.x < h.w) { s.x = h.w; if (bounce) s.vx = Math.abs(s.vx); }
        if (s.x > 100 - h.w) { s.x = 100 - h.w; if (bounce) s.vx = -Math.abs(s.vx); }
        if (s.y < h.h) { s.y = h.h; if (bounce) s.vy = Math.abs(s.vy); else if (s.vy < 0) s.vy = 0; }
        if (s.y > floor - h.h) {
          s.y = floor - h.h;
          if (bounce) s.vy = -Math.abs(s.vy); else if (s.vy > 0) s.vy = 0;
          s.onGround = true;
        }
      }
      if (s.alive) place(s);
    }
    // touching
    const now = new Set();
    for (const t of game.touches) {
      const A = group(t.a), B = group(t.b);
      for (const a of A) for (const b of B) {
        if (a === b || !a.alive || !b.alive) continue;
        const dx = (a.x - b.x) / 100 * W, dy = (a.y - b.y) / 100 * H;
        if (Math.hypot(dx, dy) < (a.size + b.size) * 0.36) {
          const key = t.id + ':' + a.id + ':' + b.id;
          now.add(key);
          if (!game.touching.has(key)) withCtx(a, b, t.fn);
        }
      }
    }
    game.touching = now;
    // clock
    if (game.timeLeft != null) {
      game.timeLeft -= dt;
      if (game.timeLeft <= 0) { game.timeLeft = 0; endGame(game.timeWin); }
    }
    hud();
    if (game.sprites.length > 300) game.sprites = game.sprites.filter(s => s.alive);
  }
  function target(which) { return which === 'me' ? ctx.me : ctx.other; }
  function setBeh(name, patch) {
    Object.assign(beh(name), patch);
    group(name).forEach(s => Object.assign(s, patch));
  }
  function buildPad() {
    const needLR = game.controls.some(c => c.mode !== 'ud');
    const needUD = game.controls.some(c => c.mode !== 'lr');
    const needAction = game.jumps.length || keys.some(k => k.key === ' ');
    if (!needLR && !needUD && !needAction) return;
    const pad = document.createElement('div');
    pad.className = 'a-pad';
    const btn = (label, key) => {
      const b = document.createElement('button');
      b.className = 'a-pad-btn'; b.textContent = label;
      const down = (e) => { e.preventDefault(); press(key); if (key === ' ') keys.forEach(k => { if (k.key === ' ' && game.running) k.fn(); }); };
      const up = (e) => { e.preventDefault(); held.delete(key); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
      pad.append(b);
    };
    if (needLR) btn('⬅️', 'ArrowLeft');
    if (needUD) { btn('⬆️', 'ArrowUp'); btn('⬇️', 'ArrowDown'); }
    if (needLR) btn('➡️', 'ArrowRight');
    if (needAction) btn(game.jumps.length ? '⏫ קפיצה' : '🔥 פעולה', ' ');
    game.el.after(pad);
  }
  function hints() {
    const out = [];
    if (game.controls.length) out.push(game.controls.some(c => c.mode === 'all') ? '⬅️⬆️⬇️➡️ חצים כדי לזוז' : '⬅️ ➡️ חצים כדי לזוז');
    if (game.jumps.length) out.push('רווח או לחיצה כדי לקפוץ');
    else if (keys.some(k => k.key === ' ')) out.push('רווח או לחיצה על המסך לפעולה');
    if (Object.keys(clicks).some(n => game.defs[n])) out.push('לוחצים על הדמויות');
    return out.join(' · ');
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

    // ----- game -----
    stage(parent, name, height, theme, fn) {
      const t = THEMES[theme] || THEMES.sky;
      const el = register(name, mk('div', 'a-stage theme-' + (THEMES[theme] ? theme : 'sky'), parent));
      el.style.height = (height || 420) + 'px';
      game = { el, floor: t.floor, sprites: [], defs: {}, beh: {}, touches: touchDefs, touching: new Set(), controls: [], jumps: [], chase: [],
        score: 0, lives: null, timeLeft: null, timeWin: true, running: false, over: false };
      const [mark, count, anim] = t.decor;
      for (let i = 0; i < count; i++) {
        const d = document.createElement('span');
        d.className = 'a-decor ' + anim + (mark.length > 2 ? ' ' + mark : '');
        if (mark.length <= 2) d.textContent = mark;
        d.style.left = rnd(0, 100) + '%';
        d.style.top = rnd(0, t.floor - 10) + '%';
        d.style.animationDelay = -rnd(0, 20) + 's';
        d.style.animationDuration = (anim === 'drift' ? rnd(25, 45) : anim === 'rise' ? rnd(6, 12) : rnd(1.5, 4)) + 's';
        if (mark.length <= 2) d.style.fontSize = rnd(24, 48) + 'px';
        el.append(d);
      }
      if (t.floor < 100) { const g = document.createElement('div'); g.className = 'a-ground'; g.style.height = (100 - t.floor) + '%'; el.append(g); }
      const h = document.createElement('div');
      h.className = 'a-hud';
      game.hudScore = document.createElement('span');
      game.hudLives = document.createElement('span');
      game.hudTime = document.createElement('span');
      h.append(game.hudScore, game.hudLives, game.hudTime);
      el.append(h);
      game.startEl = document.createElement('div');
      game.startEl.className = 'a-overlay a-start';
      game.startEl.innerHTML = '<div class="a-over-emoji">▶️</div><h2>לחצו כדי להתחיל</h2><p></p>';
      el.append(game.startEl);
      el.addEventListener('pointerdown', () => {
        if (!game.running) { startGame(); return; }
        if (game.over) return;
        (clicks[name] || []).forEach(f => withCtx(null, null, f));
        doJumps();
      });
      fn(el);
      return el;
    },
    sprite(parent, name, emoji, size, x, y, show) {
      if (!needGame()) return;
      if (!game.defs[name]) game.defs[name] = { emoji, size: Number(size) || 60 };
      if (show) makeSprite(name, Number(x), Number(y), false);
    },
    controls(name, mode, speed) { if (needGame()) game.controls.push({ name, mode, speed: Number(speed) || 50 }); },
    jumpOn(name, power, air) { if (needGame()) game.jumps.push({ name, power: Number(power) || 10, air: air === 'air' }); },
    gravity(name, strength) { if (needGame()) setBeh(name, { g: (Number(strength) || 0) * 40 }); },
    velocity(name, dir, speed) {
      if (!needGame()) return;
      const v = Number(speed) || 0;
      setBeh(name, { vx: dir === 'right' ? v : dir === 'left' ? -v : 0, vy: dir === 'down' ? v : dir === 'up' ? -v : 0 });
    },
    edges(name, mode) { if (needGame()) setBeh(name, { edge: mode }); },
    chase(name, targetName, speed) {
      if (!needGame()) return;
      game.chase = game.chase.filter(c => c.name !== name);
      game.chase.push({ name, target: targetName, speed: Number(speed) || 20 });
    },
    spawn(name, where) {
      if (!needGame() || game.over) return;
      const def = game.defs[name];
      if (!def) { toast('⚠️ אין דמות בשם "' + name + '"', 'bad'); return; }
      const H = game.el.clientHeight || 400;
      const hh = def.size * 0.5 / H * 100;
      const f = game.floor;
      const pos = where === 'right' ? [106, rnd(12, f - 12)]
        : where === 'left' ? [-6, rnd(12, f - 12)]
        : where === 'ground' ? [106, f - hh]
        : where === 'ground_left' ? [-6, f - hh]
        : where === 'random' ? [rnd(8, 92), rnd(10, f - 10)]
        : [rnd(8, 92), -6];
      makeSprite(name, pos[0], pos[1], true);
    },
    shoot(shooter, bullet, dir) {
      if (!needGame() || game.over || !game.running) return;
      const from = ctx.me && ctx.me.name === shooter ? ctx.me : group(shooter)[0];
      if (!from) return;
      const s = makeSprite(bullet, from.x, from.y, true);
      if (!s) return;
      if (!s.vx && !s.vy) {
        const v = 110;
        s.vx = dir === 'right' ? v : dir === 'left' ? -v : 0;
        s.vy = dir === 'down' ? v : dir === 'up' ? -v : 0;
      }
      beep([900, 500], 0.05, 'square');
    },
    teleport(name) {
      if (!needGame()) return;
      const list = ctx.me && ctx.me.name === name ? [ctx.me] : group(name);
      for (const s of list) { s.x = rnd(10, 90); s.y = rnd(12, game.floor - 12); place(s); }
    },
    removeSprite(which) { kill(target(which)); },
    removeAll(name) { group(name).forEach(s => kill(s)); },
    effect(kind, which) { const s = target(which); if (s) burst(s, kind); },
    addScore(n) {
      if (!needGame()) return;
      n = Number(n) || 0;
      game.score += n;
      floatText((n >= 0 ? '+' : '') + n, ctx.me || ctx.other);
      if (n > 0) beep([880, 1320], 0.07); 
      hud();
    },
    addLives(n) {
      if (!needGame()) return;
      n = Number(n) || 0;
      if (game.lives == null) game.lives = 3;
      game.lives += n;
      if (n < 0) {
        game.el.classList.remove('shake'); void game.el.offsetWidth; game.el.classList.add('shake');
        beep([180], 0.25, 'square');
      }
      hud();
      if (game.lives <= 0) endGame(false);
    },
    setLives(n) { if (needGame()) { game.lives = Number(n) || 1; hud(); } },
    timer(sec, result) { if (needGame()) { game.timeLeft = Number(sec) || 30; game.timeWin = result !== 'lose'; hud(); } },
    gameOver(result) { endGame(result === 'win'); },
    onTouch(a, b, fn) { touchDefs.push({ id: touchDefs.length, a, b, fn: safe(fn) }); },
    gameScore() { return game ? game.score : 0; },

    error: fail,
    start() {
      root = document.getElementById('app');
      try { if (pageFn) pageFn(root); } catch (e) { fail(e); }
      document.addEventListener('keydown', (e) => {
        if (game && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
        if (game && !game.running) { if ([' ', 'Enter'].includes(e.key) || e.key.startsWith('Arrow')) startGame(); return; }
        if (game && game.over) return;
        if (game && !e.repeat) press(e.key);
        if (e.repeat && game) return;
        keys.forEach(k => { if (k.key === e.key) { e.preventDefault(); k.fn(); } });
      });
      document.addEventListener('keyup', (e) => held.delete(e.key));
      window.addEventListener('blur', () => held.clear());
      starts.forEach(f => f());
      if (game) { game.startEl.querySelector('p').textContent = hints(); buildPad(); hud(); }
      timers.forEach(t => {
        t.id = setInterval(() => { if (game && (!game.running || game.over)) return; t.fn(); }, t.sec * 1000);
      });
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
.a-stage { position: relative; width: 100%; overflow: hidden; border-radius: 22px; touch-action: none; user-select: none; -webkit-user-select: none;
  box-shadow: 0 12px 30px rgba(20,10,60,.3), inset 0 0 0 3px rgba(255,255,255,.15); cursor: pointer; }
.theme-sky { background: linear-gradient(#5ab8ff, #bfe6ff); }
.theme-space { background: radial-gradient(circle at 30% 20%, #3b2a7a, #0b0626 70%); }
.theme-sea { background: linear-gradient(#2bc0e4, #0a4d8c); }
.theme-grass { background: linear-gradient(#7fd3ff, #d8f3ff); }
.theme-night { background: linear-gradient(#1a1446, #3d2a6e); }
.theme-desert { background: linear-gradient(#ffcf7d, #ffeec2); }
.theme-candy { background: linear-gradient(#ffc6e8, #fff0fa); }
.a-ground { position: absolute; left: 0; right: 0; bottom: 0; background: linear-gradient(#5fd068, #2e9b45); border-top: 4px solid #7be382; }
.theme-desert .a-ground { background: linear-gradient(#e9b463, #c98a3a); border-top-color: #f4c97e; }
.a-decor { position: absolute; pointer-events: none; opacity: .8; }
.a-decor.dot { width: 3px; height: 3px; border-radius: 50%; background: #fff; }
.a-decor.bubble { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255,255,255,.6); }
.a-decor.drift { animation: a-drift linear infinite; }
.a-decor.twinkle { animation: a-twinkle ease-in-out infinite alternate; }
.a-decor.rise { animation: a-rise linear infinite; }
@keyframes a-drift { from { transform: translateX(-60vw); } to { transform: translateX(60vw); } }
@keyframes a-twinkle { from { opacity: .15; } to { opacity: 1; } }
@keyframes a-rise { from { transform: translateY(40vh); opacity: 0; } 30% { opacity: .8; } to { transform: translateY(-60vh); opacity: 0; } }
.a-sprite { position: absolute; transform: translate(-50%, -50%); line-height: 1; filter: drop-shadow(0 4px 4px rgba(0,0,0,.3)); animation: a-pop .25s ease-out; z-index: 2; }
.a-sprite.gone { transition: transform .2s, opacity .2s; transform: translate(-50%, -50%) scale(1.6); opacity: 0; }
@keyframes a-pop { from { transform: translate(-50%, -50%) scale(.2); } }
.a-particle { position: absolute; z-index: 3; pointer-events: none; font-size: 20px; transform: translate(-50%, -50%); animation: a-burst .7s ease-out forwards; }
@keyframes a-burst { to { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(.3); opacity: 0; } }
.a-float { position: absolute; z-index: 4; pointer-events: none; font-weight: 800; font-size: 22px; color: #fff; text-shadow: 0 2px 4px rgba(0,0,0,.5); transform: translate(-50%, -50%); animation: a-up .9s ease-out forwards; }
@keyframes a-up { to { transform: translate(-50%, -150%); opacity: 0; } }
.a-hud { position: absolute; top: 10px; left: 10px; right: 10px; display: flex; gap: 8px; justify-content: space-between; z-index: 5; pointer-events: none; }
.a-hud span { background: rgba(0,0,0,.45); color: #fff; padding: 6px 12px; border-radius: 999px; font-weight: 700; font-size: 1rem; }
.a-overlay { position: absolute; inset: 0; z-index: 10; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  background: rgba(15,8,45,.72); color: #fff; text-align: center; padding: 20px; animation: a-in .3s; }
.a-overlay h2 { margin: 0; font-size: 2rem; } .a-overlay p { margin: 0 0 10px; opacity: .9; }
.a-over-emoji { font-size: 4rem; line-height: 1; }
.a-start { cursor: pointer; }
.shake { animation: a-shake .35s; }
@keyframes a-shake { 25% { transform: translateX(-8px); } 50% { transform: translateX(8px); } 75% { transform: translateX(-4px); } }
.a-pad { direction: ltr; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; width: 100%; user-select: none; -webkit-user-select: none; }
.a-pad-btn { min-width: 64px; height: 56px; border: none; border-radius: 16px; font: inherit; font-size: 1.5rem; font-weight: 700; background: rgba(106,76,255,.9); color: #fff;
  box-shadow: 0 4px 0 rgba(0,0,0,.25); touch-action: none; cursor: pointer; padding: 0 14px; }
.a-pad-btn:active { transform: translateY(2px); box-shadow: 0 2px 0 rgba(0,0,0,.25); }
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
