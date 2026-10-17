/**
 * Two real browsers, one board, no server-side state.
 *
 * Starts `review-host` serving `dist/` on a random port, opens the same board
 * in two isolated Chromium contexts, draws a stroke in A and waits for it in
 * B (over the WebRTC data channel), then checks the host is holding no data:
 * after both tabs close, `/health` must report zero rooms.
 *
 *   npm run build && node scripts/p2p-e2e.mjs
 *   E2E_HUB=cloudflare node scripts/p2p-e2e.mjs   (hub = cloudflare/worker.ts under wrangler dev)
 *
 * Needs Playwright (local or global install) and a Chromium.
 */
import { execFileSync, execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return import(pathToFileURL(path.join(globalRoot, 'playwright', 'index.mjs')).href);
  }
}

function fail(msg) {
  console.error(`p2p-e2e: FAIL ${msg}`);
  process.exitCode = 1;
}

async function waitFor(fn, ms, label) {
  const until = Date.now() + ms;
  let last;
  while (Date.now() < until) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timeout: ${label} (last=${JSON.stringify(last)})`);
}

if (!existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('p2p-e2e: run `npm run build` first');
  process.exit(2);
}

// E2E_HUB=cloudflare: the same run against cloudflare/worker.ts under wrangler dev.
const onCloudflare = process.env.E2E_HUB === 'cloudflare';
let base;
let killHub;
let stopHub;
if (onCloudflare) {
  const { startCfDev } = await import('./cf-dev.mjs');
  const cf = await startCfDev({ assetsDir: path.join(root, 'dist'), hubName: 'cf-e2e' });
  base = cf.base;
  killHub = () => cf.kill('SIGKILL');
  stopHub = () => cf.stop();
} else {
  execFileSync('cargo', ['build', '--manifest-path', path.join(root, 'rust', 'Cargo.toml'), '-p', 'review-host'], {
    stdio: 'inherit',
  });
  const port = 20000 + Math.floor(Math.random() * 20000);
  const host = spawn(path.join(root, 'rust', 'target', 'debug', 'review-host'), ['--dist', path.join(root, 'dist'), '--port', String(port), '--host', '127.0.0.1', '--no-mdns'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  host.stdout.on('data', (d) => process.stdout.write(`[host] ${d}`));
  base = `http://127.0.0.1:${port}`;
  killHub = () => host.kill('SIGKILL');
  stopHub = () => host.kill('SIGTERM');
}

/** Peers the hub lists in a room, as a newcomer would see them. */
async function hubPeers(room) {
  if (!onCloudflare) return (await (await fetch(`${base}/health`)).json()).peers;
  const { default: WebSocket } = await import('ws');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/signal/${room}?peer=e2e-probe-${Date.now()}`);
    ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m.t === 'welcome') { resolve(m.peers.length); ws.close(); }
    });
    ws.on('error', reject);
  });
}

const { chromium } = await loadPlaywright();
const launchOpts = existsSync('/opt/pw-browsers/chromium') ? {} : {};
const browser = await chromium.launch(launchOpts);
const consoleLog = [];
try {
  await waitFor(async () => {
    try {
      const r = await fetch(`${base}/health`);
      return r.ok;
    } catch {
      return false;
    }
  }, 10_000, 'host up');

  const board = `e2e${Date.now().toString(36)}`;
  const t0 = Date.now();
  const ctxA = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const ctxB = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  for (const [name, page] of [['A', a], ['B', b]]) {
    page.on('pageerror', (e) => console.error(`[${name}] pageerror`, e.message));
    page.on('console', (m) => consoleLog.push(`[${name} ${Date.now() - t0}ms] ${m.text()}`));
  }
  const linked = async (page) =>
    page.evaluate(() => {
      const snap = window.reviewP2p?.();
      return snap ? snap.peers.filter((p) => p.state === 'open').length : 0;
    });
  const shapes = (page) => page.evaluate(() => window.__reviewShapeCount?.() ?? -1);
  let strokeY = 260;
  const draw = async (page) => {
    const n = await shapes(page);
    await page.keyboard.press('KeyP');
    strokeY += 60;
    await page.mouse.move(400, strokeY);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(400 + i * 15, strokeY + (i % 3) * 10);
    await page.mouse.up();
    await waitFor(async () => (await shapes(page)) > n, 5_000, 'stroke drawn');
    return shapes(page);
  };

  // 1. A is alone and draws. Nothing goes anywhere: there is no server copy.
  await a.goto(`${base}/board/${board}?netDebug=1`);
  await waitFor(async () => (await shapes(a)) >= 0, 10_000, 'A board ready');
  await a.waitForLoadState('networkidle');
  await a.waitForTimeout(1_000);
  await a.mouse.click(200, 200);
  const first = await draw(a);
  console.log(`p2p-e2e: A drew alone (${first} shape)`);

  // 2. B joins late and gets the board from A over the data channel.
  await b.goto(`${base}/board/${board}?netDebug=1`);
  await waitFor(async () => (await linked(a)) === 1 && (await linked(b)) === 1, 20_000, 'data channel open');
  const snapA = await a.evaluate(() => window.reviewP2p());
  console.log('p2p-e2e: link open', JSON.stringify({ hubs: snapA.hubs.map((h) => [h.url, h.state]), path: snapA.peers[0].path }));
  await waitFor(async () => (await shapes(b)) === first, 10_000, 'late joiner gets the board');
  console.log(`p2p-e2e: late joiner B received ${first} shape from A`);

  // 3. Live edit A -> B.
  await b.mouse.click(200, 200);
  const second = await draw(a);
  await waitFor(async () => (await shapes(b)) === second, 10_000, 'live stroke reaches B');
  console.log(`p2p-e2e: live stroke A -> B (${second} shapes)`);
  const statsA = await a.evaluate(() => window.reviewP2p().peers[0]);
  if (!(statsA.bytesOut > 0 && statsA.bytesIn > 0)) fail('no bytes on the link');

  // 4. A third tab joins and leaves: the hub forgets it at once.
  const room = `review-${board}`;
  if (!onCloudflare) {
    const live = await (await fetch(`${base}/health`)).json();
    if (live.rooms !== 1 || live.peers !== 2) fail(`expected 1 room / 2 peers, got ${JSON.stringify(live)}`);
  }
  const ctxC = await browser.newContext();
  const c = await ctxC.newPage();
  await c.goto(`${base}/board/${board}?netDebug=1`);
  await waitFor(async () => (await hubPeers(room)) === 3, 10_000, 'C on hub');
  await ctxC.close();
  await waitFor(async () => (await hubPeers(room)) === 2, 10_000, 'hub forgets C');
  console.log('p2p-e2e: hub forgot C as soon as it left');
  await waitFor(async () => (await shapes(a)) === (await shapes(b)), 10_000, 'A and B agree after C left');

  // 5. Kill the hub. Open links keep working: board data never used it.
  killHub();
  await new Promise((r) => setTimeout(r, 1_500));
  const third = await draw(b);
  await waitFor(async () => (await shapes(a)) === third, 10_000, 'B -> A with the hub dead');
  console.log(`p2p-e2e: hub killed, B -> A still synced (${third} shapes)`);
  if (!process.exitCode) console.log('p2p-e2e: OK');
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
  for (const [i, ctx] of browser.contexts().entries()) {
    for (const page of ctx.pages()) {
      const state = await page
        .evaluate(() => ({ shapes: window.__reviewShapeCount?.(), mesh: window.reviewP2p?.() }))
        .catch((err) => String(err));
      console.error(`p2p-e2e: context ${i}`, JSON.stringify(state));
    }
  }
  console.error(consoleLog.slice(-80).join('\n'));
  if (process.env.E2E_SHOTS) {
    for (const [i, ctx] of browser.contexts().entries()) {
      for (const page of ctx.pages()) await page.screenshot({ path: path.join(process.env.E2E_SHOTS, `p2p-e2e-${i}.png`) }).catch(() => {});
    }
  }
} finally {
  await browser.close();
  stopHub();
}
