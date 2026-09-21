//! Hibernating Yjs room. Mirrors `worker/src/room.ts`.
//!
//! The constructor only arms `setWebSocketAutoResponse`. The CRDT is loaded
//! on sync/accept, not on awareness, so a cursor wake does not read blobs.
//! `review-ka` is answered by the runtime without invoking `websocket_message`.

use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::Rc;
use std::sync::{Arc, Mutex as StdMutex};

use async_lock::Mutex;
use serde::{Deserialize, Serialize};
use worker::*;
use yrs::sync::{Awareness, DefaultProtocol, Message, Protocol, SyncMessage};
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{ClientID, Doc, Options, ReadTxn, StateVector, Transact, Update};

use crate::blob::{
    can_drop_persisted_tail, can_gc_empty_room, should_full_persist, AWARENESS_QUIET_BEFORE_FULL_MS,
    EMPTY_GC_MS, FULL_PERSIST_IDLE_MS, MAX_WS_MESSAGE, TAIL_FLUSH_MS,
};
use crate::storage_blob::{delete_blob, merge_tails, read_blob, write_blob};
use crate::token::{can_clear_room, close_reason, expected_token, is_room_delete_authorized, presented_secret, safe_close_code};

pub const WS_KEEPALIVE_REQUEST: &str = "review-ka";
pub const WS_KEEPALIVE_RESPONSE: &str = "review-ka-ack";

#[derive(Serialize, Deserialize, Default)]
struct SockAtt {
    clients: Vec<u64>,
}

struct Effects {
    doc_frames: Vec<Vec<u8>>,
    aw_frames: Vec<Vec<u8>>,
    persisted: Vec<Vec<u8>>,
}

impl Effects {
    fn take_frames(&mut self) -> (Vec<Vec<u8>>, Vec<Vec<u8>>) {
        (
            std::mem::take(&mut self.doc_frames),
            std::mem::take(&mut self.aw_frames),
        )
    }
}

struct Core {
    awareness: Option<Awareness>,
    doc_hydrated: bool,
    dirty: bool,
    pending: Vec<Vec<u8>>,
    persist_gen: u64,
    last_persist_ms: f64,
    last_aware_ms: f64,
    tail_armed: bool,
    full_gen: u64,
    suppress_persist: bool,
    wipe_in_flight: bool,
    alarm_scheduled: bool,
    room_tag: String,
    ws_kind_sample: u32,
}

impl Core {
    fn new() -> Self {
        Self {
            awareness: None,
            doc_hydrated: false,
            dirty: false,
            pending: Vec::new(),
            persist_gen: 0,
            last_persist_ms: 0.0,
            last_aware_ms: 0.0,
            tail_armed: false,
            full_gen: 0,
            suppress_persist: false,
            wipe_in_flight: false,
            alarm_scheduled: false,
            room_tag: String::new(),
            ws_kind_sample: 0,
        }
    }
}

struct Shared {
    state: State,
    env: Env,
    core: RefCell<Core>,
    effects: Arc<StdMutex<Effects>>,
    current: Arc<StdMutex<Option<WebSocket>>>,
    gate: Mutex<()>,
}

#[durable_object]
pub struct BoardRoom {
    shared: Rc<Shared>,
}

impl DurableObject for BoardRoom {
    fn new(state: State, env: Env) -> Self {
        console_error_panic_hook::set_once();
        let shared = Rc::new(Shared {
            state,
            env,
            core: RefCell::new(Core::new()),
            effects: Arc::new(StdMutex::new(Effects {
                doc_frames: Vec::new(),
                aw_frames: Vec::new(),
                persisted: Vec::new(),
            })),
            current: Arc::new(StdMutex::new(None)),
            gate: Mutex::new(()),
        });
        arm_keepalive(&shared.state);
        Self { shared }
    }

    async fn fetch(&self, req: Request) -> Result<Response> {
        let path = req.path();
        if req.method() == Method::Delete && path.starts_with("/room/") {
            return self.delete_room(req).await;
        }
        let upgrade = req.headers().get("Upgrade")?.unwrap_or_default();
        if !upgrade.eq_ignore_ascii_case("websocket") {
            return Response::error("Expected websocket", 426);
        }
        if self.shared.core.borrow().wipe_in_flight {
            return wiping_response();
        }
        let freshly = ensure_doc_loaded(&self.shared).await;
        if self.shared.core.borrow().wipe_in_flight {
            return wiping_response();
        }
        let tag = path.trim_start_matches('/').chars().take(80).collect::<String>();
        if !tag.is_empty() {
            self.shared.core.borrow_mut().room_tag = tag;
        }
        self.shared.core.borrow_mut().suppress_persist = false;

        let pair = WebSocketPair::new()?;
        let client = pair.client;
        let server = pair.server;
        arm_keepalive(&self.shared.state);
        self.shared.state.accept_web_socket(&server);
        let _ = server.serialize_attachment(&SockAtt { clients: Vec::new() });

        if self.shared.core.borrow().alarm_scheduled {
            let _ = self.shared.state.storage().delete_alarm().await;
            self.shared.core.borrow_mut().alarm_scheduled = false;
        }

        send_step1(&self.shared, &server);
        if freshly {
            // Accept always loads. The snapshot is the same path as a fresh load.
        }
        send_awareness_snapshot(&self.shared, &server);
        Response::from_websocket(client)
    }

    async fn alarm(&self) -> Result<Response> {
        self.shared.core.borrow_mut().alarm_scheduled = false;
        if self.shared.core.borrow().suppress_persist {
            return Response::empty();
        }
        let needs_flush = {
            let c = self.shared.core.borrow();
            c.doc_hydrated && (c.dirty || !c.pending.is_empty())
        };
        if needs_flush {
            flush_full(&self.shared).await;
        }
        if self.shared.core.borrow().suppress_persist {
            return Response::empty();
        }
        let sockets = self.shared.state.get_websockets().len();
        let (dirty, pending) = {
            let c = self.shared.core.borrow();
            (c.dirty, c.pending.len())
        };
        if !can_gc_empty_room(sockets, dirty, pending) {
            if sockets == 0 {
                let _ = self
                    .shared
                    .state
                    .storage()
                    .set_alarm(EMPTY_GC_MS as i64)
                    .await;
                self.shared.core.borrow_mut().alarm_scheduled = true;
            }
            return Response::empty();
        }
        let _ = wipe_room(&self.shared).await;
        Response::empty()
    }

    async fn websocket_message(
        &self,
        ws: WebSocket,
        message: WebSocketIncomingMessage,
    ) -> Result<()> {
        match message {
            WebSocketIncomingMessage::String(text) => {
                if text == WS_KEEPALIVE_REQUEST {
                    maybe_log(&self.shared, "ka-fallback");
                    let _ = ws.send_with_str(WS_KEEPALIVE_RESPONSE);
                }
                return Ok(());
            }
            WebSocketIncomingMessage::Binary(data) => {
                if let Err(err) = on_binary(&self.shared, &ws, &data).await {
                    console_error!("[BoardRoom] message error {err}");
                }
                Ok(())
            }
        }
    }

    async fn websocket_close(
        &self,
        ws: WebSocket,
        code: usize,
        reason: String,
        _was_clean: bool,
    ) -> Result<()> {
        reciprocate(&ws, code, &reason);
        let _ = handle_gone(&self.shared, &ws).await;
        Ok(())
    }

    async fn websocket_error(&self, ws: WebSocket, _error: Error) -> Result<()> {
        reciprocate(&ws, 1000, "");
        let _ = handle_gone(&self.shared, &ws).await;
        Ok(())
    }
}

impl BoardRoom {
    async fn delete_room(&self, req: Request) -> Result<Response> {
        let authorized = delete_authorized(&self.shared.env, &req);
        let sockets = self.shared.state.get_websockets();
        if !can_clear_room(authorized, sockets.len()) {
            return do_json(403, &serde_json::json!({ "ok": false }));
        }
        {
            let mut c = self.shared.core.borrow_mut();
            c.wipe_in_flight = true;
            c.suppress_persist = true;
            c.pending.clear();
            c.dirty = false;
            c.full_gen = c.full_gen.wrapping_add(1);
            c.tail_armed = false;
        }
        for ws in sockets {
            let _ = ws.close(Some(1000), Some("room cleared"));
        }
        wipe_room(&self.shared).await?;
        do_json(200, &serde_json::json!({ "ok": true, "cleared": true }))
    }
}

fn delete_authorized(env: &Env, req: &Request) -> bool {
    let compact = env_string(env, "REVIEW_COMPACT_TOKEN");
    let alias = env_string(env, "REVIEW_ROOM_DELETE_TOKEN");
    let expected = expected_token(&compact, &alias);
    let headers = req.headers();
    let presented = presented_secret(
        &headers.get("X-Review-Compact-Token").ok().flatten().unwrap_or_default(),
        &headers
            .get("X-Review-Room-Delete-Token")
            .ok()
            .flatten()
            .unwrap_or_default(),
        &headers.get("Authorization").ok().flatten().unwrap_or_default(),
    );
    is_room_delete_authorized(&presented, &expected)
}

fn env_string(env: &Env, key: &str) -> String {
    if let Ok(secret) = env.secret(key) {
        let s = secret.to_string();
        if !s.is_empty() {
            return s;
        }
    }
    if let Ok(var) = env.var(key) {
        let s = var.to_string();
        if !s.is_empty() {
            return s;
        }
    }
    String::new()
}

fn do_json(status: u16, body: &serde_json::Value) -> Result<Response> {
    let mut resp = Response::from_json(body)?.with_status(status);
    resp.headers_mut().set("Content-Type", "application/json")?;
    resp.headers_mut()
        .set("Access-Control-Allow-Origin", "*")?;
    Ok(resp)
}

fn wiping_response() -> Result<Response> {
    do_json(503, &serde_json::json!({ "ok": false, "wiping": true }))
}

fn arm_keepalive(state: &State) {
    match WebSocketRequestResponsePair::new(WS_KEEPALIVE_REQUEST, WS_KEEPALIVE_RESPONSE) {
        Ok(pair) => state.set_websocket_auto_response(&pair),
        Err(err) => {
            console_error!("[BoardRoom] keepalive auto-response arm failed {err:?}");
        }
    }
}

fn new_awareness() -> Awareness {
    let mut opts = Options::default();
    opts.skip_gc = true;
    // SystemClock is not compiled for wasm32-unknown-unknown.
    Awareness::with_clock(Doc::with_options(opts), || js_sys::Date::now() as u64)
}

fn lock_fx(effects: &StdMutex<Effects>) -> std::sync::MutexGuard<'_, Effects> {
    effects.lock().unwrap_or_else(|err| err.into_inner())
}

fn lock_current(current: &StdMutex<Option<WebSocket>>) -> std::sync::MutexGuard<'_, Option<WebSocket>> {
    current.lock().unwrap_or_else(|err| err.into_inner())
}

fn bind(shared: &Rc<Shared>, awareness: &mut Awareness) {
    let effects = Arc::clone(&shared.effects);
    let _ = awareness
        .doc()
        .observe_update_v1("review-do-doc", move |_txn, ev| {
            let msg = Message::Sync(SyncMessage::Update(ev.update.clone())).encode_v1();
            let mut fx = lock_fx(&effects);
            fx.doc_frames.push(msg);
            fx.persisted.push(ev.update.clone());
        });
    let effects = Arc::clone(&shared.effects);
    let current = Arc::clone(&shared.current);
    awareness.on_update("review-do-aw", move |aw, ev, _origin| {
        let changed = ev.all_changes();
        if !changed.is_empty() {
            if let Ok(upd) = aw.update_with_clients(changed) {
                let msg = Message::Awareness(upd).encode_v1();
                lock_fx(&effects).aw_frames.push(msg);
            }
        }
        if let Some(ws) = lock_current(&current).clone() {
            track_clients(&ws, ev.added(), ev.updated(), ev.removed());
        }
    });
}

fn track_clients(ws: &WebSocket, added: &[ClientID], updated: &[ClientID], removed: &[ClientID]) {
    let mut set: HashSet<u64> = read_clients(ws).into_iter().collect();
    for id in added {
        set.insert(id.get());
    }
    for id in updated {
        set.insert(id.get());
    }
    for id in removed {
        set.remove(&id.get());
    }
    let clients: Vec<u64> = set.into_iter().collect();
    let _ = ws.serialize_attachment(&SockAtt { clients });
}

fn read_clients(ws: &WebSocket) -> Vec<u64> {
    match ws.deserialize_attachment::<SockAtt>() {
        Ok(Some(att)) => att.clients,
        _ => Vec::new(),
    }
}

fn apply_bytes(awareness: &Awareness, bytes: &[u8]) {
    let Ok(update) = Update::decode_v1(bytes) else {
        console_error!("[BoardRoom] load update failed");
        return;
    };
    if let Err(err) = awareness.doc().transact_mut().apply_update(update) {
        console_error!("[BoardRoom] load update failed {err}");
    }
}

async fn ensure_doc_loaded(shared: &Rc<Shared>) -> bool {
    {
        let c = shared.core.borrow();
        if c.doc_hydrated && c.awareness.is_some() {
            return false;
        }
    }
    let storage = shared.state.storage();
    let doc_bytes = read_blob(&storage, "doc").await;
    let tail_bytes = read_blob(&storage, "tail").await;
    if shared.core.borrow().wipe_in_flight {
        return false;
    }
    let mut awareness = new_awareness();
    if let Some(bytes) = doc_bytes.as_deref() {
        apply_bytes(&awareness, bytes);
    }
    if let Some(bytes) = tail_bytes.as_deref() {
        apply_bytes(&awareness, bytes);
    }
    bind(shared, &mut awareness);
    let mut c = shared.core.borrow_mut();
    c.awareness = Some(awareness);
    c.doc_hydrated = true;
    c.dirty = false;
    c.pending.clear();
    c.persist_gen = 0;
    true
}

fn ensure_awareness_hub(shared: &Rc<Shared>) {
    if shared.core.borrow().awareness.is_some() {
        return;
    }
    let mut awareness = new_awareness();
    bind(shared, &mut awareness);
    let mut c = shared.core.borrow_mut();
    if c.awareness.is_some() {
        return;
    }
    c.awareness = Some(awareness);
    c.doc_hydrated = false;
    c.dirty = false;
    c.pending.clear();
    c.persist_gen = 0;
}

fn reset_room(shared: &Rc<Shared>) {
    let mut awareness = new_awareness();
    bind(shared, &mut awareness);
    let mut c = shared.core.borrow_mut();
    c.awareness = Some(awareness);
    c.doc_hydrated = true;
    c.dirty = false;
    c.pending.clear();
    c.persist_gen = 0;
    c.last_persist_ms = 0.0;
}

fn send_step1(shared: &Shared, ws: &WebSocket) {
    let c = shared.core.borrow();
    let Some(aw) = c.awareness.as_ref() else {
        return;
    };
    let sv = aw.doc().transact().state_vector();
    let frame = Message::Sync(SyncMessage::SyncStep1(sv)).encode_v1();
    drop(c);
    let _ = ws.send_with_bytes(&frame);
}

fn send_awareness_snapshot(shared: &Shared, ws: &WebSocket) {
    let c = shared.core.borrow();
    let Some(aw) = c.awareness.as_ref() else {
        return;
    };
    let Ok(upd) = aw.update() else {
        return;
    };
    if upd.clients.is_empty() {
        return;
    }
    let frame = Message::Awareness(upd).encode_v1();
    drop(c);
    let _ = ws.send_with_bytes(&frame);
}

fn fanout(shared: &Shared, current: Option<&WebSocket>) {
    let (doc_frames, aw_frames) = lock_fx(&shared.effects).take_frames();
    let sockets = shared.state.get_websockets();
    for frame in &doc_frames {
        for ws in &sockets {
            if current.is_some_and(|cur| cur == ws) {
                continue;
            }
            let _ = ws.send_with_bytes(frame);
        }
    }
    for frame in &aw_frames {
        for ws in &sockets {
            let _ = ws.send_with_bytes(frame);
        }
    }
}

fn note_persisted(shared: &Rc<Shared>) {
    let updates = {
        let mut fx = lock_fx(&shared.effects);
        std::mem::take(&mut fx.persisted)
    };
    if updates.is_empty() {
        return;
    }
    {
        let mut c = shared.core.borrow_mut();
        if c.suppress_persist || !c.doc_hydrated {
            return;
        }
        c.dirty = true;
        c.persist_gen = c.persist_gen.saturating_add(updates.len() as u64);
        c.pending.extend(updates);
    }
    queue_tail(shared);
}

fn queue_tail(shared: &Rc<Shared>) {
    {
        let mut c = shared.core.borrow_mut();
        if c.suppress_persist || c.tail_armed || c.pending.is_empty() {
            return;
        }
        c.tail_armed = true;
    }
    let shared2 = Rc::clone(shared);
    shared.state.wait_until(async move {
        Delay::from(std::time::Duration::from_millis(TAIL_FLUSH_MS)).await;
        shared2.core.borrow_mut().tail_armed = false;
        if shared2.core.borrow().suppress_persist {
            return;
        }
        flush_tail(&shared2).await;
        if !shared2.core.borrow().suppress_persist && !shared2.core.borrow().pending.is_empty() {
            queue_tail(&shared2);
        }
    });
}

fn queue_full(shared: &Rc<Shared>) {
    let gen = {
        let mut c = shared.core.borrow_mut();
        if c.suppress_persist || !c.dirty {
            return;
        }
        c.full_gen = c.full_gen.wrapping_add(1);
        c.full_gen
    };
    let shared2 = Rc::clone(shared);
    shared.state.wait_until(async move {
        Delay::from(std::time::Duration::from_millis(FULL_PERSIST_IDLE_MS)).await;
        if shared2.core.borrow().full_gen != gen {
            return;
        }
        if shared2.core.borrow().suppress_persist || !shared2.core.borrow().dirty {
            return;
        }
        let since = {
            let c = shared2.core.borrow();
            if c.last_aware_ms > 0.0 {
                js_sys::Date::now() - c.last_aware_ms
            } else {
                AWARENESS_QUIET_BEFORE_FULL_MS
            }
        };
        if since < AWARENESS_QUIET_BEFORE_FULL_MS {
            queue_full(&shared2);
            return;
        }
        let allow = {
            let c = shared2.core.borrow();
            should_full_persist(c.last_persist_ms, js_sys::Date::now())
        };
        if !allow {
            return;
        }
        flush_full(&shared2).await;
    });
}

async fn flush_tail(shared: &Rc<Shared>) {
    let storage = shared.state.storage();
    let _guard = shared.gate.lock().await;
    flush_tail_locked(shared, &storage).await;
}

async fn flush_tail_locked(shared: &Rc<Shared>, storage: &Storage) {
    let batch = {
        let mut c = shared.core.borrow_mut();
        if c.suppress_persist || c.pending.is_empty() {
            return;
        }
        std::mem::take(&mut c.pending)
    };
    let prev = read_blob(storage, "tail").await;
    match merge_tails(prev.as_deref(), &batch) {
        Some(merged) => {
            if let Err(err) = write_blob(storage, "tail", &merged).await {
                console_error!("[BoardRoom] tail persist failed {err}");
                if !shared.core.borrow().suppress_persist {
                    let mut c = shared.core.borrow_mut();
                    let mut restored = batch;
                    restored.extend(std::mem::take(&mut c.pending));
                    c.pending = restored;
                    c.dirty = true;
                }
            }
        }
        None => {
            if !shared.core.borrow().suppress_persist {
                let mut c = shared.core.borrow_mut();
                let mut restored = batch;
                restored.extend(std::mem::take(&mut c.pending));
                c.pending = restored;
                c.dirty = true;
            }
        }
    }
}

async fn flush_full(shared: &Rc<Shared>) {
    let storage = shared.state.storage();
    let _guard = shared.gate.lock().await;
    {
        let c = shared.core.borrow();
        if c.suppress_persist || !c.doc_hydrated || c.awareness.is_none() {
            return;
        }
        if !c.dirty && c.pending.is_empty() {
            return;
        }
    }
    flush_tail_locked(shared, &storage).await;
    if shared.core.borrow().suppress_persist {
        return;
    }
    let encode_gen = shared.core.borrow().persist_gen;
    let bytes = {
        let c = shared.core.borrow();
        let Some(aw) = c.awareness.as_ref() else {
            return;
        };
        let bytes = aw
            .doc()
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        bytes
    };
    if let Err(err) = write_blob(&storage, "doc", &bytes).await {
        console_error!("[BoardRoom] full persist failed {err}");
        if !shared.core.borrow().suppress_persist {
            shared.core.borrow_mut().dirty = true;
        }
        return;
    }
    flush_tail_locked(shared, &storage).await;
    if shared.core.borrow().suppress_persist {
        return;
    }
    let (gen, pending) = {
        let c = shared.core.borrow();
        (c.persist_gen, c.pending.len())
    };
    if !can_drop_persisted_tail(encode_gen, gen, pending) {
        shared.core.borrow_mut().dirty = true;
        return;
    }
    if let Err(err) = delete_blob(&storage, "tail").await {
        console_error!("[BoardRoom] tail delete failed {err}");
        shared.core.borrow_mut().dirty = true;
        return;
    }
    let (gen, pending) = {
        let c = shared.core.borrow();
        (c.persist_gen, c.pending.len())
    };
    if !can_drop_persisted_tail(encode_gen, gen, pending) {
        shared.core.borrow_mut().dirty = true;
        flush_tail_locked(shared, &storage).await;
        return;
    }
    let mut c = shared.core.borrow_mut();
    c.dirty = false;
    c.last_persist_ms = js_sys::Date::now();
}

async fn wipe_room(shared: &Rc<Shared>) -> Result<()> {
    {
        let mut c = shared.core.borrow_mut();
        c.wipe_in_flight = true;
        c.suppress_persist = true;
        c.pending.clear();
        c.dirty = false;
        c.full_gen = c.full_gen.wrapping_add(1);
    }
    let storage = shared.state.storage();
    let shared2 = Rc::clone(shared);
    let blocked = shared.state.block_concurrency_while(async move {
        let _guard = shared2.gate.lock().await;
        {
            let mut c = shared2.core.borrow_mut();
            c.pending.clear();
            c.dirty = false;
        }
        if let Err(err) = storage.delete_all().await {
            console_error!("[BoardRoom] deleteAll failed {err}");
            return Ok(());
        }
        reset_room(&shared2);
        Ok(())
    });
    let result = blocked.await;
    shared.core.borrow_mut().wipe_in_flight = false;
    result.map(|_| ())
}

fn peek_type(data: &[u8]) -> Option<u8> {
    let mut n: u64 = 0;
    let mut shift = 0;
    for b in data {
        n |= ((b & 0x7f) as u64) << shift;
        if b & 0x80 == 0 {
            return u8::try_from(n).ok();
        }
        shift += 7;
        if shift > 28 {
            return None;
        }
    }
    None
}

async fn on_binary(shared: &Rc<Shared>, ws: &WebSocket, data: &[u8]) -> Result<()> {
    if data.len() > MAX_WS_MESSAGE {
        console_error!("[BoardRoom] message too large {}", data.len());
        return Ok(());
    }
    let kind = peek_type(data);
    if kind == Some(1) {
        maybe_log(shared, "awareness");
        ensure_awareness_hub(shared);
        shared.core.borrow_mut().last_aware_ms = js_sys::Date::now();
        *lock_current(&shared.current) = Some(ws.clone());
        let replies = {
            let mut c = shared.core.borrow_mut();
            let aw = c.awareness.as_mut().ok_or_else(|| Error::RustError("no awareness".into()))?;
            DefaultProtocol
                .handle(aw, data)
                .map_err(|err| Error::RustError(err.to_string()))?
        };
        *lock_current(&shared.current) = None;
        fanout(shared, Some(ws));
        for msg in replies {
            let _ = ws.send_with_bytes(&msg.encode_v1());
        }
        // Drop doc frames that an awareness-only stub must not persist.
        lock_fx(&shared.effects).persisted.clear();
        return Ok(());
    }
    if kind == Some(0) {
        maybe_log(shared, "sync");
        let freshly = ensure_doc_loaded(shared).await;
        if freshly {
            send_step1(shared, ws);
            send_awareness_snapshot(shared, ws);
        }
        *lock_current(&shared.current) = Some(ws.clone());
        let replies = {
            let mut c = shared.core.borrow_mut();
            let aw = c.awareness.as_mut().ok_or_else(|| Error::RustError("no doc".into()))?;
            DefaultProtocol
                .handle(aw, data)
                .map_err(|err| Error::RustError(err.to_string()))?
        };
        *lock_current(&shared.current) = None;
        note_persisted(shared);
        fanout(shared, Some(ws));
        for msg in replies {
            let _ = ws.send_with_bytes(&msg.encode_v1());
        }
        queue_full(shared);
        return Ok(());
    }
    *lock_current(&shared.current) = Some(ws.clone());
    ensure_awareness_hub(shared);
    let replies = {
        let mut c = shared.core.borrow_mut();
        let Some(aw) = c.awareness.as_mut() else {
            return Ok(());
        };
        DefaultProtocol
            .handle(aw, data)
            .map_err(|err| Error::RustError(err.to_string()))?
    };
    *lock_current(&shared.current) = None;
    fanout(shared, Some(ws));
    for msg in replies {
        let _ = ws.send_with_bytes(&msg.encode_v1());
    }
    lock_fx(&shared.effects).persisted.clear();
    Ok(())
}

async fn handle_gone(shared: &Rc<Shared>, ws: &WebSocket) -> Result<()> {
    if shared.core.borrow().suppress_persist {
        return Ok(());
    }
    let clients = read_clients(ws);
    if !clients.is_empty() {
        if shared.core.borrow().awareness.is_some() {
            *lock_current(&shared.current) = None;
            {
                let mut c = shared.core.borrow_mut();
                if let Some(aw) = c.awareness.as_mut() {
                    for id in clients {
                        aw.remove_state(ClientID::new(id));
                    }
                }
            }
            fanout(shared, None);
            lock_fx(&shared.effects).persisted.clear();
        }
    }
    let needs_flush = {
        let c = shared.core.borrow();
        c.doc_hydrated && (c.dirty || !c.pending.is_empty())
    };
    if needs_flush {
        flush_full(shared).await;
    }
    if shared.core.borrow().suppress_persist {
        return Ok(());
    }
    if shared.state.get_websockets().is_empty() {
        let _ = shared.state.storage().set_alarm(EMPTY_GC_MS as i64).await;
        shared.core.borrow_mut().alarm_scheduled = true;
    }
    Ok(())
}

fn reciprocate(ws: &WebSocket, code: usize, reason: &str) {
    let raw = u16::try_from(code).unwrap_or(1000);
    let safe = safe_close_code(raw);
    let reason = close_reason(reason);
    if ws.close(Some(safe), Some(reason)).is_err() {
        let _ = ws.close(Some(1000), Some(""));
    }
}

fn maybe_log(shared: &Shared, kind: &str) {
    let room = {
        let mut c = shared.core.borrow_mut();
        let n = c.ws_kind_sample;
        c.ws_kind_sample = n.wrapping_add(1);
        if n & 63 != 0 {
            return;
        }
        if c.room_tag.is_empty() {
            "?".to_string()
        } else {
            c.room_tag.clone()
        }
    };
    let sockets = shared.state.get_websockets().len();
    console_log!("[review-sync] ws kind={kind} room={room} sockets={sockets}");
}
