use crate::common::hostname_ip::list_local_lan_ips;
use crate::discovery::{DeviceInfo, DiscoveryConfig};
use crate::transfer::protocol::MODE_PING;
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

/// 发现模块运行时状态（内部，不暴露给前端）
pub struct DiscoveryState {
    /// mdns-sd daemon 句柄
    pub daemon: Option<mdns_sd::ServiceDaemon>,
    /// 浏览后台任务句柄
    pub browse_task: Option<tauri::async_runtime::JoinHandle<()>>,
    /// 心跳检测后台任务句柄
    pub health_task: Option<tauri::async_runtime::JoinHandle<()>>,
    /// 本机已注册的服务全名（用于注销与重注册）
    pub registered_fullname: Option<String>,
    /// 本机 device_id（用于过滤自己广播的服务）
    pub self_device_id: Option<String>,
    /// 最近一次启动发现时的入参（用于 set_device_name 重注册）
    pub last_config: Option<DiscoveryConfig>,
    /// 已发现设备表：device_id -> DeviceInfo
    pub devices: HashMap<String, DeviceInfo>,
    /// fullname -> device_id 反查索引（ServiceRemoved 只给 fullname）
    pub fullname_index: HashMap<String, String>,
}

impl Default for DiscoveryState {
    fn default() -> Self {
        Self {
            daemon: None,
            browse_task: None,
            health_task: None,
            registered_fullname: None,
            self_device_id: None,
            last_config: None,
            devices: HashMap::new(),
            fullname_index: HashMap::new(),
        }
    }
}

pub type SharedDiscoveryState = Arc<Mutex<DiscoveryState>>;

pub enum UpsertResult {
    Added,
    Updated,
    NoChange,
}

/// 判断目标 IP 是否与本机任一网卡同 /24 网段（IPv6 简化处理）
pub fn is_same_subnet_with_local(target: &IpAddr) -> bool {
    let locals = list_local_lan_ips();
    match target {
        IpAddr::V4(target_v4) => locals.iter().any(|local| match local {
            IpAddr::V4(local_v4) => same_ipv4_subnet(local_v4, target_v4),
            _ => false,
        }),
        IpAddr::V6(_) => locals.iter().any(|local| matches!(local, IpAddr::V6(_))),
    }
}

fn same_ipv4_subnet(a: &Ipv4Addr, b: &Ipv4Addr) -> bool {
    let a = a.octets();
    let b = b.octets();
    a[0] == b[0] && a[1] == b[1] && a[2] == b[2]
}

// ---------- 时间工具 ----------

/// 当前 Unix 时间戳（毫秒）
pub fn current_unix_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---------- 设备表操作 ----------

/// 新增或更新设备，返回操作类型并触发对应事件
pub async fn upsert_device(
    state: &SharedDiscoveryState,
    app: &AppHandle,
    fullname: String,
    info: DeviceInfo,
) -> UpsertResult {
    let mut s = state.lock().await;
    let device_id = info.device_id.clone();

    // 更新 fullname 反查索引
    s.fullname_index.insert(fullname, device_id.clone());

    let result = match s.devices.get(&device_id) {
        None => UpsertResult::Added,
        Some(existing) => {
            if existing.ip == info.ip
                && existing.port == info.port
                && existing.device_name == info.device_name
                && existing.version == info.version
                && existing.platform == info.platform
            {
                UpsertResult::NoChange
            } else {
                UpsertResult::Updated
            }
        }
    };

    match result {
        UpsertResult::Added => {
            s.devices.insert(device_id, info.clone());
            drop(s);
            let _ = app.emit("device-online", &info);
            UpsertResult::Added
        }
        UpsertResult::Updated => {
            s.devices.insert(device_id, info.clone());
            drop(s);
            let _ = app.emit("device-updated", &info);
            UpsertResult::Updated
        }
        UpsertResult::NoChange => {
            // 仅刷新 last_seen，不发事件
            if let Some(d) = s.devices.get_mut(&device_id) {
                d.last_seen = info.last_seen;
            }
            UpsertResult::NoChange
        }
    }
}

/// 按 device_id 移除设备，触发 device-offline 事件
pub async fn remove_device(state: &SharedDiscoveryState, app: &AppHandle, device_id: &str) -> bool {
    let mut s = state.lock().await;
    s.fullname_index.retain(|_, id| id != device_id);
    let removed = s.devices.remove(device_id).is_some();
    drop(s);
    if removed {
        let _ = app.emit("device-offline", device_id.to_string());
    }
    removed
}

/// 按 fullname 反查 device_id 并移除（用于 ServiceRemoved 事件）
pub async fn remove_device_by_fullname(
    state: &SharedDiscoveryState,
    app: &AppHandle,
    fullname: &str,
) -> bool {
    let device_id = {
        let s = state.lock().await;
        s.fullname_index.get(fullname).cloned()
    };
    match device_id {
        Some(id) => remove_device(state, app, &id).await,
        None => false,
    }
}

/// 列出当前已知设备（按 device_name 字典序）
pub async fn list_devices(state: &SharedDiscoveryState) -> Vec<DeviceInfo> {
    let s = state.lock().await;
    let mut list: Vec<DeviceInfo> = s.devices.values().cloned().collect();
    list.sort_by(|a, b| a.device_name.cmp(&b.device_name));
    list
}

/// 心跳检测：定期清理超时未刷新的设备
///
/// mdns-sd 的 goodbye 包能覆盖正常退出，但拔网线 / 进程崩溃场景收不到，
/// 需后台轮询 last_seen 超时清理。
///
/// 注意：mdns-sd 的 `ServiceResolved` 事件只在服务首次解析时触发，之后不会
/// 定期重复触发（服务信息不变时）。因此 `last_seen` 不会自动刷新，超时后
/// 不能直接移除设备，需要先通过 TCP 连接验证设备是否真的离线。
/// - TCP 连接成功 → 设备在线，刷新 `last_seen`；同时发送 MODE_PING 获取
///   对端最新 deviceName（mdns-sd 不重触发 ServiceResolved，改昵称后对端
///   收不到更新，需通过心跳主动拉取），若变化则 emit `device-updated`
/// - TCP 连接失败 → 设备离线，移除
pub async fn health_check(
    state: SharedDiscoveryState,
    app: AppHandle,
    interval: Duration,
    timeout: Duration,
) {
    let timeout_ms = timeout.as_millis() as u64;
    let verify_timeout = Duration::from_secs(3);
    loop {
        tokio::time::sleep(interval).await;

        // 收集超时设备（ip, port 用于 TCP 连接验证）
        let timed_out: Vec<(String, String, u16)> = {
            let s = state.lock().await;
            let now = current_unix_ms();
            s.devices
                .iter()
                .filter(|(_, d)| now.saturating_sub(d.last_seen) > timeout_ms)
                .map(|(id, d)| (id.clone(), d.ip.clone(), d.port))
                .collect()
        };

        for (id, ip, port) in timed_out {
            let addr = format!("{}:{}", ip, port);
            // TCP 连接 + MODE_PING 查询：获取对端最新 deviceName
            let ping_result = tokio::time::timeout(verify_timeout, ping_device(&addr)).await;

            match ping_result {
                // 连接成功（设备在线）
                Ok(Ok(new_name_opt)) => {
                    let mut s = state.lock().await;
                    if let Some(d) = s.devices.get_mut(&id) {
                        d.last_seen = current_unix_ms();
                        // deviceName 变化 → 更新 + emit（旧版本不支持 MODE_PING 时 new_name_opt=None，不更新）
                        if let Some(new_name) = new_name_opt {
                            if d.device_name != new_name {
                                d.device_name = new_name;
                                let info = d.clone();
                                drop(s);
                                let _ = app.emit("device-updated", &info);
                                continue;
                            }
                        }
                    }
                }
                // 连接失败或超时（设备离线）
                Ok(Err(_)) | Err(_) => {
                    remove_device(&state, &app, &id).await;
                }
            }
        }
    }
}

/// TCP 连接对端并发送 MODE_PING，获取对端最新 deviceName
///
/// 返回值：
/// - `Ok(Some(name))`：连接成功且对端支持 MODE_PING，返回最新 deviceName
/// - `Ok(None)`：连接成功但对端为旧版本（不支持 MODE_PING），deviceName 不可用
/// - `Err(_)`：连接失败（设备离线）
async fn ping_device(addr: &str) -> std::io::Result<Option<String>> {
    let mut stream = tokio::net::TcpStream::connect(addr).await?;
    // connect 成功即证明设备在线；MODE_PING 读取失败说明对端是旧版本
    let ping_result = async {
        stream.write_all(&[MODE_PING]).await?;
        stream.flush().await?;
        let mut len_bytes = [0u8; 4];
        stream.read_exact(&mut len_bytes).await?;
        let len = u32::from_be_bytes(len_bytes) as usize;
        let mut buf = vec![0u8; len];
        stream.read_exact(&mut buf).await?;
        std::io::Result::Ok(String::from_utf8_lossy(&buf).to_string())
    }
    .await;
    match ping_result {
        Ok(name) => Ok(Some(name)),
        Err(_) => Ok(None),
    }
}
