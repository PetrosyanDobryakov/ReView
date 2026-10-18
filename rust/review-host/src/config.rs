//! Host configuration. Every knob has an env var so the binary and the
//! desktop app can share one code path.

use std::env;
use std::path::PathBuf;

/// Bumped when the signaling wire format changes. Clients refuse other majors.
pub const SIGNAL_PROTO: u32 = 1;

pub const DEFAULT_PORT: u16 = 1234;

#[derive(Clone, Debug)]
pub struct Config {
    /// Bind address (`0.0.0.0` so LAN friends can reach it).
    pub host: String,
    pub port: u16,
    /// Try `port+1 ..= port+port_tries` when the port is taken (desktop app).
    pub port_tries: u16,
    /// Directory with the built SPA (`dist/`). `None` = signaling only.
    pub dist: Option<PathBuf>,
    /// Advertise and browse `_review._tcp` on the LAN.
    pub mdns: bool,
    /// Human name shown in other peers' LAN lists.
    pub name: String,
    pub max_rooms: usize,
    pub max_peers_per_room: usize,
    /// Largest text frame a client may send (SDP + ICE fits in a few KB).
    pub max_frame: usize,
    /// Print each join/leave/signal to stdout.
    pub verbose: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            host: "0.0.0.0".to_string(),
            port: DEFAULT_PORT,
            port_tries: 0,
            dist: None,
            mdns: true,
            name: default_name(),
            max_rooms: 1024,
            max_peers_per_room: 64,
            max_frame: 64 * 1024,
            verbose: false,
        }
    }
}

impl Config {
    /// `REVIEW_HOST`, `REVIEW_PORT` (or legacy `REVIEW_SYNC_PORT`), `REVIEW_DIST`,
    /// `REVIEW_PORT_TRIES`, `REVIEW_MDNS=0`, `REVIEW_NAME`, `REVIEW_VERBOSE=1`, plus `--dist <dir>`,
    /// `--port <n>`, `--no-mdns`, `--verbose` flags.
    pub fn from_env() -> Self {
        let mut cfg = Self::default();
        if let Ok(h) = env::var("REVIEW_HOST") {
            if !h.trim().is_empty() {
                cfg.host = h.trim().to_string();
            }
        }
        if let Some(p) = env::var("REVIEW_PORT")
            .ok()
            .or_else(|| env::var("REVIEW_SYNC_PORT").ok())
            .and_then(|s| s.parse().ok())
        {
            cfg.port = p;
        }
        if let Ok(d) = env::var("REVIEW_DIST") {
            if !d.trim().is_empty() {
                cfg.dist = Some(PathBuf::from(d));
            }
        }
        if matches!(env::var("REVIEW_MDNS").as_deref(), Ok("0") | Ok("false")) {
            cfg.mdns = false;
        }
        if let Ok(n) = env::var("REVIEW_NAME") {
            if !n.trim().is_empty() {
                cfg.name = n.trim().to_string();
            }
        }
        if let Some(n) = env::var("REVIEW_PORT_TRIES").ok().and_then(|s| s.parse().ok()) {
            cfg.port_tries = n;
        }
        cfg.verbose = matches!(env::var("REVIEW_VERBOSE").as_deref(), Ok("1") | Ok("true"));
        let mut args = env::args().skip(1);
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--dist" => cfg.dist = args.next().map(PathBuf::from),
                "--port" => {
                    if let Some(p) = args.next().and_then(|s| s.parse().ok()) {
                        cfg.port = p;
                    }
                }
                "--host" => {
                    if let Some(h) = args.next() {
                        cfg.host = h;
                    }
                }
                "--name" => {
                    if let Some(n) = args.next() {
                        cfg.name = n;
                    }
                }
                "--no-mdns" => cfg.mdns = false,
                "--verbose" | "--log" => cfg.verbose = true,
                _ => {}
            }
        }
        cfg
    }
}

fn default_name() -> String {
    for key in ["HOSTNAME", "COMPUTERNAME"] {
        if let Ok(v) = env::var(key) {
            if !v.trim().is_empty() {
                return v.trim().to_string();
            }
        }
    }
    if let Ok(v) = std::fs::read_to_string("/etc/hostname") {
        if !v.trim().is_empty() {
            return v.trim().to_string();
        }
    }
    "ReView".to_string()
}
