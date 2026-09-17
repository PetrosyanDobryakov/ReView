/**
 * Contract tests for rotate-handle world origin + confetti seam.
 * Geometry mirrors Engine.rotateHandleWorldPos (sibling origin fix).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ROTATE_HANDLE_OFFSET_PX,
  localToWorld,
  rotateHandleLocal,
  rotateHandleOnBox,
} from '../src/core/transform.ts';

const engineSrc = readFileSync(
  fileURLToPath(new URL('../src/engine/Engine.ts', import.meta.url)),
  'utf8'
);
const toolsSrc = readFileSync(
  fileURLToPath(new URL('../src/engine/tools.ts', import.meta.url)),
  'utf8'
);

assert.match(engineSrc, /rotateHandleWorldPos\(hitId/, 'shared world origin API');
assert.match(engineSrc, /triggerConfetti\(/, 'confetti replaces fireworks');
assert.doesNotMatch(engineSrc, /triggerFireworks|private fireworks/, 'glow-orb fireworks gone');
assert.match(toolsSrc, /rotateHandleWorldPos\(rotHit\)\s*\?\?\s*p\.world/, 'tools use live knob origin');
assert.match(toolsSrc, /handleRotateClick\(origin\.x,\s*origin\.y\)/, 'world XY args preserved');
assert.doesNotMatch(toolsSrc, /44\s*\/\s*engine\.camera\.zoom/, 'no hardcoded AABB corner spawn');
// Physics: always shoot up; snappy launch; floaty slow fall; long life.
assert.match(engineSrc, /const aim = -Math\.PI \/ 2/, 'cannon aim locked to world −y (up)');
assert.doesNotMatch(
  engineSrc,
  /atan2\(wy - \(box\.y \+ box\.h \/ 2\)/,
  'no away-from-selection-center aim'
);
assert.match(
  engineSrc,
  /const speed = \(800 \+ Math\.random\(\) \* 500\) \* invZ/,
  'snappy launch speed ~800–1300 px/s'
);
assert.match(engineSrc, /const g = 240 \* invZ/, 'low-ish gravity for floaty fall');
assert.match(engineSrc, /p\.vx \*= Math\.pow\(0\.4, dt\)/, 'horizontal air drag');
assert.match(engineSrc, /p\.vy \*= Math\.pow\(0\.28, dt\)/, 'vertical drag → slow terminal fall');
assert.match(engineSrc, /p\.life -= dt \* 0\.32/, 'longer confetti lifetime');

/** Pure geometry matching rotateHandleWorldPos */
function knobWorld(hitId, zoom, topMiddle, selectionBounds, getView) {
  const s = ROTATE_HANDLE_OFFSET_PX / zoom;
  if (hitId === '__group__') {
    if (!selectionBounds) return null;
    return rotateHandleOnBox(selectionBounds, s, topMiddle);
  }
  const v = getView(hitId);
  if (!v) return null;
  const local = rotateHandleLocal(v.w, v.h, s, topMiddle);
  return localToWorld(v, local.x, local.y);
}

const zoom = 1;
const offset = ROTATE_HANDLE_OFFSET_PX / zoom;

{
  const v = { x: 100, y: 200, w: 80, h: 40, rotation: 0, type: 'rect' };
  const o = knobWorld('s1', zoom, false, null, () => v);
  assert.deepEqual(o, { x: 100 - offset, y: 200 + 40 + offset });
}

{
  const v = { x: 100, y: 200, w: 80, h: 40, rotation: 0, type: 'rect' };
  const o = knobWorld('s1', zoom, true, null, () => v);
  assert.deepEqual(o, { x: 140, y: 200 - offset });
}

{
  const v = { x: 0, y: 0, w: 100, h: 50, rotation: 90, type: 'rect' };
  const local = rotateHandleLocal(v.w, v.h, offset, false);
  const expected = localToWorld(v, local.x, local.y);
  const o = knobWorld('rot', zoom, false, null, () => v);
  assert.ok(o);
  assert.ok(Math.hypot(o.x - expected.x, o.y - expected.y) < 1e-9);
}

{
  const box = { x: 10, y: 20, w: 100, h: 60 };
  const o = knobWorld('__group__', zoom, true, box, () => undefined);
  assert.deepEqual(o, { x: 60, y: 20 - offset });
}

console.log('rotate-effect-origin-test: ok');
