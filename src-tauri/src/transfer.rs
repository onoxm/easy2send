// 文件/文件夹传输模块入口
// 子模块：
//   protocol: 协议常量 + 路径安全工具
//   server:   接收链路
//   client:   发送链路
mod client;
pub(crate) mod protocol;
mod server;

use crate::discovery::{DeviceInfo, SharedDiscoveryState};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
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
    discovery_state: tauri::State<'_, SharedDiscoveryState>,
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
    let discovery_state = discovery_state.inner().clone();
    let handle = tauri::async_runtime::spawn(async move {
        if let Err(e) =
            server::run_server(&addr, app_clone, rx, save_path_for_task, discovery_state).await
        {
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

// 统一入口：自动判断文件或文件夹（单文件，兼容旧版）
#[tauri::command]
pub async fn send_file(app: AppHandle, addr: String, file_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = client::run_client(&addr, &file_path, app).await {
            eprintln!("Client error: {}", e);
        }
    });
    Ok(())
}

// 批量入口：多文件/文件夹混合，一次 TCP 连接串行发送（MODE_BATCH，保留兼容）
#[tauri::command]
pub async fn send_files(
    app: AppHandle,
    addr: String,
    file_paths: Vec<String>,
) -> Result<(), String> {
    if file_paths.is_empty() {
        return Err("文件列表为空".to_string());
    }
    tauri::async_runtime::spawn(async move {
        if let Err(e) = client::run_client_batch(&addr, &file_paths, app).await {
            eprintln!("Client batch error: {}", e);
        }
    });
    Ok(())
}

/// 创建传输任务组：前端按并发数排队调度
///
/// 返回 JSON 数组：[{ task_id, path, name }]
/// 前端逐个调用 `start_transfer_task` 开始传输，按并发上限控制同时运行数
#[tauri::command]
pub async fn create_transfer_tasks(
    addr: String,
    file_paths: Vec<String>,
) -> std::result::Result<Vec<serde_json::Value>, String> {
    let list = client::build_transfer_task_seeds(&addr, &file_paths).map_err(|e| e.to_string())?;
    Ok(list
        .into_iter()
        .map(|(task_id, path, name)| {
            serde_json::json!({
                "task_id": task_id,
                "path": path.to_string_lossy().to_string(),
                "name": name,
            })
        })
        .collect())
}

/// 启动单个传输任务（由 create_transfer_tasks 得到的 task_id）
///
/// 每个任务单独建 TCP 连接 + MODE_FILE_TASK/MODE_FOLDER_TASK
/// 事件使用 `send-progress-v2` / `send-complete-v2`（带 task_id）
#[tauri::command]
pub async fn start_transfer_task(
    app: AppHandle,
    addr: String,
    task_id: String,
    file_path: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn(async move {
        let p = PathBuf::from(&file_path);
        if let Err(e) = client::run_client_with_task_id(&addr, &p, &task_id, &app).await {
            eprintln!("transfer task {} error: {}", task_id, e);
            let _ = app.emit(
                "send-error-v2",
                serde_json::json!({
                    "task_id": task_id,
                    "message": e.to_string(),
                }),
            );
        }
    });
    Ok(())
}

/// 连接指定设备（发送握手）
///
/// 从 discovery 设备表查找 device_id → 取其全部候选 IP →
/// 逐个尝试 TCP 连接对方 server 并发送 MODE_HANDSHAKE + 本机设备信息，
/// 每个候选 IP 超时 3s（避免单 IP 不可达时卡 21s）。
/// 返回对端 DeviceInfo（ip 字段更新为实际握手成功的 IP），前端存入 store 后跳转传输页
#[tauri::command]
pub async fn connect_device(
    device_id: String,
    state: tauri::State<'_, SharedDiscoveryState>,
) -> Result<DeviceInfo, String> {
    // 从 discovery state 查找对端设备 + 本机设备信息
    let (info, self_info) = {
        let s = state.lock().await;
        let info = s
            .devices
            .get(&device_id)
            .cloned()
            .ok_or_else(|| format!("设备未找到: {}", device_id))?;
        let cfg = s.last_config.as_ref().ok_or("discovery 未启动")?;
        let did = s.self_device_id.as_ref().ok_or("device_id 未设置")?;
        (
            info,
            (
                did.clone(),
                cfg.device_name.clone(),
                cfg.port,
                cfg.platform.clone(),
                cfg.version.clone(),
            ),
        )
    };
    let (self_device_id, self_device_name, server_port, platform, version) = self_info;

    // 候选地址：首选 IP 在前，其余 addresses 去重后追加
    // 多网卡环境下 mDNS 注册多 IP，首选可能不可达，需逐个尝试
    let mut candidates: Vec<String> = vec![info.ip.clone()];
    for a in &info.addresses {
        if !candidates.contains(a) {
            candidates.push(a.clone());
        }
    }

    println!(
        "[connect] 尝试连接 {}:{} ({}), 候选地址: {:?}",
        info.device_name, info.port, device_id, candidates
    );

    let mut last_err = String::new();
    for ip in &candidates {
        let addr = format!("{}:{}", ip, info.port);
        match tokio::time::timeout(
            Duration::from_secs(3),
            client::send_handshake(
                &addr,
                &self_device_id,
                &self_device_name,
                server_port,
                &platform,
                &version,
            ),
        )
        .await
        {
            Ok(Ok(_)) => {
                println!("[connect] 握手成功 {}", addr);
                // 若用了非首选 IP，更新 info.ip 为实际成功的 IP，
                // 后续发文件直接用这个可达 IP，无需再次容错
                let mut result = info.clone();
                result.ip = ip.clone();
                return Ok(result);
            }
            Ok(Err(e)) => {
                last_err = format!("{}: {}", addr, e);
                eprintln!("[connect] 握手失败 {}: {}", addr, e);
                continue;
            }
            Err(_) => {
                last_err = format!("{}: 连接超时(3s)", addr);
                eprintln!("[connect] 握手超时 {}", addr);
                continue;
            }
        }
    }
    Err(format!(
        "连接失败（尝试 {} 个地址均失败）: {}",
        candidates.len(),
        last_err
    ))
}

/// 手动连接指定地址（跳过 mDNS 发现表，直接 TCP 握手）
///
/// 供前端"手动连接"按钮调用：mDNS 发现不到对方时（跨网段/VPN/多网卡选错），
/// 用户手动输入 `ip:port` 发起握手。
///
/// 流程：发送 MODE_HANDSHAKE → 成功后用 MODE_PING 拉取对端 deviceName →
/// 构造 DeviceInfo 返回（ip/port 从 addr 解析，deviceName 来自 PING）
#[tauri::command]
pub async fn connect_by_addr(
    addr: String,
    state: tauri::State<'_, SharedDiscoveryState>,
) -> Result<DeviceInfo, String> {
    // 从 discovery state 拿本机设备信息（用于握手）
    let (self_device_id, self_device_name, server_port, platform, version) = {
        let s = state.lock().await;
        let cfg = s
            .last_config
            .as_ref()
            .ok_or("discovery 未启动，无法获取本机信息")?;
        let did = s.self_device_id.as_ref().ok_or("device_id 未设置")?;
        (
            did.clone(),
            cfg.device_name.clone(),
            cfg.port,
            cfg.platform.clone(),
            cfg.version.clone(),
        )
    };

    println!("[connect] 手动连接: {}", addr);

    // 1. 发送握手到目标地址（3s 超时）
    tokio::time::timeout(
        Duration::from_secs(3),
        client::send_handshake(
            &addr,
            &self_device_id,
            &self_device_name,
            server_port,
            &platform,
            &version,
        ),
    )
    .await
    .map_err(|_| format!("连接超时(3s): {}", addr))?
    .map_err(|e| format!("握手失败 {}: {}", addr, e))?;

    println!("[connect] 手动握手成功 {}", addr);

    // 2. 解析 addr 为 ip + port
    let socket_addr = addr
        .parse::<std::net::SocketAddr>()
        .map_err(|e| format!("地址格式错误（应为 IP:端口）: {}", e))?;
    let peer_ip = socket_addr.ip().to_string();
    let peer_port = socket_addr.port();

    // 3. 用 MODE_PING 拉取对端 deviceName（失败则用占位符）
    let peer_name = match tokio::time::timeout(
        Duration::from_secs(3),
        crate::discovery::health::ping_device(&addr),
    )
    .await
    {
        Ok(Ok(Some(name))) => name,
        _ => format!("未知设备({})", peer_ip),
    };

    // 4. 构造 DeviceInfo 返回
    Ok(DeviceInfo {
        device_id: String::new(),
        device_name: peer_name,
        ip: peer_ip.clone(),
        addresses: vec![peer_ip],
        port: peer_port,
        platform: String::new(),
        version: String::new(),
        https: false,
        last_seen: crate::discovery::state::current_unix_ms(),
    })
}
