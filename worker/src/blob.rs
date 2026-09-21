//! Chunked `doc` / `tail` blobs. Same key layout as `worker/src/persist.ts`.

pub const STORAGE_CHUNK: usize = 1_500_000;
pub const FULL_PERSIST_MS: f64 = 1000.0;
pub const PUT_BATCH: usize = 80;
pub const MAX_WS_MESSAGE: usize = 32 * 1024 * 1024;
pub const TAIL_FLUSH_MS: u64 = 150;
pub const FULL_PERSIST_IDLE_MS: u64 = 250;
pub const AWARENESS_QUIET_BEFORE_FULL_MS: f64 = 120.0;
pub const EMPTY_GC_MS: u64 = 90 * 1000;

pub fn split_chunks(bytes: &[u8], size: usize) -> Vec<Vec<u8>> {
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

pub fn should_full_persist(last_persist_ms: f64, now_ms: f64) -> bool {
    now_ms - last_persist_ms >= FULL_PERSIST_MS
}

pub fn can_drop_persisted_tail(encode_gen: u64, current_gen: u64, pending_count: usize) -> bool {
    encode_gen == current_gen && pending_count == 0
}

pub fn can_gc_empty_room(socket_count: usize, dirty: bool, pending_count: usize) -> bool {
    socket_count == 0 && !dirty && pending_count == 0
}

pub fn storage_count_f64(raw: Option<f64>) -> u64 {
    match raw {
        Some(n) if n.is_finite() => n.max(0.0).floor() as u64,
        _ => 0,
    }
}

pub fn storage_count_string(raw: &str) -> u64 {
    let s = raw.trim();
    if s.is_empty() {
        return 0;
    }
    match s.parse::<f64>() {
        Ok(n) if n.is_finite() => n.max(0.0).floor() as u64,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunks_and_predicates() {
        let parts = split_chunks(&[1, 2, 3, 4, 5], 2);
        assert_eq!(parts, vec![vec![1, 2], vec![3, 4], vec![5]]);
        assert_eq!(join_chunks(&parts), vec![1, 2, 3, 4, 5]);
        assert_eq!(split_chunks(&[], 2), vec![Vec::<u8>::new()]);
        assert!(should_full_persist(0.0, 1000.0));
        assert!(!should_full_persist(0.0, 999.0));
        assert!(can_drop_persisted_tail(3, 3, 0));
        assert!(!can_drop_persisted_tail(3, 4, 0));
        assert!(can_gc_empty_room(0, false, 0));
        assert!(!can_gc_empty_room(1, false, 0));
        assert!(!can_gc_empty_room(0, true, 0));
        assert_eq!(storage_count_string("12.9"), 12);
        assert_eq!(EMPTY_GC_MS, 90_000);
    }
}
