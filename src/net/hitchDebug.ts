/**
 * netDebug hitch probes: awareness receive gaps, long tasks, slow peer paints.
 * Silent unless net logging is on — leave behind for future stutter hunts.
 */

import { isNetLogEnabled, netLog } from './log';

const GAP_BUCKETS_MS = [16, 33, 50, 100, 250] as const;
const GAP_SUMMARY_MS = 5000;
const GAP_WARN_MS = 50;
const RENDER_WARN_MS = 40;
const LONGTASK_WARN_MS = 50;
const RENDER_WARN_COOLDOWN_MS = 2000;

type GapHist = {
  /** Counts for gaps in (prev, bucket] — last bucket is > previous. */
  counts: number[];
  /** Gaps above the last named bucket. */
  over: number;
  maxGap: number;
  samples: number;
  windowStarted: number;
};

let gapHist: GapHist | null = null;
let lastAwareAt = 0;
let longTaskObserver: PerformanceObserver | null = null;
let hitchBooted = false;
let lastRenderWarnAt = 0;

function emptyHist(now: number): GapHist {
  return {
    counts: GAP_BUCKETS_MS.map(() => 0),
    over: 0,
    maxGap: 0,
    samples: 0,
    windowStarted: now,
  };
}

function bucketGap(dt: number, hist: GapHist): void {
  hist.samples += 1;
  if (dt > hist.maxGap) hist.maxGap = dt;
  for (let i = 0; i < GAP_BUCKETS_MS.length; i++) {
    if (dt <= GAP_BUCKETS_MS[i]) {
      hist.counts[i] += 1;
      return;
    }
  }
  hist.over += 1;
}

/** Call on every awareness change (before emitPeers). */
export function noteAwarenessReceive(now = typeof performance !== 'undefined' ? performance.now() : Date.now()): void {
  if (!isNetLogEnabled()) {
    lastAwareAt = now;
    return;
  }
  if (lastAwareAt > 0) {
    const dt = now - lastAwareAt;
    if (!gapHist) gapHist = emptyHist(now);
    bucketGap(dt, gapHist);
    if (dt >= GAP_WARN_MS) {
      netLog.warn('awareness receive gap', () => ({ dtMs: Math.round(dt) }));
    }
    if (now - gapHist.windowStarted >= GAP_SUMMARY_MS) {
      const h = gapHist;
      netLog.info('awareness gap 5s', () => ({
        samples: h.samples,
        maxMs: Math.round(h.maxGap),
        bucketsMs: Object.fromEntries([
          ...GAP_BUCKETS_MS.map((b, i) => [`<=${b}`, h.counts[i]]),
          [`>${GAP_BUCKETS_MS[GAP_BUCKETS_MS.length - 1]}`, h.over],
        ]),
      }));
      gapHist = emptyHist(now);
    }
  }
  lastAwareAt = now;
}

/** Call from the engine loop when a peer-driven paint frame is slow. */
export function notePeerRenderDt(
  dtSec: number,
  meta: { peersAnimating: boolean; dirty: boolean; peerCount: number; shapeCount: number }
): void {
  if (!isNetLogEnabled() || !meta.peersAnimating) return;
  const dtMs = dtSec * 1000;
  if (dtMs < RENDER_WARN_MS) return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now - lastRenderWarnAt < RENDER_WARN_COOLDOWN_MS) return;
  lastRenderWarnAt = now;
  netLog.warn('peer paint frame', () => ({
    dtMs: Math.round(dtMs),
    ...meta,
  }));
}

/** Long-task observer — boot once when net debug is on. */
export function bootHitchDebug(): void {
  if (hitchBooted || typeof PerformanceObserver === 'undefined') return;
  if (!isNetLogEnabled()) return;
  hitchBooted = true;
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      if (!isNetLogEnabled()) return;
      for (const entry of list.getEntries()) {
        if (entry.duration < LONGTASK_WARN_MS) continue;
        netLog.warn('longtask', () => ({
          dtMs: Math.round(entry.duration),
          name: entry.name,
          startTime: Math.round(entry.startTime),
        }));
      }
    });
    longTaskObserver.observe({ type: 'longtask', buffered: true } as PerformanceObserverInit);
  } catch {
    // Safari / older engines may lack longtask.
    longTaskObserver = null;
  }
}

/** Test helper — reset gap state between cases. */
export function resetHitchDebugForTests(): void {
  gapHist = null;
  lastAwareAt = 0;
}

/** Test helper — classify a gap into histogram without logging. */
export function classifyGapForTests(dt: number): { bucket: string } {
  for (const b of GAP_BUCKETS_MS) {
    if (dt <= b) return { bucket: `<=${b}` };
  }
  return { bucket: `>${GAP_BUCKETS_MS[GAP_BUCKETS_MS.length - 1]}` };
}
