/// App commands. Listing them makes Tauri generate `allow-<command>`
/// permissions; `capabilities/default.json` grants them to the app window.
const COMMANDS: &[&str] = &[
  "host_info",
  "quit_ready",
  "board_save",
  "board_load",
  "board_list",
  "board_delete",
  "open_boards_folder",
  "blob_save",
  "blob_load",
  "selftest_report",
  "rtc_create",
  "rtc_create_data_channel",
  "rtc_create_offer",
  "rtc_create_answer",
  "rtc_set_local",
  "rtc_set_remote",
  "rtc_add_ice",
  "rtc_send",
  "rtc_set_low_threshold",
  "rtc_close_channel",
  "rtc_path",
  "rtc_close",
];

fn main() {
  tauri_build::try_build(
    tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
  )
  .expect("tauri build");
}
