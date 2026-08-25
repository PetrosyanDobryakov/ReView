import type { ShapeType } from './shapes';

export type RecognizedShape =
  | { kind: 'line'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'arrow'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'ellipse'; x: number; y: number; w: number; h: number };

function pathStats(pts: number[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  len: number;
  closed: boolean;
  area: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let len = 0;
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
  // Shoelace area
  let area = 0;
  const n = Math.floor(pts.length / 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
  }
  area = Math.abs(area) / 2;
  return { minX, minY, maxX, maxY, len, closed, area };
}

function lineFitError(pts: number[]): number {
  const x0 = pts[0];
  const y0 = pts[1];
  const x1 = pts[pts.length - 2];
  const y1 = pts[pts.length - 1];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  let err = 0;
  let n = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const t = ((pts[i] - x0) * dx + (pts[i + 1] - y0) * dy) / len2;
    const px = x0 + t * dx;
    const py = y0 + t * dy;
    err += Math.hypot(pts[i] - px, pts[i + 1] - py);
    n++;
  }
  return n ? err / n : Infinity;
}

function circleFitScore(pts: number[], box: { w: number; h: number; cx: number; cy: number }): number {
  const r = (box.w + box.h) / 4;
  if (r < 8) return 0;
  let err = 0;
  let n = 0;
  for (let i = 0; i < pts.length; i += 2) {
    err += Math.abs(Math.hypot(pts[i] - box.cx, pts[i + 1] - box.cy) - r);
    n++;
  }
  const mean = n ? err / n : Infinity;
  return mean < r * 0.28 ? 1 - mean / (r * 0.28) : 0;
}

function rectFitScore(pts: number[], box: { w: number; h: number; minX: number; minY: number }): number {
  if (box.w < 16 || box.h < 16) return 0;
  let onEdge = 0;
  const tol = Math.max(10, Math.min(box.w, box.h) * 0.16);
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i];
    const y = pts[i + 1];
    const nearL = Math.abs(x - box.minX) <= tol;
    const nearR = Math.abs(x - (box.minX + box.w)) <= tol;
    const nearT = Math.abs(y - box.minY) <= tol;
    const nearB = Math.abs(y - (box.minY + box.h)) <= tol;
    if ((nearL || nearR) && y >= box.minY - tol && y <= box.minY + box.h + tol) onEdge++;
    else if ((nearT || nearB) && x >= box.minX - tol && x <= box.minX + box.w + tol) onEdge++;
  }
  const ratio = onEdge / (pts.length / 2);
  return ratio > 0.55 ? ratio : 0;
}

/**
 * Guess a geometry from a freehand polyline.
 * Returns null when the stroke is too messy / too short to snap.
 */
export function recognizeStroke(pts: number[]): RecognizedShape | null {
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

  // Straight line / arrow: low deviation, not closed
  if (!looksClosed && lineErr < Math.max(6, diag * 0.04) && endDist > diag * 0.55) {
    const shape = {
      x0: pts[0],
      y0: pts[1],
      x1: pts[pts.length - 2],
      y1: pts[pts.length - 1],
    };
    // Arrow if the stroke ends with a sharp hook (last 15% reverses)
    const mid = Math.max(2, Math.floor(pts.length * 0.7) & ~1);
    const tipDx = pts[pts.length - 2] - pts[mid];
    const tipDy = pts[pts.length - 1] - pts[mid + 1];
    const bodyDx = pts[mid] - pts[0];
    const bodyDy = pts[mid + 1] - pts[1];
    const tipLen = Math.hypot(tipDx, tipDy);
    const bodyLen = Math.hypot(bodyDx, bodyDy) || 1;
    const dot = (tipDx * bodyDx + tipDy * bodyDy) / (tipLen * bodyLen || 1);
    if (tipLen > 12 && tipLen < bodyLen * 0.45 && dot < 0.25) {
      return { kind: 'arrow', ...shape };
    }
    return { kind: 'line', ...shape };
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
    const circ = circleFitScore(pts, box);
    const rect = rectFitScore(pts, box);
    const aspect = w > 0 && h > 0 ? Math.max(w, h) / Math.min(w, h) : 99;
    if (circ > 0.4 && circ >= rect && aspect < 2.2) {
      return { kind: 'ellipse', x: st.minX, y: st.minY, w, h };
    }
    if (rect > 0.5) {
      return { kind: 'rect', x: st.minX, y: st.minY, w, h };
    }
    if (circ > 0.3 && aspect < 2.5) {
      return { kind: 'ellipse', x: st.minX, y: st.minY, w, h };
    }
  }
  return null;
}

export function recognizedToShapeType(kind: RecognizedShape['kind']): ShapeType {
  if (kind === 'ellipse') return 'ellipse';
  if (kind === 'rect') return 'rect';
  if (kind === 'arrow' || kind === 'line') return 'arrow';
  return 'pen';
}
