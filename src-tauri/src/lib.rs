// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod common;
use common::{
    hostname_ip::get_lan_ip, port::get_free_port, tray::create_tray, update_state,
    version::get_version,
};
mod fs;
use fs::file_transfer;
use std::sync::Arc;
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let server_state = Arc::new(Mutex::new(file_transfer::ServerState::default()));
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(server_state)
        .setup(|app| create_tray(app))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            get_version,
            get_lan_ip,
            file_transfer::start_server,
            file_transfer::stop_server,
            file_transfer::send_file,
            get_free_port,
            update_state::is_update_dismissed,
            update_state::set_update_dismissed
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
