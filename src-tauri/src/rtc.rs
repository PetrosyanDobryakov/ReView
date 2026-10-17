//! Native WebRTC for the webview, as a thin RTCPeerConnection bridge.
//!
//! Ubuntu/Debian WebKitGTK is built without WebRTC, so the page has no
//! `RTCPeerConnection`. The frontend then installs a polyfill
//! (`src/net/p2p/nativeRtc.ts`) whose every call lands here, backed by
//! webrtc-rs. It speaks standard WebRTC, so desktop links interoperate with
//! browsers. The P2P mesh code above it does not know the difference.
//!
//! Events for one connection go back over one ordered IPC channel as raw
//! frames: byte 0 = kind, rest = payload.
//!   0 JSON event (`{"t":"ice"|"state"|"open"|"close"|"datachannel"|"low", ...}`)
//!   1 binary data-channel message
//!   2 text data-channel message (UTF-8)
//! One channel keeps "open" ahead of the first message, which the mesh relies on.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use serde::Deserialize;
use serde_json::json;
use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody, Request};
use tokio::sync::Mutex;
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::MediaEngine;
use webrtc::api::setting_engine::SettingEngine;
use webrtc::api::APIBuilder;
use webrtc::data_channel::data_channel_init::RTCDataChannelInit;
use webrtc::data_channel::data_channel_message::DataChannelMessage;
use webrtc::data_channel::RTCDataChannel;
use webrtc::ice::mdns::MulticastDnsMode;
use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::interceptor::registry::Registry;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;

const EV_JSON: u8 = 0;
const EV_BINARY: u8 = 1;
const EV_TEXT: u8 = 2;

struct Conn {
  pc: Arc<RTCPeerConnection>,
  /// Data channels by polyfill-side id.
  channels: Mutex<HashMap<u32, Arc<RTCDataChannel>>>,
  events: Channel<InvokeResponseBody>,
}

#[derive(Default)]
pub struct RtcState {
  conns: Mutex<HashMap<u32, Arc<Conn>>>,
}

#[derive(Deserialize)]
pub struct IceServerArg {
  urls: Vec<String>,
  username: Option<String>,
  credential: Option<String>,
}

fn emit(events: &Channel<InvokeResponseBody>, kind: u8, payload: &[u8]) {
  let mut buf = Vec::with_capacity(payload.len() + 1);
  buf.push(kind);
  buf.extend_from_slice(payload);
  let _ = events.send(InvokeResponseBody::Raw(buf));
}

fn emit_json(events: &Channel<InvokeResponseBody>, v: serde_json::Value) {
  emit(events, EV_JSON, v.to_string().as_bytes());
}

async fn conn(state: &RtcState, id: u32) -> Result<Arc<Conn>, String> {
  state
    .conns
    .lock()
    .await
    .get(&id)
    .cloned()
    .ok_or_else(|| format!("no peer connection {id}"))
}

/// Wire one data channel's callbacks to the connection's event stream.
async fn bind_channel(conn: &Arc<Conn>, cid: u32, dc: Arc<RTCDataChannel>) {
  conn.channels.lock().await.insert(cid, Arc::clone(&dc));
  let ev = conn.events.clone();
  dc.on_open(Box::new(move || {
    emit_json(&ev, json!({ "t": "open", "channel": cid }));
    Box::pin(async {})
  }));
  let ev = conn.events.clone();
  dc.on_message(Box::new(move |msg: DataChannelMessage| {
    let mut head = Vec::with_capacity(msg.data.len() + 4);
    head.extend_from_slice(&cid.to_be_bytes());
    head.extend_from_slice(&msg.data);
    emit(&ev, if msg.is_string { EV_TEXT } else { EV_BINARY }, &head);
    Box::pin(async {})
  }));
  let ev = conn.events.clone();
  dc.on_close(Box::new(move || {
    emit_json(&ev, json!({ "t": "close", "channel": cid }));
    Box::pin(async {})
  }));
  let ev = conn.events.clone();
  dc.on_buffered_amount_low(Box::new(move || {
    let ev = ev.clone();
    Box::pin(async move { emit_json(&ev, json!({ "t": "low", "channel": cid })) })
  }))
  .await;
}

/// Channels created by the remote side get ids from this counter (top bit set
/// so they never collide with ids the page picks).
static REMOTE_CHANNEL_IDS: AtomicUsize = AtomicUsize::new(0x8000_0000);

#[tauri::command]
pub async fn rtc_create(
  state: tauri::State<'_, RtcState>,
  id: u32,
  ice_servers: Vec<IceServerArg>,
  events: Channel<InvokeResponseBody>,
) -> Result<(), String> {
  let mut media = MediaEngine::default();
  let registry = register_default_interceptors(Registry::new(), &mut media).map_err(|e| e.to_string())?;
  let mut settings = SettingEngine::default();
  // Browsers hide LAN IPs behind `<uuid>.local` names; resolve them.
  settings.set_ice_multicast_dns_mode(MulticastDnsMode::QueryOnly);
  // Two windows on one machine (and containers with no LAN) still connect.
  settings.set_include_loopback_candidate(true);
  let api = APIBuilder::new()
    .with_media_engine(media)
    .with_interceptor_registry(registry)
    .with_setting_engine(settings)
    .build();
  let config = RTCConfiguration {
    ice_servers: ice_servers
      .into_iter()
      .map(|s| RTCIceServer {
        urls: s.urls,
        username: s.username.unwrap_or_default(),
        credential: s.credential.unwrap_or_default(),
        ..Default::default()
      })
      .collect(),
    ..Default::default()
  };
  let pc = Arc::new(api.new_peer_connection(config).await.map_err(|e| e.to_string())?);
  let conn = Arc::new(Conn {
    pc: Arc::clone(&pc),
    channels: Mutex::new(HashMap::new()),
    events,
  });

  let ev = conn.events.clone();
  pc.on_ice_candidate(Box::new(move |c| {
    let payload = match c.and_then(|c| c.to_json().ok()) {
      // sdpMid "" from webrtc-rs is not a valid mid for browsers; the m-line index is enough.
      Some(init) => json!({
        "t": "ice",
        "candidate": { "candidate": init.candidate, "sdpMid": null, "sdpMLineIndex": init.sdp_mline_index.unwrap_or(0) },
      }),
      None => json!({ "t": "ice", "candidate": null }),
    };
    emit_json(&ev, payload);
    Box::pin(async {})
  }));
  let ev = conn.events.clone();
  pc.on_peer_connection_state_change(Box::new(move |s| {
    emit_json(&ev, json!({ "t": "state", "state": s.to_string() }));
    Box::pin(async {})
  }));
  let weak = Arc::downgrade(&conn);
  pc.on_data_channel(Box::new(move |dc| {
    let weak = weak.clone();
    Box::pin(async move {
      let Some(conn) = weak.upgrade() else { return };
      let cid = REMOTE_CHANNEL_IDS.fetch_add(1, Ordering::Relaxed) as u32;
      // Announce first: binding may fire "open" right away for a channel that is already up.
      emit_json(
        &conn.events,
        json!({ "t": "datachannel", "channel": cid, "label": dc.label(), "ordered": dc.ordered() }),
      );
      bind_channel(&conn, cid, dc).await;
    })
  }));
  state.conns.lock().await.insert(id, conn);
  Ok(())
}

#[tauri::command]
pub async fn rtc_create_data_channel(
  state: tauri::State<'_, RtcState>,
  id: u32,
  channel: u32,
  label: String,
  ordered: bool,
) -> Result<(), String> {
  let conn = conn(&state, id).await?;
  let init = RTCDataChannelInit {
    ordered: Some(ordered),
    ..Default::default()
  };
  let dc = conn
    .pc
    .create_data_channel(&label, Some(init))
    .await
    .map_err(|e| e.to_string())?;
  bind_channel(&conn, channel, dc).await;
  Ok(())
}

#[tauri::command]
pub async fn rtc_create_offer(state: tauri::State<'_, RtcState>, id: u32) -> Result<String, String> {
  let conn = conn(&state, id).await?;
  let offer = conn.pc.create_offer(None).await.map_err(|e| e.to_string())?;
  Ok(offer.sdp)
}

#[tauri::command]
pub async fn rtc_create_answer(state: tauri::State<'_, RtcState>, id: u32) -> Result<String, String> {
  let conn = conn(&state, id).await?;
  let answer = conn.pc.create_answer(None).await.map_err(|e| e.to_string())?;
  Ok(answer.sdp)
}

fn description(kind: &str, sdp: String) -> Result<RTCSessionDescription, String> {
  match kind {
    "offer" => RTCSessionDescription::offer(sdp),
    "answer" => RTCSessionDescription::answer(sdp),
    other => return Err(format!("unsupported description type {other}")),
  }
  .map_err(|e| e.to_string())
}

/// Returns the local SDP after applying (it may already carry candidates).
#[tauri::command]
pub async fn rtc_set_local(
  state: tauri::State<'_, RtcState>,
  id: u32,
  kind: String,
  sdp: String,
) -> Result<String, String> {
  let conn = conn(&state, id).await?;
  conn
    .pc
    .set_local_description(description(&kind, sdp)?)
    .await
    .map_err(|e| e.to_string())?;
  Ok(conn.pc.local_description().await.map(|d| d.sdp).unwrap_or_default())
}

#[tauri::command]
pub async fn rtc_set_remote(
  state: tauri::State<'_, RtcState>,
  id: u32,
  kind: String,
  sdp: String,
) -> Result<(), String> {
  let conn = conn(&state, id).await?;
  conn
    .pc
    .set_remote_description(description(&kind, sdp)?)
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rtc_add_ice(
  state: tauri::State<'_, RtcState>,
  id: u32,
  candidate: RTCIceCandidateInit,
) -> Result<(), String> {
  let conn = conn(&state, id).await?;
  conn.pc.add_ice_candidate(candidate).await.map_err(|e| e.to_string())
}

/// Raw body = message bytes. Headers: `x-rtc-id`, `x-rtc-channel`, `x-rtc-text`.
/// Returns the channel's buffered amount after queueing.
#[tauri::command]
pub async fn rtc_send(state: tauri::State<'_, RtcState>, request: Request<'_>) -> Result<usize, String> {
  let header = |k: &str| {
    request
      .headers()
      .get(k)
      .and_then(|v| v.to_str().ok())
      .and_then(|v| v.parse::<u32>().ok())
  };
  let id = header("x-rtc-id").ok_or("missing x-rtc-id")?;
  let cid = header("x-rtc-channel").ok_or("missing x-rtc-channel")?;
  let text = request.headers().get("x-rtc-text").is_some();
  let InvokeBody::Raw(bytes) = request.body() else {
    return Err("expected raw bytes".into());
  };
  let conn = conn(&state, id).await?;
  let dc = conn
    .channels
    .lock()
    .await
    .get(&cid)
    .cloned()
    .ok_or("no such data channel")?;
  if text {
    dc.send_text(String::from_utf8_lossy(bytes).into_owned())
      .await
      .map_err(|e| e.to_string())?;
  } else {
    dc.send(&bytes.clone().into()).await.map_err(|e| e.to_string())?;
  }
  Ok(dc.buffered_amount().await)
}

#[tauri::command]
pub async fn rtc_set_low_threshold(
  state: tauri::State<'_, RtcState>,
  id: u32,
  channel: u32,
  threshold: usize,
) -> Result<(), String> {
  let conn = conn(&state, id).await?;
  if let Some(dc) = conn.channels.lock().await.get(&channel) {
    dc.set_buffered_amount_low_threshold(threshold).await;
  }
  Ok(())
}

#[tauri::command]
pub async fn rtc_close_channel(state: tauri::State<'_, RtcState>, id: u32, channel: u32) -> Result<(), String> {
  let conn = conn(&state, id).await?;
  let dc = conn.channels.lock().await.remove(&channel);
  if let Some(dc) = dc {
    let _ = dc.close().await;
  }
  Ok(())
}

/// Candidate type of the selected pair's local side: host | srflx | prflx | relay.
#[tauri::command]
pub async fn rtc_path(state: tauri::State<'_, RtcState>, id: u32) -> Result<Option<String>, String> {
  let conn = conn(&state, id).await?;
  let pair = conn
    .pc
    .sctp()
    .transport()
    .ice_transport()
    .get_selected_candidate_pair()
    .await;
  // Display is "(local) <proto> <type> <addr> <-> (remote) ...".
  Ok(pair.and_then(|p| p.to_string().split_whitespace().nth(2).map(str::to_string)))
}

#[tauri::command]
pub async fn rtc_close(state: tauri::State<'_, RtcState>, id: u32) -> Result<(), String> {
  let conn = state.conns.lock().await.remove(&id);
  if let Some(conn) = conn {
    conn.channels.lock().await.clear();
    let _ = conn.pc.close().await;
  }
  Ok(())
}
