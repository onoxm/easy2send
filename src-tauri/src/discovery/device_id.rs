use anyhow::{anyhow, Result};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tokio::fs;
use uuid::Uuid;

/// device_id 持久化文件名（存放在 app_data_dir 下）
const DEVICE_ID_FILE: &str = "device_id.txt";

fn device_id_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow!("无法获取 app_data_dir: {}", e))?;
    Ok(dir.join(DEVICE_ID_FILE))
}

/// 读取或生成本机 device_id（UUID v4），首次生成后持久化到 app_data_dir/device_id.txt
///
/// 容错策略：文件不存在 / 内容非法时重新生成并覆盖写入，保证调用一定返回合法 UUID。
pub async fn get_or_create_device_id(app: &AppHandle) -> Result<String> {
    let path = device_id_path(app)?;

    // 尝试读取已有
    if let Ok(content) = fs::read_to_string(&path).await {
        let trimmed = content.trim().to_string();
        if Uuid::parse_str(&trimmed).is_ok() {
            return Ok(trimmed);
        }
        // 文件损坏或内容非法，落到下方重新生成
    }

    // 生成新的 UUID v4
    let new_id = Uuid::new_v4().to_string();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    fs::write(&path, &new_id).await?;
    Ok(new_id)
}
