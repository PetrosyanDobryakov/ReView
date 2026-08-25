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

/** Downsample a polyline for ephemeral awareness drafts (keeps first/last). */
export function downsamplePolyline(points: number[], maxVertices: number): number[] {
  const n = points.length / 2;
  if (n <= maxVertices || maxVertices < 2) return points;
  const out: number[] = [];
  const last = n - 1;
  for (let i = 0; i < maxVertices; i++) {
    const idx = i === maxVertices - 1 ? last : Math.round((i * last) / (maxVertices - 1));
    out.push(points[idx * 2], points[idx * 2 + 1]);
  }
  return out;
}
