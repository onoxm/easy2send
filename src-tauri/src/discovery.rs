//! 自动设备发现模块（基于 mDNS / DNS-SD）
//!
//! 服务类型：`_easy2send._tcp.local.`
//! 底层库：`mdns-sd`（纯 Rust，跨平台无外部依赖）
//!
//! 子模块：
//! - `device_id`：本机 UUID v4 持久化
//! - `state`：运行时状态、设备表 CRUD、网卡过滤
//! - `health`：心跳检测 + PING 查询（设备保活与昵称同步）
//! - `register`：注册 / 注销本机 mDNS 服务
//! - `browse`：浏览局域网设备 + 事件推送

pub mod browse;
pub mod device_id;
pub mod health;
pub mod register;
pub mod state;

use crate::common::hostname_ip::lan_ips_csv;
use crate::discovery::health::health_check;
// re-export 供 lib.rs 构造默认状态
pub use crate::discovery::state::{DiscoveryState, SharedDiscoveryState};

use mdns_sd::ServiceDaemon;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

// ---------- 对外数据结构 ----------

/// 发现模块对外暴露的设备信息（emit 给前端 / 命令返回）
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    /// 设备唯一标识（UUID v4，从 TXT 记录解析）
    pub device_id: String,
    /// 用户可见别名
    pub device_name: String,
    /// 设备 IP（与本机同网段者优先）
    pub ip: String,
    /// 设备所有可达 IPv4 地址（mDNS 注册的全部 IP，供连接失败时逐个尝试）
    pub addresses: Vec<String>,
    /// TCP 传输端口
    pub port: u16,
    /// 平台：windows / macos / linux
    pub platform: String,
    /// app 版本号
    pub version: String,
    /// 是否启用 HTTPS（v1 恒 false，预留）
    pub https: bool,
    /// 最后一次收到该设备消息的 Unix 时间戳（毫秒）
    pub last_seen: u64,
}

/// 启动发现时的入参
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryConfig {
    /// 本机设备别名（来自设置）
    pub device_name: String,
    /// 本机 TCP 监听端口；接收端传实际端口，发送端传 0 表示仅浏览
    pub port: u16,
    /// 平台标识 windows / macos / linux
    pub platform: String,
    /// app 版本号
    pub version: String,
}

// ---------- 内部工具 ----------

/// 构造并注册本机服务（同步函数，可在锁内调用）
///
/// `port == 0` 时不注册（发送端仅浏览），返回 None。
fn register_with_daemon(
    daemon: &ServiceDaemon,
    device_id: &str,
    config: &DiscoveryConfig,
) -> Result<Option<String>, String> {
    if config.port == 0 {
        return Ok(None);
    }

    // 枚举所有有效 LAN IP（排除虚拟网卡），注册为逗号分隔的多 IP，
    // mdns-sd 0.13 原生支持 AsIpAddrs，对端解析时优先选同网段 IP
    let local_ip = lan_ips_csv().ok_or_else(|| "未找到有效的 LAN 网卡".to_string())?;
    println!("[mdns] 本机 IP: {}", local_ip);

    let info = register::build_service_info(
        device_id,
        &config.device_name,
        &local_ip,
        config.port,
        &config.platform,
        &config.version,
    )
    .map_err(|e| format!("{}", e))?;

    let fullname = info.get_fullname().to_string();
    println!(
        "[mdns] 注册服务: {} @ {}:{} (fullname={})",
        config.device_name, local_ip, config.port, fullname
    );
    daemon
        .register(info)
        .map_err(|e| format!("注册服务失败: {}", e))?;
    println!("[mdns] 服务注册成功");
    Ok(Some(fullname))
}

// ---------- Tauri 命令 ----------

/// 启动设备发现
///
/// - 接收端（`config.port > 0`）：注册本机 `_easy2send._tcp.` 服务 + 浏览
/// - 发送端（`config.port == 0`）：仅浏览
///
/// 若 discovery 已运行：
/// - 发送端（port=0）调用 → 直接返回 Ok（复用已有 browse）
/// - 接收端（port>0）调用且当前未注册 → 升级为注册模式（注册服务）
#[tauri::command]
pub async fn start_discovery(
    app: AppHandle,
    config: DiscoveryConfig,
    state: tauri::State<'_, SharedDiscoveryState>,
) -> Result<(), String> {
    // 1. 检查是否已在运行
    {
        let mut s = state.lock().await;
        if s.daemon.is_some() {
            // 已运行：接收端（port>0）且当前未注册 → 升级为注册模式
            if config.port > 0 && s.registered_fullname.is_none() {
                let daemon = s.daemon.as_ref().unwrap();
                let device_id = s.self_device_id.as_deref().ok_or("device_id 未设置")?;
                let fullname = register_with_daemon(daemon, device_id, &config)?;
                s.registered_fullname = fullname;
                s.last_config = Some(config);
                let _ = app.emit("discovery-status", "running");
            }
            // 发送端（port==0）或已注册 → 直接返回 Ok
            return Ok(());
        }
    }

    // 2. 创建 daemon
    let daemon = ServiceDaemon::new().map_err(|e| format!("mdns daemon init failed: {}", e))?;

    // 3. 读取/生成本机 device_id
    let self_device_id = device_id::get_or_create_device_id(&app)
        .await
        .map_err(|e| format!("生成 device_id 失败: {}", e))?;

    // 4. 接收端：注册本机服务（port > 0 时）
    let registered_fullname = register_with_daemon(&daemon, &self_device_id, &config)?;

    // 5. 启动浏览
    let receiver = browse::start_browse(&daemon).map_err(|e| format!("{}", e))?;
    let shared_state: SharedDiscoveryState = state.inner().clone();
    let browse_task = browse::spawn_browse_task(receiver, shared_state, app.clone());

    // 6. 启动心跳检测：每 10s 扫描，30s 未刷新则 TCP 验证（在线刷新 last_seen，离线移除）
    //    注：mdns-sd 的 ServiceResolved 不定期重触发，需 TCP 验证保活
    let health_state: SharedDiscoveryState = state.inner().clone();
    let health_app = app.clone();
    let health_task = tauri::async_runtime::spawn(async move {
        health_check(
            health_state,
            health_app,
            Duration::from_secs(10),
            Duration::from_secs(30),
        )
        .await;
    });

    // 7. 写入状态
    {
        let mut s = state.lock().await;
        s.daemon = Some(daemon);
        s.browse_task = Some(browse_task);
        s.health_task = Some(health_task);
        s.registered_fullname = registered_fullname;
        s.self_device_id = Some(self_device_id);
        s.last_config = Some(config);
    }

    let _ = app.emit("discovery-status", "running");
    Ok(())
}

/// 停止设备发现（幂等：未启动时调用也返回 Ok）
#[tauri::command]
pub async fn stop_discovery(state: tauri::State<'_, SharedDiscoveryState>) -> Result<(), String> {
    let (daemon, browse_task, health_task) = {
        let mut s = state.lock().await;
        (s.daemon.take(), s.browse_task.take(), s.health_task.take())
    };

    // 取消后台任务
    if let Some(handle) = browse_task {
        handle.abort();
    }
    if let Some(handle) = health_task {
        handle.abort();
    }

    // 关闭 daemon（shutdown 会自动发 goodbye 并注销所有服务）
    if let Some(daemon) = daemon {
        let _ = daemon.shutdown();
    }

    // 清空设备表与索引
    {
        let mut s = state.lock().await;
        s.registered_fullname = None;
        s.self_device_id = None;
        s.last_config = None;
        s.devices.clear();
        s.fullname_index.clear();
    }

    Ok(())
}

/// 注销本机 mDNS 服务（不停 browse）
///
/// 接收端停止时调用：注销服务让其他设备看不到自己，但 browse 继续运行
/// （browse 由根布局管理，应用生命周期内常驻）。
#[tauri::command]
pub async fn unregister_service(
    state: tauri::State<'_, SharedDiscoveryState>,
) -> Result<(), String> {
    let mut s = state.lock().await;
    if let (Some(daemon), Some(fullname)) = (s.daemon.as_ref(), s.registered_fullname.as_ref()) {
        println!("[mdns] 注销服务: {}", fullname);
        let _ = daemon.unregister(fullname);
        s.registered_fullname = None;
        s.last_config = None;
    }
    Ok(())
}

/// 查询当前已知设备列表（同步查询，不触发网络请求）
#[tauri::command]
pub async fn list_devices(
    state: tauri::State<'_, SharedDiscoveryState>,
) -> Result<Vec<DeviceInfo>, String> {
    Ok(crate::discovery::state::list_devices(&state).await)
}

/// 运行时修改本机广播别名
///
/// 若服务正在运行：注销旧服务 → 以新名称重新注册 → 触发对端 `device-updated`。
#[tauri::command]
pub async fn set_device_name(
    app: AppHandle,
    name: String,
    state: tauri::State<'_, SharedDiscoveryState>,
) -> Result<(), String> {
    // 校验：1-32 字符，不含点号（避免破坏实例名解析）
    if name.is_empty() || name.len() > 32 || name.contains('.') {
        return Err("设备别名非法（1-32 字符，不含点号）".to_string());
    }

    let mut s = state.lock().await;

    // 若服务正在运行，重新注册
    if let (Some(daemon), Some(old_fullname), Some(config), Some(device_id)) = (
        s.daemon.as_ref(),
        s.registered_fullname.as_ref(),
        s.last_config.as_ref(),
        s.self_device_id.as_ref(),
    ) {
        let local_ip = lan_ips_csv().ok_or_else(|| "未找到有效的 LAN 网卡".to_string())?;

        let new_info = register::build_service_info(
            device_id,
            &name,
            &local_ip,
            config.port,
            &config.platform,
            &config.version,
        )
        .map_err(|e| format!("{}", e))?;

        let new_fullname = new_info.get_fullname().to_string();

        // 注销旧服务（不等待结果，goodbye 会异步发出）
        let _ = daemon.unregister(old_fullname);

        // 注册新服务
        daemon
            .register(new_info)
            .map_err(|e| format!("注册服务失败: {}", e))?;

        s.registered_fullname = Some(new_fullname);
    }

    // 更新 last_config 中的别名
    if let Some(c) = s.last_config.as_mut() {
        c.device_name = name;
    }

    drop(s);

    // TODO: 持久化 deviceName 到配置文件（前端 store 已持久化，后端可选）
    let _ = app.emit("discovery-status", "running");
    Ok(())
}

/// 读取或生成本机 device_id（供设置页展示）
#[tauri::command]
pub async fn get_device_id(app: AppHandle) -> Result<String, String> {
    device_id::get_or_create_device_id(&app)
        .await
        .map_err(|e| format!("{}", e))
}
