//! Signaling hub. The only thing it does is introduce peers in a room and
//! forward their WebRTC handshake messages (SDP offers/answers, ICE
//! candidates). It never sees board data and keeps nothing after a peer
//! leaves: an empty room is dropped immediately.
//!
//! Wire format (JSON text frames, `proto` 1):
//!
//! ```text
//! hub -> peer   {"t":"welcome","proto":1,"peer":"<you>","peers":["<id>",..],"host":"<name>"}
//! hub -> peers  {"t":"join","peer":"<id>"}      {"t":"leave","peer":"<id>"}
//! peer -> hub   {"t":"signal","to":"<id>","data":<any>}
//! hub -> peer   {"t":"signal","from":"<id>","data":<any>}
//! hub -> peer   {"t":"gone","peer":"<id>"}      (signal target is not here)
//! peer -> hub   {"t":"ping"}                    hub -> peer {"t":"pong"}
//! hub -> peer   {"t":"error","error":"<code>"} then close
//! ```

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde_json::{json, Value};
use tokio::sync::mpsc::UnboundedSender;

use crate::config::SIGNAL_PROTO;

/// Outgoing frame for one socket. `Close` asks the writer to close the socket.
#[derive(Debug, Clone)]
pub enum Out {
    Text(String),
    Close(u16, &'static str),
}

struct Conn {
    id: u64,
    tx: UnboundedSender<Out>,
}

#[derive(Default)]
pub struct Hub {
    rooms: Mutex<HashMap<String, HashMap<String, Conn>>>,
    next_id: AtomicU64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum JoinError {
    TooManyRooms,
    RoomFull,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Stats {
    pub rooms: usize,
    pub peers: usize,
}

/// Peer ids are random client-chosen tokens. Keep them boring so they can
/// be echoed into JSON and logs without escaping surprises.
pub fn is_valid_peer_id(id: &str) -> bool {
    (6..=64).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

impl Hub {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register `peer` in `room`. A second socket with the same peer id
    /// (reconnect before the old socket noticed) replaces the first one.
    /// Returns the connection id to pass to [`Hub::leave`].
    pub fn join(
        &self,
        room: &str,
        peer: &str,
        tx: UnboundedSender<Out>,
        host_name: &str,
        max_rooms: usize,
        max_peers: usize,
    ) -> Result<u64, JoinError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let mut rooms = self.rooms.lock().unwrap();
        if !rooms.contains_key(room) && rooms.len() >= max_rooms {
            return Err(JoinError::TooManyRooms);
        }
        let members = rooms.entry(room.to_string()).or_default();
        let replacing = members.contains_key(peer);
        if !replacing && members.len() >= max_peers {
            if members.is_empty() {
                rooms.remove(room);
            }
            return Err(JoinError::RoomFull);
        }
        if let Some(old) = members.remove(peer) {
            let _ = old.tx.send(Out::Close(4000, "replaced"));
        }
        let others: Vec<String> = members.keys().cloned().collect();
        let welcome = json!({
            "t": "welcome",
            "proto": SIGNAL_PROTO,
            "peer": peer,
            "peers": others,
            "host": host_name,
        });
        let _ = tx.send(Out::Text(welcome.to_string()));
        if !replacing {
            let note = json!({ "t": "join", "peer": peer }).to_string();
            for conn in members.values() {
                let _ = conn.tx.send(Out::Text(note.clone()));
            }
        }
        members.insert(peer.to_string(), Conn { id, tx });
        Ok(id)
    }

    /// Drop `peer` if `conn_id` is still its live socket. Empty rooms vanish.
    pub fn leave(&self, room: &str, peer: &str, conn_id: u64) {
        let mut rooms = self.rooms.lock().unwrap();
        let Some(members) = rooms.get_mut(room) else {
            return;
        };
        if members.get(peer).map(|c| c.id) != Some(conn_id) {
            return;
        }
        members.remove(peer);
        if members.is_empty() {
            rooms.remove(room);
            return;
        }
        let note = json!({ "t": "leave", "peer": peer }).to_string();
        for conn in members.values() {
            let _ = conn.tx.send(Out::Text(note.clone()));
        }
    }

    /// Handle one text frame from `peer`. Unknown or malformed frames are
    /// ignored so newer clients can add optional messages.
    pub fn handle(&self, room: &str, peer: &str, text: &str) {
        let Ok(msg) = serde_json::from_str::<Value>(text) else {
            return;
        };
        let rooms = self.rooms.lock().unwrap();
        let Some(members) = rooms.get(room) else {
            return;
        };
        let Some(me) = members.get(peer) else {
            return;
        };
        match msg.get("t").and_then(Value::as_str) {
            Some("ping") => {
                let _ = me.tx.send(Out::Text(r#"{"t":"pong"}"#.to_string()));
            }
            Some("signal") => {
                let Some(to) = msg.get("to").and_then(Value::as_str) else {
                    return;
                };
                let data = msg.get("data").cloned().unwrap_or(Value::Null);
                match members.get(to) {
                    Some(target) if to != peer => {
                        let fwd = json!({ "t": "signal", "from": peer, "data": data });
                        let _ = target.tx.send(Out::Text(fwd.to_string()));
                    }
                    _ => {
                        let gone = json!({ "t": "gone", "peer": to });
                        let _ = me.tx.send(Out::Text(gone.to_string()));
                    }
                }
            }
            _ => {}
        }
    }

    pub fn stats(&self) -> Stats {
        let rooms = self.rooms.lock().unwrap();
        Stats {
            rooms: rooms.len(),
            peers: rooms.values().map(HashMap::len).sum(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver};

    fn drain(rx: &mut UnboundedReceiver<Out>) -> Vec<Value> {
        let mut out = Vec::new();
        while let Ok(m) = rx.try_recv() {
            if let Out::Text(t) = m {
                out.push(serde_json::from_str(&t).unwrap());
            }
        }
        out
    }

    #[test]
    fn peer_ids() {
        assert!(is_valid_peer_id("abc123"));
        assert!(is_valid_peer_id("A-b_c-1234"));
        assert!(!is_valid_peer_id("abc"));
        assert!(!is_valid_peer_id("has space1"));
        assert!(!is_valid_peer_id(&"a".repeat(65)));
    }

    #[test]
    fn join_signal_leave() {
        let hub = Hub::new();
        let (atx, mut arx) = unbounded_channel();
        let (btx, mut brx) = unbounded_channel();
        let a = hub.join("r", "peer-a", atx, "h", 8, 8).unwrap();
        let w = drain(&mut arx);
        assert_eq!(w[0]["t"], "welcome");
        assert_eq!(w[0]["peers"], json!([]));
        let b = hub.join("r", "peer-b", btx, "h", 8, 8).unwrap();
        assert_eq!(drain(&mut brx)[0]["peers"], json!(["peer-a"]));
        assert_eq!(drain(&mut arx)[0], json!({"t":"join","peer":"peer-b"}));

        hub.handle("r", "peer-b", r#"{"t":"signal","to":"peer-a","data":{"x":1}}"#);
        assert_eq!(
            drain(&mut arx)[0],
            json!({"t":"signal","from":"peer-b","data":{"x":1}})
        );
        hub.handle("r", "peer-b", r#"{"t":"signal","to":"nobody","data":1}"#);
        assert_eq!(drain(&mut brx)[0], json!({"t":"gone","peer":"nobody"}));
        hub.handle("r", "peer-b", r#"{"t":"ping"}"#);
        assert_eq!(drain(&mut brx)[0]["t"], "pong");

        hub.leave("r", "peer-b", b);
        assert_eq!(drain(&mut arx)[0], json!({"t":"leave","peer":"peer-b"}));
        assert_eq!(hub.stats(), Stats { rooms: 1, peers: 1 });
        hub.leave("r", "peer-a", a);
        assert_eq!(hub.stats(), Stats::default());
    }

    #[test]
    fn reconnect_replaces_without_join_noise() {
        let hub = Hub::new();
        let (atx, mut arx) = unbounded_channel();
        let (b1, mut b1rx) = unbounded_channel();
        let (b2, _b2rx) = unbounded_channel();
        hub.join("r", "peer-a", atx, "h", 8, 8).unwrap();
        let old = hub.join("r", "peer-b", b1, "h", 8, 8).unwrap();
        drain(&mut arx);
        drain(&mut b1rx);
        let new = hub.join("r", "peer-b", b2, "h", 8, 8).unwrap();
        assert!(matches!(b1rx.try_recv(), Ok(Out::Close(4000, _))));
        assert!(drain(&mut arx).is_empty());
        // The stale socket closing must not evict the new one.
        hub.leave("r", "peer-b", old);
        assert_eq!(hub.stats().peers, 2);
        hub.leave("r", "peer-b", new);
        assert_eq!(hub.stats().peers, 1);
    }

    #[test]
    fn limits() {
        let hub = Hub::new();
        let (tx, _rx) = unbounded_channel();
        hub.join("r1", "peer-a", tx.clone(), "h", 1, 1).unwrap();
        assert_eq!(
            hub.join("r2", "peer-a", tx.clone(), "h", 1, 1),
            Err(JoinError::TooManyRooms)
        );
        assert_eq!(
            hub.join("r1", "peer-b", tx, "h", 1, 1),
            Err(JoinError::RoomFull)
        );
    }
}
