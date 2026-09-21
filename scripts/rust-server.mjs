/**
 * Build (incremental) and exec the Rust sync server.
 * `npm run server` / `npm run dev` use this instead of the old Node Yjs process.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const binPath = path.join(root, 'rust', 'target', 'debug', 'review-sync');

export function ensureRustServer() {
  execFileSync(
    'cargo',
    ['build', '--manifest-path', path.join(root, 'rust', 'Cargo.toml'), '-p', 'review-sync'],
    {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        RUSTUP_TOOLCHAIN: process.env.RUSTUP_TOOLCHAIN || 'stable',
      },
    },
  );
  if (!existsSync(binPath)) {
    throw new Error(`review-sync binary missing at ${binPath}`);
  }
  return binPath;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  ensureRustServer();
  const child = spawn(binPath, process.argv.slice(2), {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  const forward = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.on('SIGINT', () => forward('SIGINT'));
  process.on('SIGTERM', () => forward('SIGTERM'));
  child.on('exit', (code) => process.exit(code ?? 0));
}
