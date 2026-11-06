import assert from 'node:assert/strict';
import { byteLengthOf } from '../src/core/boardSize.ts';

/** Mirror of formatBoardWeight in src/core/boardSize.ts — keep in sync. */
function formatBoardWeight(bytes, locale) {
  if (!bytes || bytes <= 0) return '—';
  const kb = bytes / 1024;
  if (kb < 1) {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(bytes) + ' B';
  }
  if (kb < 1024) {
    const digits = kb < 10 ? 1 : 0;
    return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(kb) + ' KB';
  }
  const mb = kb / 1024;
  const digits = mb < 10 ? 1 : 0;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(mb) + ' MB';
}

assert.equal(formatBoardWeight(0, 'en'), '—');
assert.equal(formatBoardWeight(-1, 'en'), '—');
assert.match(formatBoardWeight(500, 'en'), /B$/);
assert.match(formatBoardWeight(2048, 'en'), /KB$/);
assert.match(formatBoardWeight(2.5 * 1024 * 1024, 'en'), /MB$/);
assert.match(formatBoardWeight(2048, 'ru'), /KB$/);

console.log('boardSize: all checks passed');

assert.equal(byteLengthOf(null), 0, 'null');
assert.equal(byteLengthOf('ab'), 4, 'string utf16');
assert.equal(byteLengthOf(1.5), 8, 'number');
assert.equal(byteLengthOf(true), 8, 'boolean');
assert.equal(byteLengthOf(new Uint8Array(10)), 10, 'typed array bytes');
assert.equal(byteLengthOf([1, 'ab']), 12, 'array sums');
assert.equal(byteLengthOf({ a: 'xy', n: 1 }), 2 + 4 + 2 + 8, 'object keys + values');
assert.equal(byteLengthOf({ o: { s: 'z' } }), 2 + (2 + 2), 'nested object');
const cyc = { v: 1 };
cyc.self = cyc;
assert.equal(byteLengthOf(cyc), 2 + 8 + 8, 'cycle counted once');
console.log('byteLengthOf: all checks passed');
