import assert from 'node:assert/strict';
import {
  applyCalcKey,
  calcPublicFromPersisted,
  defaultCalcPersisted,
} from '../src/core/calcEngine.ts';
import {
  CALC_CSS_ZOOM_FLOOR,
  CALC_LABEL_MIN_SCREEN_PX,
  CALC_MIN_H,
  CALC_MIN_W,
  CALC_REF_H,
  CALC_REF_W,
  calcCssZoom,
  calcFrameScale,
  calcLabelWorldSize,
  clampCalcSize,
} from '../src/core/calcGeometry.ts';
import { calcKeypadRows } from '../src/core/calcKeypad.ts';
import { rotateHandleLocal, rotateHandleOnBox } from '../src/core/transform.ts';

function run(keys) {
  let p = defaultCalcPersisted();
  for (const k of keys) p = applyCalcKey(p, k);
  return calcPublicFromPersisted(p);
}

assert.equal(run(['1', '+', '2', '=']).display, '3');
assert.equal(run(['2', '+', '3', '×', '4', '=']).display, '14');
assert.equal(run(['2', '×', '3', '+', '4', '=']).display, '10');
assert.equal(run(['1', '0', '−', '3', '×', '2', '=']).display, '4');
assert.equal(run(['1', '÷', '0', '=']).display, 'Cannot divide by zero');
assert.equal(run(['9', '√']).display, '3');
assert.equal(run(['1', '±', '√']).display, 'Invalid input');
assert.equal(run(['2', '0', '0', '+', '1', '0', '%', '=']).display, '220');
assert.equal(run(['1', '6', 'n!']).display, '20922789888000');
assert.equal(run(['5', 'MS', 'C', 'MR']).display, '5');
assert.equal(run(['5', 'MS', 'C', 'MC', 'MR']).display, '0');

let p = defaultCalcPersisted();
p = applyCalcKey(p, '1');
p = applyCalcKey(p, '+');
p = applyCalcKey(p, '2');
p = applyCalcKey(p, 'mode-scientific');
const pub = calcPublicFromPersisted(p);
assert.equal(pub.mode, 'scientific');
assert.equal(pub.display, '2');
assert.equal(pub.expr, '');

// Board geometry invariants (resize / layout scale)
assert.deepEqual(clampCalcSize(10, 10), { w: CALC_MIN_W, h: CALC_MIN_H });
assert.deepEqual(clampCalcSize(CALC_REF_W, CALC_REF_H), { w: CALC_REF_W, h: CALC_REF_H });
assert.deepEqual(clampCalcSize(800, 900), { w: 800, h: 900 });
assert.equal(calcFrameScale(CALC_REF_W, CALC_REF_H), 1);
assert.ok(calcFrameScale(CALC_REF_W * 4, CALC_REF_H * 4) > 1);
assert.ok(calcFrameScale(80, 60) >= 0.45);

// Shared zoom floor — overlay + silhouette stop shrinking together
assert.equal(calcCssZoom(0.1, 1), CALC_CSS_ZOOM_FLOOR);
assert.ok(calcCssZoom(1, 1) >= 1);
assert.ok(calcLabelWorldSize(13, 1, 0.2) >= CALC_LABEL_MIN_SCREEN_PX / 0.2);
assert.equal(calcLabelWorldSize(13, 1, 2), 13);

// Keypad layouts stay in sync for silhouette labels
assert.equal(calcKeypadRows('standard').length, 8);
assert.equal(calcKeypadRows('scientific').length, 9);
assert.equal(calcKeypadRows('standard').at(-1)?.[0]?.span, 4);

// Rotate handle placement (Customize toggle)
assert.deepEqual(rotateHandleLocal(100, 80, 10, true), { x: 50, y: -10 });
assert.deepEqual(rotateHandleLocal(100, 80, 10, false), { x: -10, y: 90 });
assert.deepEqual(rotateHandleOnBox({ x: 0, y: 0, w: 100, h: 80 }, 10, true), { x: 50, y: -10 });

console.log('calc-engine-test: ok');
