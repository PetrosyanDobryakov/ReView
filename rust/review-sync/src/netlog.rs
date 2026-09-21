//! Session files under `logs/net/`. Created only when net debug is enabled.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::{SecondsFormat, Utc};

pub struct NetLog {
    enabled: bool,
    session_rel: String,
    latest_rel: String,
    session_file: PathBuf,
    latest_file: PathBuf,
    current_file: PathBuf,
    ready: Mutex<bool>,
}

impl NetLog {
    pub fn open(enabled: bool) -> Self {
        let stamp = Utc::now()
            .to_rfc3339_opts(SecondsFormat::Millis, true)
            .replace([':', '.'], "-");
        let session_rel = format!("logs/net/session-{stamp}.log");
        let dir = PathBuf::from("logs/net");
        Self {
            enabled,
            session_rel: session_rel.clone(),
            latest_rel: "logs/net/latest.log".to_string(),
            session_file: PathBuf::from(&session_rel),
            latest_file: dir.join("latest.log"),
            current_file: dir.join("CURRENT"),
            ready: Mutex::new(false),
        }
    }

    pub fn session_rel(&self) -> &str {
        &self.session_rel
    }

    pub fn latest_rel(&self) -> &str {
        &self.latest_rel
    }

    pub fn event(&self, level: &str, msg: &str, data: Option<serde_json::Value>) {
        if !self.enabled {
            return;
        }
        let mut row = serde_json::json!({
            "t": iso_now(),
            "level": level,
            "source": "server",
            "msg": msg,
        });
        if let Some(data) = data {
            row["data"] = data;
        }
        self.append_line(&row.to_string());
    }

    pub fn append_client(&self, line: &serde_json::Value) -> bool {
        if !self.enabled {
            return false;
        }
        if !line.is_object() {
            return false;
        }
        let msg_raw = line.get("msg");
        let msg = match msg_raw {
            Some(serde_json::Value::String(s)) => truncate(s, 8192),
            Some(other) => truncate(&other.to_string(), 8192),
            None => String::new(),
        };
        let mut row = serde_json::json!({
            "t": line.get("t").and_then(|v| v.as_str()).map(|s| s.to_string()).unwrap_or_else(iso_now),
            "level": line.get("level").and_then(|v| v.as_str()).unwrap_or("info"),
            "source": line.get("client").and_then(|v| v.as_str()).unwrap_or("client"),
            "msg": msg,
        });
        if let Some(data) = line.get("data") {
            if !data.is_null() {
                row["data"] = data.clone();
            }
        }
        self.append_line(&row.to_string());
        true
    }

    fn append_line(&self, line: &str) {
        if !self.enabled {
            return;
        }
        self.ensure_dir();
        let text = if line.ends_with('\n') {
            line.to_string()
        } else {
            format!("{line}\n")
        };
        if let Err(err) = append_both(&self.session_file, &self.latest_file, text.as_bytes()) {
            eprintln!("[review:net] file log write failed {err}");
        }
    }

    fn ensure_dir(&self) {
        let mut ready = self.ready.lock().unwrap_or_else(|e| e.into_inner());
        if *ready {
            return;
        }
        if let Some(dir) = self.session_file.parent() {
            if let Err(err) = fs::create_dir_all(dir) {
                eprintln!("[review:net] file log write failed {err}");
                return;
            }
        }
        let _ = fs::write(&self.current_file, format!("{}\n", self.session_rel));
        let _ = fs::write(&self.latest_file, b"");
        *ready = true;
    }
}

fn append_both(session: &Path, latest: &Path, bytes: &[u8]) -> std::io::Result<()> {
    for path in [session, latest] {
        let mut f = OpenOptions::new().create(true).append(true).open(path)?;
        f.write_all(bytes)?;
    }
    Ok(())
}

fn iso_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        // Cut on a char boundary.
        let mut end = max.min(s.len());
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        s[..end].to_string()
    }
}

pub const NET_LOG_MAX_LINES: usize = 200;
pub const BODY_MAX: usize = 512_000;
