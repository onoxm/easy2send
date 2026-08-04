use local_ip_address::list_afinet_netifas;
use std::net::{IpAddr, Ipv4Addr};

/// 获取本机首选 LAN IP（供 TCP server 绑定 + 前端展示）
///
/// 返回过滤后的第一个有效 IPv4 LAN 地址。多网卡环境下优先选物理网卡，
/// 排除 VMware/Hyper-V/VirtualBox/WSL/Docker/TAP 等虚拟网卡。
///
/// 仅返回 IPv4：LAN 文件传输场景不需要 IPv6，且 IPv6 link-local
/// 会导致 `${ip}:${port}` 拼接成非法 socket 地址（缺方括号）。
#[tauri::command]
pub fn get_lan_ip() -> Result<String, String> {
    let ip = list_local_lan_ips()
        .into_iter()
        .next()
        .ok_or_else(|| "未找到有效的 LAN 网卡".to_string())?;
    Ok(ip.to_string())
}

/// 返回所有有效 LAN 网卡 IPv4（排除回环、链路本地、虚拟网卡）
///
/// 供 mDNS 注册多 IP 与 TCP server 绑定使用。对端解析时优先选同网段 IP，
/// 避免单 IP 选错导致设备"单向可见"。
pub fn list_local_lan_ips() -> Vec<IpAddr> {
    let mut result = Vec::new();
    if let Ok(interfaces) = list_afinet_netifas() {
        for (name, ip) in interfaces {
            // 仅保留 IPv4，跳过 IPv6（link-local/临时地址会破坏 socket 地址解析）
            if let IpAddr::V4(v4) = ip {
                if is_valid_lan_ipv4(&v4) && is_physical_interface(&name) {
                    result.push(IpAddr::V4(v4));
                }
            }
        }
    }
    result
}

/// 返回逗号分隔的所有有效 LAN IPv4 字符串（供 mdns-sd ServiceInfo 多 IP 注册）
///
/// mdns-sd 0.13 的 `AsIpAddrs` 支持逗号分隔字符串，如 "192.168.1.9,192.168.1.10"。
/// 无有效网卡时返回 None。
pub fn lan_ips_csv() -> Option<String> {
    let ips = list_local_lan_ips();
    if ips.is_empty() {
        None
    } else {
        Some(
            ips.iter()
                .map(|ip| ip.to_string())
                .collect::<Vec<_>>()
                .join(","),
        )
    }
}

/// IPv4 网段级过滤：排除回环、链路本地、Docker/Hyper-V 默认网段
fn is_valid_lan_ipv4(v4: &Ipv4Addr) -> bool {
    let oct = v4.octets();
    !v4.is_loopback()
        && !v4.is_link_local() // 169.254.x.x
        && !v4.is_unspecified()
        // Docker 默认网段 172.16.0.0/12（含 Hyper-V vEthernet 172.30.x.x）
        && !(oct[0] == 172 && (16..=31).contains(&oct[1]))
}

/// 网卡名级过滤：排除已知虚拟网卡
///
/// Windows 上 `local_ip_address` 默认会返回 Hyper-V vEthernet 等虚拟网卡 IP，
/// 导致 mDNS 注册到错误网段、TCP server 绑定到不可达地址，表现为"单向可见"。
fn is_physical_interface(name: &str) -> bool {
    let lower = name.to_lowercase();
    const VIRTUAL_KEYWORDS: [&str; 9] = [
        "vmware",
        "vethernet",   // Hyper-V vEthernet (Default Switch / WSL)
        "virtualbox",
        "wsl",
        "docker",
        "tap",          // 网易 UU TAP / OpenVPN TAP
        "isatap",
        "teredo",
        "loopback pseudo",
    ];
    !VIRTUAL_KEYWORDS.iter().any(|kw| lower.contains(kw))
}
