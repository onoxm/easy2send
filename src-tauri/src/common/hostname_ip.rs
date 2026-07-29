use local_ip_address::local_ip;

#[tauri::command]
pub fn get_lan_ip() -> Result<String, String> {
    match local_ip() {
        Ok(ip) => Ok(ip.to_string()),
        Err(e) => Err(format!("Failed to get IP: {}", e)),
    }
}