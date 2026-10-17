/**
 * Desktop app <-> browser on one board.
 *
 * Boots the Tauri app (debug build, UI from its embedded host) under the
 * current display (use `xvfb-run` on a headless box) with REVIEW_SELFTEST
 * set, then opens the same board in headless Chromium through the app's
 * host and draws a stroke. The app's self-test passes only when that stroke
 * arrives over a peer link.
 *
 *   npm run build && (cd src-tauri && cargo build) && xvfb-run -a node scripts/desktop-e2e.mjs
 */
import { execSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 4455 + Math.floor(Math.random() * 400);
const board = `desk${Date.now().toString(36)}`;

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return import(pathToFileURL(path.join(globalRoot, 'playwright', 'index.mjs')).href);
  }
}

const app = spawn(path.join(root, 'src-tauri', 'target', 'debug', 'review-desktop'), [], {
  env: {
    ...process.env,
    REVIEW_SELFTEST: '1',
    REVIEW_SELFTEST_BOARD: board,
    REVIEW_DESKTOP_EMBEDDED: '1',
    REVIEW_DESKTOP_PORT: String(port),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let report = null;
app.stdout.on('data', (d) => {
  for (const line of String(d).split('\n')) {
    if (line.startsWith('REVIEW_SELFTEST ')) report = JSON.parse(line.slice('REVIEW_SELFTEST '.length));
  }
});
const appExit = new Promise((r) => app.on('exit', (code) => r(code)));

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
let code = 1;
try {
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${base}/lan`)).ok) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  page.on('pageerror', (e) => console.error('[browser] pageerror', e.message));
  await page.goto(`${base}/board/${board}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.mouse.click(200, 200);
  await page.keyboard.press('KeyP');
  await page.mouse.move(400, 300);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(400 + i * 15, 300 + (i % 3) * 10);
  await page.mouse.up();
  console.log('desktop-e2e: browser drew', await page.evaluate(() => window.__reviewShapeCount()), 'shape(s)');
  const exitCode = await Promise.race([appExit, new Promise((r) => setTimeout(() => r('timeout'), 90_000))]);
  const link = await page.evaluate(() => window.reviewP2p().peers.map((p) => ({ state: p.state, path: p.path })));
  console.log('desktop-e2e: browser links', JSON.stringify(link));
  console.log('desktop-e2e: app report', JSON.stringify(report));
  code = exitCode === 0 && report?.shapesFromPeer > 0 ? 0 : 1;
  console.log(code === 0 ? 'desktop-e2e: OK' : `desktop-e2e: FAIL (app exit ${exitCode})`);
} finally {
  await browser.close();
  if (app.exitCode === null) app.kill('SIGTERM');
}
process.exit(code);
