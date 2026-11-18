// Offline photo processing for handwritten exercises.
// Keeps the handwriting itself untouched apart from contrast — only paper, shadows,
// erased scribbles and empty space are changed.

export async function fileToCanvas(file, maxSide = 3600) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { bmp = await createImageBitmap(file); }
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close && bmp.close();
  return c;
}

export function rotate(src, deg) {
  deg = ((deg % 360) + 360) % 360;
  if (!deg) return src;
  const c = document.createElement('canvas');
  const swap = deg === 90 || deg === 270;
  c.width = swap ? src.height : src.width; c.height = swap ? src.width : src.height;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(deg * Math.PI / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

export function crop(src, r) {
  const x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y));
  const w = Math.min(src.width - x, Math.round(r.w)), h = Math.min(src.height - y, Math.round(r.h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, w); c.height = Math.max(1, h);
  c.getContext('2d').drawImage(src, x, y, w, h, 0, 0, w, h);
  return c;
}

const lum = (d, p) => 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];

// Flatten lighting and clean the page. opts: clean / contrast / sharp, each 0..3.
// Paper becomes white, shadows disappear; the handwriting itself is kept, only sharpened / darkened.
export const DEFAULT_OPTS = { clean: 1, contrast: 1, sharp: 1 };
export function enhance(src, opts = DEFAULT_OPTS) {
  const { clean = 1, contrast = 1, sharp = 1 } = opts;
  const W = src.width, H = src.height;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, W, H); const d = img.data;
  const B = Math.max(12, Math.round(Math.max(W, H) / 60));
  const gw = Math.ceil(W / B), gh = Math.ceil(H / B);
  const bg = new Float32Array(gw * gh * 3);
  const tmp = [];
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    tmp.length = 0;
    const x1 = Math.min(W, (gx + 1) * B), y1 = Math.min(H, (gy + 1) * B);
    for (let y = gy * B; y < y1; y += 2) for (let x = gx * B; x < x1; x += 2) {
      const p = (y * W + x) * 4; tmp.push([lum(d, p), d[p], d[p + 1], d[p + 2]]);
    }
    tmp.sort((a, b) => b[0] - a[0]);
    const k = tmp[Math.floor(tmp.length * 0.1)] || [255, 255, 255, 255];
    const o = (gy * gw + gx) * 3; bg[o] = k[1]; bg[o + 1] = k[2]; bg[o + 2] = k[3];
  }
  const sm = new Float32Array(bg.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) for (let ch = 0; ch < 3; ch++) {
      let acc = 0, n = 0, mx = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = gy + dy, xx = gx + dx; if (yy < 0 || xx < 0 || yy >= gh || xx >= gw) continue;
        const v = bg[(yy * gw + xx) * 3 + ch]; acc += v; n++; if (v > mx) mx = v;
      }
      sm[(gy * gw + gx) * 3 + ch] = pass === 0 ? mx : acc / n;
    }
    bg.set(sm);
  }
  const sample = (x, y, ch) => {
    const fx = Math.min(gw - 1, Math.max(0, x / B - 0.5)), fy = Math.min(gh - 1, Math.max(0, y / B - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const g = (xx, yy) => bg[(yy * gw + xx) * 3 + ch];
    return (g(x0, y0) * (1 - tx) + g(x1, y0) * tx) * (1 - ty) + (g(x0, y1) * (1 - tx) + g(x1, y1) * tx) * ty;
  };
  // 1. normalise lighting
  const N = W * H;
  const R = new Float32Array(N), G = new Float32Array(N), Bl = new Float32Array(N), L = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, p = i * 4;
    R[i] = Math.min(255, 255 * d[p] / Math.max(40, sample(x, y, 0)));
    G[i] = Math.min(255, 255 * d[p + 1] / Math.max(40, sample(x, y, 1)));
    Bl[i] = Math.min(255, 255 * d[p + 2] / Math.max(40, sample(x, y, 2)));
    L[i] = 0.299 * R[i] + 0.587 * G[i] + 0.114 * Bl[i];
  }
  // decide what is paper / grid BEFORE sharpening (sharpening would darken faint grid lines)
  const k = [1.0, 1.3, 1.6, 2.0][contrast] || 1;
  const paper = [256, 236, 224, 214][clean], gridL = [256, 205, 185, 170][clean];
  const isPaper = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const r = R[i], g = G[i], b = Bl[i], l = L[i];
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (l > paper || (l > gridL && b - r > 8 && sat < 80) || (clean >= 2 && l > 205 && sat < 30)) isPaper[i] = 1;
  }
  // 2. sharpen (unsharp mask on luminance)
  const amount = [0, 0.7, 1.4, 2.2][sharp] || 0;
  if (amount) {
    const bl = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let a = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; a += L[yy * W + xx]; n++; } }
      bl[y * W + x] = a / n;
    }
    for (let i = 0; i < N; i++) { const dl = amount * (L[i] - bl[i]); R[i] += dl; G[i] += dl; Bl[i] += dl; L[i] += dl; }
  }
  // 3. whiten paper / grid, deepen ink
  for (let i = 0; i < N; i++) {
    const p = i * 4;
    let r = R[i], g = G[i], b = Bl[i];
    if (isPaper[i]) { r = g = b = 255; }
    else { r = 255 - (255 - r) * k; g = 255 - (255 - g) * k; b = 255 - (255 - b) * k; }
    d[p] = r < 0 ? 0 : r > 255 ? 255 : r; d[p + 1] = g < 0 ? 0 : g > 255 ? 255 : g; d[p + 2] = b < 0 ? 0 : b > 255 ? 255 : b; d[p + 3] = 255;
  }
  // 4. remove isolated specks (only when cleaning)
  if (clean > 0) {
    const rad = clean >= 2 ? 2 : 1, lim = clean >= 2 ? 4 : 1;
    const nw = new Uint8Array(N);
    for (let i = 0, p = 0; i < N; i++, p += 4) nw[i] = (d[p] < 250 || d[p + 1] < 250 || d[p + 2] < 250) ? 1 : 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!nw[i]) continue;
      let n = 0;
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < H && xx >= 0 && xx < W) n += nw[yy * W + xx]; }
      if (n <= lim) { const p = i * 4; d[p] = d[p + 1] = d[p + 2] = 255; }
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function scaleCanvas(src, maxW) {
  if (src.width <= maxW) return src;
  const c = document.createElement('canvas');
  c.width = maxW; c.height = Math.round(src.height * maxW / src.width);
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function inkMap(c, thr = 175) {
  const W = c.width, H = c.height;
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const m = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < m.length; i++, p += 4) m[i] = lum(d, p) < thr ? 1 : 0;
  return m;
}

// Finds heavily scribbled-over regions (full erasures). Returns rects for the girl to confirm.
// profile comes from the handwriting calibration (handwriting.js); defaults match the original tuning
export function detectErasures(c, prof = {}) {
  const HOT = prof.eraseHot || 0.38, RING = prof.eraseRing || 0.22;
  const W = c.width, H = c.height;
  const m = inkMap(c, prof.inkThr || 185);
  const B = Math.max(8, Math.round(Math.max(W, H) / 70));
  const gw = Math.ceil(W / B), gh = Math.ceil(H / B);
  const dens = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    let n = 0, t = 0;
    for (let y = gy * B; y < Math.min(H, (gy + 1) * B); y++) for (let x = gx * B; x < Math.min(W, (gx + 1) * B); x++) { t++; n += m[y * W + x]; }
    dens[gy * gw + gx] = n / t;
  }
  const hot = new Uint8Array(gw * gh);
  for (let i = 0; i < hot.length; i++) hot[i] = dens[i] > HOT ? 1 : 0;
  // connect neighbours, keep blobs that are mostly dense
  const seen = new Uint8Array(gw * gh); const rects = [];
  for (let i = 0; i < hot.length; i++) {
    if (!hot[i] || seen[i]) continue;
    const st = [i]; seen[i] = 1; let x0 = gw, y0 = gh, x1 = 0, y1 = 0, n = 0, sum = 0;
    while (st.length) {
      const j = st.pop(); const x = j % gw, y = (j / gw) | 0; n++; sum += dens[j];
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
        const k = yy * gw + xx; if (hot[k] && !seen[k]) { seen[k] = 1; st.push(k); }
      }
    }
    if (n >= 3) {
      // grow the box while the neighbouring ring is still fairly dense (scribble edges)
      const grow = (ax0, ay0, ax1, ay1) => {
        let changed = true;
        while (changed) {
          changed = false;
          const ring = (cells) => cells.reduce((a, k) => a + dens[k], 0) / Math.max(1, cells.length);
          const col = (x) => { const r = []; for (let y = ay0; y <= ay1; y++) r.push(y * gw + x); return r; };
          const row = (y) => { const r = []; for (let x = ax0; x <= ax1; x++) r.push(y * gw + x); return r; };
          if (ax0 > 0 && ring(col(ax0 - 1)) > RING) { ax0--; changed = true; }
          if (ax1 < gw - 1 && ring(col(ax1 + 1)) > RING) { ax1++; changed = true; }
          if (ay0 > 0 && ring(row(ay0 - 1)) > RING) { ay0--; changed = true; }
          if (ay1 < gh - 1 && ring(row(ay1 + 1)) > RING) { ay1++; changed = true; }
        }
        return [ax0, ay0, ax1, ay1];
      };
      [x0, y0, x1, y1] = grow(x0, y0, x1, y1);
      // one more block where the edge still has scribble ends
      const rowD = (y, a, b) => { let t = 0; for (let x = a; x <= b; x++) t += dens[y * gw + x]; return t / (b - a + 1); };
      const colD = (x, a, b) => { let t = 0; for (let y = a; y <= b; y++) t += dens[y * gw + x]; return t / (b - a + 1); };
      if (x0 > 0 && colD(x0 - 1, y0, y1) > 0.08) x0--;
      if (x1 < gw - 1 && colD(x1 + 1, y0, y1) > 0.08) x1++;
      const pad = B * 0.4;
      rects.push({ x: Math.max(0, x0 * B - pad), y: Math.max(0, y0 * B - pad), w: Math.min(W, (x1 + 1) * B + pad) - Math.max(0, x0 * B - pad), h: Math.min(H, (y1 + 1) * B + pad) - Math.max(0, y0 * B - pad), on: true });
    }
  }
  return rects;
}

export function whiteOut(c, rects) {
  const o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
  const ctx = o.getContext('2d', { willReadFrequently: true }); ctx.drawImage(c, 0, 0); ctx.fillStyle = '#fff';
  const on = rects.filter(r => r.on);
  if (!on.length) return o;
  for (const r of on) ctx.fillRect(r.x, r.y, r.w, r.h);
  // stray scribble ends just outside a box: ink pieces that touch the box and stay within a small margin
  const W = o.width, H = o.height;
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  const ink = i => lum(d, i * 4) < 200;
  for (const r of on) {
    const m = Math.round(Math.max(6, Math.min(r.w, r.h) * 0.15));
    const X0 = Math.max(0, Math.floor(r.x - m)), Y0 = Math.max(0, Math.floor(r.y - m));
    const X1 = Math.min(W - 1, Math.ceil(r.x + r.w + m)), Y1 = Math.min(H - 1, Math.ceil(r.y + r.h + m));
    const bx0 = Math.max(0, Math.floor(r.x) - 1), by0 = Math.max(0, Math.floor(r.y) - 1);
    const bx1 = Math.min(W - 1, Math.ceil(r.x + r.w)), by1 = Math.min(H - 1, Math.ceil(r.y + r.h));
    const seen = new Uint8Array((X1 - X0 + 1) * (Y1 - Y0 + 1));
    const li = (x, y) => (y - Y0) * (X1 - X0 + 1) + (x - X0);
    const seeds = [];
    for (let x = bx0; x <= bx1; x++) { seeds.push([x, by0]); seeds.push([x, by1]); }
    for (let y = by0; y <= by1; y++) { seeds.push([bx0, y]); seeds.push([bx1, y]); }
    for (const [sx, sy] of seeds) {
      if (seen[li(sx, sy)] || !ink(sy * W + sx)) continue;
      const comp = []; const st = [[sx, sy]]; seen[li(sx, sy)] = 1; let escapes = false;
      while (st.length) {
        const [x, y] = st.pop(); comp.push(y * W + x);
        if (x <= X0 || y <= Y0 || x >= X1 || y >= Y1) escapes = true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < X0 || yy < Y0 || xx > X1 || yy > Y1) continue;
          const k = li(xx, yy); if (seen[k]) continue; seen[k] = 1;
          if (ink(yy * W + xx)) st.push([xx, yy]);
        }
      }
      if (!escapes) for (const i of comp) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; }
    }
  }
  ctx.putImageData(img, 0, 0);
  return o;
}

// Trim margins and collapse tall empty bands (e.g. where an erasure was removed).
export function compact(c) {
  const W = c.width, H = c.height;
  const m = inkMap(c, 200);
  const rows = new Int32Array(H), cols = new Int32Array(W);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) { rows[y]++; cols[x]++; }
  const rThr = Math.max(2, W * 0.005), cThr = Math.max(2, H * 0.005);
  let top = 0, bot = H - 1, left = 0, right = W - 1;
  while (top < H && rows[top] <= rThr) top++;
  while (bot > top && rows[bot] <= rThr) bot--;
  while (left < W && cols[left] <= cThr) left++;
  while (right > left && cols[right] <= cThr) right--;
  if (top >= bot || left >= right) return c;
  const pad = Math.round(Math.max(12, Math.min(W, H) * 0.03));
  left = Math.max(0, left - pad); right = Math.min(W - 1, right + pad);
  top = Math.max(0, top - pad); bot = Math.min(H - 1, bot + pad);
  // keep-rows list, shrinking long blank runs
  const maxGap = Math.round(Math.max(24, (bot - top) * 0.05));
  const keep = []; let run = [];
  for (let y = top; y <= bot; y++) {
    if (rows[y] <= rThr) { run.push(y); continue; }
    if (run.length) { keep.push(...(run.length > maxGap ? run.slice(0, maxGap) : run)); run = []; }
    keep.push(y);
  }
  keep.push(...run.slice(0, maxGap));
  const o = document.createElement('canvas'); o.width = right - left + 1; o.height = keep.length;
  const ctx = o.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, o.width, o.height);
  // copy contiguous row spans
  let i = 0;
  while (i < keep.length) {
    let j = i; while (j + 1 < keep.length && keep[j + 1] === keep[j] + 1) j++;
    ctx.drawImage(c, left, keep[i], o.width, j - i + 1, 0, i, o.width, j - i + 1);
    i = j + 1;
  }
  return o;
}

export function toBlob(c, maxW = 2000, q = 0.9) {
  let src = c;
  if (c.width > maxW) {
    src = document.createElement('canvas');
    src.width = maxW; src.height = Math.round(c.height * maxW / c.width);
    const ctx = src.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, 0, 0, src.width, src.height);
  }
  return new Promise(r => src.toBlob(b => r({ blob: b, w: src.width, h: src.height }), 'image/jpeg', q));
}
