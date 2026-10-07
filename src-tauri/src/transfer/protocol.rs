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
/// 单文件 + 来源 device_id + 16 字节 task_id（传输连接自带身份）
///
/// 布局：mode(1B) + device_id(4B 长度前缀 + UTF-8) + task_id(16B) + payload
/// 接收端据此校验信任表；不带身份的旧模式（MODE_FILE_TASK 等）一律拒绝。
pub const MODE_FILE_TASK_AUTH: u8 = 7;
/// 文件夹 + 来源 device_id + 16 字节 task_id（布局同 MODE_FILE_TASK_AUTH）
pub const MODE_FOLDER_TASK_AUTH: u8 = 8;
/// 断开通知：本机主动结束与对端的会话时发送
///
/// 布局：mode(1B) + device_id(4B 长度前缀 + UTF-8) + device_name(4B 长度前缀 + UTF-8)
///
/// **单向通知，接收端读完即关、不回包。** 断开是「我说完了」而不是一次协商 ——
/// 两端都回通知就会变成互相触发的循环。收到通知的一方只做本地清理（结束会话、回首页）。
///
/// 不带 task_id：它针对的是「这次会话」，不是某一条传输任务。
pub const MODE_DISCONNECT: u8 = 9;

// ---------- 连接应答 ----------
/// 对端接受本次连接
///
/// 一个字节，两处复用：
///   1. 握手（MODE_HANDSHAKE）之后 —— 接收端回写是否接纳该设备
///   2. 传输（MODE_*_TASK_AUTH）开始前 —— 接收端回写信任校验是否通过
pub const REPLY_ACCEPTED: u8 = 1;
/// 对端拒绝本次连接（握手被拒 / 传输未授权）
pub const REPLY_REJECTED: u8 = 0;
/// 等待对端确认握手的超时（秒）
///
/// 发送端等回包、接收端等用户点「接受/拒绝」，两端共用同一上限：
/// 接收端先超时则关掉等待、回拒绝；发送端先超时则放弃本次连接。
pub const HANDSHAKE_CONFIRM_TIMEOUT_SECS: u64 = 30;

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

/// 长度前缀字符串允许的最大字节数
///
/// 读侧必须在分配**之前**校验：`read_string` 位于未认证路径上（服务端先读 device_id，
/// 之后才去查信任表），对端只要在 4 字节前缀里写个大数，就能让本进程去分配对应大小的
/// 内存 —— 一个 TCP 包换 4GB 分配。协议里所有字符串（device_id / device_name /
/// platform / version）实际都在几十字节量级，4KB 已是数量级上的宽裕，不会误伤正常对端。
pub const MAX_STRING_LEN: usize = 4096;

/// 文件夹条目相对路径允许的最大字节数
///
/// 给得比普通字符串宽：深层目录再叠中文文件名（UTF-8 下每字 3 字节）会明显更长。
pub const MAX_PATH_LEN: usize = 32768;

/// 未完成文件的临时后缀（配合 `part_path_of`）
pub const PART_SUFFIX: &str = ".part";

/// 在路径后追加临时后缀，得到「写到一半」的临时文件路径
///
/// 不用 `Path::with_extension` —— 它会把 `a.tar.gz` 换成 `a.tar.part`（丢掉 `.gz`），
/// 直接拼在末尾才保住原文件的完整名字。
pub fn part_path_of(path: &Path) -> PathBuf {
    let mut os = path.as_os_str().to_os_string();
    os.push(PART_SUFFIX);
    PathBuf::from(os)
}

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
    // 校验必须在 vec! 之前：len 完全来自对端，不校验就等于把内存分配权交给了它
    if len > MAX_STRING_LEN {
        return Err(anyhow!("字符串长度 {} 超出上限 {}", len, MAX_STRING_LEN));
    }
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
