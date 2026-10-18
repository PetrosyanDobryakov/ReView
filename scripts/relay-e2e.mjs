/**
 * Two browsers meet through public Nostr relays only (no review-host hub, no
 * Cloudflare hub): the UI comes from a plain static server, so the default
 * relays are the only way the peers can find each other. Needs internet.
 *
 *   npm run build && node scripts/relay-e2e.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  const clean = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\.\.+/g, '');
  let file = path.join(dist, clean);
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const board = `relay${Date.now().toString(36)}`;

const browser = await chromium.launch();
let code = 1;
const state = (p) => p.evaluate(() => ({ shapes: window.__reviewShapeCount?.(), p2p: window.reviewP2p?.() }));
const [a, b] = [await browser.newPage(), await browser.newPage()];
try {
  for (const p of [a, b]) {
    p.on('pageerror', (e) => console.error('pageerror', e.message));
    await p.goto(`${base}/board/${board}`);
    await p.waitForFunction(() => typeof window.reviewP2p === 'function');
  }
  const t0 = Date.now();
  await a.waitForFunction(() => window.reviewP2p().peers.some((p) => p.state === 'open'), null, { timeout: 45_000 });
  const snap = (await state(a)).p2p;
  console.log(`relay-e2e: linked in ${Date.now() - t0} ms`);
  console.log('relay-e2e: hubs', snap.hubs.map((h) => `${h.url} ${h.state} peers=${h.peers}`).join(', '));
  if (snap.hubs.some((h) => !h.url.startsWith('nostr+'))) throw new Error('a non-relay hub was used');
  await a.mouse.click(200, 200);
  await a.keyboard.press('KeyP');
  await a.mouse.move(400, 300);
  await a.mouse.down();
  for (let i = 1; i <= 10; i++) await a.mouse.move(400 + i * 15, 300 + (i % 3) * 10);
  await a.mouse.up();
  await b.waitForFunction(() => window.__reviewShapeCount() > 0, null, { timeout: 20_000 });
  code = 0;
  console.log('relay-e2e: stroke arrived over the direct link; OK');
} catch (e) {
  console.error('relay-e2e: FAIL', e.message);
  for (const p of [a, b]) console.error(JSON.stringify(await state(p).catch(String)));
} finally {
  await browser.close();
  server.close();
}
process.exit(code);
