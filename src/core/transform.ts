import type { ShapeBox, ShapeView } from './shapes';

/** Degrees. 0 = upright. */
export function shapeRotation(v: Pick<ShapeView, 'rotation'>): number {
  return v.rotation ?? 0;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Screen-space offset from the selection edge to the rotate knob center. */
export const ROTATE_HANDLE_OFFSET_PX = 44;

/**
 * Local (unrotated shape) position of the rotate knob relative to the shape box.
 * `topMiddle` = Figma-style top center; otherwise legacy bottom-left corner.
 */
export function rotateHandleLocal(
  w: number,
  h: number,
  offsetWorld: number,
  topMiddle: boolean
): { x: number; y: number } {
  if (topMiddle) return { x: w / 2, y: -offsetWorld };
  return { x: -offsetWorld, y: h + offsetWorld };
}

/**
 * Axis-aligned group bbox position for the rotate knob (world).
 */
export function rotateHandleOnBox(
  box: { x: number; y: number; w: number; h: number },
  offsetWorld: number,
  topMiddle: boolean
): { x: number; y: number } {
  if (topMiddle) return { x: box.x + box.w / 2, y: box.y - offsetWorld };
  return { x: box.x - offsetWorld, y: box.y + box.h + offsetWorld };
}

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

/**
 * Place a crop window so its local top-left stays at the same world point after
 * the AABB (and therefore the rotation center) changes. Unrotated crops are a no-op.
 */
export function reanchorCroppedBox(
  orig: ShapeBox & { rotation?: number },
  cropBox: ShapeBox
): ShapeBox {
  const next: ShapeBox & { rotation?: number } = {
    x: cropBox.x,
    y: cropBox.y,
    w: cropBox.w,
    h: cropBox.h,
    rotation: orig.rotation,
  };
  const oldTL = localToWorld(orig, cropBox.x - orig.x, cropBox.y - orig.y);
  const newTL = localToWorld(next, 0, 0);
  return {
    x: next.x + (oldTL.x - newTL.x),
    y: next.y + (oldTL.y - newTL.y),
    w: next.w,
    h: next.h,
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

/**
 * Unrotated width/height whose rotated AABB matches `aabbW`×`aabbH`.
 * At 45° the system is singular — fall back to scaling the original size.
 */
export function unrotatedSizeMatchingAabb(
  aabbW: number,
  aabbH: number,
  deg: number,
  origW: number,
  origH: number,
  sx: number,
  sy: number
): { w: number; h: number } {
  const rad = degToRad(deg);
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const det = c * c - s * s;
  if (Math.abs(det) < 1e-6) {
    return { w: Math.max(1, origW * sx), h: Math.max(1, origH * sy) };
  }
  const w = (c * aabbW - s * aabbH) / det;
  const h = (c * aabbH - s * aabbW) / det;
  if (!(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) {
    return { w: Math.max(1, origW * sx), h: Math.max(1, origH * sy) };
  }
  return { w, h };
}

export type GroupResizeMember = {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  type: string;
  locked?: boolean;
  points?: number[];
  strokeWidth?: number;
};

/**
 * Scale one selected member with the group AABB. Centers move in group space;
 * rotated boxes keep `rotation` and recover unrotated size from the scaled AABB
 * so a 90° rect grows along the handle axis instead of the unrotated width.
 */
export function groupResizeMember(
  o: GroupResizeMember,
  origBox: ShapeBox,
  nextBox: ShapeBox,
  minSize: number
): { x: number; y: number; w?: number; h?: number; points?: number[] } | null {
  if (o.locked) return null;
  const sx = origBox.w !== 0 ? nextBox.w / origBox.w : 1;
  const sy = origBox.h !== 0 ? nextBox.h / origBox.h : 1;
  const mapX = (px: number) => nextBox.x + (px - origBox.x) * sx;
  const mapY = (py: number) => nextBox.y + (py - origBox.y) * sy;
  const keepSize = o.type === 'text' || o.type === 'sticky';
  if (keepSize) {
    const cx = o.x + o.w / 2;
    const cy = o.y + o.h / 2;
    return { x: mapX(cx) - o.w / 2, y: mapY(cy) - o.h / 2 };
  }
  if (o.points && o.points.length >= 2) {
    const pts: number[] = [];
    for (let i = 0; i < o.points.length; i += 2) {
      pts.push(mapX(o.points[i]), mapY(o.points[i + 1]));
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      minX = Math.min(minX, pts[i]);
      maxX = Math.max(maxX, pts[i]);
      minY = Math.min(minY, pts[i + 1]);
      maxY = Math.max(maxY, pts[i + 1]);
    }
    const pad = (o.strokeWidth ?? 0) / 2;
    return {
      x: minX - pad,
      y: minY - pad,
      w: Math.max(minSize, maxX - minX + pad * 2),
      h: Math.max(minSize, maxY - minY + pad * 2),
      points: pts,
    };
  }
  const c = shapeCenter(o);
  const nc = { x: mapX(c.x), y: mapY(c.y) };
  const absSx = Math.abs(sx);
  const absSy = Math.abs(sy);
  const rot = shapeRotation(o);
  if (!rot) {
    const nw = Math.max(minSize, o.w * absSx);
    const nh = Math.max(minSize, o.h * absSy);
    return { x: nc.x - nw / 2, y: nc.y - nh / 2, w: nw, h: nh };
  }
  const aabb = rotatedAabb(o);
  const targetW = Math.max(minSize, aabb.w * absSx);
  const targetH = Math.max(minSize, aabb.h * absSy);
  const size = unrotatedSizeMatchingAabb(targetW, targetH, rot, o.w, o.h, absSx, absSy);
  const nw = Math.max(minSize, size.w);
  const nh = Math.max(minSize, size.h);
  return { x: nc.x - nw / 2, y: nc.y - nh / 2, w: nw, h: nh };
}

/**
 * Move a glued rider by mapping world points through the host's local frame.
 * Used when the host's local space warps without a uniform scale (table
 * insert/delete/divider). Boxes and strokes keep size (rigid translate by
 * center) so cell-divider stretch does not distort ink or photos.
 */
export function mapShapeThroughLocalMap(
  o: GroupResizeMember,
  origHost: ShapeBox & { rotation?: number },
  nextHost: ShapeBox & { rotation?: number },
  mapLocal: (lx: number, ly: number) => { x: number; y: number },
  minSize: number
): { x: number; y: number; w?: number; h?: number; points?: number[] } | null {
  if (o.locked) return null;
  const nextFrame = {
    x: nextHost.x,
    y: nextHost.y,
    w: nextHost.w,
    h: nextHost.h,
    rotation: nextHost.rotation ?? origHost.rotation,
  };
  const mapPt = (px: number, py: number) => {
    const lp = worldToLocal(origHost, px, py);
    const mapped = mapLocal(lp.x, lp.y);
    return localToWorld(nextFrame, mapped.x, mapped.y);
  };
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  const nc = mapPt(cx, cy);
  const dx = nc.x - cx;
  const dy = nc.y - cy;
  if (o.points && o.points.length >= 2) {
    // Rigid translate: do not warp points through the cell-fraction map
    // (that stretched drawings when a column/row divider moved).
    const pts: number[] = [];
    for (let i = 0; i < o.points.length; i += 2) {
      pts.push(o.points[i]! + dx, o.points[i + 1]! + dy);
    }
    return {
      x: o.x + dx,
      y: o.y + dy,
      w: Math.max(minSize, o.w),
      h: Math.max(minSize, o.h),
      points: pts,
    };
  }
  return { x: o.x + dx, y: o.y + dy };
}

/** Keep a glued rider in the host's local frame while the host's unrotated box changes. */
export function mapShapeThroughHostResize(
  o: GroupResizeMember,
  origHost: ShapeBox & { rotation?: number },
  nextHost: ShapeBox & { rotation?: number },
  minSize: number
): { x: number; y: number; w?: number; h?: number; points?: number[] } | null {
  if (o.locked) return null;
  const sx = origHost.w !== 0 ? nextHost.w / origHost.w : 1;
  const sy = origHost.h !== 0 ? nextHost.h / origHost.h : 1;
  const nextFrame = {
    x: nextHost.x,
    y: nextHost.y,
    w: nextHost.w,
    h: nextHost.h,
    rotation: nextHost.rotation ?? origHost.rotation,
  };
  const mapPt = (px: number, py: number) => {
    const lp = worldToLocal(origHost, px, py);
    return localToWorld(nextFrame, lp.x * sx, lp.y * sy);
  };
  if (o.type === 'text' || o.type === 'sticky') {
    const c = mapPt(o.x + o.w / 2, o.y + o.h / 2);
    return { x: c.x - o.w / 2, y: c.y - o.h / 2 };
  }
  if (o.points && o.points.length >= 2) {
    const pts: number[] = [];
    for (let i = 0; i < o.points.length; i += 2) {
      const p = mapPt(o.points[i]!, o.points[i + 1]!);
      pts.push(p.x, p.y);
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      minX = Math.min(minX, pts[i]!);
      maxX = Math.max(maxX, pts[i]!);
      minY = Math.min(minY, pts[i + 1]!);
      maxY = Math.max(maxY, pts[i + 1]!);
    }
    const pad = (o.strokeWidth ?? 0) / 2;
    return {
      x: minX - pad,
      y: minY - pad,
      w: Math.max(minSize, maxX - minX + pad * 2),
      h: Math.max(minSize, maxY - minY + pad * 2),
      points: pts,
    };
  }
  const c = shapeCenter(o);
  const nc = mapPt(c.x, c.y);
  const absSx = Math.abs(sx);
  const absSy = Math.abs(sy);
  const rot = shapeRotation(o);
  if (!rot) {
    const nw = Math.max(minSize, o.w * absSx);
    const nh = Math.max(minSize, o.h * absSy);
    return { x: nc.x - nw / 2, y: nc.y - nh / 2, w: nw, h: nh };
  }
  const aabb = rotatedAabb(o);
  const targetW = Math.max(minSize, aabb.w * absSx);
  const targetH = Math.max(minSize, aabb.h * absSy);
  const size = unrotatedSizeMatchingAabb(targetW, targetH, rot, o.w, o.h, absSx, absSy);
  const nw = Math.max(minSize, size.w);
  const nh = Math.max(minSize, size.h);
  return { x: nc.x - nw / 2, y: nc.y - nh / 2, w: nw, h: nh };
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

/**
 * Orbit a shape around a world pivot. Pens/arrows bake the turn into points;
 * boxes keep size and add `deltaDeg` to `rotation`.
 */
export function rotateShapeAround(
  o: {
    x: number;
    y: number;
    w: number;
    h: number;
    type: string;
    points?: number[];
    strokeWidth?: number;
    rotation?: number;
  },
  cx: number,
  cy: number,
  deltaDeg: number
): { x: number; y: number; w?: number; h?: number; points?: number[]; rotation?: number } {
  if (!deltaDeg) {
    return { x: o.x, y: o.y, rotation: o.rotation };
  }
  if (o.type === 'pen' || o.type === 'arrow') {
    const pts = rotatePointsAround(o.points ?? [], cx, cy, deltaDeg);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      minX = Math.min(minX, pts[i]!);
      maxX = Math.max(maxX, pts[i]!);
      minY = Math.min(minY, pts[i + 1]!);
      maxY = Math.max(maxY, pts[i + 1]!);
    }
    if (!Number.isFinite(minX)) return { x: o.x, y: o.y, rotation: 0 };
    const pad = (o.strokeWidth ?? 2) / 2 + 2;
    return {
      points: pts,
      x: minX - pad,
      y: minY - pad,
      w: maxX - minX + pad * 2,
      h: maxY - minY + pad * 2,
      rotation: 0,
    };
  }
  const ocx = o.x + o.w / 2;
  const ocy = o.y + o.h / 2;
  const rad = degToRad(deltaDeg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = ocx - cx;
  const dy = ocy - cy;
  return {
    x: cx + dx * cos - dy * sin - o.w / 2,
    y: cy + dx * sin + dy * cos - o.h / 2,
    rotation: shapeRotation(o) + deltaDeg,
  };
}
