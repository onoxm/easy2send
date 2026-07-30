use std::io;
use std::net::{SocketAddr, TcpListener};

#[tauri::command]
pub fn get_free_port(ip: String, start: u16, end: u16) -> Result<u16, String> {
    let available = get_available_ports(ip, start, end)?;
    available
        .first()
        .copied()
        .ok_or_else(|| "范围内没有可用端口".to_string())
}

pub fn get_available_ports(ip: String, start: u16, end: u16) -> Result<Vec<u16>, String> {
    if start > end {
        return Err("起始端口不能大于结束端口".to_string());
    }

    let mut available = Vec::new();
    for port in start..=end {
        let addr_str = format!("{}:{}", ip, port);
        let addr: SocketAddr = addr_str
            .parse()
            .map_err(|e| format!("无效 IP/端口: {}", e))?;

        match TcpListener::bind(addr) {
            Ok(listener) => {
                // 绑定成功 → 端口可用
                drop(listener); // 立即释放
                available.push(port);
            }
            Err(e) if e.kind() == io::ErrorKind::AddrInUse => {
                // 端口被占用，跳过
                continue;
            }
            Err(e) => {
                // 其他错误（如权限），视作不可用，打印日志
                eprintln!("绑定端口 {} 出错: {}", port, e);
                continue;
            }
        }
    }
    Ok(available)
}
