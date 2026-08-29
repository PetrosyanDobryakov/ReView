import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_P2P_SIGNALING, resolveP2pEnabled } from '../src/net/p2pPolicy.ts';

assert.deepEqual([...DEFAULT_P2P_SIGNALING], ['wss://signaling.yjs.dev']);
assert.equal(
  DEFAULT_P2P_SIGNALING.some((u) => u.includes('herokuapp.com')),
  false,
  'default signaling must not include Heroku',
);

assert.equal(resolveP2pEnabled({ staticHost: true, storedEnabled: false, userSet: false }), true, 'static + old false default → P2P on');
assert.equal(resolveP2pEnabled({ staticHost: true, storedEnabled: false, userSet: true }), false, 'static + explicit off → P2P off');
assert.equal(resolveP2pEnabled({ staticHost: true, storedEnabled: true, userSet: true }), true, 'static + explicit on → P2P on');
assert.equal(resolveP2pEnabled({ staticHost: false, storedEnabled: false, userSet: false }), false, 'LAN default stays off');
assert.equal(resolveP2pEnabled({ staticHost: false, storedEnabled: true, userSet: false }), true, 'LAN opt-in on');
assert.equal(resolveP2pEnabled({ staticHost: false, storedEnabled: false, userSet: true }), false, 'LAN explicit off');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configSrc = readFileSync(path.join(root, 'src/net/config.ts'), 'utf8');
assert.equal(configSrc.includes('herokuapp.com'), false, 'config.ts must not list Heroku signaling');
assert.equal(configSrc.includes('DEFAULT_P2P_SIGNALING'), true, 'config.ts uses DEFAULT_P2P_SIGNALING');

console.log('p2p config: all checks passed');
