//! `REVIEW_SELFTEST=1 review-desktop` boots the app, checks the pieces a
//! real session needs from inside the webview, prints one JSON line and exits.
//!
//! Checks: WebRTC exists and a loopback data channel delivers a message,
//! the embedded host answers `/lan`, board files round-trip through IPC, and
//! the P2P client is loaded. With `REVIEW_SELFTEST_BOARD=<id>` it also opens
//! that board and waits for a peer link (used with a browser joining the
//! same board through this app's host).

use std::time::Duration;

use tauri::{AppHandle, Runtime, WebviewWindow};

const PROBE: &str = r#"
(async () => {
  const ipc = window.__TAURI_INTERNALS__;
  console.log('selftest: start', location.href, typeof ipc);
  const out = {
    webrtc: typeof RTCPeerConnection === 'function',
    nativeRtc: window.__reviewNativeRtc === true,
    origin: location.origin,
  };
  try {
    const host = await ipc.invoke('host_info');
    out.host = { port: host.port, mdns: host.mdns, addresses: host.addresses.length };
    const lan = await (await fetch(`http://127.0.0.1:${host.port}/lan`)).json();
    out.lanService = lan.service;
  } catch (e) { out.hostError = String(e); }
  if (out.webrtc) {
    try {
      const a = new RTCPeerConnection(), b = new RTCPeerConnection();
      // Hold candidates until the other side has its remote description (as webrtcLink does).
      const pipe = (to) => {
        const held = [];
        let ready = false;
        return {
          add: (c) => (ready ? to.addIceCandidate(c) : held.push(c)),
          ready: async () => { ready = true; for (const c of held) await to.addIceCandidate(c); },
        };
      };
      const toB = pipe(b), toA = pipe(a);
      a.onicecandidate = (e) => e.candidate && toB.add(e.candidate);
      b.onicecandidate = (e) => e.candidate && toA.add(e.candidate);
      const got = new Promise((res, rej) => {
        b.ondatachannel = (ev) => { ev.channel.onmessage = (m) => res(m.data); };
        setTimeout(() => rej(new Error('datachannel timeout')), 15000);
      });
      const dc = a.createDataChannel('selftest');
      dc.onopen = () => dc.send('ping');
      await a.setLocalDescription(await a.createOffer());
      await b.setRemoteDescription(a.localDescription);
      await toB.ready();
      await b.setLocalDescription(await b.createAnswer());
      await a.setRemoteDescription(b.localDescription);
      await toA.ready();
      out.datachannel = await got;
      a.close(); b.close();
    } catch (e) { out.webrtcError = String(e); }
  }
  try {
    await ipc.invoke('board_save', new Uint8Array([1, 2, 3, 4]), {
      headers: { 'x-board-id': 'selftest', 'x-board-meta': encodeURIComponent('{"name":"selftest"}') },
    });
    const back = new Uint8Array(await ipc.invoke('board_load', { id: 'selftest' }));
    out.boardFile = Array.from(back).join(',');
    const list = await ipc.invoke('board_list');
    out.boardListed = list.some((b) => b.id === 'selftest' && b.meta && b.meta.name === 'selftest');
    await ipc.invoke('board_delete', { id: 'selftest' });
  } catch (e) { out.boardError = String(e); }
  try {
    const bytes = new Uint8Array([5, 6, 7]);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const hash = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
    await ipc.invoke('blob_save', bytes, { headers: { 'x-blob-hash': hash, 'x-blob-mime': 'image/png' } });
    const raw = new Uint8Array(await ipc.invoke('blob_load', { hash }));
    const nl = raw.indexOf(10);
    out.blobFile = new TextDecoder().decode(raw.subarray(0, nl)) + '|' + Array.from(raw.subarray(nl + 1)).join(',');
  } catch (e) { out.blobError = String(e); }
  out.mesh = typeof window.reviewP2p === 'function';
  const board = __BOARD__;
  if (board) {
    if (!location.pathname.startsWith('/board/')) {
      sessionStorage.setItem('review-selftest-partial', JSON.stringify(out));
      location.assign(`/board/${board}`);
      return;
    }
  }
  console.log('selftest: report', JSON.stringify(out));
  await ipc.invoke('selftest_report', { report: JSON.stringify(out) });
})().catch((e) => console.log('selftest: failed', String(e)));
"#;

/// Second stage after navigating to the board: wait for an open link and a shape from the peer.
const BOARD_PROBE: &str = r#"
(async () => {
  const ipc = window.__TAURI_INTERNALS__;
  const out = JSON.parse(sessionStorage.getItem('review-selftest-partial') || '{}');
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    const snap = window.reviewP2p && window.reviewP2p();
    const open = snap ? snap.peers.filter((p) => p.state === 'open') : [];
    const shapes = window.__reviewShapeCount ? window.__reviewShapeCount() : 0;
    if (open.length > 0 && shapes > 0) {
      out.peerLink = { path: open[0].path, bytesIn: open[0].bytesIn, hubs: snap.hubs.map((h) => h.state) };
      out.shapesFromPeer = shapes;
      // The board must be on disk, not just in memory.
      await window.__reviewFlushBoards();
      const id = location.pathname.split('/').pop();
      out.boardFileBytes = new Uint8Array(await ipc.invoke('board_load', { id })).length;
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  await ipc.invoke('selftest_report', { report: JSON.stringify(out) });
})();
"#;

pub fn maybe_run<R: Runtime>(_app: AppHandle<R>, window: WebviewWindow<R>) {
  if std::env::var("REVIEW_SELFTEST").is_err() {
    return;
  }
  let board = std::env::var("REVIEW_SELFTEST_BOARD")
    .ok()
    .filter(|b| b.bytes().all(|c| c.is_ascii_alphanumeric()))
    .map(|b| format!("'{b}'"))
    .unwrap_or_else(|| "null".into());
  let probe = PROBE.replace("__BOARD__", &board);
  let has_board = board != "null";
  std::thread::spawn(move || {
    std::thread::sleep(Duration::from_secs(4));
    let _ = window.eval(&probe);
    if has_board {
      std::thread::sleep(Duration::from_secs(5));
      let _ = window.eval(BOARD_PROBE);
    }
  });
}

#[tauri::command]
pub fn selftest_report<R: Runtime>(app: AppHandle<R>, report: String) {
  println!("REVIEW_SELFTEST {report}");
  let ok = serde_json::from_str::<serde_json::Value>(&report)
    .map(|v| {
      v["webrtc"] == true
        && v["datachannel"] == "ping"
        && v["lanService"] == "review-host"
        && v["boardFile"] == "1,2,3,4"
        && v["boardListed"] == true
        && v["blobFile"] == "image/png|5,6,7"
        && v["mesh"] == true
        && (std::env::var("REVIEW_SELFTEST_BOARD").is_err()
          || (v["shapesFromPeer"].as_u64().unwrap_or(0) > 0 && v["boardFileBytes"].as_u64().unwrap_or(0) > 100))
    })
    .unwrap_or(false);
  app.exit(if ok { 0 } else { 1 });
  // `exit` asks the event loop to stop; make the process status reliable for scripts.
  std::process::exit(if ok { 0 } else { 1 });
}
