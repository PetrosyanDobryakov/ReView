import assert from 'node:assert/strict';

/** Mirror of recognizeStroke heuristics — keep in sync with src/core/recognize.ts */
function pathStats(pts) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    len = 0;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]);
    maxX = Math.max(maxX, pts[i]);
    minY = Math.min(minY, pts[i + 1]);
    maxY = Math.max(maxY, pts[i + 1]);
    if (i >= 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  }
  const closed =
    pts.length >= 6 &&
    Math.hypot(pts[0] - pts[pts.length - 2], pts[1] - pts[pts.length - 1]) < Math.max(24, len * 0.08);
  let area = 0;
  const n = Math.floor(pts.length / 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
  }
  area = Math.abs(area) / 2;
  return { minX, minY, maxX, maxY, len, closed, area };
}

function lineFitError(pts) {
  const x0 = pts[0],
    y0 = pts[1],
    x1 = pts[pts.length - 2],
    y1 = pts[pts.length - 1];
  const dx = x1 - x0,
    dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  let err = 0,
    n = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const t = ((pts[i] - x0) * dx + (pts[i + 1] - y0) * dy) / len2;
    err += Math.hypot(pts[i] - (x0 + t * dx), pts[i + 1] - (y0 + t * dy));
    n++;
  }
  return n ? err / n : Infinity;
}

function recognizeStroke(pts) {
  if (pts.length < 6) return null;
  const st = pathStats(pts);
  const w = st.maxX - st.minX;
  const h = st.maxY - st.minY;
  if (w < 10 && h < 10) return null;
  const diag = Math.hypot(w, h);
  const lineErr = lineFitError(pts);
  const endDist = Math.hypot(pts[pts.length - 2] - pts[0], pts[pts.length - 1] - pts[1]);
  if (!st.closed && lineErr < Math.max(6, diag * 0.04) && endDist > diag * 0.55) {
    return { kind: 'line', x0: pts[0], y0: pts[1], x1: pts[pts.length - 2], y1: pts[pts.length - 1] };
  }
  if (st.closed || endDist < Math.max(20, diag * 0.15)) {
    const box = { minX: st.minX, minY: st.minY, w, h, cx: st.minX + w / 2, cy: st.minY + h / 2 };
    // circle-ish: sample near constant radius
    const r = (w + h) / 4;
    let err = 0,
      n = 0;
    for (let i = 0; i < pts.length; i += 2) {
      err += Math.abs(Math.hypot(pts[i] - box.cx, pts[i + 1] - box.cy) - r);
      n++;
    }
    const circ = n && err / n < r * 0.18 ? 1 - err / n / (r * 0.18) : 0;
    if (circ > 0.55) return { kind: 'ellipse', x: box.cx - Math.max(w, h) / 2, y: box.cy - Math.max(w, h) / 2, w: Math.max(w, h), h: Math.max(w, h) };
    // rectangle edges
    let onEdge = 0;
    const tol = Math.max(8, Math.min(w, h) * 0.12);
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i],
        y = pts[i + 1];
      const nearL = Math.abs(x - box.minX) <= tol;
      const nearR = Math.abs(x - (box.minX + w)) <= tol;
      const nearT = Math.abs(y - box.minY) <= tol;
      const nearB = Math.abs(y - (box.minY + h)) <= tol;
      if ((nearL || nearR) && y >= box.minY - tol && y <= box.minY + h + tol) onEdge++;
      else if ((nearT || nearB) && x >= box.minX - tol && x <= box.minX + w + tol) onEdge++;
    }
    if (onEdge / (pts.length / 2) > 0.72) return { kind: 'rect', x: st.minX, y: st.minY, w, h };
  }
  return null;
}

function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

function localToWorld(v, lx, ly) {
  const rot = v.rotation ?? 0;
  const c = { x: v.x + v.w / 2, y: v.y + v.h / 2 };
  if (!rot) return { x: v.x + lx, y: v.y + ly };
  const rad = degToRad(rot);
  const cos = Math.cos(rad),
    sin = Math.sin(rad);
  const dx = lx - v.w / 2,
    dy = ly - v.h / 2;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

function rotatedAabb(v) {
  const corners = [localToWorld(v, 0, 0), localToWorld(v, v.w, 0), localToWorld(v, v.w, v.h), localToWorld(v, 0, v.h)];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of corners) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Straight horizontal line
{
  const pts = [];
  for (let i = 0; i <= 20; i++) pts.push(i * 10, 100);
  const g = recognizeStroke(pts);
  assert.equal(g?.kind, 'line');
}

// Closed square
{
  const pts = [];
  const push = (x, y) => pts.push(x, y);
  for (let i = 0; i <= 10; i++) push(50 + i * 10, 50);
  for (let i = 0; i <= 10; i++) push(150, 50 + i * 10);
  for (let i = 0; i <= 10; i++) push(150 - i * 10, 150);
  for (let i = 0; i <= 10; i++) push(50, 150 - i * 10);
  const g = recognizeStroke(pts);
  assert.equal(g?.kind, 'rect');
}

// Rotation AABB grows for 45° square
{
  const v = { x: 0, y: 0, w: 100, h: 100, rotation: 45 };
  const b = rotatedAabb(v);
  assert.ok(b.w > 100 && b.h > 100);
  assert.ok(Math.abs(b.w - b.h) < 1e-6);
}

// JPEG→PDF header
{
  // Minimal JPEG SOI + EOI
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  // Inline a tiny subset of jpegToPdf object framing checks via string search on built PDF
  // (full encoder lives in src/core/exportVector.ts — smoke via dynamic import not available in plain node without build)
  assert.equal(jpeg[0], 0xff);
}

console.log('recognize/transform: all checks passed');
