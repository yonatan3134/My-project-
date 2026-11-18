// Clean geometry figures from a tiny description (also what Claude returns for new exercises):
// { pts: {A:[x,y],...}  (any units, y down),
//   segs: [['A','B'], ...],
//   ticks: [['B','D',1], ...]          equal-segment marks (1-3 ticks)
//   arcs: [['B','D','E',1], ...]       angle at the middle point, 1-3 arcs; 5th item true = reflex side
//   right: [['A','D','B'], ...]        right-angle square at the middle point
//   texts: [['B','A','C','160°', true]] angle text, optional reflex flag
//   lab: {A:'n'} optional label direction n/s/e/w/ne/nw/se/sw }
const W = 320, Hh = 240, PAD = 26;
const COLORS = ['#2563eb', '#dc2626', '#059669'];

// Colors for the visual mode: every row of the proof gets the next color not used yet.
export const PALETTE = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#db2777', '#65a30d', '#7c2d12', '#4f46e5', '#0d9488', '#b91c1c'];

// What a statement talks about: triangles, angles, segments and points (by their letters).
export function objectsOf(text, fig) {
  const t = String(text).replace(/`/g, '');
  const P = fig?.pts || {};
  const out = { tris: [], angles: [], segs: [], pts: [] };
  const used = [];
  for (const m of t.matchAll(/△\s*([A-Z])([A-Z])([A-Z])/g)) { out.tris.push([m[1], m[2], m[3]]); used.push([m.index, m.index + m[0].length]); }
  for (const m of t.matchAll(/∢\s*([A-Z])(?:([A-Z])([A-Z]))?/g)) {
    used.push([m.index, m.index + m[0].length]);
    if (m[3]) { out.angles.push([m[1], m[2], m[3]]); continue; }
    const v = m[1];
    const nb = [...new Set((fig?.segs || []).filter(sg => sg.includes(v)).map(sg => sg[0] === v ? sg[1] : sg[0]))];
    if (nb.length === 2) out.angles.push([nb[0], v, nb[1]]);
    else out.pts.push(v);
  }
  const free = (i, j) => !used.some(([a, b]) => i < b && j > a);
  for (const m of t.matchAll(/(?<![A-Za-z])([A-Z])([A-Z])(?![A-Za-z])/g)) if (free(m.index, m.index + 2)) out.segs.push([m[1], m[2]]);
  for (const m of t.matchAll(/(?<![A-Za-z∢△])([A-Z])(?![A-Za-z])/g)) if (free(m.index, m.index + 1)) out.pts.push(m[1]);
  const ok = n => !!P[n];
  out.tris = out.tris.filter(x => x.every(ok)); out.angles = out.angles.filter(x => x.every(ok));
  out.segs = out.segs.filter(x => x.every(ok) && x[0] !== x[1]); out.pts = out.pts.filter(ok);
  return out;
}

export function renderFigure(fig, highlights = []) {
  if (!fig || !fig.pts) return '';
  const P = fig.pts, names = Object.keys(P);
  const xs = names.map(n => P[n][0]), ys = names.map(n => P[n][1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const s = Math.min((W - 2 * PAD) / Math.max(1, maxX - minX), (Hh - 2 * PAD) / Math.max(1, maxY - minY));
  const ox = (W - (maxX - minX) * s) / 2, oy = (Hh - (maxY - minY) * s) / 2;
  const T = n => [ox + (P[n][0] - minX) * s, oy + (P[n][1] - minY) * s];
  const out = [];
  const line = (a, b, st = '#1e293b', w = 2.2) => out.push(`<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${st}" stroke-width="${w}" stroke-linecap="round"/>`);
  for (const h of highlights) for (const [a, b, c] of h.tris || [])
    out.push(`<polygon points="${[a, b, c].map(n => T(n).map(v => v.toFixed(1)).join(',')).join(' ')}" fill="${h.color}" fill-opacity="0.2" stroke="none"/>`);
  for (const [a, b] of fig.segs || []) if (P[a] && P[b]) line(T(a), T(b));
  for (const h of highlights) {
    for (const [a, b] of h.segs || []) line(T(a), T(b), h.color, 5.5);
  }
  // tick marks
  for (const [a, b, n = 1] of fig.ticks || []) {
    if (!P[a] || !P[b]) continue;
    const A = T(a), B = T(b), mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1, ux = (B[0] - A[0]) / len, uy = (B[1] - A[1]) / len;
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 5, cx = mx + ux * off, cy = my + uy * off;
      line([cx - uy * 6, cy + ux * 6], [cx + uy * 6, cy - ux * 6], COLORS[(n - 1) % 3], 2);
    }
  }
  const angleOf = (v, p) => { const V = T(v), Q = T(p); return Math.atan2(Q[1] - V[1], Q[0] - V[0]); };
  const sweep = (v, p, q, reflex) => {
    let a1 = angleOf(v, p), a2 = angleOf(v, q);
    let d = a2 - a1; while (d <= -Math.PI) d += 2 * Math.PI; while (d > Math.PI) d -= 2 * Math.PI;
    if (reflex) d = d > 0 ? d - 2 * Math.PI : d + 2 * Math.PI;
    return [a1, d];
  };
  for (const [p, v, q, n = 1, reflex] of fig.arcs || []) {
    if (!P[p] || !P[v] || !P[q]) continue;
    const V = T(v); let [a1, d] = sweep(v, p, q, reflex);
    // leave a small gap at both rays so two equal angles side by side read as two separate arcs
    const trim = Math.sign(d) * Math.min(0.13, Math.abs(d) * 0.16); a1 += trim; d -= 2 * trim;
    for (let i = 0; i < n; i++) {
      const r = 15 + i * 4.5, a2 = a1 + d;
      const x1 = V[0] + r * Math.cos(a1), y1 = V[1] + r * Math.sin(a1), x2 = V[0] + r * Math.cos(a2), y2 = V[1] + r * Math.sin(a2);
      out.push(`<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${Math.abs(d) > Math.PI ? 1 : 0} ${d > 0 ? 1 : 0} ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${COLORS[(n - 1) % 3]}" stroke-width="2"/>`);
    }
  }
  for (const h of highlights) {
    for (const [p, v, q] of h.angles || []) {
      const V = T(v); let [a1, d] = sweep(v, p, q, false); const r = 24, a2 = a1 + d;
      out.push(`<path d="M ${V[0].toFixed(1)} ${V[1].toFixed(1)} L ${(V[0] + r * Math.cos(a1)).toFixed(1)} ${(V[1] + r * Math.sin(a1)).toFixed(1)} A ${r} ${r} 0 0 ${d > 0 ? 1 : 0} ${(V[0] + r * Math.cos(a2)).toFixed(1)} ${(V[1] + r * Math.sin(a2)).toFixed(1)} Z" fill="${h.color}" fill-opacity="0.45" stroke="${h.color}" stroke-width="1.5"/>`);
    }
    for (const n of h.pts || []) { const p = T(n); out.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="7" fill="none" stroke="${h.color}" stroke-width="3"/>`); }
  }
  for (const [p, v, q] of fig.right || []) {
    if (!P[p] || !P[v] || !P[q]) continue;
    const V = T(v), A = T(p), B = T(q), k = 10;
    const ua = [(A[0] - V[0]) / Math.hypot(A[0] - V[0], A[1] - V[1]), (A[1] - V[1]) / Math.hypot(A[0] - V[0], A[1] - V[1])];
    const ub = [(B[0] - V[0]) / Math.hypot(B[0] - V[0], B[1] - V[1]), (B[1] - V[1]) / Math.hypot(B[0] - V[0], B[1] - V[1])];
    const p1 = [V[0] + ua[0] * k, V[1] + ua[1] * k], p2 = [p1[0] + ub[0] * k, p1[1] + ub[1] * k], p3 = [V[0] + ub[0] * k, V[1] + ub[1] * k];
    out.push(`<polyline points="${p1.join(',')} ${p2.join(',')} ${p3.join(',')}" fill="none" stroke="#0f172a" stroke-width="1.6"/>`);
  }
  for (const [p, v, q, txt, reflex] of fig.texts || []) {
    if (!P[p] || !P[v] || !P[q]) continue;
    const V = T(v), [a1, d] = sweep(v, p, q, reflex), m = a1 + d / 2;
    out.push(`<text x="${(V[0] + 30 * Math.cos(m)).toFixed(1)}" y="${(V[1] + 30 * Math.sin(m) + 4).toFixed(1)}" font-size="12" text-anchor="middle" fill="#7c3aed" font-weight="700">${txt}</text>`);
  }
  // labels: pushed away from the centre of the figure (or a given direction)
  const cx = xs.reduce((a, b) => a + b, 0) / xs.length, cy = ys.reduce((a, b) => a + b, 0) / ys.length;
  const DIRS = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], ne: [.7, -.7], nw: [-.7, -.7], se: [.7, .7], sw: [-.7, .7] };
  for (const n of names) {
    const p = T(n);
    let dir = fig.lab && DIRS[fig.lab[n]];
    if (!dir) { const dx = P[n][0] - cx, dy = P[n][1] - cy, l = Math.hypot(dx, dy) || 1; dir = [dx / l, dy / l]; }
    out.push(`<text x="${(p[0] + dir[0] * 13).toFixed(1)}" y="${(p[1] + dir[1] * 13 + 5).toFixed(1)}" font-size="15" font-weight="700" text-anchor="middle" fill="#0f172a" font-family="Times New Roman, serif">${n}</text>`);
    out.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.2" fill="#0f172a"/>`);
  }
  return `<svg viewBox="0 0 ${W} ${Hh}" xmlns="http://www.w3.org/2000/svg" class="geo-svg">${out.join('')}</svg>`;
}
