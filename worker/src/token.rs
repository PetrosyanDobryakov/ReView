//! Worker DELETE auth and close-code rules from `worker/src/auth.ts` and `room.ts`.
//!
//! No loopback privilege. Occupied rooms need the secret. Empty rooms may be
//! cleared without one. Close codes 1005, 1006, and 1015, and anything outside
//! 1000 or 3000-4999, are rewritten to 1000.

pub fn tokens_match(provided: &str, expected: &str) -> bool {
    if expected.is_empty() || provided.is_empty() {
        return false;
    }
    let a = provided.as_bytes();
    let b = expected.as_bytes();
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for i in 0..a.len() {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

pub fn bearer(authorization: &str) -> Option<&str> {
    let auth = authorization.trim();
    let bytes = auth.as_bytes();
    if bytes.len() < 7 || !auth[..6].eq_ignore_ascii_case("bearer") {
        return None;
    }
    if !bytes[6].is_ascii_whitespace() {
        return None;
    }
    let rest = auth[6..].trim_start();
    let token = rest.split_whitespace().next().unwrap_or("");
    if token.is_empty() {
        None
    } else {
        Some(token)
    }
}

pub fn presented_secret(compact: &str, room_delete: &str, authorization: &str) -> String {
    if !compact.is_empty() {
        return compact.to_string();
    }
    if !room_delete.is_empty() {
        return room_delete.to_string();
    }
    bearer(authorization).unwrap_or("").to_string()
}

pub fn expected_token(compact: &str, room_delete: &str) -> String {
    if !compact.is_empty() {
        compact.to_string()
    } else if !room_delete.is_empty() {
        room_delete.to_string()
    } else {
        String::new()
    }
}

pub fn is_room_delete_authorized(provided: &str, expected: &str) -> bool {
    if expected.is_empty() {
        return false;
    }
    tokens_match(provided, expected)
}

pub fn can_clear_room(authorized: bool, socket_count: usize) -> bool {
    authorized || socket_count == 0
}

/// Codes the runtime rejects if passed to `WebSocket.close`.
pub fn safe_close_code(code: u16) -> u16 {
    if code == 1000 || (3000..=4999).contains(&code) {
        code
    } else {
        1000
    }
}

pub fn close_reason(reason: &str) -> String {
    reason.chars().take(123).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn occupied_needs_token_empty_does_not() {
        assert!(!can_clear_room(false, 2));
        assert!(can_clear_room(true, 2));
        assert!(can_clear_room(false, 0));
        assert!(!is_room_delete_authorized("", "secret"));
        assert!(!is_room_delete_authorized("secret", ""));
        assert!(is_room_delete_authorized("secret", "secret"));
        assert!(!is_room_delete_authorized("nope", "secret"));
        assert_eq!(bearer("Bearer abc"), Some("abc"));
        assert_eq!(bearer("bearer\tabc"), Some("abc"));
        assert_eq!(presented_secret("", "", "Bearer tok"), "tok");
    }

    #[test]
    fn reserved_close_codes_become_1000() {
        assert_eq!(safe_close_code(1000), 1000);
        assert_eq!(safe_close_code(1001), 1000);
        assert_eq!(safe_close_code(1005), 1000);
        assert_eq!(safe_close_code(1006), 1000);
        assert_eq!(safe_close_code(1015), 1000);
        assert_eq!(safe_close_code(3000), 3000);
        assert_eq!(safe_close_code(4999), 4999);
        assert_eq!(safe_close_code(5000), 1000);
        assert_eq!(close_reason(&"x".repeat(200)).chars().count(), 123);
    }
}
