//! HTTP and WebSocket front door for both server personalities.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;

use axum::body::Body;
use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, FromRequestParts, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Router;
use tokio::net::TcpListener;

use crate::auth::{node_delete_authorized, worker_delete_authorized, PresentedToken};
use crate::config::{Config, Mode};
use crate::hub::{leave, push_bin, ConnectError, Hub, Out};
use crate::lan::{format_lan_host, list_lan_addresses};
use crate::netlog::{NetLog, BODY_MAX, NET_LOG_MAX_LINES};
use crate::room_name::{
    format_host_for_url, is_valid_room_name, room_from_delete_path, room_from_websocket_path,
};

pub struct App {
    pub hub: Hub,
    pub cfg: Arc<Config>,
    pub netlog: Arc<NetLog>,
    pub started: Instant,
}

pub async fn serve(cfg: Config) -> std::io::Result<()> {
    let cfg = Arc::new(cfg);
    let netlog = Arc::new(NetLog::open(cfg.net_log));
    netlog.event(
        "info",
        "session start",
        Some(serde_json::json!({
            "file": netlog.session_rel(),
            "port": cfg.port,
        })),
    );
    let hub = Hub::new(Arc::clone(&cfg), Arc::clone(&netlog));
    let app = Arc::new(App {
        hub,
        cfg: Arc::clone(&cfg),
        netlog: Arc::clone(&netlog),
        started: Instant::now(),
    });

    let addr = cfg.bind_addr().map_err(|err| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, err)
    })?;
    let listener = match TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(err) if err.kind() == std::io::ErrorKind::AddrInUse => {
            println!("[review] sync already running on :{}", cfg.port);
            std::process::exit(0);
        }
        Err(err) => return Err(err),
    };
    print_banner(&cfg, &netlog);
    let addresses = list_lan_addresses();
    netlog.event(
        "info",
        "listen",
        Some(serde_json::json!({
            "addresses": addresses,
            "port": cfg.port,
            "host": cfg.host,
            "emptyRoomGcMs": cfg.empty_room_gc.as_millis() as u64,
            "maxPayload": cfg.max_payload,
            "maxRooms": cfg.max_rooms,
        })),
    );

    let gc_app = Arc::clone(&app);
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(gc_app.cfg.gc_tick);
        tick.tick().await;
        loop {
            tick.tick().await;
            gc_app.hub.gc_once().await;
        }
    });

    let router = Router::new()
        .fallback(dispatch)
        .layer(axum::middleware::from_fn_with_state(
            Arc::clone(&app),
            cors_layer,
        ))
        .with_state(app);

    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
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

fn print_banner(cfg: &Config, netlog: &NetLog) {
    println!("[review] sync server on {}:{}", cfg.host, cfg.port);
    if cfg.host == "0.0.0.0" || cfg.host == "::" {
        println!("[review]   local:   ws://localhost:{}", cfg.port);
        let addresses = list_lan_addresses();
        for ip in &addresses {
            println!(
                "[review]   network: ws://{}:{}",
                format_lan_host(ip),
                cfg.port
            );
        }
        if addresses.is_empty() {
            println!("[review]   (no private LAN address found)");
        }
        println!(
            "[review]   UI (dev): http://<lan-ip>:{}  — friends open that, not localhost",
            cfg.ui_port
        );
    } else {
        println!(
            "[review]   ws://{}:{}",
            format_host_for_url(&cfg.host),
            cfg.port
        );
        println!(
            "[review]   UI (dev): http://{}:{}",
            format_host_for_url(&cfg.host),
            cfg.ui_port
        );
    }
    let secs = (cfg.empty_room_gc.as_millis() as f64 / 1000.0).round() as u64;
    println!("[review:net] empty-room GC after {secs}s");
    if cfg.net_log {
        println!("[review:net] session log → {}", netlog.session_rel());
        println!("[review:net] verbose HTTP logging on (REVIEW_NET_LOG)");
    }
}

async fn cors_layer(State(app): State<Arc<App>>, req: Request, next: Next) -> Response {
    if req.method() == Method::OPTIONS {
        return options_response(&app);
    }
    let mut res = next.run(req).await;
    apply_cors(&app, res.headers_mut());
    res
}

fn apply_cors(app: &App, headers: &mut HeaderMap) {
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, HEAD, POST, DELETE, OPTIONS"),
    );
    let allow = match app.cfg.mode {
        Mode::Node => "Content-Type, Authorization, X-Review-Compact-Token, X-Review-Room-Delete-Token",
        Mode::Worker => {
            "Content-Type, Authorization, X-Review-Compact-Token, X-Review-Room-Delete-Token, Upgrade, Connection, Sec-WebSocket-Key, Sec-WebSocket-Version"
        }
    };
    if let Ok(value) = HeaderValue::from_str(allow) {
        headers.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, value);
    }
    headers.insert(
        header::ACCESS_CONTROL_MAX_AGE,
        HeaderValue::from_static("86400"),
    );
}

fn options_response(app: &App) -> Response {
    let mut res = Response::builder()
        .status(StatusCode::NO_CONTENT)
        .body(Body::empty())
        .unwrap();
    apply_cors(app, res.headers_mut());
    res
}

async fn dispatch(
    State(app): State<Arc<App>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request,
) -> Response {
    if is_websocket(&req) {
        return upgrade(app, addr, req).await;
    }
    match app.cfg.mode {
        Mode::Node => node_http(app, addr, req).await,
        Mode::Worker => worker_http(app, addr, req).await,
    }
}

fn is_websocket(req: &Request) -> bool {
    req.headers()
        .get(header::UPGRADE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.eq_ignore_ascii_case("websocket"))
        .unwrap_or(false)
}

async fn upgrade(app: Arc<App>, addr: SocketAddr, req: Request) -> Response {
    let path = req.uri().path().to_string();
    let (mut parts, _body) = req.into_parts();
    match WebSocketUpgrade::from_request_parts(&mut parts, &()).await {
        Ok(ws) => {
            let max = app.cfg.max_payload;
            ws.max_message_size(max)
                .max_frame_size(max)
                .on_upgrade(move |socket| drive_socket(socket, app, path, addr))
        }
        Err(err) => err.into_response(),
    }
}

async fn drive_socket(mut socket: WebSocket, app: Arc<App>, path: String, addr: SocketAddr) {
    let remote = addr.ip().to_string();
    let room = room_from_websocket_path(&path);
    if !is_valid_room_name(&room) {
        println!("[review:net] ws reject bad room from={remote} room={room}");
        app.netlog.event(
            "warn",
            "ws reject bad room",
            Some(serde_json::json!({ "room": room, "from": remote })),
        );
        let _ = socket
            .send(close_message(1008, "bad room"))
            .await;
        return;
    }
    let live = match app.hub.connect(&room, remote.clone()).await {
        Ok(live) => live,
        Err(ConnectError::TooMany) => {
            println!(
                "[review:net] ws reject max rooms from={remote} room={room} size={}",
                app.cfg.max_rooms
            );
            app.netlog.event(
                "warn",
                "ws reject max rooms",
                Some(serde_json::json!({
                    "room": room,
                    "from": remote,
                    "size": app.cfg.max_rooms,
                })),
            );
            let _ = socket
                .send(close_message(1013, "too many rooms"))
                .await;
            return;
        }
        Err(ConnectError::Failed) => {
            let _ = socket
                .send(close_message(1011, "setup failed"))
                .await;
            return;
        }
    };

    let id = live.id;
    let room_tx = live.room;
    let mut outbound = live.outbound;
    let mut pong_ok = true;
    let mut ping = tokio::time::interval(std::time::Duration::from_secs(30));
    ping.tick().await;

    let (code, reason) = loop {
        tokio::select! {
            biased;
            out = outbound.recv() => {
                match out {
                    Some(Out::Bin(bytes)) => {
                        if socket.send(Message::Binary(bytes.into())).await.is_err() {
                            break (1006, String::new());
                        }
                    }
                    Some(Out::Close { code, reason }) => {
                        let _ = socket.send(close_message(code, &reason)).await;
                        break (code, reason);
                    }
                    None => break (1006, String::new()),
                }
            }
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Binary(bin))) => push_bin(&room_tx, id, bin.to_vec()),
                    Some(Ok(Message::Text(text))) => {
                        if text.as_str() == "review-ka" {
                            let _ = socket
                                .send(Message::Text("review-ka-ack".into()))
                                .await;
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        let _ = socket.send(Message::Pong(payload)).await;
                    }
                    Some(Ok(Message::Pong(_))) => {
                        pong_ok = true;
                    }
                    Some(Ok(Message::Close(frame))) => {
                        let (code, reason) = match frame {
                            Some(frame) => (frame.code.into(), frame.reason.to_string()),
                            None => (1005, String::new()),
                        };
                        break (code, reason);
                    }
                    Some(Err(_)) | None => break (1006, String::new()),
                }
            }
            _ = ping.tick() => {
                if !pong_ok {
                    let _ = socket.send(close_message(1000, "ping timeout")).await;
                    break (1000, "ping timeout".to_string());
                }
                pong_ok = false;
                if socket.send(Message::Ping(Vec::<u8>::new().into())).await.is_err() {
                    break (1006, String::new());
                }
            }
        }
    };
    leave(&room_tx, id, code, reason);
}

fn close_message(code: u16, reason: &str) -> Message {
    Message::Close(Some(CloseFrame {
        code: code.into(),
        reason: reason.to_string().into(),
    }))
}

async fn node_http(app: Arc<App>, addr: SocketAddr, req: Request) -> Response {
    let path = req.uri().path().to_string();
    let method = req.method().clone();
    if path == "/health" || path == "/healthz" {
        if method == Method::HEAD {
            return empty_json();
        }
        return json(StatusCode::OK, health_body(&app).await);
    }
    if path.starts_with("/room/") && method == Method::DELETE {
        return delete_room(&app, &path, &addr, req.headers(), false).await;
    }
    if path == "/lan" {
        if app.cfg.net_log {
            let remote = addr.ip().to_string();
            println!("[review:net] GET /lan from={remote}");
            app.netlog.event(
                "info",
                "GET /lan",
                Some(serde_json::json!({ "from": remote })),
            );
        }
        return json(
            StatusCode::OK,
            serde_json::json!({
                "ok": true,
                "port": app.cfg.port,
                "addresses": list_lan_addresses(),
            }),
        );
    }
    if path == "/net-log" && (method == Method::GET || method == Method::POST) {
        if !app.cfg.net_log {
            return json(StatusCode::NOT_FOUND, serde_json::json!({ "ok": false }));
        }
        if method == Method::GET {
            return json(
                StatusCode::OK,
                serde_json::json!({
                    "ok": true,
                    "file": app.netlog.session_rel(),
                    "latest": app.netlog.latest_rel(),
                }),
            );
        }
        return net_log_post(app, req).await;
    }
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Body::from("ReView — sync server"))
        .unwrap()
}

async fn worker_http(app: Arc<App>, addr: SocketAddr, req: Request) -> Response {
    let path = req.uri().path().to_string();
    let method = req.method().clone();
    if path == "/health" || path == "/healthz" {
        if method == Method::HEAD {
            return empty_json();
        }
        return json(
            StatusCode::OK,
            serde_json::json!({
                "ok": true,
                "service": "review-sync-worker",
                "emptyRoomGcMs": app.cfg.empty_room_gc.as_millis() as u64,
            }),
        );
    }
    if path == "/" || path.is_empty() {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(Body::from(
                "ReView sync worker — use wss://<host>/review-<boardId>",
            ))
            .unwrap();
    }
    if path.starts_with("/room/") && method == Method::DELETE {
        return delete_room(&app, &path, &addr, req.headers(), true).await;
    }
    let room = room_from_websocket_path(&path);
    if !is_valid_room_name(&room) {
        return json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "ok": false, "error": "bad room" }),
        );
    }
    Response::builder()
        .status(StatusCode::UPGRADE_REQUIRED)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Body::from("Expected websocket"))
        .unwrap()
}

async fn delete_room(
    app: &App,
    path: &str,
    addr: &SocketAddr,
    headers: &HeaderMap,
    worker: bool,
) -> Response {
    let room = room_from_delete_path(path);
    if !is_valid_room_name(&room) {
        return json(
            StatusCode::BAD_REQUEST,
            serde_json::json!({ "ok": false, "error": "bad room" }),
        );
    }
    let presented = presented_token(headers);
    let remote = addr.ip().to_string();
    if worker {
        let sockets = app.hub.socket_count(&room).await;
        if !worker_delete_authorized(&presented, &app.cfg.token, sockets) {
            println!("[review:net] room DELETE denied from={remote} room={room}");
            app.netlog.event(
                "warn",
                "room DELETE denied",
                Some(serde_json::json!({ "from": remote, "room": room })),
            );
            return json(StatusCode::FORBIDDEN, serde_json::json!({ "ok": false }));
        }
        let _existed = app.hub.clear_room(&room).await;
        return json(
            StatusCode::OK,
            serde_json::json!({ "ok": true, "cleared": true }),
        );
    }
    if !node_delete_authorized(&remote, &presented, &app.cfg.token) {
        println!("[review:net] room DELETE denied from={remote} room={room}");
        app.netlog.event(
            "warn",
            "room DELETE denied",
            Some(serde_json::json!({ "from": remote, "room": room })),
        );
        return json(StatusCode::FORBIDDEN, serde_json::json!({ "ok": false }));
    }
    let cleared = app.hub.clear_room(&room).await;
    json(
        StatusCode::OK,
        serde_json::json!({ "ok": true, "cleared": cleared, "room": room }),
    )
}

fn presented_token(headers: &HeaderMap) -> PresentedToken {
    PresentedToken::from_header_values(
        header_str(headers, "x-review-compact-token"),
        header_str(headers, "x-review-room-delete-token"),
        header_str(headers, "authorization"),
    )
}

fn header_str<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

async fn health_body(app: &App) -> serde_json::Value {
    serde_json::json!({
        "ok": true,
        "service": app.cfg.service_name(),
        "port": app.cfg.port,
        "rooms": app.hub.room_count().await,
        "emptyRoomGcMs": app.cfg.empty_room_gc.as_millis() as u64,
        "maxPayload": app.cfg.max_payload,
        "maxRooms": app.cfg.max_rooms,
        "netLog": app.cfg.net_log,
        "uptimeMs": app.started.elapsed().as_millis() as u64,
    })
}

async fn net_log_post(app: Arc<App>, req: Request) -> Response {
    let bytes = match axum::body::to_bytes(req.into_body(), BODY_MAX).await {
        Ok(bytes) => bytes,
        Err(_) => {
            app.netlog.event("warn", "net-log POST failed", None);
            return json(StatusCode::BAD_REQUEST, serde_json::json!({ "ok": false }));
        }
    };
    let raw = String::from_utf8_lossy(&bytes);
    let parsed: serde_json::Value = if raw.trim().is_empty() {
        serde_json::json!({})
    } else {
        match serde_json::from_str(raw.trim()) {
            Ok(v) => v,
            Err(_) => {
                app.netlog.event("warn", "net-log POST failed", None);
                return json(StatusCode::BAD_REQUEST, serde_json::json!({ "ok": false }));
            }
        }
    };
    let incoming = if let Some(lines) = parsed.get("lines").and_then(|v| v.as_array()) {
        lines.clone()
    } else {
        vec![parsed]
    };
    let mut written = 0;
    for line in incoming.into_iter().take(NET_LOG_MAX_LINES) {
        if app.netlog.append_client(&line) {
            written += 1;
        }
    }
    json(
        StatusCode::OK,
        serde_json::json!({
            "ok": true,
            "file": app.netlog.session_rel(),
            "written": written,
        }),
    )
}

fn json(status: StatusCode, body: serde_json::Value) -> Response {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(body.to_string()))
        .unwrap()
}

fn empty_json() -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::empty())
        .unwrap()
}
