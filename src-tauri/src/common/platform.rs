use std::env::consts;

#[tauri::command]
pub fn get_platform() -> String {
    consts::OS.to_owned()
}
