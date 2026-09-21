//! Private LAN addresses for `GET /lan` and the listen banner.

use if_addrs::get_if_addrs;

use crate::room_name::format_host_for_url;

pub fn list_lan_addresses() -> Vec<String> {
    let Ok(ifaces) = get_if_addrs() else {
        return Vec::new();
    };
    let mut preferred = Vec::new();
    let mut fallback = Vec::new();
    for iface in ifaces {
        if iface.is_loopback() {
            continue;
        }
        let dockerish = is_dockerish(&iface.name);
        let addr = iface.ip().to_string();
        let ok = match iface.ip() {
            std::net::IpAddr::V4(v4) => {
                let s = v4.to_string();
                if s.starts_with("169.254.") {
                    false
                } else {
                    is_private_v4(&s)
                }
            }
            std::net::IpAddr::V6(_) => is_private_v6(&addr),
        };
        if !ok {
            continue;
        }
        if dockerish {
            fallback.push(addr);
        } else {
            preferred.push(addr);
        }
    }
    let mut picked = if preferred.is_empty() { fallback } else { preferred };
    picked.sort_by_key(|a| lan_rank(a));
    picked.dedup();
    picked
}

pub fn format_lan_host(addr: &str) -> String {
    format_host_for_url(addr)
}

fn is_dockerish(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.starts_with("docker")
        || n.starts_with("br-")
        || n.starts_with("veth")
        || n.starts_with("vmnet")
        || n.starts_with("vbox")
}

fn is_private_v4(addr: &str) -> bool {
    let mut parts = addr.split('.');
    let Some(a) = parts.next().and_then(|s| s.parse::<u32>().ok()) else {
        return false;
    };
    let Some(b) = parts.next().and_then(|s| s.parse::<u32>().ok()) else {
        return false;
    };
    if parts.next().is_none() || parts.next().is_none() || parts.next().is_some() {
        return false;
    }
    if a == 10 {
        return true;
    }
    if a == 192 && b == 168 {
        return true;
    }
    if a == 172 && (16..=31).contains(&b) {
        return true;
    }
    false
}

fn is_private_v6(addr: &str) -> bool {
    let a = addr.split('%').next().unwrap_or("").to_ascii_lowercase();
    if a.starts_with("fe80:") {
        return false;
    }
    a.starts_with("fc") || a.starts_with("fd")
}

fn lan_rank(addr: &str) -> u8 {
    if addr.starts_with("192.168.") {
        0
    } else if addr.starts_with("10.") {
        1
    } else if addr.contains(':') {
        3
    } else {
        2
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rank_and_private() {
        assert!(is_private_v4("192.168.1.5"));
        assert!(is_private_v4("10.1.2.3"));
        assert!(is_private_v4("172.16.0.1"));
        assert!(!is_private_v4("172.15.0.1"));
        assert!(!is_private_v4("8.8.8.8"));
        assert!(is_private_v6("fd00::1"));
        assert!(!is_private_v6("fe80::1"));
        assert!(lan_rank("192.168.0.1") < lan_rank("10.0.0.1"));
        assert!(lan_rank("10.0.0.1") < lan_rank("172.16.0.1"));
        assert!(lan_rank("172.16.0.1") < lan_rank("fd00::1"));
        assert!(is_dockerish("docker0"));
        assert!(is_dockerish("br-abc"));
        assert!(!is_dockerish("eth0"));
    }
}
