/**
 * Prove which SPA build https://review.zpro-driftman.workers.dev/ actually serves.
 * Usage: node scripts/check-live-version.mjs [expectedVersion]
 */
import assert from 'node:assert/strict';

const BASE = process.env.REVIEW_PREVIEW_URL || 'https://review.zpro-driftman.workers.dev';
const expected = process.argv[2] || null;

const htmlRes = await fetch(BASE + '/', {
  headers: { 'User-Agent': 'review-check-live-version', 'Cache-Control': 'no-cache' },
});
assert.equal(htmlRes.ok, true, `GET / failed ${htmlRes.status}`);
const html = await htmlRes.text();
const meta = html.match(/name="review-build"\s+content="([^"]+)"/);
const metaVer = html.match(/name="review-version"\s+content="([^"]+)"/);
const asset = html.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/);

console.log('url', BASE);
console.log('cf-cache-status', htmlRes.headers.get('cf-cache-status'));
console.log('cache-control', htmlRes.headers.get('cache-control'));
console.log('html_asset', asset?.[1] ?? '(none)');
console.log('meta_review-build', meta?.[1] ?? '(missing — build predates meta tag / stale HTML)');
console.log('meta_review-version', metaVer?.[1] ?? '(missing)');

if (asset) {
  const jsRes = await fetch(`${BASE}/assets/${asset[1]}`, {
    headers: { 'User-Agent': 'review-check-live-version', 'Cache-Control': 'no-cache' },
  });
  assert.equal(jsRes.ok, true, `GET asset failed ${jsRes.status}`);
  const js = await jsRes.text();
  const vers = [...new Set(js.match(/0\.14\.\d+/g) || [])].sort();
  console.log('js_embedded_0.14.x', vers.join(', ') || '(none)');
  console.log('js_has_review-build_string', js.includes(meta?.[1]?.split('+')[0] || '___') || vers.length > 0);
  if (expected) {
    assert.ok(
      vers.includes(expected) || metaVer?.[1] === expected || (meta?.[1] || '').startsWith(expected),
      `expected ${expected} in live JS/meta, got vers=${vers} meta=${meta?.[1]}`
    );
  }
}

if (!meta && !metaVer) {
  console.log(
    'HINT: Workers Builds deployCommand is currently "echo done" — builds succeed but never upload. Set Deploy command to: npx wrangler deploy'
  );
}

console.log('check-live-version: done');
