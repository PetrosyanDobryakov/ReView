//! Chunked `doc` / `tail` blobs.
//! Same key layout as `worker/src/persist.ts`: generation pointer flips last so a
//! crash keeps the previous readable generation.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use yrs::merge_updates_v1;

pub const STORAGE_CHUNK: usize = 1_500_000;
pub const FULL_PERSIST_MS: u64 = 1000;
pub const PUT_BATCH: usize = 80;
pub const MAX_WS_MESSAGE: usize = 32 * 1024 * 1024;
pub const TAIL_FLUSH_MS: u64 = 150;
pub const FULL_PERSIST_IDLE_MS: u64 = 250;
pub const AWARENESS_QUIET_BEFORE_FULL_MS: u64 = 120;

#[derive(Clone, Debug)]
pub enum Val {
    Bytes(Vec<u8>),
    Count(u64),
}

pub trait BlobStore {
    fn get(&self, key: &str) -> Option<Val>;
    fn get_many(&self, keys: &[String]) -> HashMap<String, Val>;
    fn put_many(&mut self, entries: Vec<(String, Val)>);
    fn delete_keys(&mut self, keys: &[String]);
    fn delete_all(&mut self);
}

#[derive(Default)]
#[allow(dead_code)]
pub struct MemoryStore {
    map: HashMap<String, Val>,
}

impl BlobStore for MemoryStore {
    fn get(&self, key: &str) -> Option<Val> {
        self.map.get(key).cloned()
    }

    fn get_many(&self, keys: &[String]) -> HashMap<String, Val> {
        let mut out = HashMap::new();
        for key in keys {
            if let Some(v) = self.map.get(key) {
                out.insert(key.clone(), v.clone());
            }
        }
        out
    }

    fn put_many(&mut self, entries: Vec<(String, Val)>) {
        for (k, v) in entries {
            self.map.insert(k, v);
        }
    }

    fn delete_keys(&mut self, keys: &[String]) {
        for k in keys {
            self.map.remove(k);
        }
    }

    fn delete_all(&mut self) {
        self.map.clear();
    }
}

pub struct FsStore {
    root: PathBuf,
}

impl FsStore {
    pub fn open(root: impl Into<PathBuf>) -> Self {
        let root = root.into();
        let _ = fs::create_dir_all(&root);
        Self { root }
    }

    fn path_for(&self, key: &str) -> PathBuf {
        self.root.join(key)
    }
}

impl BlobStore for FsStore {
    fn get(&self, key: &str) -> Option<Val> {
        read_val(&self.path_for(key))
    }

    fn get_many(&self, keys: &[String]) -> HashMap<String, Val> {
        let mut out = HashMap::new();
        for key in keys {
            if let Some(v) = read_val(&self.path_for(key)) {
                out.insert(key.clone(), v);
            }
        }
        out
    }

    fn put_many(&mut self, entries: Vec<(String, Val)>) {
        for (k, v) in entries {
            write_val(&self.path_for(&k), &v);
        }
    }

    fn delete_keys(&mut self, keys: &[String]) {
        for k in keys {
            let _ = fs::remove_file(self.path_for(k));
        }
    }

    fn delete_all(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
        let _ = fs::create_dir_all(&self.root);
    }
}

fn write_val(path: &Path, val: &Val) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let bytes = match val {
        Val::Bytes(b) => {
            let mut v = Vec::with_capacity(1 + b.len());
            v.push(b'B');
            v.extend_from_slice(b);
            v
        }
        Val::Count(n) => format!("N{n}").into_bytes(),
    };
    let tmp = tmp_path(path);
    if fs::write(&tmp, &bytes).is_ok() {
        let _ = fs::rename(&tmp, path);
    }
}

fn tmp_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("blob");
    path.with_file_name(format!("{name}.tmp"))
}

fn read_val(path: &Path) -> Option<Val> {
    let b = fs::read(path).ok()?;
    match b.first().copied() {
        Some(b'B') => Some(Val::Bytes(b[1..].to_vec())),
        Some(b'N') => {
            let s = std::str::from_utf8(&b[1..]).ok()?;
            Some(Val::Count(s.parse().ok()?))
        }
        _ => None,
    }
}

pub fn split_chunks(bytes: &[u8], size: usize) -> Vec<Vec<u8>> {
    let size = size.max(1);
    if bytes.is_empty() {
        return vec![Vec::new()];
    }
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let end = (i + size).min(bytes.len());
        out.push(bytes[i..end].to_vec());
        i = end;
    }
    out
}

pub fn join_chunks(parts: &[Vec<u8>]) -> Vec<u8> {
    let total: usize = parts.iter().map(|p| p.len()).sum();
    let mut out = Vec::with_capacity(total);
    for p in parts {
        out.extend_from_slice(p);
    }
    out
}

#[allow(dead_code)]
pub fn should_full_persist(last_persist_ms: u64, now_ms: u64) -> bool {
    now_ms.saturating_sub(last_persist_ms) >= FULL_PERSIST_MS
}

pub fn can_drop_persisted_tail(encode_gen: u64, current_gen: u64, pending_count: usize) -> bool {
    encode_gen == current_gen && pending_count == 0
}

pub fn can_gc_empty_room(socket_count: usize, dirty: bool, pending_count: usize) -> bool {
    socket_count == 0 && !dirty && pending_count == 0
}

pub fn storage_count(raw: Option<&Val>) -> u64 {
    match raw {
        Some(Val::Count(n)) => *n,
        Some(Val::Bytes(b)) => {
            let Ok(s) = std::str::from_utf8(b) else {
                return 0;
            };
            let s = s.trim();
            if s.is_empty() {
                return 0;
            }
            match s.parse::<f64>() {
                Ok(n) if n.is_finite() => n.max(0.0).floor() as u64,
                _ => 0,
            }
        }
        None => 0,
    }
}

fn as_bytes(v: Option<&Val>) -> Option<Vec<u8>> {
    match v {
        Some(Val::Bytes(b)) => Some(b.clone()),
        _ => None,
    }
}

fn gen_base(prefix: &str, gen: u64) -> String {
    format!("{prefix}:{gen}")
}

fn read_chunked(store: &dyn BlobStore, base: &str, n: u64) -> Option<Vec<u8>> {
    let n = usize::try_from(n).ok()?;
    let keys: Vec<String> = (0..n).map(|i| format!("{base}:{i}")).collect();
    let map = store.get_many(&keys);
    let mut parts = Vec::with_capacity(n);
    for i in 0..n {
        let v = map.get(&format!("{base}:{i}"));
        parts.push(as_bytes(v)?);
    }
    Some(join_chunks(&parts))
}

fn delete_chunked(store: &mut dyn BlobStore, base: &str, n: u64, extra: &[String]) {
    let mut keys = extra.to_vec();
    keys.push(format!("{base}:n"));
    let count = n.max(1);
    for i in 0..count {
        keys.push(format!("{base}:{i}"));
    }
    store.delete_keys(&keys);
}

pub fn write_blob(store: &mut dyn BlobStore, prefix: &str, bytes: &[u8]) {
    let prev_gen = storage_count(store.get(&format!("{prefix}:gen")).as_ref());
    let next_gen = prev_gen + 1;
    let base = gen_base(prefix, next_gen);
    let chunks = split_chunks(bytes, STORAGE_CHUNK);
    let mut off = 0;
    while off < chunks.len() {
        let end = (off + PUT_BATCH).min(chunks.len());
        let mut entries = Vec::new();
        for (j, chunk) in chunks[off..end].iter().enumerate() {
            entries.push((format!("{base}:{}", off + j), Val::Bytes(chunk.clone())));
        }
        if end == chunks.len() {
            entries.push((format!("{base}:n"), Val::Count(chunks.len() as u64)));
        }
        store.put_many(entries);
        off = end;
    }
    store.put_many(vec![(format!("{prefix}:gen"), Val::Count(next_gen))]);

    let leftover = vec![prefix.to_string(), format!("{prefix}:n")];
    if prev_gen > 0 {
        let prev_base = gen_base(prefix, prev_gen);
        let prev_n = storage_count(store.get(&format!("{prev_base}:n")).as_ref());
        delete_chunked(store, &prev_base, prev_n, &leftover);
    } else {
        let legacy_n = storage_count(store.get(&format!("{prefix}:n")).as_ref());
        delete_chunked(store, prefix, legacy_n, &leftover);
    }
}

pub fn read_blob(store: &dyn BlobStore, prefix: &str) -> Option<Vec<u8>> {
    let gen = storage_count(store.get(&format!("{prefix}:gen")).as_ref());
    if gen > 0 {
        let n = storage_count(store.get(&format!("{}:n", gen_base(prefix, gen))).as_ref());
        if n > 0 {
            return read_chunked(store, &gen_base(prefix, gen), n);
        }
        return None;
    }
    let n = storage_count(store.get(&format!("{prefix}:n")).as_ref());
    if n > 0 {
        return read_chunked(store, prefix, n);
    }
    as_bytes(store.get(prefix).as_ref())
}

pub fn delete_blob(store: &mut dyn BlobStore, prefix: &str) {
    let gen = storage_count(store.get(&format!("{prefix}:gen")).as_ref());
    let mut keys = vec![
        prefix.to_string(),
        format!("{prefix}:n"),
        format!("{prefix}:gen"),
    ];
    if gen > 0 {
        let base = gen_base(prefix, gen);
        let n = storage_count(store.get(&format!("{base}:n")).as_ref());
        keys.push(format!("{base}:n"));
        let count = n.max(1);
        for i in 0..count {
            keys.push(format!("{base}:{i}"));
        }
    }
    let legacy_n = storage_count(store.get(&format!("{prefix}:n")).as_ref());
    for i in 0..legacy_n.max(1) {
        keys.push(format!("{prefix}:{i}"));
    }
    store.delete_keys(&keys);
}

pub fn merge_tails(prev: Option<&[u8]>, updates: &[Vec<u8>]) -> Option<Vec<u8>> {
    let mut parts: Vec<&[u8]> = Vec::new();
    if let Some(p) = prev {
        if !p.is_empty() {
            parts.push(p);
        }
    }
    for u in updates {
        if !u.is_empty() {
            parts.push(u.as_slice());
        }
    }
    if parts.is_empty() {
        return None;
    }
    if parts.len() == 1 {
        return Some(parts[0].to_vec());
    }
    merge_updates_v1(parts).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_roundtrip_and_generation() {
        let mut store = MemoryStore::default();
        let bytes = vec![7u8; 50];
        // Force several chunks by calling split directly, then write via the public path
        // with the real chunk size (one chunk). A second write must drop generation 1.
        write_blob(&mut store, "doc", &bytes);
        assert_eq!(read_blob(&store, "doc").as_deref(), Some(bytes.as_slice()));
        let next = vec![9u8; 10];
        write_blob(&mut store, "doc", &next);
        assert_eq!(read_blob(&store, "doc").as_deref(), Some(next.as_slice()));
        assert!(store.get("doc:1:0").is_none(), "previous generation removed");
        delete_blob(&mut store, "doc");
        assert!(read_blob(&store, "doc").is_none());
    }

    #[test]
    fn small_chunks_cover_the_2mb_split() {
        let parts = split_chunks(&[1, 2, 3, 4, 5], 2);
        assert_eq!(parts, vec![vec![1, 2], vec![3, 4], vec![5]]);
        assert_eq!(join_chunks(&parts), vec![1, 2, 3, 4, 5]);
        assert_eq!(split_chunks(&[], 2), vec![Vec::<u8>::new()]);
    }

    #[test]
    fn gc_and_tail_predicates() {
        assert!(should_full_persist(0, 1000));
        assert!(!should_full_persist(0, 999));
        assert!(can_drop_persisted_tail(3, 3, 0));
        assert!(!can_drop_persisted_tail(3, 4, 0));
        assert!(!can_drop_persisted_tail(3, 3, 1));
        assert!(can_gc_empty_room(0, false, 0));
        assert!(!can_gc_empty_room(1, false, 0));
        assert!(!can_gc_empty_room(0, true, 0));
        assert!(!can_gc_empty_room(0, false, 2));
    }

    #[test]
    fn fs_store_roundtrip() {
        let dir = std::env::temp_dir().join(format!("review-sync-blob-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let mut store = FsStore::open(&dir);
        write_blob(&mut store, "tail", b"abc");
        assert_eq!(read_blob(&store, "tail").as_deref(), Some(b"abc".as_slice()));
        store.delete_all();
        assert!(read_blob(&store, "tail").is_none());
        let _ = fs::remove_dir_all(&dir);
    }
}
