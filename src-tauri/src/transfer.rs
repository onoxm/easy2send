// 文件/文件夹传输模块入口
// 子模块：
//   protocol: 协议常量 + 路径安全工具
//   server:   接收链路
//   client:   发送链路
mod client;
mod protocol;
mod server;

use crate::discovery::{DeviceInfo, SharedDiscoveryState};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::{oneshot, Mutex};

// ---------- 服务器状态管理 ----------
pub struct ServerState {
    pub cancel_sender: Option<oneshot::Sender<()>>,
    pub task_handle: Option<tauri::async_runtime::JoinHandle<()>>,
    pub save_dir: PathBuf,
}

impl Default for ServerState {
    fn default() -> Self {
        Self {
            cancel_sender: None,
            task_handle: None,
            save_dir: PathBuf::from("received"),
        }
    }
}

// ---------- Tauri 命令 ----------
#[tauri::command]
pub async fn start_server(
    app: AppHandle,
    addr: String,
    save_dir: String,
    state: tauri::State<'_, Arc<Mutex<ServerState>>>,
) -> Result<(), String> {
    let save_path = PathBuf::from(&save_dir);

    if !save_path.is_absolute() {
        return Err("保存路径必须是绝对路径".to_string());
    }
    if let Err(e) = tokio::fs::create_dir_all(&save_path).await {
        return Err(format!("无法创建目录: {}", e));
    }

    let save_path_for_task = save_path.clone();

    {
        let mut state = state.lock().await;
        if state.cancel_sender.is_some() {
            return Err("服务器已在运行".to_string());
        }
        state.save_dir = save_path;
    }

    let (tx, rx) = oneshot::channel();
    let app_clone = app.clone();
    let handle = tauri::async_runtime::spawn(async move {
        if let Err(e) = server::run_server(&addr, app_clone, rx, save_path_for_task).await {
            eprintln!("服务器错误: {}", e);
        }
    });

    {
        let mut state = state.lock().await;
        state.cancel_sender = Some(tx);
        state.task_handle = Some(handle);
    }
    Ok(())
}

#[tauri::command]
pub async fn stop_server(state: tauri::State<'_, Arc<Mutex<ServerState>>>) -> Result<(), String> {
    let mut state = state.lock().await;
    if let Some(sender) = state.cancel_sender.take() {
        let _ = sender.send(());
        state.task_handle = None;
        Ok(())
    } else {
        Err("No server is running".to_string())
    }
}

// 统一入口：自动判断文件或文件夹
#[tauri::command]
pub async fn send_file(app: AppHandle, addr: String, file_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = client::run_client(&addr, &file_path, app).await {
            eprintln!("Client error: {}", e);
        }
    });
    Ok(())
}

/// 连接指定设备（发送握手）
///
/// 从 discovery 设备表查找 device_id 对应的 ip:port →
/// TCP 连接对方 server → 发送 MODE_HANDSHAKE + 本机设备信息
/// 返回对端 DeviceInfo，前端存入 store 后跳转传输页
#[tauri::command]
pub async fn connect_device(
    device_id: String,
    state: tauri::State<'_, SharedDiscoveryState>,
) -> Result<DeviceInfo, String> {
    // 从 discovery state 查找对端设备
    let info = {
        let s = state.lock().await;
        s.devices
            .get(&device_id)
            .cloned()
            .ok_or_else(|| format!("设备未找到: {}", device_id))?
    };

    // 获取本机设备信息（含本机 server port）
    let (self_device_id, self_device_name, server_port, platform, version) = {
        let s = state.lock().await;
        let cfg = s.last_config.as_ref().ok_or("discovery 未启动")?;
        let did = s.self_device_id.as_ref().ok_or("device_id 未设置")?;
        (
            did.clone(),
            cfg.device_name.clone(),
            cfg.port,
            cfg.platform.clone(),
            cfg.version.clone(),
        )
    };

    // 连接对方 + 发送握手（携带本机 server port，使对端可回连）
    let addr = format!("{}:{}", info.ip, info.port);
    client::send_handshake(
        &addr,
        &self_device_id,
        &self_device_name,
        server_port,
        &platform,
        &version,
    )
    .await
    .map_err(|e| format!("连接失败: {}", e))?;

    Ok(info)
}
