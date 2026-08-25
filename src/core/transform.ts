import type { ShapeBox, ShapeView } from './shapes';

/** Degrees. 0 = upright. */
export function shapeRotation(v: Pick<ShapeView, 'rotation'>): number {
  return v.rotation ?? 0;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function shapeCenter(v: ShapeBox): { x: number; y: number } {
  return { x: v.x + v.w / 2, y: v.y + v.h / 2 };
}

/** Map a world point into the shape's unrotated local frame (origin = shape top-left). */
export function worldToLocal(v: ShapeBox & { rotation?: number }, wx: number, wy: number): { x: number; y: number } {
  const rot = shapeRotation(v);
  if (!rot) return { x: wx - v.x, y: wy - v.y };
  const c = shapeCenter(v);
  const rad = -degToRad(rot);
  const dx = wx - c.x;
  const dy = wy - c.y;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: dx * cos - dy * sin + v.w / 2,
    y: dx * sin + dy * cos + v.h / 2,
  };
}

export function localToWorld(v: ShapeBox & { rotation?: number }, lx: number, ly: number): { x: number; y: number } {
  const rot = shapeRotation(v);
  const c = shapeCenter(v);
  if (!rot) return { x: v.x + lx, y: v.y + ly };
  const rad = degToRad(rot);
  const dx = lx - v.w / 2;
  const dy = ly - v.h / 2;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: c.x + dx * cos - dy * sin,
    y: c.y + dx * sin + dy * cos,
  };
}

/** Axis-aligned bounds that fully cover a possibly rotated box. */
export function rotatedAabb(v: ShapeBox & { rotation?: number }): ShapeBox {
  const rot = shapeRotation(v);
  if (!rot) return { x: v.x, y: v.y, w: v.w, h: v.h };
  const corners = [
    localToWorld(v, 0, 0),
    localToWorld(v, v.w, 0),
    localToWorld(v, v.w, v.h),
    localToWorld(v, 0, v.h),
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of corners) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Rotation handle sits above the top-center of the (rotated) box. */
export function rotationHandleWorld(v: ShapeBox & { rotation?: number }, offset = 28): { x: number; y: number } {
  return localToWorld(v, v.w / 2, -offset);
}

export function withShapeRotation(
  ctx: CanvasRenderingContext2D,
  v: ShapeBox & { rotation?: number },
  draw: () => void
): void {
  const rot = shapeRotation(v);
  if (!rot) {
    draw();
    return;
  }
  const c = shapeCenter(v);
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(degToRad(rot));
  ctx.translate(-c.x, -c.y);
  draw();
  ctx.restore();
}

/** Rotate point arrays around a center (used for pens/arrows). */
export function rotatePointsAround(
  points: number[],
  cx: number,
  cy: number,
  deg: number
): number[] {
  if (!deg || points.length < 2) return points.slice();
  const rad = degToRad(deg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const out: number[] = [];
  for (let i = 0; i < points.length; i += 2) {
    const dx = points[i] - cx;
    const dy = points[i + 1] - cy;
    out.push(cx + dx * cos - dy * sin, cy + dx * sin + dy * cos);
  }
  return out;
}
