//! LAN discovery over mDNS (`_review._tcp.local.`).
//!
//! Every host advertises its signaling port and browses for the others, so a
//! client can join the hubs of everyone on the same Wi-Fi without typing an
//! address. Discovery failures are never fatal: the host still serves its
//! own hub, it just will not see neighbours.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;

use crate::config::SIGNAL_PROTO;
use crate::lan::list_lan_addresses;

pub const SERVICE_TYPE: &str = "_review._tcp.local.";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct LanHost {
    /// Instance id, unique per running host.
    pub id: String,
    pub name: String,
    pub addresses: Vec<String>,
    pub port: u16,
}

pub struct Discovery {
    daemon: Option<ServiceDaemon>,
    self_id: String,
    hosts: Arc<Mutex<HashMap<String, LanHost>>>,
}

impl Discovery {
    /// Advertise `port` and start browsing. Returns a no-op discovery when the
    /// platform refuses multicast (containers, locked-down Wi-Fi).
    pub fn start(self_id: &str, name: &str, port: u16) -> Self {
        let hosts = Arc::new(Mutex::new(HashMap::new()));
        let daemon = match Self::spawn(self_id, name, port, Arc::clone(&hosts)) {
            Ok(d) => Some(d),
            Err(err) => {
                eprintln!("[review] mdns off: {err}");
                None
            }
        };
        Self {
            daemon,
            self_id: self_id.to_string(),
            hosts,
        }
    }

    pub fn disabled(self_id: &str) -> Self {
        Self {
            daemon: None,
            self_id: self_id.to_string(),
            hosts: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn active(&self) -> bool {
        self.daemon.is_some()
    }

    /// Other hosts seen on the LAN, sorted by name.
    pub fn hosts(&self) -> Vec<LanHost> {
        let map = self.hosts.lock().unwrap();
        let mut list: Vec<LanHost> = map
            .values()
            .filter(|h| h.id != self.self_id)
            .cloned()
            .collect();
        list.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
        list
    }

    fn spawn(
        self_id: &str,
        name: &str,
        port: u16,
        hosts: Arc<Mutex<HashMap<String, LanHost>>>,
    ) -> Result<ServiceDaemon, String> {
        let daemon = ServiceDaemon::new().map_err(|e| e.to_string())?;
        let addrs = list_lan_addresses()
            .into_iter()
            .filter(|a| !a.contains(':'))
            .collect::<Vec<_>>();
        if !addrs.is_empty() {
            let host_label = format!("review-{}.local.", &self_id[..self_id.len().min(12)]);
            let proto = SIGNAL_PROTO.to_string();
            let props = [("id", self_id), ("name", name), ("proto", proto.as_str())];
            let info = ServiceInfo::new(
                SERVICE_TYPE,
                &format!("review-{self_id}"),
                &host_label,
                addrs.join(",").as_str(),
                port,
                &props[..],
            )
            .map_err(|e| e.to_string())?;
            daemon.register(info).map_err(|e| e.to_string())?;
        }
        let rx = daemon.browse(SERVICE_TYPE).map_err(|e| e.to_string())?;
        std::thread::Builder::new()
            .name("review-mdns".into())
            .spawn(move || {
                // fullname -> id so removals can find the entry.
                let mut names: HashMap<String, String> = HashMap::new();
                while let Ok(event) = rx.recv() {
                    match event {
                        ServiceEvent::ServiceResolved(info) => {
                            if info.get_property_val_str("proto")
                                != Some(SIGNAL_PROTO.to_string().as_str())
                            {
                                continue;
                            }
                            let Some(id) = info.get_property_val_str("id").map(str::to_string)
                            else {
                                continue;
                            };
                            let name = info
                                .get_property_val_str("name")
                                .unwrap_or("ReView")
                                .to_string();
                            let mut addresses: Vec<String> = info
                                .get_addresses_v4()
                                .into_iter()
                                .map(|a| a.to_string())
                                .collect();
                            addresses.sort();
                            names.insert(info.get_fullname().to_string(), id.clone());
                            hosts.lock().unwrap().insert(
                                id.clone(),
                                LanHost {
                                    id,
                                    name,
                                    addresses,
                                    port: info.get_port(),
                                },
                            );
                        }
                        ServiceEvent::ServiceRemoved(_, fullname) => {
                            if let Some(id) = names.remove(&fullname) {
                                hosts.lock().unwrap().remove(&id);
                            }
                        }
                        _ => {}
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(daemon)
    }
}

impl Drop for Discovery {
    fn drop(&mut self) {
        if let Some(d) = self.daemon.take() {
            let _ = d.shutdown();
        }
    }
}
