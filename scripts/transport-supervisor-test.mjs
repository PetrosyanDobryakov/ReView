/**
 * Unit checks for the transport supervisor policy (Step 2a).
 * Run: node --experimental-strip-types scripts/transport-supervisor-test.mjs
 */
import assert from 'node:assert/strict';
import {
  WS_PROBE_INTERVAL_MS,
  WS_ROSTER_GRACE_MS,
  decideTransport,
} from '../src/net/supervisor.ts';

assert.equal(WS_ROSTER_GRACE_MS, 10_000);
assert.equal(WS_PROBE_INTERVAL_MS, 5 * 60_000);

const NOW = 1_000_000;
const settled = {
  nowMs: NOW,
  saveEnabled: true,
  p2pEnabled: true,
  p2pOnline: true,
  p2pPeerIds: ['u2'],
  wsOnline: true,
  wsPeerIds: ['u2'],
  wsConnectedAtMs: NOW - WS_ROSTER_GRACE_MS - 1,
  sleeping: false,
  lastProbeAtMs: 0,
};

// Covered peers + settled roster -> sleep, no probe.
assert.deepEqual(decideTransport(settled), { wish: 'ws-sleep', probe: false });

// Master switch / P2P state gates -> WS stays up.
assert.equal(decideTransport({ ...settled, saveEnabled: false }).wish, 'ws-up');
assert.equal(decideTransport({ ...settled, p2pEnabled: false }).wish, 'ws-up');
assert.equal(decideTransport({ ...settled, p2pOnline: false }).wish, 'ws-up');
// Solo (no P2P peers): WS is the source of truth.
assert.equal(decideTransport({ ...settled, p2pPeerIds: [] }).wish, 'ws-up');
// WS-only peer (e.g. old client): never sleep under them.
assert.equal(
  decideTransport({ ...settled, wsPeerIds: ['u2', 'u3'] }).wish,
  'ws-up'
);
// Down or still-learning WS socket -> up.
assert.equal(decideTransport({ ...settled, wsOnline: false }).wish, 'ws-up');
assert.equal(
  decideTransport({ ...settled, wsConnectedAtMs: NOW - 1000 }).wish,
  'ws-up'
);
assert.equal(decideTransport({ ...settled, wsConnectedAtMs: null }).wish, 'ws-up');
// Vacuous coverage (WS roster empty, P2P live) -> sleep.
assert.equal(
  decideTransport({ ...settled, wsPeerIds: [] }).wish,
  'ws-sleep'
);
// Sleeping + fresh probe -> stay asleep, no probe flag.
assert.deepEqual(
  decideTransport({ ...settled, sleeping: true, lastProbeAtMs: NOW - 1000 }),
  { wish: 'ws-sleep', probe: false }
);
// Sleeping + probe due -> wake to flush + relearn.
assert.deepEqual(
  decideTransport({ ...settled, sleeping: true, lastProbeAtMs: NOW - WS_PROBE_INTERVAL_MS - 1 }),
  { wish: 'ws-up', probe: true }
);
// Awake + stale probe timestamp -> still just sleeps (probe only fires while asleep).
assert.deepEqual(
  decideTransport({ ...settled, sleeping: false, lastProbeAtMs: 0 }),
  { wish: 'ws-sleep', probe: false }
);
// P2P covers two peers, WS sees the same two -> sleep.
assert.equal(
  decideTransport({
    ...settled,
    p2pPeerIds: ['u2', 'u3'],
    wsPeerIds: ['u3', 'u2'],
  }).wish,
  'ws-sleep'
);

console.log('transport-supervisor-test: ok');
