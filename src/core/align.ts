import type { ShapeBox, ShapeType, ShapeView } from './shapes';
import { arrowBounds } from './shapes';
import { rotatedAabb } from './transform';

/**
 * Snap / single-select align guides only use media-like containers
 * (photos, video, PDFs, tables, frames) — not freehand ink or ordinary shapes.
 */
export const ALIGN_SNAP_TARGET_TYPES: ReadonlySet<ShapeType> = new Set([
  'image',
  'video',
  'doc',
  'table',
  'frame',
]);

export function isAlignSnapTarget(type: ShapeType): boolean {
  return ALIGN_SNAP_TARGET_TYPES.has(type);
}

/** World AABB of a shape, including rotation and arrow curves. */
export function visualBox(v: ShapeView): ShapeBox {
  if (v.type === 'arrow') return arrowBounds(v);
  return rotatedAabb(v);
}

export type AlignGuide = {
  orientation: 'v' | 'h';
  pos: number;
  a0: number;
  a1: number;
  b0: number;
  b1: number;
};

export type SnapResult = {
  dx: number;
  dy: number;
  guides: AlignGuide[];
};

export type AlignKind =
  | 'left'
  | 'centerH'
  | 'right'
  | 'top'
  | 'centerV'
  | 'bottom'
  | 'distributeH'
  | 'distributeV';

export function groupBox(views: ShapeView[]): ShapeBox | null {
  if (!views.length) return null;
  let x = Infinity;
  let y = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of views) {
    const b = visualBox(v);
    x = Math.min(x, b.x);
    y = Math.min(y, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x, y, w: maxX - x, h: maxY - y };
}

export function computeSnap(
  movingBox: ShapeBox,
  others: ShapeBox[],
  threshold: number
): SnapResult {
  if (!others.length) return { dx: 0, dy: 0, guides: [] };

  let bestDx = 0;
  let bestDy = 0;
  let bestDxScore = Infinity;
  let bestDyScore = Infinity;
  const guides: AlignGuide[] = [];

  const mLeft = movingBox.x;
  const mCenterX = movingBox.x + movingBox.w / 2;
  const mRight = movingBox.x + movingBox.w;
  const mTop = movingBox.y;
  const mCenterY = movingBox.y + movingBox.h / 2;
  const mBottom = movingBox.y + movingBox.h;

  for (const o of others) {
    const oLeft = o.x;
    const oCenterX = o.x + o.w / 2;
    const oRight = o.x + o.w;
    const oTop = o.y;
    const oCenterY = o.y + o.h / 2;
    const oBottom = o.y + o.h;

    const candX: Array<[number, number]> = [
      [oLeft - mLeft, oLeft],
      [oCenterX - mCenterX, oCenterX],
      [oRight - mRight, oRight],
      [oLeft - mCenterX, oLeft],
      [oRight - mCenterX, oRight],
      [oCenterX - mLeft, oCenterX],
      [oCenterX - mRight, oCenterX],
      [oLeft - mRight, oLeft],
      [oRight - mLeft, oRight],
    ];
    for (const [dx] of candX) {
      const score = Math.abs(dx);
      if (score < threshold && score < bestDxScore) {
        bestDxScore = score;
        bestDx = dx;
      }
    }
    const candY: Array<[number, number]> = [
      [oTop - mTop, oTop],
      [oCenterY - mCenterY, oCenterY],
      [oBottom - mBottom, oBottom],
      [oTop - mCenterY, oTop],
      [oBottom - mCenterY, oBottom],
      [oCenterY - mTop, oCenterY],
      [oCenterY - mBottom, oCenterY],
      [oTop - mBottom, oTop],
      [oBottom - mTop, oBottom],
    ];
    for (const [dy] of candY) {
      const score = Math.abs(dy);
      if (score < threshold && score < bestDyScore) {
        bestDyScore = score;
        bestDy = dy;
      }
    }
  }

  // second pass to collect guides for best deltas
  const snappedX = movingBox.x + bestDx;
  const snappedCenterX = movingBox.x + movingBox.w / 2 + bestDx;
  const snappedRight = movingBox.x + movingBox.w + bestDx;
  const snappedY = movingBox.y + bestDy;
  const snappedCenterY = movingBox.y + movingBox.h / 2 + bestDy;
  const snappedBottom = movingBox.y + movingBox.h + bestDy;

  if (bestDxScore !== Infinity) {
    for (const o of others) {
      const oLeft = o.x;
      const oCenterX = o.x + o.w / 2;
      const oRight = o.x + o.w;
      const vals = new Set([oLeft, oCenterX, oRight]);
      const snapVals = new Set([snappedX, snappedCenterX, snappedRight]);
      for (const v of vals) {
        if (snapVals.has(v)) {
          guides.push({
            orientation: 'v',
            pos: v,
            a0: Math.min(movingBox.y + bestDy, o.y),
            a1: Math.max(movingBox.y + bestDy + movingBox.h, o.y + o.h),
            b0: o.y,
            b1: o.y + o.h,
          });
          break;
        }
      }
      if (guides.some((g) => g.orientation === 'v')) break;
    }
    // fallback simple guide if none matched exact
    if (!guides.some((g) => g.orientation === 'v')) {
      guides.push({
        orientation: 'v',
        pos: snappedX,
        a0: snappedY,
        a1: snappedY + movingBox.h,
        b0: snappedY,
        b1: snappedY + movingBox.h,
      });
    }
  }
  if (bestDyScore !== Infinity) {
    for (const o of others) {
      const oTop = o.y;
      const oCenterY = o.y + o.h / 2;
      const oBottom = o.y + o.h;
      const vals = new Set([oTop, oCenterY, oBottom]);
      const snapVals = new Set([snappedY, snappedCenterY, snappedBottom]);
      for (const v of vals) {
        if (snapVals.has(v)) {
          guides.push({
            orientation: 'h',
            pos: v,
            a0: Math.min(movingBox.x + bestDx, o.x),
            a1: Math.max(movingBox.x + bestDx + movingBox.w, o.x + o.w),
            b0: o.x,
            b1: o.x + o.w,
          });
          break;
        }
      }
      if (guides.some((g) => g.orientation === 'h')) break;
    }
    if (!guides.some((g) => g.orientation === 'h')) {
      guides.push({
        orientation: 'h',
        pos: snappedY,
        a0: snappedX,
        a1: snappedX + movingBox.w,
        b0: snappedX,
        b1: snappedX + movingBox.w,
      });
    }
  }

  // keep at most 2 guides
  const vGuide = guides.find((g) => g.orientation === 'v') ?? null;
  const hGuide = guides.find((g) => g.orientation === 'h') ?? null;
  const filtered: AlignGuide[] = [];
  if (vGuide) filtered.push(vGuide);
  if (hGuide) filtered.push(hGuide);
  return { dx: bestDx, dy: bestDy, guides: filtered };
}

export function alignViews(
  targets: ShapeView[],
  others: ShapeView[],
  kind: AlignKind
): Array<[string, Partial<ShapeView>]> {
  if (!targets.length) return [];
  const targetBox = groupBox(targets);
  if (!targetBox) return [];

  const refBox = others.length ? groupBox(others) : null;

  const patches: Array<[string, Partial<ShapeView>]> = [];

  if (kind === 'left') {
    if (refBox) {
      const dx = refBox.x - targetBox.x;
      for (const v of targets) patches.push([v.id, { x: v.x + dx }]);
    } else if (targets.length >= 2) {
      const left = targetBox.x;
      for (const v of targets) {
        const b = visualBox(v);
        patches.push([v.id, { x: v.x + (left - b.x) }]);
      }
    }
  } else if (kind === 'right') {
    if (refBox) {
      const dx = refBox.x + refBox.w - (targetBox.x + targetBox.w);
      for (const v of targets) patches.push([v.id, { x: v.x + dx }]);
    } else if (targets.length >= 2) {
      const right = targetBox.x + targetBox.w;
      for (const v of targets) {
        const b = visualBox(v);
        patches.push([v.id, { x: v.x + (right - (b.x + b.w)) }]);
      }
    }
  } else if (kind === 'centerH') {
    if (refBox) {
      const dx = refBox.x + refBox.w / 2 - (targetBox.x + targetBox.w / 2);
      for (const v of targets) patches.push([v.id, { x: v.x + dx }]);
    } else if (targets.length >= 2) {
      const center = targetBox.x + targetBox.w / 2;
      for (const v of targets) {
        const b = visualBox(v);
        patches.push([v.id, { x: v.x + (center - (b.x + b.w / 2)) }]);
      }
    }
  } else if (kind === 'top') {
    if (refBox) {
      const dy = refBox.y - targetBox.y;
      for (const v of targets) patches.push([v.id, { y: v.y + dy }]);
    } else if (targets.length >= 2) {
      const top = targetBox.y;
      for (const v of targets) {
        const b = visualBox(v);
        patches.push([v.id, { y: v.y + (top - b.y) }]);
      }
    }
  } else if (kind === 'bottom') {
    if (refBox) {
      const dy = refBox.y + refBox.h - (targetBox.y + targetBox.h);
      for (const v of targets) patches.push([v.id, { y: v.y + dy }]);
    } else if (targets.length >= 2) {
      const bottom = targetBox.y + targetBox.h;
      for (const v of targets) {
        const b = visualBox(v);
        patches.push([v.id, { y: v.y + (bottom - (b.y + b.h)) }]);
      }
    }
  } else if (kind === 'centerV') {
    if (refBox) {
      const dy = refBox.y + refBox.h / 2 - (targetBox.y + targetBox.h / 2);
      for (const v of targets) patches.push([v.id, { y: v.y + dy }]);
    } else if (targets.length >= 2) {
      const center = targetBox.y + targetBox.h / 2;
      for (const v of targets) {
        const b = visualBox(v);
        patches.push([v.id, { y: v.y + (center - (b.y + b.h / 2)) }]);
      }
    }
  } else if (kind === 'distributeH') {
    if (targets.length < 3) return [];
    const sorted = [...targets].sort((a, b) => visualBox(a).x - visualBox(b).x);
    const boxes = sorted.map(visualBox);
    const minX = Math.min(...boxes.map((b) => b.x));
    const maxR = Math.max(...boxes.map((b) => b.x + b.w));
    const totalW = boxes.reduce((s, b) => s + b.w, 0);
    const gap = (maxR - minX - totalW) / (sorted.length - 1);
    let cur = minX;
    for (let i = 0; i < sorted.length; i++) {
      const v = sorted[i]!;
      const b = boxes[i]!;
      patches.push([v.id, { x: v.x + (cur - b.x) }]);
      cur += b.w + gap;
    }
  } else if (kind === 'distributeV') {
    if (targets.length < 3) return [];
    const sorted = [...targets].sort((a, b) => visualBox(a).y - visualBox(b).y);
    const boxes = sorted.map(visualBox);
    const minY = Math.min(...boxes.map((b) => b.y));
    const maxB = Math.max(...boxes.map((b) => b.y + b.h));
    const totalH = boxes.reduce((s, b) => s + b.h, 0);
    const gap = (maxB - minY - totalH) / (sorted.length - 1);
    let cur = minY;
    for (let i = 0; i < sorted.length; i++) {
      const v = sorted[i]!;
      const b = boxes[i]!;
      patches.push([v.id, { y: v.y + (cur - b.y) }]);
      cur += b.h + gap;
    }
  }

  // Local-space polylines: x/y translation is enough — points follow on read.
  return patches;
}
