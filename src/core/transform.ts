import type { ShapeBox, ShapeView } from './shapes';

/** Degrees. 0 = upright. */
export function shapeRotation(v: Pick<ShapeView, 'rotation'>): number {
  return v.rotation ?? 0;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Screen-space stem length from the top edge to the rotate knob. */
export const ROTATE_HANDLE_OFFSET_PX = 44;

/** Degrees from a board axis (0/90/180/270) before the magnet pulls in. */
export const ROTATE_MAGNET_DEG = 7;

const ROTATE_AXES = [0, 90, 180, 270] as const;

/**
 * Miro-style rotation: free everywhere, soft-snap only when close to a
 * horizontal or vertical board axis. `free` skips the magnet entirely.
 */
export function snapRotationDeg(deg: number, free: boolean, threshold = ROTATE_MAGNET_DEG): number {
  if (free || threshold <= 0) return deg;
  const a = ((deg % 360) + 360) % 360;
  let nearest = 0;
  let best = Infinity;
  for (const ax of ROTATE_AXES) {
    let d = Math.abs(a - ax);
    if (d > 180) d = 360 - d;
    if (d < best) {
      best = d;
      nearest = ax;
    }
  }
  if (best > threshold) return deg;
  let diff = nearest - a;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return deg + diff;
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

/** Opposite-edge fractions (0…1) kept fixed while dragging a resize handle. */
export function resizeAnchorFractions(handle: string): { fx: number; fy: number } {
  return {
    fx: handle.includes('e') ? 0 : handle.includes('w') ? 1 : 0.5,
    fy: handle.includes('s') ? 0 : handle.includes('n') ? 1 : 0.5,
  };
}

/**
 * After resizing the unrotated AABB of a rotated shape, shift x/y so the
 * world position of the opposite edge/corner stays put. Without this, the
 * box center drifts and handles feel like they resize the wrong way.
 */
export function reanchorRotatedResize(
  orig: ShapeBox & { rotation?: number },
  next: ShapeBox,
  handle: string,
  edges: { left: number; right: number; top: number; bottom: number }
): ShapeBox {
  const rot = shapeRotation(orig);
  if (!rot) return next;
  const { fx, fy } = resizeAnchorFractions(handle);
  const fixedLocalX = fx * orig.w;
  const fixedLocalY = fy * orig.h;
  const fixedWorld = localToWorld(orig, fixedLocalX, fixedLocalY);
  const sx = orig.w !== 0 ? (edges.right - edges.left) / orig.w : 1;
  const sy = orig.h !== 0 ? (edges.bottom - edges.top) / orig.h : 1;
  const mappedX = edges.left + fixedLocalX * sx;
  const mappedY = edges.top + fixedLocalY * sy;
  const placed = localToWorld(
    { ...next, rotation: rot },
    mappedX - next.x,
    mappedY - next.y
  );
  return {
    ...next,
    x: next.x + (fixedWorld.x - placed.x),
    y: next.y + (fixedWorld.y - placed.y),
  };
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
