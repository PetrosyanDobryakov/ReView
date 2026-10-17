/**
 * Build (incremental) and exec `review-host`: the self-hosted web UI server,
 * stateless signaling hub and LAN discovery. It stores no board data.
 * `npm run server` (hub only) / `npm run host` (hub + built UI) / `npm run dev`.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const binPath = path.join(root, 'rust', 'target', 'debug', 'review-host');

export function ensureRustServer() {
  execFileSync(
    'cargo',
    ['build', '--manifest-path', path.join(root, 'rust', 'Cargo.toml'), '-p', 'review-host'],
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
    throw new Error(`review-host binary missing at ${binPath}`);
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
