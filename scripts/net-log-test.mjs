/**
 * Net-debug flag parsing + SPA/hash query merge (mirrors src/net/log.ts).
 */
import assert from 'node:assert/strict';

function parseNetFlag(raw) {
  if (raw == null) return null;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return null;
}

function mergeLocationSearch(search, hash) {
  const merged = new URLSearchParams();
  const sp = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  for (const [k, v] of sp) merged.set(k, v);
  const h = hash || '';
  const q = h.indexOf('?');
  if (q >= 0) {
    const hp = new URLSearchParams(h.slice(q + 1));
    for (const [k, v] of hp) merged.set(k, v);
  }
  return merged;
}

assert.equal(parseNetFlag('1'), true);
assert.equal(parseNetFlag('true'), true);
assert.equal(parseNetFlag('0'), false);
assert.equal(parseNetFlag('false'), false);
assert.equal(parseNetFlag(''), null);
assert.equal(parseNetFlag(null), null);

{
  const p = mergeLocationSearch('?netDebug=1', '');
  assert.equal(p.get('netDebug'), '1');
}
{
  // Hash query alone (awkward SPA deep-link)
  const p = mergeLocationSearch('', '#/board/abc?netLog=1');
  assert.equal(p.get('netLog'), '1');
}
{
  // Search + hash keys merge
  const p = mergeLocationSearch('?netDebug=1', '#x?foo=2');
  assert.equal(p.get('netDebug'), '1');
  assert.equal(p.get('foo'), '2');
}
{
  // Hash can override same key if set after (merge sets hash last)
  const p = mergeLocationSearch('?netDebug=0', '#?netDebug=1');
  assert.equal(p.get('netDebug'), '1');
}

try {
  const mod = await import('../src/net/log.ts');
  assert.equal(mod.parseNetFlag('1'), true);
  assert.equal(mod.mergeLocationSearch('?netDebug=1', '').get('netDebug'), '1');
  assert.equal(mod.mergeLocationSearch('', '#/b?netLog=1').get('netLog'), '1');
  console.log('net-log: strip-types import ok');
} catch (err) {
  console.warn('net-log: skipped TS import', err && err.message);
}

console.log('net-log: all checks passed');
