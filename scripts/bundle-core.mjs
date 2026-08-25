import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const root = fileURLToPath(new URL('..', import.meta.url));

await esbuild.build({
  absWorkingDir: root,
  entryPoints: ['scripts/core-test-entry.ts'],
  outfile: 'scripts/core-bundle.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  logLevel: 'silent',
});
