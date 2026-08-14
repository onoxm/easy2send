// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod common;
use common::{
    hostname_ip::get_lan_ip,
    port::get_free_port,
    sound::play_system_sound,
    tray::create_tray,
    update_state::{is_update_dismissed, set_update_dismissed},
    version::get_version,
};
mod fs;
use fs::{
    open::open_file,
    write::{write_binary_file, write_text_file},
};
mod discovery;
mod transfer;
mod webupload;
use discovery::{
    get_device_id, list_devices, set_device_name, start_discovery, stop_discovery,
    unregister_service, DiscoveryState, SharedDiscoveryState,
};
use std::sync::Arc;
use tokio::sync::Mutex;
use transfer::{
    connect_by_addr, connect_device, create_transfer_tasks, send_file, send_files, start_server,
    start_transfer_task, stop_server, ServerState,
};
use webupload::{
    create_pair_token, get_web_upload_port, start_web_upload, stop_web_upload,
    WebUploadServerControl,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let server_state = Arc::new(Mutex::new(ServerState::default()));
    let discovery_state: SharedDiscoveryState = Arc::new(Mutex::new(DiscoveryState::default()));
    let webupload_state = Arc::new(Mutex::new(WebUploadServerControl::default()));
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(server_state)
        .manage(discovery_state)
        .manage(webupload_state)
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
            send_files,
            create_transfer_tasks,
            start_transfer_task,
            connect_device,
            connect_by_addr,
            get_free_port,
            is_update_dismissed,
            set_update_dismissed,
            play_system_sound,
            write_binary_file,
            write_text_file,
            open_file,
            // 设备发现（mDNS）
            start_discovery,
            stop_discovery,
            list_devices,
            set_device_name,
            get_device_id,
            // 注销本机服务（不停 browse）
            unregister_service,
            // 手机扫码上传（HTTP 服务器）
            start_web_upload,
            stop_web_upload,
            get_web_upload_port,
            create_pair_token,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
