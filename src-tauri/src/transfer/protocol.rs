use anyhow::{anyhow, Result};
use std::path::{Component, Path, PathBuf};
use tokio::net::TcpStream;

/// 单次读取/写入的缓冲区大小（4MB，千兆网下减少循环与 syscall 次数）
pub const CHUNK_SIZE: usize = 4 * 1024 * 1024;

/// socket 收发缓冲区大小（4MB，千兆网高 BDP 场景避免窗口受限）
const SOCKET_BUF_SIZE: usize = 4 * 1024 * 1024;

/// 调大 socket 收发缓冲区（SO_SNDBUF / SO_RCVBUF）
///
/// Windows 默认 64KB，千兆网 RTT 较大时 BDP 可能超过默认窗口导致吞吐受限。
/// 设置失败不报错（某些系统对 buffer size 有上限），仅记录日志。
pub fn tune_socket_buffers(stream: &TcpStream) {
    let sock = socket2::SockRef::from(stream);
    if let Err(e) = sock.set_recv_buffer_size(SOCKET_BUF_SIZE) {
        eprintln!("[transfer] set_recv_buffer_size 失败: {}", e);
    }
    if let Err(e) = sock.set_send_buffer_size(SOCKET_BUF_SIZE) {
        eprintln!("[transfer] set_send_buffer_size 失败: {}", e);
    }
}

// ---------- 协议标识 ----------
/// 单文件模式（兼容旧版接收端，无 task_id）
pub const MODE_FILE: u8 = 0;
/// 文件夹模式（兼容旧版接收端，无 task_id）
pub const MODE_FOLDER: u8 = 1;
/// 握手模式（对等连接：A 连接 B 时发送本机设备信息）
pub const MODE_HANDSHAKE: u8 = 2;
/// 批量模式：条目数 N → N 个 [entry_mode + payload]，支持多文件/文件夹一次 TCP 传输
pub const MODE_BATCH: u8 = 3;
/// 单文件 + 16 字节 task_id（UUID v4），事件带 task_id 便于前端分条展示
pub const MODE_FILE_TASK: u8 = 4;
/// 文件夹 + 16 字节 task_id（UUID v4）
pub const MODE_FOLDER_TASK: u8 = 5;
/// 心跳查询：对端回复本机 deviceName，供 health_check 更新设备昵称
/// （mdns-sd 0.13 ServiceResolved 仅首次触发，改昵称后对端收不到更新）
pub const MODE_PING: u8 = 6;

// ---------- 条目类型（文件夹模式内） ----------
pub const ENTRY_FILE: u8 = 0;
pub const ENTRY_DIR: u8 = 1;

/// 安全路径拼接：规范化并确保结果仍位于 base 之内，防止路径遍历（../ 注入）
pub fn safe_join(base: &Path, rel: &str) -> Result<PathBuf> {
    // 统一用 normalize 折叠 .. 和 .，避免 canonicalize 在 Windows 上产生 \\?\ 前缀
    // 导致与候选路径前缀不一致
    let normalized_base = normalize(base);
    let normalized = normalize(&base.join(rel));
    if !normalized.starts_with(&normalized_base) {
        return Err(anyhow!("非法路径，已拒绝: {}", rel));
    }
    Ok(normalized)
}

/// 不依赖文件系统存在的路径规范化（折叠 .. 和 .）
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}
