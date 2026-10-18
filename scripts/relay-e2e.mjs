/**
 * Two browsers meet through public Nostr relays only (no review-host hub, no
 * Cloudflare hub): the UI comes from a plain static server, so the default
 * relays are the only way the peers can find each other. Needs internet.
 *
 *   npm run build && node scripts/relay-e2e.mjs
 *
 * HUB_LINK=1: no WebRTC at all; the board's frames go through the relays
 * themselves (the fallback for peers no direct or TURN path can join).
 *
 * TURN_ONLY=1 (build with VITE_HUBS pointing at a hub that serves /turn):
 * the link may use only TURN relay candidates, so it proves the relay path.
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
const turnOnly = process.env.TURN_ONLY === '1';
const hubLink = process.env.HUB_LINK === '1';
// Two contexts: separate storage, so nothing can sync through a shared IndexedDB.
const pages = [];
for (let i = 0; i < 2; i++) {
  const ctx = await browser.newContext();
  if (turnOnly) await ctx.addInitScript(() => localStorage.setItem('REVIEW_ICE_RELAY', '1'));
  if (hubLink) await ctx.addInitScript(() => localStorage.setItem('REVIEW_FORCE_HUB_LINK', '1'));
  pages.push(await ctx.newPage());
}
const [a, b] = pages;
try {
  for (const p of [a, b]) {
    p.on('pageerror', (e) => console.error('pageerror', e.message));
    await p.goto(`${base}/board/${board}`);
    await p.waitForFunction(() => typeof window.reviewP2p === 'function');
  }
  const t0 = Date.now();
  await a.waitForFunction(() => window.reviewP2p().peers.some((p) => p.state === 'open'), null, { timeout: turnOnly ? 90_000 : 45_000 });
  const snap = (await state(a)).p2p;
  console.log(`relay-e2e: linked in ${Date.now() - t0} ms`);
  console.log('relay-e2e: hubs', snap.hubs.map((h) => `${h.url} ${h.state} peers=${h.peers}`).join(', '));
  // Only built-in hubs (relays, plus VITE_HUBS when the build has them): no review-host to meet through.
  if (snap.hubs.some((h) => h.source !== 'preset')) throw new Error('a non-built-in hub was used');
  if (hubLink) {
    if (!(await state(a)).p2p.peers.some((p) => p.path === 'hub')) throw new Error('link is not through the relays');
    console.log('relay-e2e: link runs through the relays (no WebRTC)');
  }
  if (turnOnly) {
    await a.waitForFunction(() => window.reviewP2p().peers.some((p) => p.path === 'relay'), null, { timeout: 15_000 });
    console.log('relay-e2e: link runs through TURN');
  }
  await a.mouse.click(200, 200);
  await a.keyboard.press('KeyP');
  await a.mouse.move(400, 300);
  await a.mouse.down();
  for (let i = 1; i <= 10; i++) await a.mouse.move(400 + i * 15, 300 + (i % 3) * 10);
  await a.mouse.up();
  const t1 = Date.now();
  await b.waitForFunction(() => window.__reviewShapeCount() > 0, null, { timeout: 20_000 });
  console.log(`relay-e2e: stroke arrived in ${Date.now() - t1} ms`);
  // And back the other way.
  await b.mouse.click(300, 500);
  await b.keyboard.press('KeyP');
  await b.mouse.move(300, 500);
  await b.mouse.down();
  for (let i = 1; i <= 10; i++) await b.mouse.move(300 + i * 15, 500 + (i % 3) * 10);
  await b.mouse.up();
  await a.waitForFunction(() => window.__reviewShapeCount() > 1, null, { timeout: 20_000 });
  console.log('relay-e2e: strokes synced both ways');
  // A photo: only its hash is in the board; B pulls the bytes from A.
  const media = (p) => p.evaluate(() => window.__reviewMedia());
  const bytes = await a.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 360;
    c.height = 240;
    const g = c.getContext('2d');
    const px = g.createImageData(360, 240);
    for (let i = 0; i < px.data.length; i++) px.data[i] = i % 4 === 3 ? 255 : (Math.random() * 256) | 0;
    g.putImageData(px, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'photo.png', { type: 'image/png' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: 600, clientY: 400, bubbles: true, cancelable: true }));
    return blob.size;
  });
  const t2 = Date.now();
  for (;;) {
    const m = await media(b);
    if (m.refs >= 1 && m.held === m.refs) break;
    if (Date.now() - t2 > 120_000) throw new Error(`photo did not arrive: ${JSON.stringify(m)}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`relay-e2e: photo ${bytes} B reached B in ${Date.now() - t2} ms (${await media(b).then((m) => m.refs)} refs)`);
  code = 0;
  console.log('relay-e2e: OK');
} catch (e) {
  console.error('relay-e2e: FAIL', e.message);
  for (const p of [a, b]) console.error(JSON.stringify(await state(p).catch(String)));
} finally {
  await browser.close();
  server.close();
}
process.exit(code);
