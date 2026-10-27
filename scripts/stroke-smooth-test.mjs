/**
 * Unit checks for the stylus stabilizer (One Euro filter):
 * raw bypass, tremor damping at rest, tracking at speed, per-stroke reset.
 * Run: node --experimental-strip-types scripts/stroke-smooth-test.mjs
 */
import assert from 'node:assert/strict';
import { createStrokeSmoother } from '../src/core/strokeSmooth.ts';

// --- bypass at 0 ---------------------------------------------------------------
{
  const f = createStrokeSmoother(0);
  assert.deepEqual(f.push(10, 20), { x: 10, y: 20 });
  assert.deepEqual(f.push(11, 22), { x: 11, y: 22 });
}

// --- first push seeds -----------------------------------------------------------
{
  const f = createStrokeSmoother(80);
  assert.deepEqual(f.push(5, 5), { x: 5, y: 5 });
}

// --- tremor at rest is damped ----------------------------------------------------
{
  const f = createStrokeSmoother(80);
  f.push(100, 100);
  let maxDev = 0;
  // Deterministic jitter around a fixed point (no time control in node —
  // performance.now exists, dt varies, but damping must still bound it).
  const seq = [0.4, -0.3, 0.5, -0.45, 0.35, -0.2, 0.15, -0.1, 0.05, -0.05];
  for (const j of seq) {
    const p = f.push(100 + j, 100 - j);
    maxDev = Math.max(maxDev, Math.abs(p.x - 100), Math.abs(p.y - 100));
  }
  assert.ok(maxDev < 0.3, `tremor damped, maxDev=${maxDev}`);
}

// --- fast motion still tracks (no heavy lag) --------------------------------------
{
  const f = createStrokeSmoother(60);
  f.push(0, 0);
  let last = { x: 0, y: 0 };
  for (let i = 1; i <= 30; i++) last = f.push(i * 10, 0);
  // After a sustained run the filter must sit close to the leading edge.
  assert.ok(Math.abs(last.x - 300) < 25, `tracks at speed, x=${last.x}`);
}

// --- reset reseeds -----------------------------------------------------------------
{
  const f = createStrokeSmoother(80);
  f.push(0, 0);
  f.push(50, 50);
  f.reset();
  assert.deepEqual(f.push(999, 1), { x: 999, y: 1 });
}

console.log('stroke-smooth-test: ok');
