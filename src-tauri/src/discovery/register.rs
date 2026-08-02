use anyhow::{anyhow, Result};
use mdns_sd::ServiceInfo;

/// easy2send 自定义 mDNS 服务类型（尾部点表示完整 FQDN）
pub const SERVICE_TYPE: &str = "_easy2send._tcp.local.";

/// 构造本机服务的 ServiceInfo
///
/// 实例名格式：`<deviceName>-<deviceId前8位>`，避免同子网重名设备冲突。
/// host_name 格式：`easy2send-<deviceId前8位>.local.`，必须以 `.local.` 结尾。
pub fn build_service_info(
    device_id: &str,
    device_name: &str,
    ip: &str,
    port: u16,
    platform: &str,
    version: &str,
) -> Result<ServiceInfo> {
    let short_id = device_id.get(..8).unwrap_or(device_id);
    let instance = format!("{}-{}", device_name, short_id);
    let host_name = format!("easy2send-{}.local.", short_id);

    // TXT 记录字段：全部为字符串（mDNS TXT 规范要求）
    let port_str = port.to_string();
    let properties: Vec<(&str, &str)> = vec![
        ("deviceId", device_id),
        ("deviceName", device_name),
        ("platform", platform),
        ("version", version),
        ("port", &port_str),
        // 预留位：v1 恒为 false，未来启用 TLS 时改 true
        ("https", "false"),
    ];

    ServiceInfo::new(SERVICE_TYPE, &instance, &host_name, ip, port, &properties[..])
        .map_err(|e| anyhow!("构建 ServiceInfo 失败: {}", e))
}
