/**
 * The Cloudflare hub (`cloudflare/worker.ts`) under `wrangler dev` (local
 * workerd): same wire format as review-host, hibernation ping auto-reply,
 * reconnect replacement, binary refusal, no web UI, and that a room forgets
 * its members.
 *
 *   node scripts/cf-hub-test.mjs                                   (wrangler dev)
 *   CF_HUB_URL=https://review-hub.<sub>.workers.dev node scripts/cf-hub-test.mjs
 */
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { hubTarget } from './cf-dev.mjs';

const cf = await hubTarget();
const { base, hub, name } = cf;
if (cf.live) console.log(`cf-hub-test: live hub ${base} (${name})`);
const cleanup = () => cf.stop();

/** Socket with a message queue so tests can await the next frame. */
function connect(room, peer) {
  const ws = new WebSocket(`${hub}/signal/${room}?peer=${peer}`);
  const queue = [];
  const waiters = [];
  ws.on('message', (data, binary) => {
    if (binary) return;
    const msg = JSON.parse(String(data));
    const w = waiters.shift();
    if (w) w(msg);
    else queue.push(msg);
  });
  const closed = new Promise((r) => ws.on('close', (code, reason) => r({ code, reason: String(reason) })));
  return {
    ws,
    closed,
    next(ms = 5_000) {
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`${peer}: no message`)), ms);
        waiters.push((m) => { clearTimeout(t); resolve(m); });
      });
    },
    async quiet(ms = 400) {
      await new Promise((r) => setTimeout(r, ms));
      assert.deepEqual(queue, [], `${peer}: unexpected frames`);
    },
    send(obj) { ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); },
    close() { ws.close(1000); return closed; },
  };
}

try {
  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.service, 'review-hub');
  assert.equal(health.proto, 1);
  assert.equal(health.name, name);
  const root = await fetch(`${base}/board/abc`);
  assert.equal(root.status, 404, 'no web UI on the hub');
  assert.equal((await fetch(`${base}/lan`)).status, 404, 'no /lan: the hub is not a page host');
  assert.equal((await fetch(`${base}/signal/bad%2Froom?peer=peer-a1`)).status, 400);
  assert.equal((await fetch(`${base}/signal/review-x?peer=no`)).status, 400);
  assert.equal((await fetch(`${base}/signal/review-x?peer=peer-a1`)).status, 426);
  // /turn: 404 without a TURN key (local wrangler dev), else short-lived Cloudflare TURN credentials.
  const turn = await fetch(`${base}/turn`);
  if (process.env.CF_HUB_URL) {
    assert.equal(turn.status, 200, 'live hub mints TURN credentials');
    const j = await turn.json();
    const urls = j.iceServers.flatMap((s) => [].concat(s.urls));
    assert.ok(j.ttl > 3600 && urls.some((u) => u.startsWith('turn:turn.cloudflare.com')), 'turn urls');
    assert.ok(j.iceServers.every((s) => s.username && s.credential), 'credentials present');
    assert.ok(!urls.some((u) => /:53\b/.test(u)), 'port 53 filtered');
    console.log(`cf-hub-test: /turn gives ${urls.length} TURN urls, ttl ${j.ttl}s`);
  } else {
    assert.equal(turn.status, 404);
    await turn.body?.cancel();
  }

  const room = `review-cf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const a = connect(room, 'peer-aaaa');
  const w1 = await a.next();
  assert.deepEqual(w1, { t: 'welcome', proto: 1, peer: 'peer-aaaa', peers: [], host: name });

  const b = connect(room, 'peer-bbbb');
  assert.deepEqual((await b.next()).peers, ['peer-aaaa']);
  assert.deepEqual(await a.next(), { t: 'join', peer: 'peer-bbbb' });

  b.send({ t: 'signal', to: 'peer-aaaa', data: { sdp: 'x', n: 1 } });
  assert.deepEqual(await a.next(), { t: 'signal', from: 'peer-bbbb', data: { sdp: 'x', n: 1 } });
  b.send({ t: 'signal', to: 'nobody-here', data: 1 });
  assert.deepEqual(await b.next(), { t: 'gone', peer: 'nobody-here' });
  b.send({ t: 'signal', to: 'peer-bbbb', data: 1 });
  assert.deepEqual(await b.next(), { t: 'gone', peer: 'peer-bbbb' }, 'no signalling yourself');

  // Exact ping string: answered by the runtime (hibernation auto-response).
  b.send('{"t":"ping"}');
  assert.deepEqual(await b.next(), { t: 'pong' });
  // Unknown frames are ignored.
  b.send({ t: 'future-thing' });
  b.send('not json');
  await b.quiet();

  // Reconnect with the same id replaces the old socket without join/leave noise.
  const b2 = connect(room, 'peer-bbbb');
  assert.deepEqual((await b2.next()).peers, ['peer-aaaa']);
  assert.equal((await b.closed).code, 4000);
  await a.quiet(600);
  a.send({ t: 'signal', to: 'peer-bbbb', data: 'hi' });
  assert.deepEqual(await b2.next(), { t: 'signal', from: 'peer-aaaa', data: 'hi' });

  // Binary is refused.
  const c = connect(room, 'peer-cccc');
  await c.next();
  assert.deepEqual(await a.next(), { t: 'join', peer: 'peer-cccc' });
  assert.deepEqual(await b2.next(), { t: 'join', peer: 'peer-cccc' });
  c.ws.send(Buffer.from([1, 2, 3]));
  assert.equal((await c.closed).code, 1003);
  assert.deepEqual(await a.next(), { t: 'leave', peer: 'peer-cccc' });
  assert.deepEqual(await b2.next(), { t: 'leave', peer: 'peer-cccc' });

  // Leave, then the room is empty: a newcomer sees nobody.
  await b2.close();
  assert.deepEqual(await a.next(), { t: 'leave', peer: 'peer-bbbb' });
  await a.close();
  await new Promise((r) => setTimeout(r, 300));
  const d = connect(room, 'peer-dddd');
  assert.deepEqual((await d.next()).peers, [], 'room forgot everyone');
  await d.close();

  // Rooms are isolated.
  const e = connect(`${room}-other`, 'peer-eeee');
  const f = connect(room, 'peer-ffff');
  assert.deepEqual((await e.next()).peers, []);
  assert.deepEqual((await f.next()).peers, []);
  await e.close();
  await f.close();

  console.log('cf-hub-test: OK');
  cleanup();
  process.exit(0);
} catch (err) {
  console.error(err);
  console.error(cf.output().slice(-4000));
  cleanup();
  process.exit(1);
}
