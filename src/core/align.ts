import type { ShapeBox, ShapeView } from './shapes';

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
    x = Math.min(x, v.x);
    y = Math.min(y, v.y);
    maxX = Math.max(maxX, v.x + v.w);
    maxY = Math.max(maxY, v.y + v.h);
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
        a0: snappedY,
        a1: snappedY,
        b0: snappedY,
        b1: snappedY,
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

  // reference box = union of others if exists, else targetBox (center logic still works)
  const refBox = others.length ? groupBox(others) : null;
  if (!refBox && (kind === 'distributeH' || kind === 'distributeV')) return [];

  const patches: Array<[string, Partial<ShapeView>]> = [];

  if (kind === 'left' && refBox) {
    const dx = refBox.x - targetBox.x;
    for (const v of targets) patches.push([v.id, { x: v.x + dx }]);
  } else if (kind === 'right' && refBox) {
    const dx = refBox.x + refBox.w - (targetBox.x + targetBox.w);
    for (const v of targets) patches.push([v.id, { x: v.x + dx }]);
  } else if (kind === 'centerH' && refBox) {
    const dx = refBox.x + refBox.w / 2 - (targetBox.x + targetBox.w / 2);
    for (const v of targets) patches.push([v.id, { x: v.x + dx }]);
  } else if (kind === 'top' && refBox) {
    const dy = refBox.y - targetBox.y;
    for (const v of targets) patches.push([v.id, { y: v.y + dy }]);
  } else if (kind === 'bottom' && refBox) {
    const dy = refBox.y + refBox.h - (targetBox.y + targetBox.h);
    for (const v of targets) patches.push([v.id, { y: v.y + dy }]);
  } else if (kind === 'centerV' && refBox) {
    const dy = refBox.y + refBox.h / 2 - (targetBox.y + targetBox.h / 2);
    for (const v of targets) patches.push([v.id, { y: v.y + dy }]);
  } else if (kind === 'distributeH') {
    if (targets.length < 3) return [];
    const sorted = [...targets].sort((a, b) => a.x - b.x);
    const minX = Math.min(...sorted.map((v) => v.x));
    const maxR = Math.max(...sorted.map((v) => v.x + v.w));
    const totalW = sorted.reduce((s, v) => s + v.w, 0);
    const gap = (maxR - minX - totalW) / (sorted.length - 1);
    let cur = minX;
    for (const v of sorted) {
      patches.push([v.id, { x: cur }]);
      cur += v.w + gap;
    }
  } else if (kind === 'distributeV') {
    if (targets.length < 3) return [];
    const sorted = [...targets].sort((a, b) => a.y - b.y);
    const minY = Math.min(...sorted.map((v) => v.y));
    const maxB = Math.max(...sorted.map((v) => v.y + v.h));
    const totalH = sorted.reduce((s, v) => s + v.h, 0);
    const gap = (maxB - minY - totalH) / (sorted.length - 1);
    let cur = minY;
    for (const v of sorted) {
      patches.push([v.id, { y: cur }]);
      cur += v.h + gap;
    }
  }

  // for points (pen/arrow) we need to shift points as well — caller will handle via patchShapes? Engine's translateSelection does points shift.
  // Here we only move x/y; for pen/arrow we also need to shift points. So enrich patches:
  for (const [id, patch] of patches) {
    const v = targets.find((t) => t.id === id);
    if (v?.points) {
      const nx = patch.x ?? v.x;
      const ny = patch.y ?? v.y;
      const dx = nx - v.x;
      const dy = ny - v.y;
      (patch as any).points = v.points.map((val, i) => val + (i % 2 === 0 ? dx : dy));
    }
  }

  return patches;
}
