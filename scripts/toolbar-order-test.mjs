import assert from 'node:assert/strict';
import {
  CREATE_DEFAULTS,
  MORE_DEFAULTS,
  NAV_DEFAULTS,
  moveToolInOrders,
  readOrders,
} from '../src/core/toolbarOrder.ts';

// fresh / legacy prefs → full defaults, graph parked in the shelf
assert.deepEqual(readOrders(null), {
  nav: [...NAV_DEFAULTS],
  create: [...CREATE_DEFAULTS],
  more: [...MORE_DEFAULTS],
});
assert.deepEqual(readOrders({ nav: ['select'], create: ['pen'] }).more, ['graph'], 'legacy prefs gain the shelf');

// unknown ids dropped, scheme ids never become rows, first group wins dupes
const messy = readOrders({
  nav: ['select', 'nope', 'diamond', 'pen'],
  create: ['pen', 'eraser', 'eraser'],
  more: ['graph', 'triangle', 'select'],
});
assert.deepEqual(messy.nav, ['select', 'pen', 'lasso', 'pan'], 'nav cleaned + backfilled');
assert.deepEqual(messy.create, ['eraser', 'rect', 'ellipse', 'arrow', 'sticky', 'text'], 'create cleaned + backfilled');
assert.deepEqual(messy.more, ['graph'], 'shelf keeps only parkable, no dupes');

// park eraser on the shelf, pull graph out to the strip
let o = readOrders(null);
o = moveToolInOrders(o, 'eraser', 'more', null, false);
assert.ok(!o.create.includes('eraser') && o.more.includes('eraser'), 'eraser parked');
o = moveToolInOrders(o, 'graph', 'create', 'pen', false);
assert.deepEqual(o.create[0], 'graph', 'graph leads create');
assert.ok(!o.more.includes('graph'), 'graph left the shelf');

// reorder inside the shelf
o = moveToolInOrders(o, 'eraser', 'more', null, false);
assert.deepEqual(o.more[o.more.length - 1], 'eraser', 'append to shelf end');

// invalid moves are no-ops (same reference)
assert.equal(moveToolInOrders(o, 'diamond', 'create', null, false), o, 'scheme shapes stay in the submenu');
assert.equal(moveToolInOrders(o, 'nope', 'more', null, false), o, 'unknown ids ignored');
const appended = moveToolInOrders(o, 'pen', 'create', 'nope', false);
assert.equal(appended.create.at(-1), 'pen', 'missing anchor appends');

console.log('toolbar-order: all checks passed');
