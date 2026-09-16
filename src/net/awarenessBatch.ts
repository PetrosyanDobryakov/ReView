/**
 * Coalesce high-frequency awareness fields into one setLocalState per frame.
 *
 * y-protocols' setLocalStateField emits an update (and y-websocket sends a WS
 * frame) per call. While drawing, cursor + draft were two messages per tick —
 * flooding the Durable Object and arriving as jagged bursts on peers.
 */

export type AwarenessPatch = Record<string, unknown>;

export type AwarenessScheduler = (flush: () => void) => () => void;

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
  private readonly apply: (patch: AwarenessPatch) => void;
  private readonly schedule: AwarenessScheduler;

  constructor(
    apply: (patch: AwarenessPatch) => void,
    schedule: AwarenessScheduler = defaultAwarenessScheduler
  ) {
    this.apply = apply;
    this.schedule = schedule;
  }

  /** Merge fields; flush on the next animation frame (or test scheduler). */
  queue(fields: AwarenessPatch): void {
    Object.assign(this.pending, fields);
    if (this.scheduled) return;
    this.scheduled = true;
    this.cancel = this.schedule(() => {
      this.scheduled = false;
      this.cancel = null;
      this.flushPending();
    });
  }

  /** Push pending fields immediately (clears, teardown, tests). */
  flushNow(): void {
    if (this.cancel) {
      this.cancel();
      this.cancel = null;
    }
    this.scheduled = false;
    this.flushPending();
  }

  clear(): void {
    if (this.cancel) {
      this.cancel();
      this.cancel = null;
    }
    this.scheduled = false;
    this.pending = {};
  }

  /** Test helper — pending keys before a flush. */
  pendingKeys(): string[] {
    return Object.keys(this.pending);
  }

  private flushPending(): void {
    const patch = this.pending;
    this.pending = {};
    if (!Object.keys(patch).length) return;
    this.apply(patch);
  }
}
