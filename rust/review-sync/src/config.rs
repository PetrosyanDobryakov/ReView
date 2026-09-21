//! Process configuration. Defaults match `server.mjs` and the worker constants.

use std::env;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

use crate::auth::expected_token;
use crate::persist::MAX_WS_MESSAGE;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// In-memory rooms, loopback-or-token DELETE, `/lan`, gated `/net-log`.
    Node,
    /// Chunked disk blobs, 90s empty GC, empty-room DELETE without a token.
    Worker,
}

#[derive(Clone, Debug)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub mode: Mode,
    pub net_log: bool,
    pub empty_room_gc: Duration,
    pub gc_tick: Duration,
    pub max_rooms: usize,
    pub max_payload: usize,
    pub ui_port: String,
    pub data_dir: PathBuf,
    pub token: String,
}

impl Config {
    pub fn from_env() -> Self {
        let mut args = env::args().skip(1);
        let mut net_log = env_flag("REVIEW_NET_LOG");
        let mut mode = match env::var("REVIEW_SYNC_MODE").as_deref() {
            Ok("worker") => Mode::Worker,
            _ => Mode::Node,
        };
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--log" | "--net-log" => net_log = true,
                "--mode" => {
                    if args.next().as_deref() == Some("worker") {
                        mode = Mode::Worker;
                    } else {
                        mode = Mode::Node;
                    }
                }
                "--mode=worker" => mode = Mode::Worker,
                "--mode=node" => mode = Mode::Node,
                _ => {}
            }
        }
        let port = env::var("REVIEW_SYNC_PORT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(1234);
        let host = env::var("REVIEW_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
        let gc_ms = env::var("REVIEW_ROOM_GC_MS")
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .filter(|n| *n > 0);
        let empty_room_gc = match mode {
            Mode::Node => Duration::from_millis(gc_ms.unwrap_or(5 * 60 * 1000)),
            Mode::Worker => Duration::from_millis(gc_ms.unwrap_or(90 * 1000)),
        };
        let max_rooms = env::var("REVIEW_MAX_ROOMS")
            .ok()
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(512)
            .max(1);
        let data_dir = env::var("REVIEW_SYNC_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("data/sync-rooms"));
        let token = expected_token(
            env::var("REVIEW_COMPACT_TOKEN").ok().as_deref(),
            env::var("REVIEW_ROOM_DELETE_TOKEN").ok().as_deref(),
        );
        Self {
            host,
            port,
            mode,
            net_log,
            empty_room_gc,
            gc_tick: Duration::from_secs(30),
            max_rooms,
            max_payload: MAX_WS_MESSAGE,
            ui_port: env::var("REVIEW_UI_PORT").unwrap_or_else(|_| "5173".to_string()),
            data_dir,
            token,
        }
    }

    pub fn bind_addr(&self) -> Result<SocketAddr, String> {
        format!("{}:{}", self.host, self.port)
            .parse()
            .map_err(|err| format!("bad bind address: {err}"))
    }

    pub fn service_name(&self) -> &'static str {
        match self.mode {
            Mode::Node => "review-sync",
            Mode::Worker => "review-sync-worker",
        }
    }
}

fn env_flag(name: &str) -> bool {
    matches!(env::var(name).as_deref(), Ok("1") | Ok("true"))
}
