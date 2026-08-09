use anyhow::{anyhow, Result};
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
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

// ---------- task_id 转换 ----------

/// 16 字节 task_id → 32 字符 hex 字符串
pub fn bytes_to_task_id_hex(bytes: &[u8; 16]) -> String {
    bytes.iter().map(|x| format!("{:02x}", x)).collect()
}

/// 32 字符 hex 字符串 → 16 字节 task_id
pub fn task_id_hex_to_bytes(hex: &str) -> [u8; 16] {
    let mut out = [0u8; 16];
    let h = hex.as_bytes();
    for i in 0..16 {
        out[i] = u8::from_str_radix(&String::from_utf8_lossy(&[h[i * 2], h[i * 2 + 1]]), 16)
            .unwrap_or(0);
    }
    out
}

// ---------- 字符串读写（4 字节 BE 长度前缀 + UTF-8） ----------

/// 写入长度前缀字符串
pub async fn write_string<W: AsyncWrite + Unpin>(w: &mut W, s: &str) -> Result<()> {
    let len = s.len() as u32;
    w.write_all(&len.to_be_bytes()).await?;
    w.write_all(s.as_bytes()).await?;
    Ok(())
}

/// 读取长度前缀字符串
pub async fn read_string<R: AsyncRead + Unpin>(r: &mut R) -> Result<String> {
    let mut len_buf = [0u8; 4];
    r.read_exact(&mut len_buf).await?;
    let len = u32::from_be_bytes(len_buf) as usize;
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf).await?;
    Ok(String::from_utf8(buf)?)
}

// ---------- 进度事件（server/client 共用） ----------

/// 检查是否应发射进度事件（100ms 限频或传输完成时强制发射）
pub fn should_emit(last_emit: &Instant, is_final: bool) -> bool {
    last_emit.elapsed() >= Duration::from_millis(100) || is_final
}

/// 发送进度事件：计算 percent + speed，构建 JSON payload 并 emit
///
/// `extra` 可传入额外字段（如 path / entry_index / entry_count），None 则只发公共字段
pub fn emit_progress(
    app: &AppHandle,
    event: &str,
    task_id: &str,
    sent: u64,
    total: u64,
    name: &str,
    kind: &str,
    start: Instant,
    extra: Option<&serde_json::Map<String, serde_json::Value>>,
) {
    let percent = if total > 0 {
        (sent as f64 / total as f64) * 100.0
    } else {
        0.0
    };
    let elapsed = start.elapsed().as_secs_f64();
    let speed = if elapsed > 0.0 {
        sent as f64 / elapsed
    } else {
        0.0
    };
    let mut payload = serde_json::json!({
        "task_id": task_id,
        "sent": sent,
        "total": total,
        "percent": percent,
        "speed": speed,
        "name": name,
        "kind": kind,
    });
    if let Some(extra) = extra {
        if let Some(obj) = payload.as_object_mut() {
            for (k, v) in extra {
                obj.insert(k.clone(), v.clone());
            }
        }
    }
    let _ = app.emit(event, payload);
}

// ---------- 文件夹遍历（client 发送端用） ----------

/// 递归收集目录条目（目录在前、文件在后，排序保证发送/接收两端一致）
pub async fn collect_entries(root: &Path, out: &mut Vec<(u8, PathBuf)>) -> Result<()> {
    if root.is_dir() {
        out.push((ENTRY_DIR, root.to_path_buf()));
        let mut rd = tokio::fs::read_dir(root).await?;
        let mut entries = Vec::new();
        while let Some(entry) = rd.next_entry().await? {
            entries.push(entry.path());
        }
        entries.sort();
        for p in entries {
            if p.is_dir() {
                Box::pin(collect_entries(&p, out)).await?;
            } else {
                out.push((ENTRY_FILE, p.to_path_buf()));
            }
        }
    } else if root.is_file() {
        out.push((ENTRY_FILE, root.to_path_buf()));
    }
    Ok(())
}

/// 计算路径总大小（文件夹递归求和，仅统计文件）
pub async fn calc_path_size(path: &Path) -> Result<u64> {
    if path.is_file() {
        Ok(tokio::fs::metadata(path).await?.len())
    } else {
        let mut total = 0u64;
        let mut entries: Vec<(u8, PathBuf)> = Vec::new();
        collect_entries(path, &mut entries).await?;
        for (t, p) in &entries {
            if *t == ENTRY_FILE {
                total += tokio::fs::metadata(p).await?.len();
            }
        }
        Ok(total)
    }
}

/// 生成 16 字节 UUID v4（task_id），输出成 32 位十六进制字符串
pub fn new_task_id() -> String {
    let mut bytes = [0u8; 16];
    // 简单伪随机：用 std::time 纳秒 + RandomState 随机化种子
    use std::hash::{BuildHasher, Hasher, RandomState};
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let rng1 = RandomState::new();
    let rng2 = RandomState::new();
    let mut hasher = rng1.build_hasher();
    hasher.write_u64(now);
    hasher.write_usize(&bytes as *const u8 as usize ^ std::process::id() as usize);
    let a = hasher.finish();
    let mut hasher2 = rng2.build_hasher();
    hasher2.write_u64(now);
    hasher2.write_u64(a);
    let b = hasher2.finish();
    // 填入 UUID v4 版本位和变体位
    bytes[0..8].copy_from_slice(&a.to_be_bytes());
    bytes[8..16].copy_from_slice(&b.to_be_bytes());
    bytes[6] = (bytes[6] & 0x0F) | 0x40; // version=4
    bytes[8] = (bytes[8] & 0x3F) | 0x80; // variant=RFC4122
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}
