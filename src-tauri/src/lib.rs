// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod common;
use common::{
    hostname_ip::get_lan_ip,
    port::get_free_port,
    tray::create_tray,
    update_state::{is_update_dismissed, set_update_dismissed},
    version::get_version,
};
mod fs;
use fs::{
    open::open_file,
    write::{write_binary_file, write_text_file},
};
mod transfer;
use std::sync::Arc;
use tokio::sync::Mutex;
use transfer::{send_file, start_server, stop_server, ServerState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let server_state = Arc::new(Mutex::new(ServerState::default()));
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
            start_server,
            stop_server,
            send_file,
            get_free_port,
            is_update_dismissed,
            set_update_dismissed,
            write_binary_file,
            write_text_file,
            open_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
