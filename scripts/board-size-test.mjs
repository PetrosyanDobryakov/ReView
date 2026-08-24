import assert from 'node:assert/strict';

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
