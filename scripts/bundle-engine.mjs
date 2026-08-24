import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const root = fileURLToPath(new URL('..', import.meta.url));

const stub = fileURLToPath(new URL('./mathjax-stub.mjs', import.meta.url));

await esbuild.build({
  absWorkingDir: root,
  entryPoints: ['scripts/engine-test-entry.ts'],
  outfile: 'scripts/engine-bundle.mjs',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  plugins: [
    {
      name: 'mathjax-stub',
      setup(build) {
        build.onResolve({ filter: /^mathjax-full/ }, () => ({ path: stub }));
      },
    },
  ],
  logLevel: 'silent',
});
