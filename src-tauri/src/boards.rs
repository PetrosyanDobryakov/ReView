//! Boards as plain files: `<app data>/boards/<id>.review` holds the Yjs
//! snapshot, `<id>.json` the board's name and team. This is the durable copy
//! on the desktop; the webview's IndexedDB is a cache in front of it.
//! Media lives beside them by content hash: `<app data>/blobs/<ab>/<sha256>`
//! holds `<mime>\n<bytes>`.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};

const MAX_BOARD_BYTES: usize = 512 * 1024 * 1024;
const MAX_BLOB_BYTES: usize = 64 * 1024 * 1024;

pub fn boards_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| e.to_string())?
    .join("boards");
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir)
}

/// Same alphabet the web app uses for board ids (`b<base36>`, invite ids).
fn valid_id(id: &str) -> bool {
  (1..=64).contains(&id.len())
    && id
      .bytes()
      .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn percent_decode(s: &str) -> String {
  let b = s.as_bytes();
  let mut out = Vec::with_capacity(b.len());
  let mut i = 0;
  while i < b.len() {
    if b[i] == b'%' && i + 2 < b.len() {
      if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
        out.push(h << 4 | l);
        i += 3;
        continue;
      }
    }
    out.push(b[i]);
    i += 1;
  }
  String::from_utf8_lossy(&out).into_owned()
}

fn hex(c: u8) -> Option<u8> {
  match c {
    b'0'..=b'9' => Some(c - b'0'),
    b'a'..=b'f' => Some(c - b'a' + 10),
    b'A'..=b'F' => Some(c - b'A' + 10),
    _ => None,
  }
}

/// Write via a temp file + rename so a crash never leaves half a board.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
  let tmp = path.with_extension("tmp");
  fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
  fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn board_save(app: AppHandle, request: Request<'_>) -> Result<bool, String> {
  let id = request
    .headers()
    .get("x-board-id")
    .and_then(|v| v.to_str().ok())
    .unwrap_or("")
    .to_string();
  if !valid_id(&id) {
    return Err("bad board id".into());
  }
  let InvokeBody::Raw(bytes) = request.body() else {
    return Err("expected raw bytes".into());
  };
  if bytes.is_empty() || bytes.len() > MAX_BOARD_BYTES {
    return Err("bad board size".into());
  }
  let dir = boards_dir(&app)?;
  write_atomic(&dir.join(format!("{id}.review")), bytes)?;
  if let Some(meta) = request
    .headers()
    .get("x-board-meta")
    .and_then(|v| v.to_str().ok())
  {
    let json = percent_decode(meta);
    if serde_json::from_str::<serde_json::Value>(&json).is_ok() {
      write_atomic(&dir.join(format!("{id}.json")), json.as_bytes())?;
    }
  }
  Ok(true)
}

#[tauri::command]
pub fn board_load(app: AppHandle, id: String) -> Result<Response, String> {
  if !valid_id(&id) {
    return Err("bad board id".into());
  }
  let path = boards_dir(&app)?.join(format!("{id}.review"));
  let bytes = fs::read(path).unwrap_or_default();
  Ok(Response::new(bytes))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardFile {
  id: String,
  saved_at: u64,
  size: u64,
  meta: serde_json::Value,
}

#[tauri::command]
pub fn board_list(app: AppHandle) -> Result<Vec<BoardFile>, String> {
  let dir = boards_dir(&app)?;
  let mut out = Vec::new();
  for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
    let path = entry.path();
    if path.extension().and_then(|e| e.to_str()) != Some("review") {
      continue;
    }
    let Some(id) = path.file_stem().and_then(|s| s.to_str()).map(str::to_string) else {
      continue;
    };
    if !valid_id(&id) {
      continue;
    }
    let md = entry.metadata().map_err(|e| e.to_string())?;
    let saved_at = md
      .modified()
      .ok()
      .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
      .map(|d| d.as_millis() as u64)
      .unwrap_or(0);
    let meta = fs::read_to_string(dir.join(format!("{id}.json")))
      .ok()
      .and_then(|s| serde_json::from_str(&s).ok())
      .unwrap_or(serde_json::Value::Null);
    out.push(BoardFile {
      id,
      saved_at,
      size: md.len(),
      meta,
    });
  }
  out.sort_by(|a, b| b.saved_at.cmp(&a.saved_at));
  Ok(out)
}

#[tauri::command]
pub fn board_delete(app: AppHandle, id: String) -> Result<(), String> {
  if !valid_id(&id) {
    return Err("bad board id".into());
  }
  let dir = boards_dir(&app)?;
  for ext in ["review", "json"] {
    let _ = fs::remove_file(dir.join(format!("{id}.{ext}")));
  }
  Ok(())
}

#[tauri::command]
pub fn open_boards_folder(app: AppHandle) -> Result<(), String> {
  let dir = boards_dir(&app)?;
  #[cfg(target_os = "windows")]
  let cmd = "explorer";
  #[cfg(target_os = "macos")]
  let cmd = "open";
  #[cfg(not(any(target_os = "windows", target_os = "macos")))]
  let cmd = "xdg-open";
  std::process::Command::new(cmd)
    .arg(dir)
    .spawn()
    .map(|_| ())
    .map_err(|e| e.to_string())
}

fn valid_hash(hash: &str) -> bool {
  hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn blob_path(app: &AppHandle, hash: &str) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| e.to_string())?
    .join("blobs")
    .join(&hash[..2]);
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir.join(hash))
}

/// Store media bytes under their SHA-256 (the webview checked the hash).
#[tauri::command]
pub fn blob_save(app: AppHandle, request: Request<'_>) -> Result<bool, String> {
  let header = |name: &str| {
    request
      .headers()
      .get(name)
      .and_then(|v| v.to_str().ok())
      .unwrap_or("")
      .to_string()
  };
  let hash = header("x-blob-hash");
  let mime = header("x-blob-mime");
  if !valid_hash(&hash) || mime.len() > 100 || mime.contains('\n') {
    return Err("bad blob".into());
  }
  let InvokeBody::Raw(bytes) = request.body() else {
    return Err("expected raw bytes".into());
  };
  if bytes.is_empty() || bytes.len() > MAX_BLOB_BYTES {
    return Err("bad blob size".into());
  }
  let path = blob_path(&app, &hash)?;
  if path.exists() {
    return Ok(true);
  }
  let mut out = Vec::with_capacity(mime.len() + 1 + bytes.len());
  out.extend_from_slice(mime.as_bytes());
  out.push(b'\n');
  out.extend_from_slice(bytes);
  write_atomic(&path, &out)?;
  Ok(true)
}

/// `<mime>\n<bytes>`, or empty when this device does not have it.
#[tauri::command]
pub fn blob_load(app: AppHandle, hash: String) -> Result<Response, String> {
  if !valid_hash(&hash) {
    return Err("bad blob hash".into());
  }
  Ok(Response::new(fs::read(blob_path(&app, &hash)?).unwrap_or_default()))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn ids_and_decode() {
    assert!(valid_id("bmmkxyz1234"));
    assert!(!valid_id("../etc"));
    assert!(!valid_id(""));
    assert_eq!(percent_decode("%7B%22a%22%3A1%7D"), "{\"a\":1}");
    assert_eq!(percent_decode("100%"), "100%");
    assert_eq!(percent_decode("%E2%9C%93"), "\u{2713}");
    assert!(valid_hash(&"ab".repeat(32)));
    assert!(!valid_hash(&"AB".repeat(32)));
    assert!(!valid_hash("../../etc/passwd"));
  }
}
