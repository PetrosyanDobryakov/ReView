/**
 * Boot `cloudflare/worker.ts` under `wrangler dev` (local workerd) with a
 * throwaway config: no [build] step, assets from `assetsDir`.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function startCfDev({ assetsDir, hubName = 'test-hub', log = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-cf-'));
  if (!assetsDir) {
    assetsDir = path.join(tmp, 'assets');
    fs.mkdirSync(assetsDir);
    fs.writeFileSync(path.join(assetsDir, 'index.html'), '<!doctype html><title>ReView</title>');
  }
  fs.writeFileSync(
    path.join(tmp, 'wrangler.toml'),
    `name = "review-test"
compatibility_date = "2026-08-29"
main = ${JSON.stringify(path.join(root, 'cloudflare', 'worker.ts'))}
[assets]
directory = ${JSON.stringify(assetsDir)}
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = ["/signal/*", "/lan", "/health", "/healthz"]
[vars]
HUB_NAME = ${JSON.stringify(hubName)}
[[durable_objects.bindings]]
name = "ROOMS"
class_name = "SignalRoom"
[[migrations]]
tag = "v1"
new_sqlite_classes = ["SignalRoom"]
`,
  );
  const port = 22000 + Math.floor(Math.random() * 20000);
  const child = spawn(
    path.join(root, 'node_modules', '.bin', 'wrangler'),
    ['dev', '--config', path.join(tmp, 'wrangler.toml'), '--port', String(port), '--ip', '127.0.0.1',
      '--inspector-port', String(port + 1), '--persist-to', path.join(tmp, 'state'),
      '--show-interactive-dev-session=false'],
    // Own process group: wrangler spawns workerd, and killing only wrangler
    // would leave workerd holding our pipes (the test would never exit).
    { cwd: tmp, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
  );
  let output = '';
  const onData = (d) => {
    output += d;
    if (log) process.stdout.write(`[cf] ${d}`);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const base = `http://127.0.0.1:${port}`;
  const kill = (signal) => {
    try { process.kill(-child.pid, signal); } catch { /* already gone */ }
  };
  const stop = () => {
    kill('SIGTERM');
    child.stdout.destroy();
    child.stderr.destroy();
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  const until = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch { /* not yet */ }
    if (Date.now() > until || child.exitCode != null) {
      stop();
      throw new Error(`wrangler dev did not start\n${output}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return { base, hub: base.replace(/^http/, 'ws'), port, child, kill, stop, output: () => output };
}
