//! ReView sync server.
//!
//! Node personality: in-memory Yjs rooms, the same HTTP surface as `server.mjs`.
//! Worker personality: chunked disk blobs and the `review-sync` worker's routes.

mod auth;
mod config;
mod http;
mod hub;
mod lan;
mod netlog;
mod persist;
mod room_name;

pub use config::{Config, Mode};
pub use http::serve;
