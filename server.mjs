/**
 * Launcher only. The Yjs sync server is the Rust binary `review-sync`.
 * This file exists so an old `node server.mjs` cannot boot the TypeScript stack.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const launcher = path.join(root, 'scripts', 'rust-server.mjs');
const child = spawn(process.execPath, [launcher, ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

function forward(signal) {
  if (!child.killed) child.kill(signal);
}

process.on('SIGINT', () => forward('SIGINT'));
process.on('SIGTERM', () => forward('SIGTERM'));
child.on('exit', (code) => process.exit(code ?? 0));
