/**
 * Coalesce high-frequency awareness fields into one setLocalState per flush.
 *
 * y-protocols' setLocalStateField emits an update (and y-websocket sends a WS
 * frame) per call. While drawing, cursor + draft were two messages per tick —
 * flooding the Durable Object and arriving as jagged bursts on peers.
 *
 * Flushes are rAF-coalesced, then rate-floored (~20 Hz) so multiplayer boards
 * cannot wake the hibernatable DO at display refresh. flushNow() bypasses the
 * floor for clears / teardown.
 */

export type AwarenessPatch = Record<string, unknown>;

export type AwarenessScheduler = (flush: () => void) => () => void;

/** Min ms between hot-path flushes (~20 Hz). flushNow() ignores this. */
export const AWARENESS_MIN_FLUSH_MS = 50;

export type AwarenessBatchOptions = {
  minFlushMs?: number;
  /** Injectable clock for tests (defaults to Date.now). */
  now?: () => number;
};

/** rAF when available; otherwise a 16 ms timer (Node / tests). */
export function defaultAwarenessScheduler(flush: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(() => flush());
    return () => {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
    };
  }
  const t = setTimeout(flush, 16);
  return () => clearTimeout(t);
}

export class AwarenessBatch {
  private pending: AwarenessPatch = {};
  private scheduled = false;
  private cancel: (() => void) | null = null;
  private deferTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFlushAt = 0;
  private readonly apply: (patch: AwarenessPatch) => void;
  private readonly schedule: AwarenessScheduler;
  private readonly minFlushMs: number;
  private readonly now: () => number;

  constructor(
    apply: (patch: AwarenessPatch) => void,
    schedule: AwarenessScheduler = defaultAwarenessScheduler,
    opts: AwarenessBatchOptions = {}
  ) {
    this.apply = apply;
    this.schedule = schedule;
    this.minFlushMs = opts.minFlushMs ?? AWARENESS_MIN_FLUSH_MS;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Merge fields; flush on the next animation frame (or test scheduler), rate-floored. */
  queue(fields: AwarenessPatch): void {
    Object.assign(this.pending, fields);
    this.ensureScheduled();
  }

  /** Push pending fields immediately (clears, teardown, tests). Bypasses the rate floor. */
  flushNow(): void {
    this.cancelSchedule();
    this.flushPending();
  }

  clear(): void {
    this.cancelSchedule();
    this.pending = {};
  }

  /** Test helper — pending keys before a flush. */
  pendingKeys(): string[] {
    return Object.keys(this.pending);
  }

  private ensureScheduled(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    this.cancel = this.schedule(() => this.onScheduleTick());
  }

  private onScheduleTick(): void {
    this.cancel = null;
    this.scheduled = false;
    const elapsed = this.now() - this.lastFlushAt;
    if (this.lastFlushAt > 0 && this.minFlushMs > 0 && elapsed < this.minFlushMs) {
      const wait = this.minFlushMs - elapsed;
      this.scheduled = true;
      this.deferTimer = setTimeout(() => {
        this.deferTimer = null;
        this.scheduled = false;
        if (!Object.keys(this.pending).length) return;
        this.flushPending();
      }, wait);
      return;
    }
    this.flushPending();
  }

  private cancelSchedule(): void {
    if (this.cancel) {
      this.cancel();
      this.cancel = null;
    }
    if (this.deferTimer) {
      clearTimeout(this.deferTimer);
      this.deferTimer = null;
    }
    this.scheduled = false;
  }

  private flushPending(): void {
    const patch = this.pending;
    this.pending = {};
    if (!Object.keys(patch).length) return;
    this.lastFlushAt = this.now();
    this.apply(patch);
  }
}
