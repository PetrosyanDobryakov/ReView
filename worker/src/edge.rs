//! Worker fetch handler. Same routes as `worker/src/index.ts`.
//! Valid rooms are forwarded to the `BoardRoom` Durable Object.

use worker::*;

use crate::blob::EMPTY_GC_MS;
use crate::names::{is_valid_room_name, room_from_delete_path, room_from_websocket_path};

const ALLOW_HEADERS: &str = "Content-Type, Authorization, X-Review-Compact-Token, X-Review-Room-Delete-Token, Upgrade, Connection, Sec-WebSocket-Key, Sec-WebSocket-Version";

#[event(fetch, respond_with_errors)]
pub async fn main(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    console_error_panic_hook::set_once();
    route(req, env).await
}

async fn route(req: Request, env: Env) -> Result<Response> {
    let path = req.path();
    if req.method() == Method::Options {
        let resp = Response::empty()?.with_status(204);
        return with_cors(resp);
    }
    if path == "/health" || path == "/healthz" {
        if req.method() == Method::Head {
            let mut resp = Response::empty()?;
            resp.headers_mut()
                .set("Content-Type", "application/json; charset=utf-8")?;
            resp.headers_mut().set("Cache-Control", "no-store")?;
            return with_cors(resp);
        }
        return json_response(
            200,
            &serde_json::json!({
                "ok": true,
                "service": "review-sync-worker",
                "emptyRoomGcMs": EMPTY_GC_MS,
            }),
        );
    }
    if path == "/" || path.is_empty() {
        let resp = Response::ok("ReView sync worker — use wss://<host>/review-<boardId>")?;
        return with_cors(resp);
    }
    let is_delete = path.starts_with("/room/") && req.method() == Method::Delete;
    let room = if is_delete {
        room_from_delete_path(&path)
    } else {
        room_from_websocket_path(&path)
    };
    if !is_valid_room_name(&room) {
        return json_response(400, &serde_json::json!({ "ok": false, "error": "bad room" }));
    }
    let namespace = env.durable_object("BOARD_ROOM")?;
    let stub = namespace.get_by_name(&room)?;
    stub.fetch_with_request(req).await
}

fn json_response(status: u16, body: &serde_json::Value) -> Result<Response> {
    let mut resp = Response::from_json(body)?.with_status(status);
    resp.headers_mut()
        .set("Content-Type", "application/json; charset=utf-8")?;
    resp.headers_mut().set("Cache-Control", "no-store")?;
    with_cors(resp)
}

fn with_cors(mut resp: Response) -> Result<Response> {
    let headers = resp.headers_mut();
    headers.set("Access-Control-Allow-Origin", "*")?;
    headers.set(
        "Access-Control-Allow-Methods",
        "GET, POST, DELETE, OPTIONS, HEAD",
    )?;
    headers.set("Access-Control-Allow-Headers", ALLOW_HEADERS)?;
    headers.set("Access-Control-Max-Age", "86400")?;
    Ok(resp)
}
