/**
 * One Euro filter for stylus input (tablet jitter stabilizer).
 *
 * Adaptive low-pass: heavy smoothing at low speed (kills hand tremor),
 * almost none at speed (no corner cutting / lag). Pressure passes through
 * untouched — only coordinates are filtered.
 *
 * Strength 0..100 maps to filter aggression; 0 bypasses (raw input).
 * Pure + stateful via createStrokeSmoother (one per stroke).
 */
export interface StrokeSmoother {
  /** Filtered point (world units). First call seeds and returns raw. */
  push(x: number, y: number): { x: number; y: number };
  reset(): void;
}

interface EuroState {
  x: number;
  y: number;
  dx: number;
  lastT: number;
  active: boolean;
}

function alpha(cutoff: number, freq: number): number {
  const te = 1 / Math.max(1, freq);
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / te);
}

export function createStrokeSmoother(strength: number): StrokeSmoother {
  const s = Math.min(100, Math.max(0, strength || 0));
  const st: EuroState = { x: 0, y: 0, dx: 0, lastT: 0, active: false };
  // 0 → raw; otherwise mincutoff 1.7→0.15, beta 0.05→0.95 across the range.
  const mincutoff = 1.7 - 1.55 * (s / 100);
  const beta = 0.05 + 0.9 * (s / 100);
  const dcutoff = 1;
  return {
    push(x: number, y: number): { x: number; y: number } {
      if (s <= 0) return { x, y };
      const now =
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now() / 1000
          : Date.now() / 1000;
      if (!st.active) {
        st.x = x;
        st.y = y;
        st.dx = 0;
        st.lastT = now;
        st.active = true;
        return { x, y };
      }
      const dt = Math.max(1 / 240, now - st.lastT);
      const freq = Math.min(240, 1 / dt);
      st.lastT = now;
      // Derivative (speed) estimate, then speed-adaptive cutoff.
      const d = { x: (x - st.x) / dt, y: (y - st.y) / dt };
      const aD = alpha(dcutoff, freq);
      st.dx = aD * Math.hypot(d.x, d.y) + (1 - aD) * st.dx;
      const cutoff = mincutoff + beta * st.dx;
      const a = alpha(cutoff, freq);
      st.x = a * x + (1 - a) * st.x;
      st.y = a * y + (1 - a) * st.y;
      return { x: st.x, y: st.y };
    },
    reset(): void {
      st.active = false;
    },
  };
}
