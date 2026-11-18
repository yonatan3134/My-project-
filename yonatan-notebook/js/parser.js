// Parses a Bar-Ilan homework sheet PDF (first page): finds tables, page ranges,
// exercises (with * / # marks) and the cell boxes where dates and names are written.
// Works fully offline: renders the page, detects table cells from border lines,
// then assigns pdf.js text items to cells.
import * as pdfjs from '../lib/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../lib/pdf.worker.min.mjs', import.meta.url).href;
const FONT_URL = new URL('../lib/standard_fonts/', import.meta.url).href;

export async function loadPdf(bytes) {
  return pdfjs.getDocument({ data: bytes.slice(0), standardFontDataUrl: FONT_URL, isEvalSupported: false }).promise;
}

export async function renderPageToCanvas(page, scale) {
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return c;
}

// ---- cell detection: connected components of "light" pixels enclosed by dark lines
function detectCells(canvas, scale) {
  const { width: W, height: H } = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, W, H).data;
  const light = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < light.length; i++, p += 4) {
    const l = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    light[i] = l > 150 ? 1 : 0;
  }
  const lab = new Int32Array(W * H);
  const stack = new Int32Array(W * H);
  const cells = [];
  let next = 1;
  for (let start = 0; start < light.length; start++) {
    if (!light[start] || lab[start]) continue;
    let sp = 0; stack[sp++] = start; lab[start] = next;
    let x0 = W, y0 = H, x1 = 0, y1 = 0, area = 0, edge = false;
    while (sp) {
      const i = stack[--sp];
      const x = i % W, y = (i / W) | 0;
      area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
      if (x > 0 && light[i - 1] && !lab[i - 1]) { lab[i - 1] = next; stack[sp++] = i - 1; }
      if (x < W - 1 && light[i + 1] && !lab[i + 1]) { lab[i + 1] = next; stack[sp++] = i + 1; }
      if (y > 0 && light[i - W] && !lab[i - W]) { lab[i - W] = next; stack[sp++] = i - W; }
      if (y < H - 1 && light[i + W] && !lab[i + W]) { lab[i + W] = next; stack[sp++] = i + W; }
    }
    next++;
    const w = (x1 - x0 + 1) / scale, h = (y1 - y0 + 1) / scale;
    // a real cell: not touching the page edge, reasonably sized, and mostly filled (rectangular)
    if (!edge && w >= 9 && h >= 8 && area / ((x1 - x0 + 1) * (y1 - y0 + 1)) > 0.55 && w < 560) {
      cells.push({ x0: x0 / scale, y0: y0 / scale, x1: (x1 + 1) / scale, y1: (y1 + 1) / scale, items: [] });
    }
  }
  return cells;
}

const cx = c => (c.x0 + c.x1) / 2;
const cy = c => (c.y0 + c.y1) / 2;
const inside = (c, x, y) => x >= c.x0 - 0.5 && x <= c.x1 + 0.5 && y >= c.y0 - 0.5 && y <= c.y1 + 0.5;
const xOverlap = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
const yOverlap = (a, b) => Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);

function cellText(c) {
  const its = c.items.slice().sort((a, b) => (Math.round(a.top / 4) - Math.round(b.top / 4)) || (a.x - b.x));
  // RTL words on one line: order by descending x; numbers LTR — we only need a joined key
  return its.map(i => i.str).join('').replace(/\s+/g, '');
}
function cellWords(c) {
  return c.items.slice().sort((a, b) => (Math.round(a.top / 4) - Math.round(b.top / 4)) || (b.x - a.x)).map(i => i.str).join(' ');
}

export async function parseSheet(bytes) {
  const doc = await loadPdf(bytes);
  const page = await doc.getPage(1);
  const vp1 = page.getViewport({ scale: 1 });
  const SCALE = 3;
  const canvas = await renderPageToCanvas(page, SCALE);
  const cells = detectCells(canvas, SCALE);

  const tc = await page.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const [vx, vy] = vp1.convertToViewportPoint(it.transform[4], it.transform[5]);
    const h = it.height || Math.hypot(it.transform[2], it.transform[3]);
    const item = { str: it.str.trim(), x: vx, top: vy - h * 0.8, w: it.width, h };
    item.cx = vx + it.width / 2; item.cy = vy - h * 0.3;
    items.push(item);
  }
  for (const it of items) {
    // smallest cell containing the item centre
    let best = null;
    for (const c of cells) if (inside(c, it.cx, it.cy)) {
      if (!best || (c.x1 - c.x0) * (c.y1 - c.y0) < (best.x1 - best.x0) * (best.y1 - best.y0)) best = c;
    }
    if (best) best.items.push(it); else it.free = true;
  }
  for (const c of cells) { c.text = cellText(c); c.words = cellWords(c); }

  // lesson number from title ("... שיעור 8")
  let lesson = '';
  const shiur = items.find(i => i.str === 'שיעור' || i.str.endsWith('שיעור'));
  if (shiur) {
    const cand = items.filter(i => /^\d+$/.test(i.str) && Math.abs(i.cy - shiur.cy) < 4 && i.x < shiur.x)
      .sort((a, b) => b.x - a.x)[0];
    if (cand) lesson = cand.str;
  }
  if (!lesson) {
    const m = tc.items.map(i => i.str).join(' ').match(/שיעור\s*(?:מס[^\d]*)?(\d+)/);
    if (m) lesson = m[1];
  }

  // header fields
  const fields = {};
  const findLabel = (needle) => cells.find(c => needle.split(' ').every(w => c.items.some(i => i.str.replace(':', '') === w)));
  const leftNeighbour = (c) => cells.filter(o => o !== c && Math.abs(o.x1 - c.x0) < 3 && yOverlap(o, c) > (c.y1 - c.y0) * 0.5)
    .sort((a, b) => b.x1 - a.x1)[0];
  const fieldBox = (label) => {
    const c = findLabel(label);
    if (!c) return null;
    const textLeft = Math.min(...c.items.map(i => i.x));
    if (textLeft - c.x0 > 60) return { x0: c.x0 + 4, y0: c.y0, x1: textLeft - 6, y1: c.y1 };
    const n = leftNeighbour(c);
    return n && !n.items.length ? { x0: n.x0 + 3, y0: n.y0, x1: n.x1 - 4, y1: n.y1 } : null;
  };
  fields.firstName = fieldBox('שם פרטי');
  fields.lastName = fieldBox('שם משפחה');
  fields.dueDate = fieldBox('תאריך הגשה');
  fields.timeTaken = fieldBox('כמה זמן');

  // tables: each "עמוד" header cell anchors one table
  const tables = [];
  const pageHeads = cells.filter(c => c.text === 'עמוד').sort((a, b) => a.y0 - b.y0);
  pageHeads.forEach((ph, ti) => {
    const nextTop = pageHeads[ti + 1] ? pageHeads[ti + 1].y0 : Infinity;
    // title: cell directly above the header row containing words other than מתי?
    const title = cells.filter(c => c.y1 <= ph.y0 + 2 && ph.y0 - c.y1 < 30 && c.items.length && !c.text.includes('מתי') && xOverlap(c, ph) > 0)
      .sort((a, b) => b.y1 - a.y1)[0];
    const whenHead = cells.filter(c => c.text.includes('מתי') && c.x0 >= ph.x1 - 3 && yOverlap(c, ph) > 0)[0];
    const exHead = cells.find(c => c.text === 'תרגילים' && Math.abs(cy(c) - cy(ph)) < 8);
    const leftBound = (title ? title.x0 : exHead ? exHead.x0 : 0) - 3;
    const pageCells = cells.filter(c => c.y0 >= ph.y1 - 2 && c.y0 < nextTop && xOverlap(c, ph) > (ph.x1 - ph.x0) * 0.6 && /\d/.test(c.text))
      .sort((a, b) => a.y0 - b.y0);
    const groups = pageCells.map((pc, gi) => {
      const ex = cells.filter(c => c !== pc && c.x1 <= pc.x0 + 3 && c.x0 >= leftBound && cy(c) > pc.y0 && cy(c) < pc.y1 && /\d/.test(c.text))
        .sort((a, b) => (Math.round(a.y0) - Math.round(b.y0)) || (b.x0 - a.x0));
      const exercises = ex.map((c, k) => {
        const num = (c.text.match(/\d+/) || [''])[0];
        const below = cells.filter(o => !o.items.length && Math.abs(o.y0 - c.y1) < 3 && xOverlap(o, c) > (c.x1 - c.x0) * 0.6)[0];
        return {
          id: `t${ti}g${gi}e${k}`, num, star: c.text.includes('*'), hint: c.text.includes('#'),
          box: { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 },
          below: below ? { x0: below.x0, y0: below.y0, x1: below.x1, y1: below.y1 } : null,
        };
      }).filter(e => e.num);
      const when = whenHead ? cells.filter(c => xOverlap(c, whenHead) > 3 && yOverlap(c, pc) > (pc.y1 - pc.y0) * 0.5 && !c.items.length)[0] : null;
      return {
        id: `t${ti}g${gi}`, page: pc.text.replace(/[^\d-]/g, ''),
        exercises, when: when ? { x0: when.x0, y0: when.y0, x1: when.x1, y1: when.y1 } : null,
      };
    }).filter(g => g.exercises.length);
    if (groups.length) tables.push({ id: `t${ti}`, title: title ? title.words.replace(/\)\s*([^()]+?)\s*\(/, '($1)') : `טבלה ${ti + 1}`, groups });
  });

  // a small preview image of the sheet (for the app UI)
  const prev = document.createElement('canvas');
  const ps = 1.4;
  prev.width = Math.round(vp1.width * ps); prev.height = Math.round(vp1.height * ps);
  prev.getContext('2d').drawImage(canvas, 0, 0, prev.width, prev.height);
  const previewBlob = await new Promise(r => prev.toBlob(r, 'image/jpeg', 0.85));

  const links = await linksFromPage(page, tc);
  return { lesson, fields, tables, links, pageSize: { w: vp1.width, h: vp1.height }, previewBlob, cellCount: cells.length };
}

// Links embedded in the sheet (solution videos, hints, zoom help room, enrichment).
async function linksFromPage(page, tc) {
  const out = [];
  let anns = [];
  try { anns = await page.getAnnotations(); } catch { return out; }
  for (const a of anns) {
    if (a.subtype !== 'Link' || !a.url) continue;
    const [x0, y0, x1, y1] = a.rect;
    const label = tc.items.filter(i => i.str.trim() && i.transform[4] >= x0 - 2 && i.transform[4] <= x1 + 2 && i.transform[5] >= y0 - 3 && i.transform[5] <= y1 + 3)
      .sort((p, q) => q.transform[4] - p.transform[4]).map(i => i.str.trim()).join(' ').replace(/^[-\s]+|[-\s]+$/g, '') || a.url;
    let kind = 'other';
    if (/סרטון|גבע/.test(label) || /geva/.test(a.url)) kind = 'video';
    else if (/רמז/.test(label)) kind = 'hints';
    else if (/zoom/.test(a.url) || /זום/.test(label)) kind = 'zoom';
    if (!out.some(l => l.url === a.url)) out.push({ label, url: a.url, kind });
  }
  return out;
}

export async function extractLinks(bytes) {
  const doc = await loadPdf(bytes);
  const page = await doc.getPage(1);
  return linksFromPage(page, await page.getTextContent());
}
