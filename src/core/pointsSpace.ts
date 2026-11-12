/**
 * Pen/arrow polylines are stored in shape-local space (relative to x/y).
 * ShapeView always exposes world-space points for the engine.
 *
 * Moving a stroke then only patches x/y — no full-array rewrite on the wire.
 */

export const POINTS_SPACE_META = 'pointsSpace';
export const POINTS_SPACE_LOCAL = 'local';

/** World → local (storage). */
export function toLocalPoints(points: number[], originX: number, originY: number): number[] {
  const out = new Array<number>(points.length);
  for (let i = 0; i < points.length; i += 2) {
    out[i] = points[i] - originX;
    out[i + 1] = points[i + 1] - originY;
  }
  return out;
}

/** Local (storage) → world (ShapeView). */
export function toWorldPoints(points: number[], originX: number, originY: number): number[] {
  const out = new Array<number>(points.length);
  for (let i = 0; i < points.length; i += 2) {
    out[i] = points[i] + originX;
    out[i + 1] = points[i + 1] + originY;
  }
  return out;
}

/**
 * Ramer–Douglas–Peucker simplify at commit time, plus a vertex cap.
 *
 * Capture already drops points closer than 2/zoom, but long strokes still
 * store thousands of float64 vertices (every one a Yjs tombstone forever
 * under gc:false). Returns the simplified polyline and the kept source
 * indices so pressures stay aligned.
 */
export const PEN_MAX_VERTICES = 4000;
/** RDP input is stride-capped past this many vertices (worst case is quadratic). */
export const RDP_PRE_MAX = 6000;

export function simplifyStroke(
  points: number[],
  epsilon: number,
  maxVertices = PEN_MAX_VERTICES,
): { points: number[]; keep: number[] } {
  const n = points.length / 2;
  if (n === 0) return { points: [], keep: [] };
  // RDP is quadratic in the worst case — stride huge inputs down first so a
  // marathon stroke cannot hitch pointerup. Indices always map to `points`
  // so pressures stay aligned.
  let base: number[] | null = null;
  let work = points;
  let m = n;
  if (n > RDP_PRE_MAX) {
    const stride = Math.ceil((n - 1) / (RDP_PRE_MAX - 1));
    base = [0];
    for (let i = stride; i < n - 1; i += stride) base.push(i);
    base.push(n - 1);
    work = new Array<number>(base.length * 2);
    for (let k = 0; k < base.length; k++) {
      work[k * 2] = points[base[k] * 2];
      work[k * 2 + 1] = points[base[k] * 2 + 1];
    }
    m = base.length;
  }
  const keepMask = new Array<boolean>(m).fill(false);
  keepMask[0] = true;
  keepMask[m - 1] = true;
  const eps2 = epsilon * epsilon;
  const stack: Array<[number, number]> = m > 2 ? [[0, m - 1]] : [];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = work[a * 2];
    const ay = work[a * 2 + 1];
    const dx = work[b * 2] - ax;
    const dy = work[b * 2 + 1] - ay;
    const len2 = dx * dx + dy * dy;
    let dmax = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = work[i * 2] - ax;
      const py = work[i * 2 + 1] - ay;
      let d2: number;
      if (len2 === 0) {
        d2 = px * px + py * py;
      } else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const cx = px - t * dx;
        const cy = py - t * dy;
        d2 = cx * cx + cy * cy;
      }
      if (d2 > dmax) {
        dmax = d2;
        idx = i;
      }
    }
    if (idx >= 0 && dmax > eps2) {
      keepMask[idx] = true;
      stack.push([a, idx], [idx, b]);
    }
  }
  let indices: number[] = [];
  for (let i = 0; i < m; i++) if (keepMask[i]) indices.push(base ? base[i] : i);
  if (indices.length > maxVertices && maxVertices >= 2) {
    const stride = Math.ceil((indices.length - 1) / (maxVertices - 1));
    const capped = indices.filter((_, k) => k % stride === 0);
    if (capped[capped.length - 1] !== indices[indices.length - 1]) {
      capped.push(indices[indices.length - 1]);
    }
    indices = capped;
  }
  const out: number[] = [];
  for (const i of indices) out.push(points[i * 2], points[i * 2 + 1]);
  return { points: out, keep: indices };
}

/** Round vertices to a grid step (default 0.1): kills float64 noise in storage. */
export function quantizePoints(points: number[], step = 0.1): number[] {
  const out = new Array<number>(points.length);
  for (let i = 0; i < points.length; i++) out[i] = Math.round(points[i] / step) * step;
  return out;
}
/**
 * Downsample a polyline for ephemeral awareness drafts.
 *
 * Tip-stable: when over budget, keep a fixed-size live tip (newest vertices)
 * and only re-sample the older prefix. Re-picking indices across the *whole*
 * stroke on every append made midpoints jump every frame — remote ink looked
 * jagged even when packets arrived on time.
 */
export function downsamplePolyline(points: number[], maxVertices: number, tipVertices = 24): number[] {
  const n = points.length / 2;
  if (n <= maxVertices || maxVertices < 2) return points;
  const tip = Math.max(2, Math.min(tipVertices, maxVertices - 1));
  const skeleton = maxVertices - tip;
  const prefixLen = Math.max(1, n - tip);
  const out: number[] = [];

  if (skeleton <= 1) {
    out.push(points[0], points[1]);
  } else {
    const lastSkel = skeleton - 1;
    for (let i = 0; i < skeleton; i++) {
      const idx = Math.round((i * (prefixLen - 1)) / lastSkel);
      out.push(points[idx * 2], points[idx * 2 + 1]);
    }
  }
  for (let i = n - tip; i < n; i++) {
    out.push(points[i * 2], points[i * 2 + 1]);
  }
  return out;
}
