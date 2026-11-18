// Builds the submission PDF: the original sheet (filled in) followed by the photographed solutions.
// Hebrew text is drawn on a canvas and embedded as an image, so no font files are needed.
import '../lib/pdf-lib.min.js';
import { fmtDate, fmtShort, sheetOrder } from './util.js';

const { PDFDocument, rgb } = window.PDFLib;
const PX = 5; // canvas pixels per PDF point for text images

function textPng(lines, { size = 11, color = '#14306b', align = 'right', bold = false, maxW = 1000, maxH = 1000, lineGap = 1.15, dir = 'rtl' } = {}) {
  if (!Array.isArray(lines)) lines = [lines];
  const font = (s) => `${bold ? '700 ' : ''}${s * PX}px "Segoe UI", Roboto, "Noto Sans Hebrew", Arial, sans-serif`;
  const meas = document.createElement('canvas').getContext('2d');
  let s = size;
  for (; s > 4; s -= 0.5) {
    meas.font = font(s);
    const w = Math.max(...lines.map(l => meas.measureText(l).width)) / PX;
    const h = lines.length * s * lineGap;
    if (w <= maxW && h <= maxH) break;
  }
  meas.font = font(s);
  const w = Math.ceil(Math.max(...lines.map(l => meas.measureText(l).width)) / PX) + 2;
  const h = Math.ceil(lines.length * s * lineGap + s * 0.25);
  const c = document.createElement('canvas');
  c.width = w * PX; c.height = h * PX;
  const ctx = c.getContext('2d');
  ctx.font = font(s); ctx.fillStyle = color; ctx.direction = dir; ctx.textBaseline = 'alphabetic';
  ctx.textAlign = align === 'center' ? 'center' : 'right';
  lines.forEach((l, i) => {
    const x = align === 'center' ? c.width / 2 : c.width - PX;
    ctx.fillText(l, x, (i * s * lineGap + s * 0.95) * PX);
  });
  return new Promise(r => c.toBlob(async b => r({ bytes: new Uint8Array(await b.arrayBuffer()), w, h }), 'image/png'));
}

async function drawText(doc, page, box, pageBox, lines, opts = {}) {
  const pad = 2;
  const t = await textPng(lines, { ...opts, maxW: box.x1 - box.x0 - pad * 2, maxH: box.y1 - box.y0 - 1 });
  const png = await doc.embedPng(t.bytes);
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  let x;
  if (opts.align === 'center') x = box.x0 + (bw - t.w) / 2;
  else x = box.x1 - pad - t.w;
  const yTop = box.y0 + (bh - t.h) / 2;
  page.drawImage(png, { x: pageBox.x + x, y: pageBox.y + pageBox.height - yTop - t.h, width: t.w, height: t.h });
}

export async function buildSubmission(sheet, shots, child) {
  const doc = await PDFDocument.create();
  doc.setTitle(`שיעורי בית - שיעור ${sheet.lesson || ''} - ${child.first} ${child.last}`);
  doc.setAuthor(`${child.first} ${child.last}`);
  const src = await PDFDocument.load(sheet.pdfBytes, { ignoreEncryption: true });
  const [p1] = await doc.copyPages(src, [0]);
  doc.addPage(p1);
  const pb = p1.getCropBox ? p1.getCropBox() : p1.getMediaBox();

  const f = sheet.fields || {};
  if (f.firstName) await drawText(doc, p1, f.firstName, pb, child.first, { size: 11 });
  if (f.lastName) await drawText(doc, p1, f.lastName, pb, child.last, { size: 11 });
  if (f.dueDate && sheet.dueDate) await drawText(doc, p1, f.dueDate, pb, fmtDate(sheet.dueDate), { size: 11 });

  // shots may cover several exercises (exerciseIds); an exercise may span several shots (continuation)
  const order = sheetOrder(sheet);
  const idx = new Map(order.map((o, i) => [o.ex.id, i]));
  const firstDate = new Map();
  for (const s of shots.slice().sort((a, b) => a.created - b.created)) for (const id of s.exerciseIds) if (!firstDate.has(id)) firstDate.set(id, s.date);

  for (const t of sheet.tables) for (const g of t.groups) {
    const dates = new Set();
    for (const e of g.exercises) {
      const d = firstDate.get(e.id); if (!d) continue;
      dates.add(d);
      if (e.below) await drawText(doc, p1, e.below, pb, '✓', { size: 10, align: 'center', color: '#1b5e20', bold: true });
    }
    if (g.when && dates.size) {
      const lines = [...dates].sort().map(fmtShort);
      await drawText(doc, p1, g.when, pb, lines, { size: 9, align: 'center', lineGap: 1.1 });
    }
  }

  // blocks: shots with the same exercise set, ordered by sheet position then time
  const blocks = new Map();
  for (const s of shots) {
    const ids = s.exerciseIds.filter(id => idx.has(id)).sort((a, b) => idx.get(a) - idx.get(b));
    if (!ids.length) continue;
    const key = ids.join('|');
    if (!blocks.has(key)) blocks.set(key, { ids, shots: [] });
    blocks.get(key).shots.push(s);
  }
  const blockList = [...blocks.values()];
  for (const bl of blockList) { bl.shots.sort((a, b) => a.created - b.created); bl.pos = idx.get(bl.ids[0]); bl.t = bl.shots[0].created; }
  blockList.sort((a, b) => (a.pos - b.pos) || (a.t - b.t));

  const labelFor = (ids) => {
    const byGroup = [];
    for (const id of ids) {
      const o = order[idx.get(id)];
      let g = byGroup.find(x => x.group === o.group);
      if (!g) { g = { group: o.group, table: o.table, nums: [] }; byGroup.push(g); }
      g.nums.push(o.ex.num + (o.ex.star ? '*' : ''));
    }
    return byGroup.map(g => `${g.table.title} · עמ' ${g.group.page} · ${g.nums.length > 1 ? 'תרגילים' : 'תרגיל'} ${g.nums.join(', ')}`).join('  |  ');
  };

  // ---- solution pages
  const A4 = [595.28, 841.89], M = 34, CW = A4[0] - 2 * M;
  let page = null, y = 0;
  const newPage = () => { page = doc.addPage(A4); y = A4[1] - M; };
  if (blockList.length) {
    newPage();
    const head = await textPng(`פתרונות · שיעור ${sheet.lesson || ''} · ${child.first} ${child.last}`, { size: 15, bold: true, color: '#111' });
    const hp = await doc.embedPng(head.bytes);
    page.drawImage(hp, { x: A4[0] - M - head.w, y: y - head.h, width: head.w, height: head.h });
    y -= head.h + 10;
  }
  for (const bl of blockList) {
    const label = await textPng(`${labelFor(bl.ids)} · ${fmtDate(bl.shots[0].date)}`, { size: 10.5, bold: true, color: '#14306b', maxW: CW });
    const lp = await doc.embedPng(label.bytes);
    let first = true;
    for (const s of bl.shots) {
      const img = await doc.embedJpg(new Uint8Array(await s.blob.arrayBuffer()));
      let w = Math.min(CW, s.w / 2.6), h = w * s.h / s.w;
      const maxH = A4[1] - 2 * M - label.h - 14;
      if (h > maxH) { h = maxH; w = h * s.w / s.h; }
      const need = (first ? label.h + 6 : 0) + h + 16;
      if (y - need < M) newPage();
      if (first) {
        page.drawImage(lp, { x: A4[0] - M - label.w, y: y - label.h, width: label.w, height: label.h });
        y -= label.h + 4;
        first = false;
      }
      page.drawImage(img, { x: A4[0] - M - w, y: y - h, width: w, height: h });
      y -= h + 8;
    }
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: A4[0] - M, y: y + 2 }, thickness: 0.5, color: rgb(0.8, 0.82, 0.86) });
    y -= 10;
  }
  // page numbers
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const t = await textPng(`${i + 1} / ${pages.length}`, { size: 8, color: '#777', align: 'center', dir: 'ltr' });
    const im = await doc.embedPng(t.bytes);
    const { width } = pages[i].getSize();
    pages[i].drawImage(im, { x: width / 2 - t.w / 2, y: 14, width: t.w, height: t.h });
  }
  return doc.save();
}
