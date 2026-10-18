import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_P2P_SIGNALING, deriveOwnSignalingUrl, resolveP2pEnabled, resolveSignalingUrls } from '../src/net/p2pPolicy.ts';
import { syncReconnectMode } from '../src/net/syncReconnect.ts';

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
assert.equal(syncReconnectMode(true, true), 'bounce', 'enabled same-room reconnect bounces the live socket');
assert.equal(syncReconnectMode(false, true), 'rebuild', 'disconnect does not bounce the live socket back on');
assert.equal(syncReconnectMode(true, false), 'rebuild', 'URL/room change rebuilds the provider');

// Own relay derivation (loopback/LAN sync -> same host, signal port).
assert.equal(deriveOwnSignalingUrl('ws://localhost:1234', '1235'), 'ws://localhost:1235');
assert.equal(deriveOwnSignalingUrl('ws://127.0.0.1:1234', '1235'), 'ws://127.0.0.1:1235');
assert.equal(deriveOwnSignalingUrl('ws://192.168.1.20:1234', '1235'), 'ws://192.168.1.20:1235');
assert.equal(deriveOwnSignalingUrl('ws://10.0.0.5:9999', '1235'), 'ws://10.0.0.5:1235');
assert.equal(deriveOwnSignalingUrl('wss://192.168.1.20:443', '1235'), 'wss://192.168.1.20:1235');
// Bad port falls back to the default signal port.
assert.equal(deriveOwnSignalingUrl('ws://localhost:1234', 'nope'), 'ws://localhost:1235');
// Public sync hosts keep public signaling (null = no derivation).
assert.equal(deriveOwnSignalingUrl('wss://review-sync.zpro-driftman.workers.dev', '1235'), null);
assert.equal(deriveOwnSignalingUrl('wss://example.com/x', '1235'), null);
assert.equal(deriveOwnSignalingUrl('not-a-url', '1235'), null);
assert.equal(deriveOwnSignalingUrl('http://localhost:5173/', '1235'), null);

// Resolution order: custom > own relay > public fallback.
const FALLBACK = ['wss://signaling.yjs.dev'];
assert.deepEqual(
  resolveSignalingUrls({ custom: 'wss://sig.example/x', syncUrl: 'ws://localhost:1234', signalPort: '1235', fallback: FALLBACK }),
  ['wss://sig.example/x']
);
assert.deepEqual(
  resolveSignalingUrls({ custom: null, syncUrl: 'ws://192.168.0.7:1234', signalPort: '1235', fallback: FALLBACK }),
  ['ws://192.168.0.7:1235']
);
assert.deepEqual(
  resolveSignalingUrls({ custom: null, syncUrl: 'wss://review-sync.zpro-driftman.workers.dev', signalPort: '1235', fallback: FALLBACK }),
  ['wss://signaling.yjs.dev']
);

console.log('p2p config: all checks passed');
