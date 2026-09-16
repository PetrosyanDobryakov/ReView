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
