import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };

function resolveCommitSha(): string {
  const env =
    process.env.WORKERS_CI_COMMIT_SHA ||
    process.env.CF_PAGES_COMMIT_SHA ||
    process.env.COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    '';
  if (env.trim()) return env.trim().slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

const commitSha = resolveCommitSha();
const buildId = `${pkg.version}+${commitSha}`;

const isTauri = Boolean(process.env.TAURI_ENV_PLATFORM);

export default defineConfig({
  // Tauri expects a quiet terminal when it nests Vite under `tauri dev`.
  clearScreen: !isTauri,
  plugins: [
    react(),
    {
      name: 'review-build-meta',
      transformIndexHtml(html) {
        return html.replace(
          /<meta name="description"[^>]*>/,
          (m) =>
            `${m}\n    <meta name="review-build" content="${buildId}" />\n    <meta name="review-version" content="${pkg.version}" />`
        );
      },
    },
  ],
  define: {
    __REVIEW_COMMIT__: JSON.stringify(commitSha),
    __REVIEW_BUILD__: JSON.stringify(buildId),
  },
  server: {
    host: true,
    port: 5173,
    // Tauri binds to a fixed URL; fail fast if 5173 is taken.
    strictPort: isTauri,
    // LAN / mesh friends hit us by IP; keep host check off for local collab.
    allowedHosts: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  preview: {
    host: true,
    port: 8080,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
