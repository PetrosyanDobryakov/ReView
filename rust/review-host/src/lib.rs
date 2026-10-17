//! ReView self-host.
//!
//! Serves the web UI, a stateless WebRTC signaling hub (`/signal/<room>`) and
//! LAN discovery. Board data only ever travels peer to peer and lives in each
//! peer's own storage; this crate keeps nothing once a socket closes.

mod config;
mod http;
mod hub;
mod lan;
mod mdns;
mod room_name;
mod static_files;

pub use config::{Config, DEFAULT_PORT, SIGNAL_PROTO};
pub use http::{random_id, serve, start, RunningHost};
pub use hub::Stats;
pub use lan::list_lan_addresses;
pub use mdns::LanHost;
pub use static_files::{mime_for, Asset, DirSource, StaticSource};
