//! DELETE /room authorization.
//!
//! Node: loopback TCP address, or a configured token. Never X-Forwarded-For.
//! Worker: no loopback. Occupied rooms need the token. Empty rooms may be cleared
//! without one (same outcome as the 90s empty-room GC).

#[derive(Clone, Debug, Default)]
pub struct PresentedToken {
    pub compact: String,
    pub room_delete: String,
    pub authorization: String,
}

impl PresentedToken {
    pub fn from_header_values(
        compact: Option<&str>,
        room_delete: Option<&str>,
        authorization: Option<&str>,
    ) -> Self {
        Self {
            compact: first_header(compact),
            room_delete: first_header(room_delete),
            authorization: first_header(authorization),
        }
    }
}

/// First value when a header is repeated (`a, b` is one value; callers pass the first header).
fn first_header(value: Option<&str>) -> String {
    value.unwrap_or("").to_string()
}

pub fn expected_token(compact: Option<&str>, room_delete: Option<&str>) -> String {
    match compact {
        Some(a) if !a.is_empty() => a.to_string(),
        _ => match room_delete {
            Some(b) if !b.is_empty() => b.to_string(),
            _ => String::new(),
        },
    }
}

pub fn presented_secret(headers: &PresentedToken) -> String {
    if !headers.compact.is_empty() {
        return headers.compact.clone();
    }
    if !headers.room_delete.is_empty() {
        return headers.room_delete.clone();
    }
    bearer(&headers.authorization).unwrap_or("").to_string()
}

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

pub fn is_loopback_address(addr: &str) -> bool {
    if addr.is_empty() {
        return false;
    }
    let mut a = addr.trim().to_ascii_lowercase();
    if a.starts_with('[') && a.ends_with(']') && a.len() >= 2 {
        a = a[1..a.len() - 1].to_string();
    }
    if let Some(zone) = a.find('%') {
        a.truncate(zone);
    }
    if a == "::1" || a == "0:0:0:0:0:0:0:1" || a == "localhost" {
        return true;
    }
    if a == ":ffff:127.0.0.1" {
        return true;
    }
    let v4 = if let Some(rest) = a.strip_prefix("::ffff:") {
        rest
    } else if let Some(rest) = a.strip_prefix("0:0:0:0:0:ffff:") {
        rest
    } else {
        a.as_str()
    };
    is_dotted_127(v4)
}

fn is_dotted_127(v4: &str) -> bool {
    let mut parts = v4.split('.');
    let Some(a) = parts.next() else {
        return false;
    };
    let Some(b) = parts.next() else {
        return false;
    };
    let Some(c) = parts.next() else {
        return false;
    };
    let Some(d) = parts.next() else {
        return false;
    };
    if parts.next().is_some() {
        return false;
    }
    a == "127" && is_dec_group(b) && is_dec_group(c) && is_dec_group(d)
}

fn is_dec_group(p: &str) -> bool {
    !p.is_empty() && p.len() <= 3 && p.bytes().all(|c| c.is_ascii_digit())
}

/// `Authorization: Bearer <token>`, case-insensitive scheme, at least one whitespace.
pub fn bearer(authorization: &str) -> Option<&str> {
    let s = authorization.trim();
    if s.len() < 6 || !s[..6].eq_ignore_ascii_case("bearer") {
        return None;
    }
    let rest = &s[6..];
    let trimmed = rest.trim_start();
    if trimmed.len() == rest.len() {
        return None;
    }
    let token = trimmed.split_whitespace().next().unwrap_or("");
    if token.is_empty() {
        None
    } else {
        Some(token)
    }
}

pub fn node_delete_authorized(remote_ip: &str, headers: &PresentedToken, expected: &str) -> bool {
    if is_loopback_address(remote_ip) {
        return true;
    }
    tokens_match(&presented_secret(headers), expected)
}

/// Occupied rooms need a matching secret. Empty rooms may be cleared without one.
pub fn worker_delete_authorized(headers: &PresentedToken, expected: &str, socket_count: usize) -> bool {
    if tokens_match(&presented_secret(headers), expected) {
        return true;
    }
    socket_count == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn none() -> PresentedToken {
        PresentedToken::default()
    }

    #[test]
    fn loopback_matrix() {
        assert!(is_loopback_address("127.0.0.1"));
        assert!(is_loopback_address("::1"));
        assert!(is_loopback_address("::ffff:127.0.0.1"));
        assert!(is_loopback_address(":ffff:127.0.0.1"));
        assert!(is_loopback_address("127.0.0.2"));
        assert!(!is_loopback_address("192.168.1.5"));
        assert!(!is_loopback_address("10.0.0.8"));
        assert!(!is_loopback_address("8.8.8.8"));
    }

    #[test]
    fn node_delete_ignores_forwarded_for() {
        assert!(!node_delete_authorized("192.168.1.20", &none(), ""));
        assert!(node_delete_authorized("127.0.0.1", &none(), ""));
        assert!(node_delete_authorized("::ffff:127.0.0.1", &none(), ""));
        let headers = PresentedToken::from_header_values(Some("s3cret"), None, None);
        assert!(node_delete_authorized("192.168.1.20", &headers, "s3cret"));
        let wrong = PresentedToken::from_header_values(Some("wrong"), None, None);
        assert!(!node_delete_authorized("192.168.1.20", &wrong, "s3cret"));
        let room = PresentedToken::from_header_values(None, Some("s3cret"), None);
        assert!(node_delete_authorized(
            "192.168.1.20",
            &room,
            &expected_token(None, Some("s3cret"))
        ));
        let bearer_h = PresentedToken::from_header_values(None, None, Some("Bearer s3cret"));
        assert!(node_delete_authorized("192.168.1.20", &bearer_h, "s3cret"));
    }

    #[test]
    fn worker_empty_room_needs_no_token() {
        assert!(worker_delete_authorized(&none(), "", 0));
        assert!(!worker_delete_authorized(&none(), "", 1));
        assert!(!worker_delete_authorized(&none(), "s3cret", 2));
        let headers = PresentedToken::from_header_values(Some("s3cret"), None, None);
        assert!(worker_delete_authorized(&headers, "s3cret", 2));
        // Loopback is not an input. A forged story about the peer does not matter.
        assert!(!worker_delete_authorized(&none(), "", 1));
    }

    #[test]
    fn token_preference_and_bearer() {
        assert_eq!(expected_token(Some("a"), Some("b")), "a");
        assert_eq!(expected_token(Some(""), Some("b")), "b");
        assert_eq!(expected_token(None, None), "");
        assert_eq!(bearer("Bearer s3cret"), Some("s3cret"));
        assert_eq!(bearer("bearer   s3cret"), Some("s3cret"));
        assert_eq!(bearer("Basic s3cret"), None);
    }
}
