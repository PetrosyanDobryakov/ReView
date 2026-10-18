/**
 * Desktop app <-> browser on one board.
 *
 * Starts the Electron app (UI from its embedded review-host, data in a temp
 * folder) and checks what a real session needs from inside the window:
 * WebRTC, the host, board and media files over IPC. Then headless Chromium
 * opens the same board through the app's host and draws a stroke; it has to
 * arrive in the app over a peer link and land in the board file on disk.
 *
 *   npm run test:desktop        (builds UI + review-host first)
 *
 * Needs a display (`xvfb-run -a` on a headless box).
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 4455 + Math.floor(Math.random() * 400);
const board = `desk${Date.now().toString(36)}`;
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'review-desktop-e2e-'));
const fail = (msg) => {
  throw new Error(msg);
};

const app = await _electron.launch({
  args: [root],
  env: { ...process.env, REVIEW_DESKTOP_PORT: String(port), REVIEW_DATA_DIR: dataDir, REVIEW_MDNS: '0' },
});
// CHROMIUM_PATH: a system Chromium when Playwright's own is not installed.
// No mDNS host names: two separate processes cannot resolve them without a multicast responder.
const browser = await chromium.launch({
  args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
let code = 1;
try {
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.error('[app] pageerror', e.message));
  await win.waitForLoadState('load');
  const origin = new URL(win.url()).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) fail(`app did not load from its host: ${win.url()}`);

  const probe = await win.evaluate(async () => {
    const ipc = window.reviewDesktop;
    const out = { webrtc: typeof RTCPeerConnection === 'function' };
    const host = await ipc.invoke('host_info');
    out.host = { port: host.port, service: (await (await fetch(`/lan`)).json()).service };
    await ipc.invoke('board_save', new Uint8Array([1, 2, 3, 4]), {
      'x-board-id': 'selftest',
      'x-board-meta': encodeURIComponent('{"name":"selftest"}'),
    });
    out.boardFile = Array.from(await ipc.invoke('board_load', { id: 'selftest' })).join(',');
    out.boardListed = (await ipc.invoke('board_list')).some((b) => b.id === 'selftest' && b.meta?.name === 'selftest');
    await ipc.invoke('board_delete', { id: 'selftest' });
    const bytes = new Uint8Array([5, 6, 7]);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const hash = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
    await ipc.invoke('blob_save', bytes, { 'x-blob-hash': hash, 'x-blob-mime': 'image/png' });
    const raw = await ipc.invoke('blob_load', { hash });
    const nl = raw.indexOf(10);
    out.blobFile = new TextDecoder().decode(raw.subarray(0, nl)) + '|' + Array.from(raw.subarray(nl + 1)).join(',');
    out.badId = await ipc.invoke('board_load', { id: '../x' }).then(() => 'accepted', () => 'refused');
    return out;
  });
  console.log('desktop-e2e: probe', JSON.stringify(probe));
  if (!probe.webrtc) fail('no WebRTC');
  if (probe.host.port !== port || probe.host.service !== 'review-host') fail('host_info');
  if (probe.boardFile !== '1,2,3,4' || !probe.boardListed) fail('board files');
  if (probe.blobFile !== 'image/png|5,6,7') fail('blob files');
  if (probe.badId !== 'refused') fail('bad board id accepted');

  await win.goto(`${origin}/board/${board}`);
  await win.waitForFunction(() => typeof window.reviewP2p === 'function');

  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  page.on('pageerror', (e) => console.error('[browser] pageerror', e.message));
  await page.goto(`${origin}/board/${board}`);
  await page.waitForFunction(() => typeof window.__reviewShapeCount === 'function');
  await page.waitForTimeout(1500);
  await page.mouse.click(200, 200);
  await page.keyboard.press('KeyP');
  await page.mouse.move(400, 300);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(400 + i * 15, 300 + (i % 3) * 10);
  await page.mouse.up();
  console.log('desktop-e2e: browser drew', await page.evaluate(() => window.__reviewShapeCount()), 'shape(s)');

  const p2p = (pg) => pg.evaluate(() => JSON.stringify({ shapes: window.__reviewShapeCount?.(), p2p: window.reviewP2p?.() })).catch((e) => String(e));
  await win.waitForFunction(() => window.__reviewShapeCount?.() > 0, null, { timeout: 60_000 }).catch(async (e) => {
    console.log('desktop-e2e: app state', await p2p(win));
    console.log('desktop-e2e: browser state', await p2p(page));
    throw e;
  });
  const links = await win.evaluate(() => window.reviewP2p().peers.map((p) => ({ state: p.state, path: p.path })));
  console.log('desktop-e2e: app links', JSON.stringify(links));
  const file = path.join(dataDir, 'boards', `${board}.review`);
  for (let i = 0; i < 40 && !existsSync(file); i++) await new Promise((r) => setTimeout(r, 250));
  if (!existsSync(file)) fail('board file not written');
  code = 0;
  console.log('desktop-e2e: OK');
} catch (e) {
  console.error('desktop-e2e: FAIL', e.message);
} finally {
  await browser.close();
  await app.close().catch(() => {});
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(code);
