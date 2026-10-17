import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const root = fileURLToPath(new URL('..', import.meta.url));

await esbuild.build({
  absWorkingDir: root,
  entryPoints: ['scripts/p2p-test-entry.ts'],
  outfile: 'scripts/p2p-bundle.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  // One Yjs instance shared with the test file (Yjs warns on duplicates).
  external: ['yjs'],
  logLevel: 'silent',
});
