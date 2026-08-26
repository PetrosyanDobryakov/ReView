import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

/** Optional overrides: REVIEW_UI_PORT / REVIEW_SYNC_PORT / REVIEW_HOST (defaults 5173 / 1234 / 0.0.0.0). */
const uiPort = process.env.REVIEW_UI_PORT || '5173';
const syncPort = process.env.REVIEW_SYNC_PORT || '1234';
const host = process.env.REVIEW_HOST || '0.0.0.0';

const withNetLog = process.argv.includes('--log') || process.argv.includes('--net-log') || process.env.REVIEW_NET_LOG === '1';
const serverEnv = { ...process.env, REVIEW_SYNC_PORT: syncPort, REVIEW_HOST: host, ...(withNetLog ? { REVIEW_NET_LOG: '1' } : {}) };
const viteEnv = { ...process.env, VITE_SYNC_PORT: syncPort, ...(withNetLog ? { VITE_NET_LOG: '1', REVIEW_NET_LOG: '1' } : {}) };

const server = spawn(process.execPath, ['server.mjs'], {
  cwd: root,
  stdio: 'inherit',
  env: serverEnv,
});
const vite = spawn(process.execPath, [viteBin, '--host', host, '--port', uiPort, '--strictPort'], {
  cwd: root,
  stdio: 'inherit',
  env: viteEnv,
});

function shutdown() {
  if (!server.killed) server.kill();
  if (!vite.killed) vite.kill();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

vite.on('exit', (code) => {
  if (!server.killed) server.kill();
  process.exit(code ?? 0);
});
