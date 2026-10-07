//! 心跳检测与 PING 查询
//!
//! mdns-sd 的 goodbye 包能覆盖正常退出，但拔网线 / 进程崩溃场景收不到，
//! 需后台轮询 `last_seen` 超时清理。
//!
//! 注意：mdns-sd 的 `ServiceResolved` 事件只在服务首次解析时触发，之后不会
//! 定期重复触发（服务信息不变时）。因此 `last_seen` 不会自动刷新，超时后
//! 不能直接移除设备，需要先通过 TCP 连接验证设备是否真的离线。
//! - 连接成功 → 设备在线，刷新 `last_seen`；同时发送 MODE_PING 获取
//!   对端最新 deviceName（mdns-sd 不重触发 ServiceResolved，改昵称后对端
//!   收不到更新，需通过心跳主动拉取），若变化则 emit `device-updated`
//! - 连接失败 → 设备离线，移除
//!
//! 自加密链路起，这条探测连接同样走 TLS（对端只接受加密连接）。

use crate::discovery::state::{current_unix_ms, remove_device, SharedDiscoveryState};
use crate::tls::{self, DeviceIdentity};
use crate::transfer::protocol::{MAX_STRING_LEN, MODE_PING};
use anyhow::Result;
use std::sync::Arc;
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
    identity: Arc<DeviceIdentity>,
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
            // 连接 + MODE_PING 查询：获取对端最新 deviceName
            //
            // 这条连接**不做指纹固定**：心跳要探测的正是「发现到但还没信任」的新设备，
            // 固定指纹会把它们一律判成离线，设备列表就永远刷不出新机器。
            // 因此这里只验证对端确实持有它出示的证书私钥，不看信任表。
            let ping_result =
                tokio::time::timeout(verify_timeout, ping_device(&addr, &identity)).await;

            match ping_result {
                // 连接成功（设备在线）
                Ok(Ok(new_name_opt)) => {
                    let mut s = state.lock().await;
                    if let Some(d) = s.devices.get_mut(&id) {
                        d.last_seen = current_unix_ms();
                        // deviceName 变化 → 更新 + emit（对端未按预期回应时 new_name_opt=None，不更新）
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

/// 加密连接对端并发送 MODE_PING，获取对端最新 deviceName
///
/// 返回值：
/// - `Ok(Some(name))`：连接成功且对端按预期回复，返回最新 deviceName
/// - `Ok(None)`：连接成功但对端回应不合预期，deviceName 不可用
/// - `Err(_)`：连接失败（设备离线，或对端为尚不支持加密链路的旧版本）
pub(crate) async fn ping_device(addr: &str, identity: &DeviceIdentity) -> Result<Option<String>> {
    // expected = None：探测陌生设备是心跳的本职，不能要求它已在信任表里
    let mut stream = tls::connect(addr, identity, None).await?;
    let ping_result = async {
        stream.write_all(&[MODE_PING]).await?;
        stream.flush().await?;
        let mut len_bytes = [0u8; 4];
        stream.read_exact(&mut len_bytes).await?;
        let len = u32::from_be_bytes(len_bytes) as usize;
        // 与协议读侧同一套上限：长度前缀来自对端，不校验就等于把内存分配权交出去
        if len > MAX_STRING_LEN {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "deviceName 长度超出上限",
            ));
        }
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
