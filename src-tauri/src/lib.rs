//! ReView desktop (and Android) shell.
//!
//! On launch the app starts its own `review-host` on the LAN interface: it
//! serves this same web UI to friends' browsers and runs the signaling hub
//! that introduces peers. Board data never goes through it; it flows over
//! WebRTC between peers and is stored here as files under the app data dir.
//!
//! The window loads the UI from the embedded host (`http://127.0.0.1:<port>`)
//! rather than `tauri://`, so the app and a friend's browser run the exact
//! same origin rules (plain-http hubs on the LAN are not mixed content).

mod boards;
mod rtc;
mod selftest;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use review_host::{Asset, LanHost, RunningHost, StaticSource};
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// Fixed so the webview origin (and its IndexedDB) stays the same between runs.
/// If it is taken the host walks up a few ports; board files on disk cover the
/// origin change.
const DEFAULT_PORT: u16 = 4455;
const PORT_TRIES: u16 = 20;

pub struct HostState(pub Mutex<Option<RunningHost>>);

/// Serves the frontend bundled into the app binary.
struct BundledAssets<R: Runtime>(tauri::AssetResolver<R>);

impl<R: Runtime> StaticSource for BundledAssets<R> {
  fn get(&self, path: &str) -> Option<Asset> {
    // Tauri's resolver falls back to index.html for anything; keep misses honest.
    let asset = self.0.get(path.to_string())?;
    if asset.mime_type.starts_with("text/html") && path != "index.html" && path.contains('.') {
      return None;
    }
    Some(Asset {
      bytes: asset.bytes.into(),
      mime: asset.mime_type,
    })
  }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HostInfo {
  port: u16,
  id: String,
  name: String,
  addresses: Vec<String>,
  hosts: Vec<LanHost>,
  mdns: bool,
  boards_dir: String,
}

#[tauri::command]
fn host_info(app: AppHandle, state: tauri::State<'_, HostState>) -> Result<HostInfo, String> {
  let guard = state.0.lock().map_err(|_| "host lock")?;
  let host = guard.as_ref().ok_or("host not running")?;
  Ok(HostInfo {
    port: host.port(),
    id: host.id().to_string(),
    name: host.name().to_string(),
    addresses: host.lan_addresses(),
    hosts: host.lan_hosts(),
    mdns: host.mdns_active(),
    boards_dir: boards::boards_dir(&app)?.display().to_string(),
  })
}

/// Set once the page has written its board files; the next close goes through.
static QUIT_READY: AtomicBool = AtomicBool::new(false);
/// If the page never answers (crashed, hung), close anyway after this long.
const QUIT_GRACE: Duration = Duration::from_secs(3);

#[tauri::command]
fn quit_ready<R: Runtime>(window: tauri::WebviewWindow<R>) {
  QUIT_READY.store(true, Ordering::SeqCst);
  let _ = window.close();
}

/// Closing the window first lets the page flush pending board files.
fn guard_close<R: Runtime>(window: &tauri::WebviewWindow<R>) {
  let w = window.clone();
  window.on_window_event(move |event| {
    if let WindowEvent::CloseRequested { api, .. } = event {
      if QUIT_READY.load(Ordering::SeqCst) {
        return;
      }
      api.prevent_close();
      let _ = w.eval(
        "(window.__reviewBeforeQuit ? window.__reviewBeforeQuit() : window.__TAURI_INTERNALS__.invoke('quit_ready')).catch(() => window.__TAURI_INTERNALS__.invoke('quit_ready'))",
      );
      let w2 = w.clone();
      std::thread::spawn(move || {
        std::thread::sleep(QUIT_GRACE);
        QUIT_READY.store(true, Ordering::SeqCst);
        let _ = w2.close();
      });
    }
  });
}

fn host_config() -> review_host::Config {
  let mut cfg = review_host::Config::from_env();
  cfg.port = std::env::var("REVIEW_DESKTOP_PORT")
    .ok()
    .and_then(|s| s.parse().ok())
    .unwrap_or(DEFAULT_PORT);
  cfg.port_tries = PORT_TRIES;
  // `Config::from_env` reads process args; tauri's own flags are not ours.
  cfg.dist = None;
  cfg
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(HostState(Mutex::new(None)))
    .manage(rtc::RtcState::default())
    .invoke_handler(tauri::generate_handler![
      host_info,
      quit_ready,
      boards::board_save,
      boards::board_load,
      boards::board_list,
      boards::board_delete,
      boards::open_boards_folder,
      boards::blob_save,
      boards::blob_load,
      selftest::selftest_report,
      rtc::rtc_create,
      rtc::rtc_create_data_channel,
      rtc::rtc_create_offer,
      rtc::rtc_create_answer,
      rtc::rtc_set_local,
      rtc::rtc_set_remote,
      rtc::rtc_add_ice,
      rtc::rtc_send,
      rtc::rtc_set_low_threshold,
      rtc::rtc_close_channel,
      rtc::rtc_path,
      rtc::rtc_close,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            // webrtc-rs is chatty while ICE warms up.
            .level_for("webrtc_ice", log::LevelFilter::Error)
            .level_for("webrtc", log::LevelFilter::Error)
            .build(),
        )?;
      }
      let assets: Arc<dyn StaticSource> = Arc::new(BundledAssets(app.asset_resolver()));
      let host = tauri::async_runtime::block_on(review_host::start(host_config(), Some(assets)))?;
      let port = host.port();
      log::info!("review-host on :{port} (lan: {:?})", host.lan_addresses());
      app.state::<HostState>().0.lock().unwrap().replace(host);

      // Dev loads Vite (hot reload); release loads the UI from the embedded host.
      let url = if cfg!(debug_assertions) && std::env::var("REVIEW_DESKTOP_EMBEDDED").is_err() {
        app.config().build.dev_url.clone().map(WebviewUrl::External)
      } else {
        None
      }
      .unwrap_or_else(|| {
        WebviewUrl::External(format!("http://127.0.0.1:{port}/").parse().expect("host url"))
      });
      let window = WebviewWindowBuilder::new(app, "main", url)
        .title("ReView")
        .inner_size(1280.0, 800.0)
        .min_inner_size(800.0, 600.0)
        // `target="_blank"` links (update banner, release page) open in the
        // system browser instead of a bare app window.
        .on_new_window(|url, _| {
          if matches!(url.scheme(), "http" | "https") {
            if let Err(e) = tauri_plugin_opener::open_url(url.as_str(), None::<&str>) {
              log::warn!("open {url}: {e}");
            }
          }
          tauri::webview::NewWindowResponse::Deny
        })
        .build()?;
      enable_webrtc(&window);
      guard_close(&window);
      selftest::maybe_run(app.handle().clone(), window);
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      if let tauri::RunEvent::Exit = event {
        if let Ok(mut h) = app.state::<HostState>().0.lock() {
          if let Some(mut host) = h.take() {
            host.stop();
          }
        }
      }
    });
}

/// WebKitGTK has `RTCPeerConnection` behind a setting that defaults to off.
#[cfg(target_os = "linux")]
fn enable_webrtc<R: Runtime>(window: &tauri::WebviewWindow<R>) {
  let _ = window.with_webview(|wv| {
    use webkit2gtk::{SettingsExt, WebViewExt};
    if let Some(settings) = wv.inner().settings() {
      settings.set_enable_webrtc(true);
      if std::env::var("REVIEW_SELFTEST").is_ok() {
        settings.set_enable_write_console_messages_to_stdout(true);
      }
    }
  });
}

/// WebView2 (Windows), WKWebView (macOS/iOS) and Android WebView have it on.
#[cfg(not(target_os = "linux"))]
fn enable_webrtc<R: Runtime>(_window: &tauri::WebviewWindow<R>) {}
