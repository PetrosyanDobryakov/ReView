/**
 * Desktop app (Electron) helper.
 *
 *   node scripts/desktop.mjs            build review-host + UI, run the app
 *   node scripts/desktop.mjs --dist     same, then package installers into release/
 *   node scripts/desktop.mjs --host     only build review-host into build/bin/
 *
 * `--target <rust-triple>` cross-builds review-host (CI: Intel macOS on Apple runners).
 * Extra args after `--` go to electron-builder (`-- --mac --x64`).
 */
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const dash = argv.indexOf('--');
const own = dash < 0 ? argv : argv.slice(0, dash);
const builderArgs = dash < 0 ? [] : argv.slice(dash + 1);
const target = own.includes('--target') ? own[own.indexOf('--target') + 1] : null;
const win = target ? target.includes('windows') : process.platform === 'win32';
const exe = win ? 'review-host.exe' : 'review-host';
const run = (cmd, args, env = {}) =>
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } });

run('cargo', ['build', '--release', '--manifest-path', 'rust/Cargo.toml', '-p', 'review-host', ...(target ? ['--target', target] : [])]);
const built = path.join(root, 'rust', 'target', ...(target ? [target] : []), 'release', exe);
mkdirSync(path.join(root, 'build', 'bin'), { recursive: true });
copyFileSync(built, path.join(root, 'build', 'bin', exe));
if (own.includes('--host')) process.exit(0);

if (!own.includes('--no-ui') || !existsSync(path.join(root, 'dist', 'index.html'))) run('npm', ['run', 'build']);

if (own.includes('--dist')) {
  run('npx', ['electron-builder', '--publish', 'never', ...builderArgs]);
} else {
  const electron = (await import('electron')).default;
  const child = spawn(electron, ['.'], { cwd: root, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
}
