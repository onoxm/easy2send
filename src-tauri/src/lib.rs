// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use common::{get_lan_ip, get_platform, get_version, get_unused_port};
use tauri_plugin_autostart::MacosLauncher;
mod common;

#[tauri::command]
fn get_ip() -> String {
    get_lan_ip().to_string()
}

#[tauri::command]
fn check_port(ip: &str, port: u16) -> u16 {
    get_unused_port(ip, port)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--flag1", "--flag2"]),
        ))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_version,
            get_platform,
            get_ip,
            check_port
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
