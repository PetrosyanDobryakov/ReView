//! One Tokio task per Yjs room. Sockets live outside the task and only exchange frames.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use tokio::sync::{mpsc, oneshot, Mutex};
use yrs::sync::{Awareness, DefaultProtocol, Message, Protocol, SyncMessage};
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{ClientID, Doc, Options, ReadTxn, StateVector, Transact, Update};

use crate::config::{Config, Mode};
use crate::netlog::NetLog;
use crate::persist::{
    can_drop_persisted_tail, can_gc_empty_room, delete_blob, merge_tails, read_blob, write_blob,
    AWARENESS_QUIET_BEFORE_FULL_MS, BlobStore, FsStore, FULL_PERSIST_IDLE_MS, FULL_PERSIST_MS,
    MAX_WS_MESSAGE, TAIL_FLUSH_MS,
};

#[derive(Debug)]
pub enum Out {
    Bin(Vec<u8>),
    Close { code: u16, reason: String },
}

pub(crate) enum Cmd {
    Join {
        remote: String,
        out: mpsc::UnboundedSender<Out>,
        reply: oneshot::Sender<u64>,
    },
    Msg {
        id: u64,
        bin: Vec<u8>,
    },
    Leave {
        id: u64,
        code: u16,
        reason: String,
    },
    Count {
        reply: oneshot::Sender<usize>,
    },
    Stop {
        reply: oneshot::Sender<Stop>,
    },
    Clear {
        reply: oneshot::Sender<bool>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Stop {
    Busy,
    Dirty,
    Stopped,
}

struct Effects {
    broadcasts: Vec<Vec<u8>>,
    persisted: Vec<Vec<u8>>,
    saw_awareness: bool,
}

impl Effects {
    fn take(&mut self) -> (Vec<Vec<u8>>, Vec<Vec<u8>>, bool) {
        (
            std::mem::take(&mut self.broadcasts),
            std::mem::take(&mut self.persisted),
            std::mem::take(&mut self.saw_awareness),
        )
    }
}

struct Conn {
    remote: String,
    out: mpsc::UnboundedSender<Out>,
}

struct Room {
    name: String,
    awareness: Awareness,
    conns: HashMap<u64, Conn>,
    next_id: u64,
    effects: Arc<StdMutex<Effects>>,
    current: Arc<StdMutex<Option<u64>>>,
    controlled: Arc<StdMutex<HashMap<u64, HashSet<ClientID>>>>,
    protocol: DefaultProtocol,
    netlog: Arc<NetLog>,
    store: Option<FsStore>,
    pending_tail: Vec<Vec<u8>>,
    dirty: bool,
    persist_gen: u64,
    last_full: Option<Instant>,
    last_aware: Option<Instant>,
    tail_deadline: Option<Instant>,
    full_deadline: Option<Instant>,
    suppress_persist: bool,
    max_payload: usize,
}

pub struct LiveConn {
    pub id: u64,
    pub outbound: mpsc::UnboundedReceiver<Out>,
    pub(crate) room: mpsc::UnboundedSender<Cmd>,
}

struct Slot {
    tx: mpsc::UnboundedSender<Cmd>,
    generation: u64,
}

struct HubInner {
    rooms: HashMap<String, Slot>,
    empty_since: HashMap<String, Instant>,
    generation: u64,
}

pub struct Hub {
    inner: Mutex<HubInner>,
    cfg: Arc<Config>,
    netlog: Arc<NetLog>,
}

impl Hub {
    pub fn new(cfg: Arc<Config>, netlog: Arc<NetLog>) -> Self {
        Self {
            inner: Mutex::new(HubInner {
                rooms: HashMap::new(),
                empty_since: HashMap::new(),
                generation: 0,
            }),
            cfg,
            netlog,
        }
    }

    pub async fn room_count(&self) -> usize {
        self.inner.lock().await.rooms.len()
    }

    pub async fn connect(&self, name: &str, remote: String) -> Result<LiveConn, ConnectError> {
        for _ in 0..2 {
            let tx = {
                let mut hub = self.inner.lock().await;
                let live = hub
                    .rooms
                    .get(name)
                    .map(|s| !s.tx.is_closed())
                    .unwrap_or(false);
                if !live && hub.rooms.len() >= self.cfg.max_rooms {
                    return Err(ConnectError::TooMany);
                }
                hub.ensure(name, &self.cfg, &self.netlog)
            };
            let (out_tx, out_rx) = mpsc::unbounded_channel();
            let (reply_tx, reply_rx) = oneshot::channel();
            if tx
                .send(Cmd::Join {
                    remote: remote.clone(),
                    out: out_tx,
                    reply: reply_tx,
                })
                .is_err()
            {
                continue;
            }
            if let Ok(id) = reply_rx.await {
                return Ok(LiveConn {
                    id,
                    outbound: out_rx,
                    room: tx,
                });
            }
        }
        Err(ConnectError::Failed)
    }

    /// Node: `cleared` is whether a room object existed. Worker callers also wipe disk.
    pub async fn clear_room(&self, name: &str) -> bool {
        let slot = {
            let hub = self.inner.lock().await;
            hub.rooms
                .get(name)
                .map(|s| (s.tx.clone(), s.generation))
        };
        let Some((tx, gen)) = slot else {
            self.wipe_disk(name);
            return false;
        };
        let (reply_tx, reply_rx) = oneshot::channel();
        if tx.send(Cmd::Clear { reply: reply_tx }).is_err() {
            self.remove_gen(name, gen).await;
            self.wipe_disk(name);
            return false;
        }
        let cleared = reply_rx.await.unwrap_or(false);
        self.remove_gen(name, gen).await;
        self.wipe_disk(name);
        cleared
    }

    pub async fn socket_count(&self, name: &str) -> usize {
        let tx = {
            let hub = self.inner.lock().await;
            hub.rooms.get(name).map(|s| s.tx.clone())
        };
        let Some(tx) = tx else {
            return 0;
        };
        let (reply_tx, reply_rx) = oneshot::channel();
        if tx.send(Cmd::Count { reply: reply_tx }).is_err() {
            return 0;
        }
        reply_rx.await.unwrap_or(0)
    }

    pub fn wipe_disk(&self, name: &str) {
        if self.cfg.mode != Mode::Worker {
            return;
        }
        let dir = self.cfg.data_dir.join(name);
        let _ = std::fs::remove_dir_all(dir);
    }

    pub async fn gc_once(&self) {
        let now = Instant::now();
        let gc = self.cfg.empty_room_gc;
        let snapshot: Vec<(String, mpsc::UnboundedSender<Cmd>, u64)> = {
            let hub = self.inner.lock().await;
            hub.rooms
                .iter()
                .map(|(n, s)| (n.clone(), s.tx.clone(), s.generation))
                .collect()
        };
        for (name, tx, gen) in snapshot {
            let (reply_tx, reply_rx) = oneshot::channel();
            if tx.send(Cmd::Count { reply: reply_tx }).is_err() {
                self.remove_gen(&name, gen).await;
                continue;
            }
            let count = reply_rx.await.unwrap_or(0);
            let mut hub = self.inner.lock().await;
            // The room may have been replaced while we awaited.
            let same = hub
                .rooms
                .get(&name)
                .map(|s| s.generation == gen)
                .unwrap_or(false);
            if !same {
                continue;
            }
            if count > 0 {
                hub.empty_since.remove(&name);
                continue;
            }
            let since = match hub.empty_since.get(&name).copied() {
                Some(t) => t,
                None => {
                    hub.empty_since.insert(name.clone(), now);
                    continue;
                }
            };
            if now.saturating_duration_since(since) < gc {
                continue;
            }
            drop(hub);
            let (stop_tx, stop_rx) = oneshot::channel();
            if tx.send(Cmd::Stop { reply: stop_tx }).is_err() {
                self.remove_gen(&name, gen).await;
                continue;
            }
            match stop_rx.await.unwrap_or(Stop::Stopped) {
                Stop::Stopped => {
                    self.remove_gen(&name, gen).await;
                }
                Stop::Busy => {
                    self.inner.lock().await.empty_since.remove(&name);
                }
                Stop::Dirty => {
                    // Keep the stamp and try again on the next tick.
                }
            }
        }
    }

    async fn remove_gen(&self, name: &str, gen: u64) {
        let mut hub = self.inner.lock().await;
        let same = hub
            .rooms
            .get(name)
            .map(|s| s.generation == gen)
            .unwrap_or(false);
        if same {
            hub.rooms.remove(name);
            hub.empty_since.remove(name);
        }
    }
}

impl HubInner {
    fn ensure(&mut self, name: &str, cfg: &Config, netlog: &Arc<NetLog>) -> mpsc::UnboundedSender<Cmd> {
        if let Some(slot) = self.rooms.get(name) {
            if !slot.tx.is_closed() {
                return slot.tx.clone();
            }
        }
        self.generation = self.generation.wrapping_add(1);
        let generation = self.generation;
        let (tx, rx) = mpsc::unbounded_channel();
        let room = Room::boot(
            name.to_string(),
            cfg,
            Arc::clone(netlog),
        );
        tokio::spawn(room_loop(room, rx));
        self.rooms.insert(
            name.to_string(),
            Slot {
                tx: tx.clone(),
                generation,
            },
        );
        tx
    }
}

#[derive(Debug)]
pub enum ConnectError {
    TooMany,
    Failed,
}

pub(crate) fn leave(room: &mpsc::UnboundedSender<Cmd>, id: u64, code: u16, reason: String) {
    let _ = room.send(Cmd::Leave { id, code, reason });
}

pub(crate) fn push_bin(room: &mpsc::UnboundedSender<Cmd>, id: u64, bin: Vec<u8>) {
    let _ = room.send(Cmd::Msg { id, bin });
}

async fn room_loop(mut room: Room, mut rx: mpsc::UnboundedReceiver<Cmd>) {
    loop {
        let deadline = room.next_deadline();
        let sleeper = async {
            match deadline {
                Some(t) => {
                    let now = Instant::now();
                    if t > now {
                        tokio::time::sleep(t.saturating_duration_since(now)).await;
                    }
                }
                None => std::future::pending::<()>().await,
            }
        };
        tokio::select! {
            cmd = rx.recv() => {
                match cmd {
                    None => break,
                    Some(Cmd::Join { remote, out, reply }) => {
                        let id = room.join(remote, out);
                        let _ = reply.send(id);
                    }
                    Some(Cmd::Msg { id, bin }) => room.on_binary(id, &bin),
                    Some(Cmd::Leave { id, code, reason }) => room.leave(id, code, &reason),
                    Some(Cmd::Count { reply }) => {
                        let _ = reply.send(room.conns.len());
                    }
                    Some(Cmd::Stop { reply }) => {
                        if room.stop() {
                            let _ = reply.send(Stop::Stopped);
                            break;
                        }
                        let kind = if room.conns.is_empty() { Stop::Dirty } else { Stop::Busy };
                        let _ = reply.send(kind);
                    }
                    Some(Cmd::Clear { reply }) => {
                        room.clear();
                        let _ = reply.send(true);
                        break;
                    }
                }
            }
            _ = sleeper => room.on_timer(Instant::now()),
        }
    }
}

impl Room {
    fn boot(name: String, cfg: &Config, netlog: Arc<NetLog>) -> Self {
        let mut opts = Options::default();
        opts.skip_gc = true;
        let doc = Doc::with_options(opts);
        let store = match cfg.mode {
            Mode::Worker => Some(FsStore::open(cfg.data_dir.join(&name))),
            Mode::Node => None,
        };
        if let Some(store) = store.as_ref() {
            if let Some(bytes) = read_blob(store, "doc") {
                apply_quiet(&doc, &bytes);
            }
            if let Some(bytes) = read_blob(store, "tail") {
                apply_quiet(&doc, &bytes);
            }
        }
        let mut awareness = Awareness::new(doc);
        let effects = Arc::new(StdMutex::new(Effects {
            broadcasts: Vec::new(),
            persisted: Vec::new(),
            saw_awareness: false,
        }));
        let current = Arc::new(StdMutex::new(None));
        let controlled = Arc::new(StdMutex::new(HashMap::<u64, HashSet<ClientID>>::new()));

        let effects_doc = Arc::clone(&effects);
        if let Err(err) = awareness.doc().observe_update_v1("review-sync-doc", move |_txn, ev| {
            let msg = Message::Sync(SyncMessage::Update(ev.update.clone())).encode_v1();
            if let Ok(mut g) = effects_doc.lock() {
                g.broadcasts.push(msg);
                g.persisted.push(ev.update.clone());
            }
        }) {
            eprintln!("[review:net] observe failed room={name} {err}");
        }

        let effects_aw = Arc::clone(&effects);
        let current_aw = Arc::clone(&current);
        let controlled_aw = Arc::clone(&controlled);
        awareness.on_update("review-sync-aw", move |aw, ev, _origin| {
            let changed = ev.summary().all_changes();
            if !changed.is_empty() {
                if let Ok(upd) = aw.update_with_clients(changed) {
                    let msg = Message::Awareness(upd).encode_v1();
                    if let Ok(mut g) = effects_aw.lock() {
                        g.broadcasts.push(msg);
                        g.saw_awareness = true;
                    }
                }
            } else if let Ok(mut g) = effects_aw.lock() {
                g.saw_awareness = true;
            }
            let conn = current_aw.lock().ok().and_then(|g| *g);
            if let Some(conn) = conn {
                if let Ok(mut map) = controlled_aw.lock() {
                    let set = map.entry(conn).or_default();
                    for id in ev.added() {
                        set.insert(*id);
                    }
                    for id in ev.removed() {
                        set.remove(id);
                    }
                }
            }
        });

        Self {
            name,
            awareness,
            conns: HashMap::new(),
            next_id: 0,
            effects,
            current,
            controlled,
            protocol: DefaultProtocol,
            netlog,
            store,
            pending_tail: Vec::new(),
            dirty: false,
            persist_gen: 0,
            last_full: None,
            last_aware: None,
            tail_deadline: None,
            full_deadline: None,
            suppress_persist: false,
            max_payload: cfg.max_payload.max(1).min(MAX_WS_MESSAGE),
        }
    }

    fn join(&mut self, remote: String, out: mpsc::UnboundedSender<Out>) -> u64 {
        self.next_id = self.next_id.wrapping_add(1);
        let id = self.next_id;
        println!(
            "[review:net] ws connect room={} from={remote}",
            self.name
        );
        self.netlog.event(
            "info",
            "ws connect",
            Some(serde_json::json!({ "room": self.name, "from": remote })),
        );
        let hello = self.hello_frames();
        self.conns.insert(
            id,
            Conn {
                remote,
                out: out.clone(),
            },
        );
        for frame in hello {
            let _ = out.send(Out::Bin(frame));
        }
        id
    }

    fn hello_frames(&self) -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        let sv = self.awareness.doc().transact().state_vector();
        out.push(Message::Sync(SyncMessage::SyncStep1(sv)).encode_v1());
        if let Ok(upd) = self.awareness.update() {
            if !upd.clients.is_empty() {
                out.push(Message::Awareness(upd).encode_v1());
            }
        }
        out
    }

    fn on_binary(&mut self, id: u64, data: &[u8]) {
        if data.len() > self.max_payload {
            eprintln!(
                "[review:net] ws payload too large room={} bytes={}",
                self.name,
                data.len()
            );
            return;
        }
        if let Ok(mut g) = self.current.lock() {
            *g = Some(id);
        }
        let result = self.protocol.handle(&mut self.awareness, data);
        if let Ok(mut g) = self.current.lock() {
            *g = None;
        }
        match result {
            Ok(replies) => {
                let (broadcasts, persisted, saw_aw) = self.take_effects();
                if saw_aw {
                    self.last_aware = Some(Instant::now());
                }
                if !persisted.is_empty() {
                    self.note_persisted(persisted);
                }
                self.fanout(&broadcasts);
                if let Some(conn) = self.conns.get(&id) {
                    for msg in replies {
                        let _ = conn.out.send(Out::Bin(msg.encode_v1()));
                    }
                }
            }
            Err(err) => {
                let _ = self.take_effects();
                eprintln!(
                    "[review:net] ws message error room={} {err}",
                    self.name
                );
                self.netlog.event(
                    "warn",
                    "ws message error",
                    Some(serde_json::json!({ "room": self.name, "err": err.to_string() })),
                );
            }
        }
    }

    fn leave(&mut self, id: u64, code: u16, reason: &str) {
        let Some(conn) = self.conns.remove(&id) else {
            return;
        };
        println!(
            "[review:net] ws disconnect room={} from={} code={code} reason={reason}",
            self.name, conn.remote
        );
        self.netlog.event(
            "info",
            "ws disconnect",
            Some(serde_json::json!({
                "room": self.name,
                "from": conn.remote,
                "code": code,
                "reason": reason,
            })),
        );
        let ids: Vec<ClientID> = self
            .controlled
            .lock()
            .ok()
            .and_then(|mut map| map.remove(&id))
            .map(|set| set.into_iter().collect())
            .unwrap_or_default();
        for cid in ids {
            self.awareness.remove_state(cid);
        }
        let (broadcasts, persisted, _) = self.take_effects();
        if !persisted.is_empty() {
            self.note_persisted(persisted);
        }
        self.fanout(&broadcasts);
        if self.conns.is_empty() && self.store.is_some() && (self.dirty || !self.pending_tail.is_empty())
        {
            self.flush_full();
        }
    }

    /// True when the task should exit (room was empty and storage is clean).
    fn stop(&mut self) -> bool {
        if !self.conns.is_empty() {
            return false;
        }
        if self.store.is_some() && (self.dirty || !self.pending_tail.is_empty()) {
            self.flush_full();
        }
        let pending = self.pending_tail.len();
        if self.store.is_some() && !can_gc_empty_room(0, self.dirty, pending) {
            return false;
        }
        if let Some(store) = self.store.as_mut() {
            store.delete_all();
        }
        println!("[review:net] room gc room={}", self.name);
        self.netlog.event(
            "info",
            "room gc",
            Some(serde_json::json!({ "room": self.name })),
        );
        true
    }

    fn clear(&mut self) {
        self.suppress_persist = true;
        self.pending_tail.clear();
        self.dirty = false;
        self.tail_deadline = None;
        self.full_deadline = None;
        let conns = std::mem::take(&mut self.conns);
        let had = !conns.is_empty() || self.store.is_some();
        for (_, conn) in conns {
            let _ = conn.out.send(Out::Close {
                code: 1000,
                reason: "room cleared".into(),
            });
        }
        if let Some(store) = self.store.as_mut() {
            store.delete_all();
        }
        if had || true {
            println!("[review:net] room cleared via DELETE room={}", self.name);
            self.netlog.event(
                "info",
                "room cleared",
                Some(serde_json::json!({ "room": self.name })),
            );
        }
    }

    fn on_timer(&mut self, now: Instant) {
        if self.tail_deadline.is_some_and(|t| t <= now) {
            self.tail_deadline = None;
            self.flush_tail();
            if !self.pending_tail.is_empty() {
                self.tail_deadline = Some(now + Duration::from_millis(TAIL_FLUSH_MS));
            }
        }
        if self.full_deadline.is_some_and(|t| t <= now) {
            self.full_deadline = None;
            if !self.dirty {
                return;
            }
            if let Some(aware) = self.last_aware {
                if now.saturating_duration_since(aware)
                    < Duration::from_millis(AWARENESS_QUIET_BEFORE_FULL_MS)
                {
                    self.full_deadline = Some(now + Duration::from_millis(FULL_PERSIST_IDLE_MS));
                    return;
                }
            }
            let allow = match self.last_full {
                None => true,
                Some(t) => now.saturating_duration_since(t) >= Duration::from_millis(FULL_PERSIST_MS),
            };
            if !allow {
                return;
            }
            self.flush_full();
        }
    }

    fn next_deadline(&self) -> Option<Instant> {
        match (self.tail_deadline, self.full_deadline) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (Some(a), None) => Some(a),
            (None, Some(b)) => Some(b),
            (None, None) => None,
        }
    }

    fn note_persisted(&mut self, updates: Vec<Vec<u8>>) {
        if self.suppress_persist || self.store.is_none() {
            return;
        }
        self.dirty = true;
        self.persist_gen = self.persist_gen.saturating_add(updates.len() as u64);
        self.pending_tail.extend(updates);
        if self.tail_deadline.is_none() {
            self.tail_deadline = Some(Instant::now() + Duration::from_millis(TAIL_FLUSH_MS));
        }
        self.full_deadline = Some(Instant::now() + Duration::from_millis(FULL_PERSIST_IDLE_MS));
    }

    fn flush_tail(&mut self) {
        if self.suppress_persist || self.pending_tail.is_empty() {
            return;
        }
        let Some(store) = self.store.as_mut() else {
            return;
        };
        let batch = std::mem::take(&mut self.pending_tail);
        let prev = read_blob(store, "tail");
        match merge_tails(prev.as_deref(), &batch) {
            Some(merged) => write_blob(store, "tail", &merged),
            None => {
                self.pending_tail = batch;
                self.dirty = true;
            }
        }
    }

    fn flush_full(&mut self) {
        if self.suppress_persist || self.store.is_none() {
            return;
        }
        if !self.dirty && self.pending_tail.is_empty() {
            return;
        }
        self.flush_tail();
        if self.suppress_persist {
            return;
        }
        let encode_gen = self.persist_gen;
        let bytes = self
            .awareness
            .doc()
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        self.flush_tail();
        if !can_drop_persisted_tail(encode_gen, self.persist_gen, self.pending_tail.len()) {
            // Still write the snapshot; keep the tail if a newer update landed.
        }
        let Some(store) = self.store.as_mut() else {
            return;
        };
        write_blob(store, "doc", &bytes);
        if !can_drop_persisted_tail(encode_gen, self.persist_gen, self.pending_tail.len()) {
            self.dirty = true;
            return;
        }
        delete_blob(store, "tail");
        if !can_drop_persisted_tail(encode_gen, self.persist_gen, self.pending_tail.len()) {
            self.dirty = true;
            return;
        }
        self.dirty = false;
        self.last_full = Some(Instant::now());
    }

    fn fanout(&self, frames: &[Vec<u8>]) {
        for frame in frames {
            for conn in self.conns.values() {
                let _ = conn.out.send(Out::Bin(frame.clone()));
            }
        }
    }

    fn take_effects(&self) -> (Vec<Vec<u8>>, Vec<Vec<u8>>, bool) {
        self.effects
            .lock()
            .map(|mut g| g.take())
            .unwrap_or_else(|e| e.into_inner().take())
    }
}

fn apply_quiet(doc: &Doc, bytes: &[u8]) {
    match Update::decode_v1(bytes) {
        Ok(update) => {
            if let Err(err) = doc.transact_mut().apply_update(update) {
                eprintln!("[review:net] load update failed {err}");
            }
        }
        Err(err) => eprintln!("[review:net] load update failed {err}"),
    }
}
