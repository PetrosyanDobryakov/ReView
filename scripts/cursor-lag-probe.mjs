/**
 * Cursor-lag probe: two headless browsers meet (any path, default Nostr-only
 * like relay-e2e), A moves the cursor in steps with holds, B samples what it
 * sees. Reports per-step delivery lag and whether any sent position only
 * appeared after the NEXT move (the "one step behind" symptom).
 *
 *   npm run build && node scripts/cursor-lag-probe.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const clean = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\.\.+/g, '');
  let file = path.join(dist, clean);
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(dist, 'index.html');
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const board = `cursorlag${Date.now().toString(36)}`;

const browser = await chromium.launch();
let code = 1;
try {
  const forceRelay = process.env.RELAY_ONLY === '1';
  const pages = [];
  for (let i = 0; i < 2; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    if (forceRelay) await ctx.addInitScript(() => localStorage.setItem('REVIEW_FORCE_HUB_LINK', '1'));
    pages.push(await ctx.newPage());
  }
  const [a, b] = pages;
  for (const p of [a, b]) {
    p.on('pageerror', (e) => console.error('pageerror', e.message));
    await p.goto(`${base}/board/${board}`);
    await p.waitForFunction(() => typeof window.reviewP2p === 'function');
  }
  const t0 = Date.now();
  await a.waitForFunction(() => window.reviewP2p().peers.some((p) => p.state === 'open'), null, { timeout: 60_000 });
  console.log(`probe: linked in ${Date.now() - t0} ms`);
  console.log('probe: path', (await a.evaluate(() => window.reviewP2p())).peers.map((p) => p.path).join(','));

  const peers = (p) => p.evaluate(() => (typeof window.__reviewPeers === 'function' ? window.__reviewPeers() : []));
  // Let B learn A's presence first.
  await b.waitForFunction(() => window.__reviewPeers && window.__reviewPeers().length > 0, null, { timeout: 30_000 });

  // A steps through screen points with holds; B samples what it sees.
  const steps = [
    [300, 300],
    [900, 300],
    [900, 600],
    [300, 600],
  ];
  const seen = [];
  const sampler = (async () => {
    const end = Date.now() + steps.length * 2200 + 3000;
    while (Date.now() < end) {
      const list = await peers(b).catch(() => []);
      seen.push({ t: Date.now(), list });
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
  const sent = [];
  await a.mouse.move(640, 100);
  await new Promise((r) => setTimeout(r, 500));
  for (const [x, y] of steps) {
    // Screen px -> world: just move; B compares against A's own reported cursor.
    await a.mouse.move(x, y, { steps: 3 });
    sent.push({ t: Date.now(), x, y });
    await new Promise((r) => setTimeout(r, 2000));
  }
  await sampler;

  // A's own cursor in world coords is unknown here; compare relatively: for
  // each sent step, find the first B-sample whose cursor moved materially
  // after the send (= delivery), and check the previous sample (= staleness).
  let stuck = 0;
  for (let i = 0; i < sent.length; i++) {
    const s = sent[i];
    // B samples after send, excluding the peer's pre-existing pose: find first
    // sample at least 1.2s after send (past typical jitter) and report the lag
    // to the first sample that differs from the pose at send time.
    const atSend = [...seen].reverse().find((r) => r.t <= s.t);
    const basePose = atSend && atSend.list[0] ? atSend.list[0] : null;
    let lag = -1;
    for (const r of seen) {
      if (r.t <= s.t || !r.list[0] || !basePose) continue;
      const dx = (r.list[0].x ?? 0) - (basePose.x ?? 0);
      const dy = (r.list[0].y ?? 0) - (basePose.y ?? 0);
      if (Math.hypot(dx, dy) > 5) {
        lag = r.t - s.t;
        break;
      }
    }
    // "One step behind": pose at the NEXT send still equals the pose at this send.
    let stale = false;
    if (i + 1 < sent.length) {
      const next = sent[i + 1];
      const near = seen.filter((r) => r.t > s.t + 300 && r.t <= next.t);
      if (near.length > 3 && basePose && near.every((r) => {
        const p = r.list[0];
        if (!p || p.x === null) return false;
        return Math.hypot(p.x - basePose.x, p.y - basePose.y) <= 5;
      })) {
        stale = true;
        stuck += 1;
      }
    }
    console.log(`probe: step ${i} lag=${lag}ms staleUntilNextMove=${stale}`);
  }
  console.log(`probe: stale steps: ${stuck}/${sent.length - 1}`);
  code = 0;
  console.log('probe: OK');
} catch (e) {
  console.error('probe: FAIL', e.message);
} finally {
  await browser.close();
  server.close();
}
process.exit(code);
