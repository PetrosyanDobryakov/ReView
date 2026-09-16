import assert from 'node:assert/strict';
import {
  applyCalcKey,
  calcPublicFromPersisted,
  defaultCalcPersisted,
} from '../src/core/calcEngine.ts';

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

console.log('calc-engine-test: ok');
