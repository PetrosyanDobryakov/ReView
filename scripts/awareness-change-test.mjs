/**
 * Awareness change local-only helper.
 */
import assert from 'node:assert/strict';
import { awarenessChangeIsLocalOnly } from '../src/net/awarenessChange.ts';

assert.equal(
  awarenessChangeIsLocalOnly({ updated: [7] }, 7),
  true,
  'single local update'
);
assert.equal(
  awarenessChangeIsLocalOnly({ added: [7], updated: [7], removed: [] }, 7),
  true,
  'local-only mix'
);
assert.equal(
  awarenessChangeIsLocalOnly({ updated: [7, 9] }, 7),
  false,
  'remote in updated'
);
assert.equal(
  awarenessChangeIsLocalOnly({ updated: [] }, 7),
  false,
  'empty change is not local-only skip'
);
assert.equal(
  awarenessChangeIsLocalOnly({ removed: [3] }, 7),
  false,
  'remote remove'
);

console.log('awareness-change: all checks passed');
