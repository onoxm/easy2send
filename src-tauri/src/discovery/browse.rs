use crate::discovery::state::{
    current_unix_ms, is_same_subnet_with_local, remove_device_by_fullname, upsert_device,
    SharedDiscoveryState,
};
use crate::discovery::DeviceInfo;
use mdns_sd::{Receiver, ServiceDaemon, ServiceEvent};
use std::net::IpAddr;
use tauri::{AppHandle, Emitter};

use super::register::SERVICE_TYPE;

/// 启动浏览，返回事件接收器
pub fn start_browse(daemon: &ServiceDaemon) -> anyhow::Result<Receiver<ServiceEvent>> {
    daemon
        .browse(SERVICE_TYPE)
        .map_err(|e| anyhow::anyhow!("启动浏览失败: {}", e))
}

/// 启动后台任务消费浏览事件，返回任务句柄
///
/// 事件处理：
/// - `ServiceResolved`：解析 TXT → 校验同网段 → upsert_device → emit `device-online`/`device-updated`
/// - `ServiceRemoved`：按 fullname 反查 → remove_device → emit `device-offline`
pub fn spawn_browse_task(
    receiver: Receiver<ServiceEvent>,
    state: SharedDiscoveryState,
    app: AppHandle,
) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        while let Ok(event) = receiver.recv_async().await {
            match event {
                ServiceEvent::ServiceResolved(service) => {
                    let fullname = service.get_fullname().to_string();

                    // 过滤本机广播的服务（fullname 比对 + device_id 比对双重保险）
                    let (self_fullname, self_device_id) = {
                        let s = state.lock().await;
                        (s.registered_fullname.clone(), s.self_device_id.clone())
                    };
                    if Some(&fullname) == self_fullname.as_ref() {
                        continue;
                    }

                    match parse_resolved_service(&service, self_device_id.as_deref()) {
                        Some(info) => {
                            println!(
                                "[mdns] 发现设备: {} @ {}:{}",
                                info.device_name, info.ip, info.port
                            );
                            upsert_device(&state, &app, fullname, info).await;
                        }
                        None => {
                            eprintln!("[mdns] 解析失败: {}", fullname);
                        }
                    }
                }
                ServiceEvent::ServiceRemoved(_ty, fullname) => {
                    remove_device_by_fullname(&state, &app, &fullname).await;
                }
                _ => {}
            }
        }
        let _ = app.emit("discovery-status", "stopped");
    })
}

/// 解析 ServiceInfo 为 DeviceInfo，失败返回 None
///
/// 失败原因：缺必填 TXT 字段、port 解析失败、无可用同网段 IP、为本机自身。
fn parse_resolved_service(
    service: &mdns_sd::ServiceInfo,
    self_device_id: Option<&str>,
) -> Option<DeviceInfo> {
    let device_id = match service.get_property_val_str("deviceId") {
        Some(v) => v.to_string(),
        None => {
            eprintln!("[mdns] TXT 缺少 deviceId");
            return None;
        }
    };

    // 跳过本机
    if let Some(self_id) = self_device_id {
        if self_id == device_id {
            return None;
        }
    }

    let device_name = match service.get_property_val_str("deviceName") {
        Some(v) => v.to_string(),
        None => {
            eprintln!("[mdns] TXT 缺少 deviceName");
            return None;
        }
    };
    let platform = match service.get_property_val_str("platform") {
        Some(v) => v.to_string(),
        None => {
            eprintln!("[mdns] TXT 缺少 platform");
            return None;
        }
    };
    let version = match service.get_property_val_str("version") {
        Some(v) => v.to_string(),
        None => {
            eprintln!("[mdns] TXT 缺少 version");
            return None;
        }
    };
    let port_str = match service.get_property_val_str("port") {
        Some(v) => v,
        None => {
            eprintln!("[mdns] TXT 缺少 port");
            return None;
        }
    };
    let port: u16 = match port_str.parse() {
        Ok(p) => p,
        Err(_) => {
            eprintln!("[mdns] port 解析失败 ({})", port_str);
            return None;
        }
    };
    let https = service
        .get_property_val_str("https")
        .map(|s| s == "true")
        .unwrap_or(false);

    // 从 IPv4 地址集合中优先选与本机同网段的，否则取任一 IPv4
    let addrs = service.get_addresses_v4();
    if addrs.is_empty() {
        eprintln!("[mdns] 无 IPv4 地址: {}", device_name);
        return None;
    }
    // 保留全部 IPv4 供连接失败时逐个尝试（多网卡环境首选 IP 可能不可达）
    let addresses: Vec<String> = addrs.iter().map(|ip| ip.to_string()).collect();
    let ip: IpAddr = addrs
        .into_iter()
        .copied()
        .map(IpAddr::V4)
        .find(|ip| is_same_subnet_with_local(ip))
        .or_else(|| {
            service
                .get_addresses_v4()
                .into_iter()
                .copied()
                .next()
                .map(IpAddr::V4)
        })
        .expect("addrs 非空时 or_else 的 fallback 必返回 Some");

    Some(DeviceInfo {
        device_id,
        device_name,
        ip: ip.to_string(),
        addresses,
        port,
        platform,
        version,
        https,
        last_seen: current_unix_ms(),
    })
}
