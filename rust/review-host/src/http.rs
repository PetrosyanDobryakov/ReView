//! HTTP front door: web UI, `/signal/<room>` hub sockets, `/lan`, `/health`.

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{FromRequestParts, Request, State};
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Router;
use serde_json::json;
use tokio::net::TcpListener;
use tokio::sync::{mpsc, oneshot};

use crate::config::{Config, SIGNAL_PROTO};
use crate::hub::{is_valid_peer_id, Hub, JoinError, Out, Stats};
use crate::lan::list_lan_addresses;
use crate::mdns::{Discovery, LanHost};
use crate::room_name::{is_valid_room_name, normalize_room_name};
use crate::static_files::{resolve, DirSource, StaticSource};

/// A socket that sends nothing (not even our `ping`) for this long is dropped.
const IDLE_TIMEOUT: Duration = Duration::from_secs(75);

pub struct App {
    pub cfg: Config,
    pub id: String,
    pub port: u16,
    pub hub: Hub,
    pub discovery: Discovery,
    pub static_source: Option<Arc<dyn StaticSource>>,
}

/// Handle to a host running on the current tokio runtime.
pub struct RunningHost {
    app: Arc<App>,
    stop: Option<oneshot::Sender<()>>,
}

impl RunningHost {
    pub fn port(&self) -> u16 {
        self.app.port
    }
    pub fn id(&self) -> &str {
        &self.app.id
    }
    pub fn name(&self) -> &str {
        &self.app.cfg.name
    }
    pub fn lan_hosts(&self) -> Vec<LanHost> {
        self.app.discovery.hosts()
    }
    pub fn lan_addresses(&self) -> Vec<String> {
        list_lan_addresses()
    }
    pub fn serves_ui(&self) -> bool {
        self.app.static_source.is_some()
    }
    pub fn mdns_active(&self) -> bool {
        self.app.discovery.active()
    }
    pub fn stats(&self) -> Stats {
        self.app.hub.stats()
    }
    pub fn stop(&mut self) {
        if let Some(tx) = self.stop.take() {
            let _ = tx.send(());
        }
    }
}

impl Drop for RunningHost {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Random id without pulling in a RNG crate: `RandomState` is seeded per process.
pub fn random_id() -> String {
    let mut out = String::new();
    for i in 0..2u64 {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(i);
        h.write_u128(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0),
        );
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

/// Bind and spawn the host on the current runtime.
pub async fn start(
    cfg: Config,
    static_source: Option<Arc<dyn StaticSource>>,
) -> std::io::Result<RunningHost> {
    let (listener, port) = bind(&cfg).await?;
    let id = random_id();
    let discovery = if cfg.mdns {
        Discovery::start(&id, &cfg.name, port)
    } else {
        Discovery::disabled(&id)
    };
    let static_source = static_source.or_else(|| {
        cfg.dist
            .as_ref()
            .map(|d| Arc::new(DirSource::new(d.clone())) as Arc<dyn StaticSource>)
    });
    let app = Arc::new(App {
        cfg,
        id,
        port,
        hub: Hub::new(),
        discovery,
        static_source,
    });
    let router = Router::new()
        .fallback(dispatch)
        .with_state(Arc::clone(&app));
    let (stop_tx, stop_rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        let res = axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async {
            let _ = stop_rx.await;
        })
        .await;
        if let Err(err) = res {
            eprintln!("[review] host stopped: {err}");
        }
    });
    Ok(RunningHost {
        app,
        stop: Some(stop_tx),
    })
}

async fn bind(cfg: &Config) -> std::io::Result<(TcpListener, u16)> {
    let mut last_err = None;
    for offset in 0..=cfg.port_tries {
        let Some(port) = cfg.port.checked_add(offset) else {
            break;
        };
        let addr = format!("{}:{}", cfg.host, port);
        match TcpListener::bind(&addr).await {
            Ok(l) => {
                let real = l.local_addr()?.port();
                return Ok((l, real));
            }
            Err(err) if err.kind() == std::io::ErrorKind::AddrInUse => last_err = Some(err),
            Err(err) => return Err(err),
        }
    }
    Err(last_err.unwrap_or_else(|| std::io::Error::other("no port")))
}

/// Binary entry: run until SIGINT/SIGTERM.
pub async fn serve(cfg: Config) -> std::io::Result<()> {
    let verbose = cfg.verbose;
    let ui = cfg.dist.clone();
    let host = match start(cfg, None).await {
        Ok(h) => h,
        Err(err) if err.kind() == std::io::ErrorKind::AddrInUse => {
            println!("[review] host already running on this port");
            return Ok(());
        }
        Err(err) => return Err(err),
    };
    print_banner(&host, ui.is_some(), verbose);
    shutdown_signal().await;
    drop(host);
    Ok(())
}

fn print_banner(host: &RunningHost, ui: bool, verbose: bool) {
    let port = host.port();
    println!("[review] host \"{}\" on :{port} (proto {SIGNAL_PROTO})", host.name());
    println!(
        "[review] {} — signaling only, stores nothing",
        if ui { "serving web UI" } else { "no web UI (--dist <dir> to serve one)" }
    );
    for a in host.lan_addresses() {
        let h = crate::lan::format_lan_host(&a);
        if ui {
            println!("[review]   http://{h}:{port}/");
        } else {
            println!("[review]   ws://{h}:{port}/signal/<room>");
        }
    }
    println!(
        "[review] LAN discovery: {}",
        if host.mdns_active() { "on" } else { "off" }
    );
    if verbose {
        println!("[review] verbose logging on");
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        if let Ok(mut sig) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            sig.recv().await;
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => println!("[review] SIGINT, closing"),
        _ = term => println!("[review] SIGTERM, closing"),
    }
}

async fn dispatch(State(app): State<Arc<App>>, req: Request) -> Response {
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let query = req.uri().query().unwrap_or("").to_string();
    if method == Method::OPTIONS {
        return cors(
            Response::builder()
                .status(StatusCode::NO_CONTENT)
                .body(Body::empty())
                .unwrap(),
        );
    }
    if let Some(rest) = path.strip_prefix("/signal/") {
        return signal(app, req, rest, &query).await;
    }
    if method != Method::GET && method != Method::HEAD {
        return cors(text(StatusCode::METHOD_NOT_ALLOWED, "method not allowed"));
    }
    match path.as_str() {
        "/health" | "/healthz" => {
            let s = app.hub.stats();
            cors(json_resp(json!({
                "ok": true,
                "service": "review-host",
                "proto": SIGNAL_PROTO,
                "rooms": s.rooms,
                "peers": s.peers,
            })))
        }
        "/lan" => cors(json_resp(json!({
            "ok": true,
            "service": "review-host",
            "proto": SIGNAL_PROTO,
            "id": app.id,
            "name": app.cfg.name,
            "port": app.port,
            "addresses": list_lan_addresses(),
            "mdns": app.discovery.active(),
            "ui": app.static_source.is_some(),
            "hosts": app.discovery.hosts(),
        }))),
        _ => serve_static(&app, &path, method == Method::HEAD),
    }
}

fn serve_static(app: &App, path: &str, head: bool) -> Response {
    let Some(source) = app.static_source.as_deref() else {
        if path == "/" {
            return text(
                StatusCode::OK,
                "ReView host: signaling only (no web UI bundled). Use ws://<host>/signal/<room>.",
            );
        }
        return text(StatusCode::NOT_FOUND, "not found");
    };
    let Some(asset) = resolve(source, path) else {
        return text(StatusCode::NOT_FOUND, "not found");
    };
    let cache = if path.starts_with("/assets/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    let len = asset.bytes.len();
    let body = if head {
        Body::empty()
    } else {
        Body::from(asset.bytes.into_owned())
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, asset.mime)
        .header(header::CONTENT_LENGTH, len)
        .header(header::CACHE_CONTROL, cache)
        .body(body)
        .unwrap()
}

async fn signal(app: Arc<App>, req: Request, rest: &str, query: &str) -> Response {
    let room = normalize_room_name(rest);
    if !is_valid_room_name(&room) {
        return cors(json_status(StatusCode::BAD_REQUEST, "bad room"));
    }
    let peer = query
        .split('&')
        .filter_map(|kv| kv.split_once('='))
        .find(|(k, _)| *k == "peer")
        .map(|(_, v)| v.to_string())
        .unwrap_or_default();
    if !is_valid_peer_id(&peer) {
        return cors(json_status(StatusCode::BAD_REQUEST, "bad peer"));
    }
    let (mut parts, _body) = req.into_parts();
    let ws = match WebSocketUpgrade::from_request_parts(&mut parts, &()).await {
        Ok(ws) => ws,
        Err(_) => return cors(json_status(StatusCode::UPGRADE_REQUIRED, "websocket only")),
    };
    let max = app.cfg.max_frame;
    ws.max_message_size(max)
        .max_frame_size(max)
        .on_upgrade(move |socket| run_socket(app, socket, room, peer))
}

async fn run_socket(app: Arc<App>, mut socket: WebSocket, room: String, peer: String) {
    let (tx, mut rx) = mpsc::unbounded_channel::<Out>();
    let conn = match app.hub.join(
        &room,
        &peer,
        tx,
        &app.cfg.name,
        app.cfg.max_rooms,
        app.cfg.max_peers_per_room,
    ) {
        Ok(c) => c,
        Err(err) => {
            let code = match err {
                JoinError::TooManyRooms => "too-many-rooms",
                JoinError::RoomFull => "room-full",
            };
            let _ = socket
                .send(Message::Text(
                    json!({ "t": "error", "error": code }).to_string().into(),
                ))
                .await;
            let _ = socket
                .send(Message::Close(Some(CloseFrame {
                    code: 4429,
                    reason: code.into(),
                })))
                .await;
            return;
        }
    };
    if app.cfg.verbose {
        println!("[review] join room={room} peer={peer}");
    }
    loop {
        tokio::select! {
            out = rx.recv() => match out {
                Some(Out::Text(t)) => {
                    if socket.send(Message::Text(t.into())).await.is_err() {
                        break;
                    }
                }
                Some(Out::Close(code, reason)) => {
                    let _ = socket
                        .send(Message::Close(Some(CloseFrame { code, reason: reason.into() })))
                        .await;
                    break;
                }
                None => break,
            },
            incoming = tokio::time::timeout(IDLE_TIMEOUT, socket.recv()) => match incoming {
                Ok(Some(Ok(Message::Text(t)))) => {
                    if app.cfg.verbose {
                        println!("[review] frame room={room} peer={peer} bytes={}", t.len());
                    }
                    app.hub.handle(&room, &peer, t.as_str());
                }
                Ok(Some(Ok(Message::Ping(_) | Message::Pong(_)))) => {}
                Ok(Some(Ok(Message::Binary(_)))) => {
                    // The hub never carries data. Refuse instead of relaying.
                    let _ = socket
                        .send(Message::Close(Some(CloseFrame { code: 1003, reason: "text only".into() })))
                        .await;
                    break;
                }
                _ => break,
            },
        }
    }
    app.hub.leave(&room, &peer, conn);
    if app.cfg.verbose {
        println!("[review] leave room={room} peer={peer}");
    }
}

fn cors(mut resp: Response) -> Response {
    let h = resp.headers_mut();
    h.insert("Access-Control-Allow-Origin", HeaderValue::from_static("*"));
    h.insert(
        "Access-Control-Allow-Methods",
        HeaderValue::from_static("GET, HEAD, OPTIONS"),
    );
    h.insert(
        "Access-Control-Allow-Headers",
        HeaderValue::from_static("Content-Type"),
    );
    h.insert("Access-Control-Max-Age", HeaderValue::from_static("86400"));
    // Lets an https page probe a host on the user's own LAN (Chrome PNA).
    h.insert(
        "Access-Control-Allow-Private-Network",
        HeaderValue::from_static("true"),
    );
    resp
}

fn json_resp(v: serde_json::Value) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(v.to_string()))
        .unwrap()
}

fn json_status(status: StatusCode, err: &str) -> Response {
    let mut r = json_resp(json!({ "ok": false, "error": err }));
    *r.status_mut() = status;
    r
}

fn text(status: StatusCode, body: &'static str) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        body,
    )
        .into_response()
}
