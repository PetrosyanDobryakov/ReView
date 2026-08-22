import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

const server = spawn(process.execPath, ['server.mjs'], { cwd: root, stdio: 'inherit' });
const vite = spawn(process.execPath, [viteBin], { cwd: root, stdio: 'inherit' });

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
