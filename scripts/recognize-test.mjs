import assert from 'node:assert/strict';

/** Mirror of recognize helpers — keep in sync with src/core/recognize.ts */
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

function ellipseFitScore(pts, box) {
  const rx = box.w / 2,
    ry = box.h / 2;
  if (rx < 8 || ry < 8) return 0;
  let err = 0,
    n = 0;
  for (let i = 0; i < pts.length; i += 2) {
    err += Math.abs(Math.hypot((pts[i] - box.cx) / rx, (pts[i + 1] - box.cy) / ry) - 1);
    n++;
  }
  const mean = n ? err / n : Infinity;
  return mean < 0.32 ? 1 - mean / 0.32 : 0;
}

function roundnessScore(area, len) {
  if (len <= 0) return 0;
  return (4 * Math.PI * area) / (len * len);
}

function rectFitScore(pts, box) {
  if (box.w < 16 || box.h < 16) return 0;
  let onEdge = 0,
    nearCorner = 0;
  const tol = Math.max(10, Math.min(box.w, box.h) * 0.16);
  const corners = [
    { x: box.minX, y: box.minY },
    { x: box.minX + box.w, y: box.minY },
    { x: box.minX + box.w, y: box.minY + box.h },
    { x: box.minX, y: box.minY + box.h },
  ];
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i],
      y = pts[i + 1];
    const nearL = Math.abs(x - box.minX) <= tol;
    const nearR = Math.abs(x - (box.minX + box.w)) <= tol;
    const nearT = Math.abs(y - box.minY) <= tol;
    const nearB = Math.abs(y - (box.minY + box.h)) <= tol;
    if ((nearL || nearR) && y >= box.minY - tol && y <= box.minY + box.h + tol) onEdge++;
    else if ((nearT || nearB) && x >= box.minX - tol && x <= box.minX + box.w + tol) onEdge++;
    for (const c of corners) {
      if (Math.hypot(x - c.x, y - c.y) <= tol * 1.4) {
        nearCorner++;
        break;
      }
    }
  }
  const n = pts.length / 2;
  const edgeRatio = onEdge / n;
  const cornerRatio = nearCorner / n;
  if (edgeRatio < 0.55) return 0;
  return edgeRatio * 0.7 + Math.min(1, cornerRatio * 4) * 0.3;
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
  const loopiness = st.len > 0 ? endDist / st.len : 1;
  const looksClosed = st.closed || endDist < Math.max(24, diag * 0.35) || loopiness < 0.15;

  if (!looksClosed && lineErr < Math.max(6, diag * 0.04) && endDist > diag * 0.55) {
    return { kind: 'line' };
  }

  if (looksClosed) {
    const box = {
      minX: st.minX,
      minY: st.minY,
      w,
      h,
      cx: st.minX + w / 2,
      cy: st.minY + h / 2,
    };
    const ell = ellipseFitScore(pts, box);
    const rect = rectFitScore(pts, box);
    const round = roundnessScore(st.area, st.len);
    const aspect = w > 0 && h > 0 ? Math.max(w, h) / Math.min(w, h) : 99;
    if (round >= 0.86 && ell > 0.2 && aspect < 2.8) return { kind: 'ellipse' };
    if (ell > 0.5 && round >= 0.84 && aspect < 2.8) return { kind: 'ellipse' };
    if (rect > 0.55 && round < 0.86) return { kind: 'rect' };
    if (ell > 0.4 && round >= 0.84 && aspect < 3) return { kind: 'ellipse' };
  }
  return null;
}

function localToWorld(v, lx, ly) {
  const rot = v.rotation ?? 0;
  const c = { x: v.x + v.w / 2, y: v.y + v.h / 2 };
  if (!rot) return { x: v.x + lx, y: v.y + ly };
  const rad = (rot * Math.PI) / 180;
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
  assert.equal(recognizeStroke(pts)?.kind, 'line');
}

// Closed square → rect
{
  const pts = [];
  const push = (x, y) => pts.push(x, y);
  for (let i = 0; i <= 10; i++) push(50 + i * 10, 50);
  for (let i = 0; i <= 10; i++) push(150, 50 + i * 10);
  for (let i = 0; i <= 10; i++) push(150 - i * 10, 150);
  for (let i = 0; i <= 10; i++) push(50, 150 - i * 10);
  assert.equal(recognizeStroke(pts)?.kind, 'rect');
}

// Regular 12-gon must be ellipse, NOT rect (regression: AABB edge scoring)
{
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    pts.push(200 + 100 * Math.cos(a), 200 + 100 * Math.sin(a));
  }
  assert.equal(recognizeStroke(pts)?.kind, 'ellipse', '12-gon circle → ellipse');
}

// Coarse automation-like 8-gon
{
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    pts.push(300 + 90 * Math.cos(a), 300 + 90 * Math.sin(a));
  }
  assert.equal(recognizeStroke(pts)?.kind, 'ellipse', '8-gon circle → ellipse');
}

// Oval
{
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    pts.push(400 + 120 * Math.cos(a), 400 + 70 * Math.sin(a));
  }
  assert.equal(recognizeStroke(pts)?.kind, 'ellipse', 'oval → ellipse');
}

// Rotation AABB grows for 45° square
{
  const v = { x: 0, y: 0, w: 100, h: 100, rotation: 45 };
  const b = rotatedAabb(v);
  assert.ok(b.w > 100 && b.h > 100);
  assert.ok(Math.abs(b.w - b.h) < 1e-6);
}

console.log('recognize/transform: all checks passed');
