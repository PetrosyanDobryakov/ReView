/**
 * Coalesce high-frequency shape patches during gestures.
 *
 * Light patches (x/y/w/h/rotation/…) flush immediately — cheap on the wire
 * once polylines are shape-local.
 * Heavy patches (points/pressures/src) coalesce ~30 Hz so stroke rewrites
 * cannot explode traffic; live applier keeps local paint at pointer rate.
 */

import type { ShapeView } from './shapes';

export type ShapePatch = Partial<ShapeView>;
export type PatchBatch = Array<[string, ShapePatch]>;

type FlushFn = (batch: PatchBatch) => void;
type LiveFn = (batch: PatchBatch) => void;

/** Max doc sync rate for heavy fields while a gesture is open (~30 Hz). */
const HEAVY_FLUSH_MS = 32;

let gestureDepth = 0;
let pendingHeavy = new Map<string, ShapePatch>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushToDoc: FlushFn | null = null;
let liveApply: LiveFn | null = null;

export function configureWriteGate(opts: { flush: FlushFn; live?: LiveFn | null }): void {
  flushToDoc = opts.flush;
  liveApply = opts.live ?? null;
}

export function beginWriteGesture(): void {
  gestureDepth += 1;
}

export function endWriteGesture(): void {
  gestureDepth = Math.max(0, gestureDepth - 1);
  flushHeavyNow();
}

export function isWriteGestureActive(): boolean {
  return gestureDepth > 0;
}

export function mergeShapePatch(base: ShapePatch, next: ShapePatch): ShapePatch {
  return { ...base, ...next };
}

function isHeavyPatch(patch: ShapePatch): boolean {
  return patch.points !== undefined || patch.pressures !== undefined || patch.src !== undefined;
}

function splitPatch(patch: ShapePatch): { light: ShapePatch | null; heavy: ShapePatch | null } {
  if (!isHeavyPatch(patch)) return { light: patch, heavy: null };
  const light: ShapePatch = { ...patch };
  const heavy: ShapePatch = {};
  if (patch.points !== undefined) {
    heavy.points = patch.points;
    delete light.points;
  }
  if (patch.pressures !== undefined) {
    heavy.pressures = patch.pressures;
    delete light.pressures;
  }
  if (patch.src !== undefined) {
    heavy.src = patch.src;
    delete light.src;
  }
  const lightKeys = Object.keys(light).filter((k) => (light as Record<string, unknown>)[k] !== undefined);
  return {
    light: lightKeys.length ? light : null,
    heavy: Object.keys(heavy).length ? heavy : null,
  };
}

export function enqueuePatches(batch: PatchBatch): void {
  if (!batch.length) return;

  const lightBatch: PatchBatch = [];
  let heavyChanged = false;

  for (const [id, patch] of batch) {
    const { light, heavy } = splitPatch(patch);
    if (light) lightBatch.push([id, light]);
    if (heavy) {
      const prev = pendingHeavy.get(id);
      // Keep latest light geometry with heavy so flush writes a consistent row.
      const mergedLight = light ?? {};
      pendingHeavy.set(
        id,
        prev ? mergeShapePatch(mergeShapePatch(prev, mergedLight), heavy) : mergeShapePatch(mergedLight, heavy)
      );
      heavyChanged = true;
    }
  }

  if (lightBatch.length) {
    liveApply?.(lightBatch);
    flushToDoc?.(lightBatch);
  }

  if (heavyChanged) {
    liveApply?.(snapshotHeavy());
    if (gestureDepth > 0) scheduleHeavyFlush();
    else flushHeavyNow();
  }
}

export function enqueuePatch(id: string, patch: ShapePatch): void {
  enqueuePatches([[id, patch]]);
}

export function flushNow(): void {
  flushHeavyNow();
}

function snapshotHeavy(): PatchBatch {
  const batch: PatchBatch = [];
  for (const [id, patch] of pendingHeavy) batch.push([id, patch]);
  return batch;
}

function clearHeavyTimer(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

function flushHeavyNow(): void {
  clearHeavyTimer();
  if (!pendingHeavy.size || !flushToDoc) return;
  const batch = snapshotHeavy();
  pendingHeavy = new Map();
  flushToDoc(batch);
  if (pendingHeavy.size) liveApply?.(snapshotHeavy());
}

function scheduleHeavyFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushHeavyNow();
  }, HEAVY_FLUSH_MS);
}

/** Test helper — drop pending without writing. */
export function resetWriteGate(): void {
  clearHeavyTimer();
  pendingHeavy = new Map();
  gestureDepth = 0;
}
