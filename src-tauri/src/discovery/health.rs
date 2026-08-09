//! 心跳检测与 PING 查询
//!
//! mdns-sd 的 goodbye 包能覆盖正常退出，但拔网线 / 进程崩溃场景收不到，
//! 需后台轮询 `last_seen` 超时清理。
//!
//! 注意：mdns-sd 的 `ServiceResolved` 事件只在服务首次解析时触发，之后不会
//! 定期重复触发（服务信息不变时）。因此 `last_seen` 不会自动刷新，超时后
//! 不能直接移除设备，需要先通过 TCP 连接验证设备是否真的离线。
//! - TCP 连接成功 → 设备在线，刷新 `last_seen`；同时发送 MODE_PING 获取
//!   对端最新 deviceName（mdns-sd 不重触发 ServiceResolved，改昵称后对端
//!   收不到更新，需通过心跳主动拉取），若变化则 emit `device-updated`
//! - TCP 连接失败 → 设备离线，移除

use crate::discovery::state::{current_unix_ms, remove_device, SharedDiscoveryState};
use crate::transfer::protocol::MODE_PING;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// 心跳检测：定期清理超时未刷新的设备
///
/// - `interval`：扫描间隔（默认 10s）
/// - `timeout`：设备 `last_seen` 超时阈值（默认 30s），超时后触发 TCP 验证
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
pub(crate) async fn ping_device(addr: &str) -> std::io::Result<Option<String>> {
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
