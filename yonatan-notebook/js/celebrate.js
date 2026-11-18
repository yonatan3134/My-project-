// Varied "well done" moments, plus a big celebration for keeping / beating the pace.
import { el } from './util.js';

const PRAISE = [
  'כל הכבוד, {n}!', 'וואו! איזה אלוף!', 'עוד תרגיל בכיס! 💪', 'מתמטיקאי אמיתית!', 'פיתגורס היה גאה בך!',
  'יש! סגרת עוד אחד!', 'אתה פשוט תותח!', 'המוח שלך עובד על טורבו 🚀', 'מדויק ומרשים!', 'איזה כיף לראות את זה!',
  'עוד צעד קדימה, {n}!', 'מושלם! ממשיכים?', 'גאון של מספרים!', 'נהדר! ככה עושים את זה!', 'ידעתי שתצליח!',
  'אלוף האלגברה!', 'בום! עוד תרגיל!', 'אתה מדהים!', 'X נפתר, הכבוד שלך!', 'זה היה חכם במיוחד!',
  'קדימה, אתה בתנופה!', 'וואו, {n}, איזו התמדה!', 'כוכב! ⭐', 'התרגיל הזה לא היה סיכוי מולך', 'עבודה מעולה!',
  'עוד אחד ברשימה ✔', 'מבריק!', 'הראש שלך זה מחשב-על!', 'נפלא! תמשיך ככה!', 'יופי של עבודה, {n}!',
];
const SPECIAL = {
  onpace: ['אתה בדיוק בקצב! 🎯', 'עומד בקצב כמו אלוף!', 'בקצב המושלם, {n}!'],
  ahead: ['אתה מקדים את הקצב! 🚀', 'עקפת את הלו"ז! מטורף!', 'רץ קדימה! איזה אלוף!'],
  goal: ['יעד יומי הושג! 🎯', 'עשית את זה, {n}! 🏆', 'היום שלך סגור! 🔥'],
  complete: ['סיימת את כל הדף!!! 🏆', 'הדף כולו סגור! מלך!', 'מאה אחוז! 🏆'],
};
export const STICKERS = ['🦄', '🌈', '🐬', '🦋', '🌟', '🍓', '🐼', '🦊', '🌻', '🍩', '🐙', '🎈', '🪐', '🐢', '🍉', '🎨', '🦜', '🌸', '🐧', '🍦', '🧁', '🐝', '🦩', '🌙', '💎', '🐳', '🍀', '🎀', '🦔', '🐞'];

const pick = a => a[Math.floor(Math.random() * a.length)];
let lastPraise = -1;
export function praiseText(name) {
  let i; do { i = Math.floor(Math.random() * PRAISE.length); } while (i === lastPraise && PRAISE.length > 1);
  lastPraise = i;
  return PRAISE[i].replace('{n}', name);
}

let audio;
function tone(freqs, dur = 0.12, type = 'triangle') {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    let t = audio.currentTime;
    for (const f of freqs) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur + 0.02); t += dur * 0.8;
    }
  } catch { /* no audio */ }
}

function confetti(layer, count = 120, emojis = null) {
  const cv = el('canvas', { class: 'fx-canvas' }); layer.append(cv);
  const W = cv.width = innerWidth, H = cv.height = innerHeight; const ctx = cv.getContext('2d');
  const colors = ['#ff5d8f', '#ffd166', '#06d6a0', '#118ab2', '#9b5de5', '#f15bb5', '#00bbf9'];
  const parts = Array.from({ length: count }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.45, vx: (Math.random() - 0.5) * 18, vy: -Math.random() * 18 - 6,
    r: Math.random() * 7 + 4, c: pick(colors), a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4, e: emojis ? pick(emojis) : null,
  }));
  const t0 = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.45; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
      if (p.e) { ctx.font = `${p.r * 4}px sans-serif`; ctx.fillText(p.e, 0, 0); }
      else { ctx.fillStyle = p.c; ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); }
      ctx.restore();
    }
    if (t - t0 < 3200) requestAnimationFrame(frame); else cv.remove();
  })(t0);
}

function fireworks(layer, bursts = 7) {
  const cv = el('canvas', { class: 'fx-canvas' }); layer.append(cv);
  const W = cv.width = innerWidth, H = cv.height = innerHeight; const ctx = cv.getContext('2d');
  const parts = [];
  let n = 0;
  const boom = () => {
    const x = W * (0.15 + Math.random() * 0.7), y = H * (0.15 + Math.random() * 0.4);
    const hue = Math.random() * 360;
    for (let i = 0; i < 70; i++) {
      const a = Math.PI * 2 * i / 70, s = 3 + Math.random() * 5;
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, hue: hue + Math.random() * 40 });
    }
    if (++n < bursts) setTimeout(boom, 380);
  };
  boom();
  const t0 = performance.now();
  (function frame(t) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.globalCompositeOperation = 'destination-out'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      if (p.life <= 0) continue;
      p.vy += 0.06; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.life -= 0.012;
      ctx.fillStyle = `hsla(${p.hue},100%,60%,${p.life})`; ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, 7); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    if (t - t0 < 5200) requestAnimationFrame(frame); else cv.remove();
  })(t0);
}

const STYLES = ['pop', 'spin', 'slide', 'wobble', 'zoom'];

// Small celebration for one closed exercise.
export function praise(name, sticker, { sound = true, text = null, sub = 'מדבקה חדשה נוספה לאוסף' } = {}) {
  return new Promise(res => {
    const layer = el('div', { class: 'fx-layer' });
    document.body.append(layer);
    const style = pick(STYLES);
    const card = el('div', { class: `praise praise-${style}` },
      el('div', { class: 'praise-sticker' }, sticker),
      el('div', { class: 'praise-text' }, text || praiseText(name)),
      el('div', { class: 'praise-sub' }, sub));
    layer.append(card);
    const fx = Math.random();
    if (fx < 0.45) confetti(layer, 90);
    else if (fx < 0.8) confetti(layer, 26, [...[...sticker].filter(c => c.trim()), '⭐', '✨']);
    if (sound) tone(pick([[523, 659, 784], [587, 740, 880], [659, 784, 988, 1319]]));
    const close = () => { layer.classList.add('fx-out'); setTimeout(() => { layer.remove(); res(); }, 300); };
    layer.addEventListener('click', close);
    setTimeout(close, 2300);
  });
}

// Big celebration: pace kept / beaten / sheet complete.
export function special(level, name, info, { sound = true } = {}) {
  return new Promise(res => {
    const layer = el('div', { class: 'fx-layer fx-dark' });
    document.body.append(layer);
    const icon = { onpace: '🎯', ahead: '🚀', complete: '🏆', goal: '🏆' }[level];
    const card = el('div', { class: 'special' },
      el('div', { class: 'special-icon' }, icon),
      el('div', { class: 'special-title' }, pick(SPECIAL[level]).replace('{n}', name)),
      el('div', { class: 'special-sub' }, info),
      el('button', { class: 'btn btn-big', onclick: () => close() }, 'יששש! 🙌'));
    layer.append(card);
    fireworks(layer, level === 'complete' ? 12 : 7);
    setTimeout(() => confetti(layer, 160), 500);
    if (sound) { tone([523, 659, 784, 1047], 0.16); setTimeout(() => tone([784, 988, 1175, 1568], 0.14), 900); }
    const close = () => { layer.classList.add('fx-out'); setTimeout(() => { layer.remove(); res(); }, 300); };
  });
}

// Gentle "try again" after a wrong answer.
const SAD = ['😢', '🙈', '😟', '🥺'];
const TRY = ['לא נורא, נסה שוב!', 'אופס… עוד ניסיון?', 'כמעט! נסה תשובה אחרת', 'זה לא זה. אתה יכול!'];
export function oops(sound = true) {
  return new Promise(res => {
    const layer = el('div', { class: 'fx-layer fx-soft' });
    layer.append(el('div', { class: 'oops' }, el('div', { class: 'oops-face' }, pick(SAD)), el('div', { class: 'oops-text' }, pick(TRY))));
    document.body.append(layer);
    if (sound) tone([392, 330], 0.18, 'sine');
    const close = () => { layer.classList.add('fx-out'); setTimeout(() => { layer.remove(); res(); }, 250); };
    layer.addEventListener('click', close);
    setTimeout(close, 1300);
  });
}
