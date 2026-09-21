//! Room names. Same rules as `worker/src/roomName.ts` and `sync/netUtil.mjs`.

pub const MAX_ROOM_NAME: usize = 200;

pub fn pathname_only(url_path: &str) -> &str {
    url_path.split('?').next().unwrap_or("")
}

pub fn normalize_room_name(name: &str) -> String {
    let trimmed = name.trim();
    let stripped = trim_slashes(trimmed);
    let decoded = decode_uri_component(stripped);
    trim_slashes(&decoded).to_string()
}

pub fn is_valid_room_name(name: &str) -> bool {
    if name.is_empty() || name.len() > MAX_ROOM_NAME {
        return false;
    }
    if name == "." || name == ".." {
        return false;
    }
    if name.contains('/') || name.contains('\\') {
        return false;
    }
    name.bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

pub fn room_from_websocket_path(url_path: &str) -> String {
    let path = pathname_only(url_path);
    let rest = path.strip_prefix('/').unwrap_or(path);
    normalize_room_name(rest)
}

pub fn room_from_delete_path(url_path: &str) -> String {
    let path = pathname_only(url_path);
    let Some(rest) = path.strip_prefix("/room/") else {
        return String::new();
    };
    normalize_room_name(rest)
}

fn trim_slashes(s: &str) -> &str {
    let b = s.trim_start_matches('/');
    b.trim_end_matches('/')
}

fn decode_uri_component(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return s.to_string();
            }
            let Some(hi) = hex_val(bytes[i + 1]) else {
                return s.to_string();
            };
            let Some(lo) = hex_val(bytes[i + 2]) else {
                return s.to_string();
            };
            out.push((hi << 4) | lo);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_string())
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_match_room_name_test() {
        assert!(is_valid_room_name("review-bmmkxyz"));
        assert!(!is_valid_room_name(""));
        assert!(!is_valid_room_name("."));
        assert!(!is_valid_room_name(".."));
        assert!(!is_valid_room_name("foo/bar"));
        assert!(!is_valid_room_name("foo\\bar"));
        assert!(!is_valid_room_name("has space"));
        assert!(!is_valid_room_name(&"a".repeat(201)));
        assert!(is_valid_room_name(&"a".repeat(200)));
    }

    #[test]
    fn paths_match_room_name_test() {
        assert_eq!(room_from_websocket_path("/review-abc?x=1"), "review-abc");
        assert_eq!(room_from_websocket_path("/review-abc/"), "review-abc");
        assert_eq!(room_from_delete_path("/room/review-abc"), "review-abc");
        assert_eq!(room_from_delete_path("/health"), "");
        assert_eq!(normalize_room_name("%"), "%");
        assert_eq!(normalize_room_name("a%2Fb"), "a/b");
        assert!(!is_valid_room_name(&normalize_room_name("a%2Fb")));
    }
}
