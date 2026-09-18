import * as Y from 'yjs'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'

const messageSync = 0
const messageAwareness = 1
const ROOM = `review-probe-wake-${Date.now().toString(36)}`
const URL = `wss://review-sync.zpro-driftman.workers.dev/${ROOM}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function toU8(data) {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  if (typeof Blob !== 'undefined' && data instanceof Blob) return new Uint8Array(await data.arrayBuffer())
  if (typeof data === 'string') return new TextEncoder().encode(data)
  throw new Error('unknown data ' + Object.prototype.toString.call(data))
}

function awarenessBytes(aw, ids) {
  const enc = encoding.createEncoder()
  encoding.writeVarUint(enc, messageAwareness)
  encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(aw, ids))
  return encoding.toUint8Array(enc)
}
function syncStep1Bytes(doc) {
  const enc = encoding.createEncoder()
  encoding.writeVarUint(enc, messageSync)
  syncProtocol.writeSyncStep1(enc, doc)
  return encoding.toUint8Array(enc)
}
function waitMessage(ws, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), timeoutMs)
    ws.addEventListener('message', (ev) => { clearTimeout(t); resolve(ev.data) }, { once: true })
  })
}

const doc = new Y.Doc()
const aw = new awarenessProtocol.Awareness(doc)
aw.setLocalStateField('probe', { t: Date.now() })
const ws = new WebSocket(URL)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})
console.log('open', ROOM)
const first = await waitMessage(ws)
const firstBuf = await toU8(first)
console.log('first type', decoding.readVarUint(decoding.createDecoder(firstBuf)), 'bytes', firstBuf.byteLength)
ws.send(syncStep1Bytes(doc))
await sleep(400)
ws.send(awarenessBytes(aw, [doc.clientID]))
console.log('hibernating 8s')
await sleep(8000)

async function timedSend(label, bytes, expectReply) {
  let got = 0
  const onMsg = () => { got++ }
  ws.addEventListener('message', onMsg)
  const t0 = Date.now()
  ws.send(bytes)
  if (expectReply) {
    const deadline = Date.now() + 15000
    while (got === 0 && Date.now() < deadline) await sleep(30)
  } else {
    await sleep(400)
  }
  const dt = Date.now() - t0
  ws.removeEventListener('message', onMsg)
  console.log(label, { dt_ms: dt, replies: got })
}

for (let i = 0; i < 2; i++) {
  await sleep(8000)
  await timedSend(`awareness#${i}`, awarenessBytes(aw, [doc.clientID]), false)
  await sleep(8000)
  await timedSend(`sync#${i}`, syncStep1Bytes(doc), true)
}
ws.close()
try { clearInterval(aw._checkInterval) } catch {}
doc.destroy()
console.log('done', ROOM)
