use super::protocol::{
    tune_socket_buffers, CHUNK_SIZE, ENTRY_DIR, ENTRY_FILE, MODE_BATCH, MODE_FILE, MODE_FILE_TASK,
    MODE_FOLDER, MODE_FOLDER_TASK, MODE_HANDSHAKE,
};
use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufWriter};
use tokio::net::TcpStream;

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

/// 发送入口：单条路径（文件或文件夹，兼容旧版，无 task_id）
pub(super) async fn run_client(addr: &str, file_path: &str, app: AppHandle) -> Result<()> {
    let path = PathBuf::from(file_path);
    if !path.exists() {
        return Err(anyhow!("路径不存在: {}", file_path));
    }
    let task_id = new_task_id();
    run_client_with_task_id(addr, &path, &task_id, &app).await
}

/// 发送单条路径（带 task_id），MODE_FILE_TASK 或 MODE_FOLDER_TASK
///
/// 进度 / 完成事件统一用对象：
///   send-progress: { task_id, sent, total, percent, path, name }
///   send-complete: { task_id, name }
pub async fn run_client_with_task_id(
    addr: &str,
    path: &Path,
    task_id: &str,
    app: &AppHandle,
) -> Result<()> {
    if !path.exists() {
        return Err(anyhow!("路径不存在: {}", path.display()));
    }
    let stream = TcpStream::connect(addr).await?;
    stream.set_nodelay(true)?;
    tune_socket_buffers(&stream);
    let mut stream = BufWriter::new(stream);

    // 先写 16 字节 task_id（二进制），再写 mode，再写 payload
    let mode = if path.is_dir() {
        MODE_FOLDER_TASK
    } else {
        MODE_FILE_TASK
    };
    // mode byte 放首位（兼容协议 dispatch），再 task_id(16B)，再 payload
    stream.write_all(&[mode]).await?;
    stream.write_all(&task_id_hex_to_bytes(task_id)).await?;

    let mut last_emit = Instant::now();
    if mode == MODE_FILE_TASK {
        write_file_payload_v2(
            &mut stream,
            path,
            app,
            task_id,
            path.file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default(),
            &mut last_emit,
        )
        .await?;
    } else {
        write_folder_payload_v2(&mut stream, path, app, task_id, &mut last_emit).await?;
    }
    stream.flush().await?;

    let display_name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());
    let _ = app.emit(
        "send-complete-v2",
        serde_json::json!({
            "task_id": task_id,
            "name": display_name,
            "path": path.to_string_lossy().to_string(),
        }),
    );
    Ok(())
}

/// 批量发送入口：多条路径（文件 + 文件夹混合），分别建连接并发发送
///
/// 对外返回一组 task_id，调用方用事件 `send-progress-v2` 接收分条进度
///
/// NOTE: 此函数命名为 `build_transfer_task_seeds` 避免与
/// `transfer.rs` 中对外 Tauri 命令的 `create_transfer_tasks` 混淆。
pub fn build_transfer_task_seeds(
    _addr: &str,
    paths: &[String],
) -> Result<Vec<(String, PathBuf, String)>> {
    let resolved: Vec<PathBuf> = paths
        .iter()
        .map(PathBuf::from)
        .filter(|p| p.exists())
        .collect();
    if resolved.is_empty() {
        return Err(anyhow!("没有有效的文件路径"));
    }
    let mut out = Vec::with_capacity(resolved.len());
    for p in resolved {
        let tid = new_task_id();
        let name = p
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        out.push((tid, p, name));
    }
    Ok(out)
}

/// 批量旧模式：单次 TCP 连接串行发送（保留给 send_files 兼容）
pub(super) async fn run_client_batch(addr: &str, paths: &[String], app: AppHandle) -> Result<()> {
    let resolved: Vec<PathBuf> = paths
        .iter()
        .map(PathBuf::from)
        .filter(|p| p.exists())
        .collect();
    if resolved.is_empty() {
        return Err(anyhow!("没有有效的文件路径"));
    }
    let batch_id = new_task_id();

    // 1. 扫描总大小（批量进度 = 已发送字节 / 总字节）
    let mut total_size: u64 = 0;
    for p in &resolved {
        total_size += calc_path_size(p).await?;
    }

    let stream = TcpStream::connect(addr).await?;
    stream.set_nodelay(true)?;
    tune_socket_buffers(&stream);
    let mut stream = BufWriter::new(stream);

    stream.write_all(&[MODE_BATCH]).await?;
    stream
        .write_all(&(resolved.len() as u32).to_be_bytes())
        .await?;

    let mut sent: u64 = 0;
    let mut last_emit = Instant::now();

    for (i, p) in resolved.iter().enumerate() {
        let entry_mode = if p.is_dir() { MODE_FOLDER } else { MODE_FILE };
        stream.write_all(&[entry_mode]).await?;

        if entry_mode == MODE_FILE {
            sent = write_file_payload_batch(
                &mut stream,
                p,
                &app,
                batch_id.clone(),
                i,
                resolved.len(),
                sent,
                total_size,
                &mut last_emit,
            )
            .await?;
        } else {
            sent = write_folder_payload_batch(
                &mut stream,
                p,
                &app,
                batch_id.clone(),
                i,
                resolved.len(),
                sent,
                total_size,
                &mut last_emit,
            )
            .await?;
        }
    }

    stream.flush().await?;
    let _ = app.emit(
        "send-progress-v2",
        serde_json::json!({
            "task_id": batch_id,
            "sent": total_size,
            "total": total_size,
            "percent": 100.0,
            "name": format!("批量: {} 个条目", resolved.len()),
            "kind": "batch",
            "entry_index": resolved.len(),
            "entry_count": resolved.len(),
        }),
    );
    let _ = app.emit(
        "send-complete-v2",
        serde_json::json!({
            "task_id": batch_id,
            "name": format!("批量: {} 个条目", resolved.len()),
            "kind": "batch",
        }),
    );
    Ok(())
}

/// 发送握手到指定地址（对等连接）
pub async fn send_handshake(
    addr: &str,
    device_id: &str,
    device_name: &str,
    server_port: u16,
    platform: &str,
    version: &str,
) -> Result<()> {
    let stream = TcpStream::connect(addr).await?;
    stream.set_nodelay(true)?;
    let mut stream = BufWriter::new(stream);

    stream.write_all(&[MODE_HANDSHAKE]).await?;
    write_string(&mut stream, device_id).await?;
    write_string(&mut stream, device_name).await?;
    stream.write_all(&server_port.to_be_bytes()).await?;
    write_string(&mut stream, platform).await?;
    write_string(&mut stream, version).await?;

    stream.flush().await?;
    Ok(())
}

// ---------- 内部辅助 ----------

fn task_id_hex_to_bytes(hex: &str) -> [u8; 16] {
    let mut out = [0u8; 16];
    let h = hex.as_bytes();
    for i in 0..16 {
        out[i] = u8::from_str_radix(&String::from_utf8_lossy(&[h[i * 2], h[i * 2 + 1]]), 16)
            .unwrap_or(0);
    }
    out
}

async fn write_string(stream: &mut BufWriter<TcpStream>, s: &str) -> Result<()> {
    let len = s.len() as u32;
    stream.write_all(&len.to_be_bytes()).await?;
    stream.write_all(s.as_bytes()).await?;
    Ok(())
}

async fn calc_path_size(path: &Path) -> Result<u64> {
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

async fn write_file_payload_v2(
    stream: &mut BufWriter<TcpStream>,
    path: &Path,
    app: &AppHandle,
    task_id: &str,
    display_name: String,
    last_emit: &mut Instant,
) -> Result<()> {
    let filename = path
        .file_name()
        .ok_or_else(|| anyhow!("Invalid file path"))?
        .to_string_lossy()
        .to_string();

    let mut file = File::open(path).await?;
    let file_size = file.metadata().await?.len();

    // 元数据
    let name_len = filename.len() as u32;
    stream.write_all(&name_len.to_be_bytes()).await?;
    stream.write_all(filename.as_bytes()).await?;
    stream.write_all(&file_size.to_be_bytes()).await?;

    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut sent_in_file = 0u64;

    let start = Instant::now();
    loop {
        let n = file.read(&mut buffer).await?;
        if n == 0 {
            break;
        }
        stream.write_all(&buffer[..n]).await?;
        sent_in_file += n as u64;

        if last_emit.elapsed() >= Duration::from_millis(100) || sent_in_file >= file_size {
            let percent = if file_size > 0 {
                (sent_in_file as f64 / file_size as f64) * 100.0
            } else {
                100.0
            };
            let elapsed = start.elapsed().as_secs_f64();
            let speed = if elapsed > 0.0 {
                sent_in_file as f64 / elapsed
            } else {
                0.0
            };
            let _ = app.emit(
                "send-progress-v2",
                serde_json::json!({
                    "task_id": task_id,
                    "sent": sent_in_file,
                    "total": file_size,
                    "percent": percent,
                    "speed": speed,
                    "name": display_name,
                    "kind": "file",
                    "path": path.to_string_lossy().to_string(),
                }),
            );
            *last_emit = Instant::now();
        }
    }
    Ok(())
}

async fn write_folder_payload_v2(
    stream: &mut BufWriter<TcpStream>,
    root: &Path,
    app: &AppHandle,
    task_id: &str,
    last_emit: &mut Instant,
) -> Result<()> {
    let display_name = root
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    let mut entries: Vec<(u8, PathBuf)> = Vec::new();
    collect_entries(root, &mut entries).await?;

    let mut own_total: u64 = 0;
    for (t, p) in &entries {
        if *t == ENTRY_FILE {
            own_total += tokio::fs::metadata(p).await?.len();
        }
    }

    stream.write_all(&own_total.to_be_bytes()).await?;
    stream
        .write_all(&(entries.len() as u32).to_be_bytes())
        .await?;

    let mut sent_in_folder: u64 = 0;
    let start = Instant::now();

    for (entry_type, abs_path) in &entries {
        let rel = abs_path
            .strip_prefix(root.parent().unwrap_or(Path::new("")))?
            .to_string_lossy()
            .replace('\\', "/");
        let rel_bytes = rel.as_bytes();
        stream.write_all(&[*entry_type]).await?;
        stream
            .write_all(&(rel_bytes.len() as u32).to_be_bytes())
            .await?;
        stream.write_all(rel_bytes).await?;

        if *entry_type == ENTRY_DIR {
            continue;
        }

        let file_size = tokio::fs::metadata(abs_path).await?.len();
        stream.write_all(&file_size.to_be_bytes()).await?;

        let mut file = File::open(abs_path).await?;
        let mut buffer = vec![0u8; CHUNK_SIZE];
        let mut remaining = file_size;
        while remaining > 0 {
            let n = file.read(&mut buffer).await?;
            if n == 0 {
                break;
            }
            stream.write_all(&buffer[..n]).await?;
            remaining -= n as u64;
            sent_in_folder += n as u64;

            if last_emit.elapsed() >= Duration::from_millis(100) || sent_in_folder >= own_total {
                let percent = if own_total > 0 {
                    (sent_in_folder as f64 / own_total as f64) * 100.0
                } else {
                    0.0
                };
                let elapsed = start.elapsed().as_secs_f64();
                let speed = if elapsed > 0.0 {
                    sent_in_folder as f64 / elapsed
                } else {
                    0.0
                };
                let _ = app.emit(
                    "send-progress-v2",
                    serde_json::json!({
                        "task_id": task_id,
                        "sent": sent_in_folder,
                        "total": own_total,
                        "percent": percent,
                        "speed": speed,
                        "name": display_name,
                        "kind": "folder",
                        "path": root.to_string_lossy().to_string(),
                    }),
                );
                *last_emit = Instant::now();
            }
        }
    }
    // 收尾 100%
    let _ = app.emit(
        "send-progress-v2",
        serde_json::json!({
            "task_id": task_id,
            "sent": own_total,
            "total": own_total,
            "percent": 100.0,
            "speed": 0.0,
            "name": display_name,
            "kind": "folder",
            "path": root.to_string_lossy().to_string(),
        }),
    );
    Ok(())
}

// 批量模式下写文件 payload（聚合总进度）
async fn write_file_payload_batch(
    stream: &mut BufWriter<TcpStream>,
    path: &Path,
    app: &AppHandle,
    batch_id: String,
    entry_index: usize,
    entry_count: usize,
    accum_sent: u64,
    batch_total_size: u64,
    last_emit: &mut Instant,
) -> Result<u64> {
    let filename = path
        .file_name()
        .ok_or_else(|| anyhow!("Invalid file path"))?
        .to_string_lossy()
        .to_string();
    let display = filename.clone();

    let mut file = File::open(path).await?;
    let file_size = file.metadata().await?.len();

    let name_len = filename.len() as u32;
    stream.write_all(&name_len.to_be_bytes()).await?;
    stream.write_all(filename.as_bytes()).await?;
    stream.write_all(&file_size.to_be_bytes()).await?;

    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut sent_in_file = 0u64;
    let start = Instant::now();

    loop {
        let n = file.read(&mut buffer).await?;
        if n == 0 {
            break;
        }
        stream.write_all(&buffer[..n]).await?;
        sent_in_file += n as u64;

        if last_emit.elapsed() >= Duration::from_millis(100) {
            let overall_sent = accum_sent + sent_in_file;
            let percent = if batch_total_size > 0 {
                (overall_sent as f64 / batch_total_size as f64) * 100.0
            } else {
                0.0
            };
            let elapsed = start.elapsed().as_secs_f64();
            let speed = if elapsed > 0.0 {
                sent_in_file as f64 / elapsed
            } else {
                0.0
            };
            let _ = app.emit(
                "send-progress-v2",
                serde_json::json!({
                    "task_id": batch_id,
                    "sent": overall_sent,
                    "total": batch_total_size,
                    "percent": percent,
                    "speed": speed,
                    "name": display,
                    "kind": "batch",
                    "entry_index": entry_index,
                    "entry_count": entry_count,
                }),
            );
            *last_emit = Instant::now();
        }
    }
    Ok(accum_sent + sent_in_file)
}

async fn write_folder_payload_batch(
    stream: &mut BufWriter<TcpStream>,
    root: &Path,
    app: &AppHandle,
    batch_id: String,
    entry_index: usize,
    entry_count: usize,
    accum_sent: u64,
    batch_total_size: u64,
    last_emit: &mut Instant,
) -> Result<u64> {
    let display = root
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    let mut entries: Vec<(u8, PathBuf)> = Vec::new();
    collect_entries(root, &mut entries).await?;

    let mut own_total: u64 = 0;
    for (t, p) in &entries {
        if *t == ENTRY_FILE {
            own_total += tokio::fs::metadata(p).await?.len();
        }
    }

    stream.write_all(&own_total.to_be_bytes()).await?;
    stream
        .write_all(&(entries.len() as u32).to_be_bytes())
        .await?;

    let mut sent_in_folder: u64 = 0;
    let start = Instant::now();

    for (entry_type, abs_path) in &entries {
        let rel = abs_path
            .strip_prefix(root.parent().unwrap_or(Path::new("")))?
            .to_string_lossy()
            .replace('\\', "/");
        let rel_bytes = rel.as_bytes();
        stream.write_all(&[*entry_type]).await?;
        stream
            .write_all(&(rel_bytes.len() as u32).to_be_bytes())
            .await?;
        stream.write_all(rel_bytes).await?;

        if *entry_type == ENTRY_DIR {
            continue;
        }

        let file_size = tokio::fs::metadata(abs_path).await?.len();
        stream.write_all(&file_size.to_be_bytes()).await?;

        let mut file = File::open(abs_path).await?;
        let mut buffer = vec![0u8; CHUNK_SIZE];
        let mut remaining = file_size;
        while remaining > 0 {
            let n = file.read(&mut buffer).await?;
            if n == 0 {
                break;
            }
            stream.write_all(&buffer[..n]).await?;
            remaining -= n as u64;
            sent_in_folder += n as u64;

            if last_emit.elapsed() >= Duration::from_millis(100) {
                let overall_sent = accum_sent + sent_in_folder;
                let percent = if batch_total_size > 0 {
                    (overall_sent as f64 / batch_total_size as f64) * 100.0
                } else {
                    0.0
                };
                let elapsed = start.elapsed().as_secs_f64();
                let speed = if elapsed > 0.0 {
                    sent_in_folder as f64 / elapsed
                } else {
                    0.0
                };
                let _ = app.emit(
                    "send-progress-v2",
                    serde_json::json!({
                        "task_id": batch_id,
                        "sent": overall_sent,
                        "total": batch_total_size,
                        "percent": percent,
                        "speed": speed,
                        "name": display,
                        "kind": "batch",
                        "entry_index": entry_index,
                        "entry_count": entry_count,
                    }),
                );
                *last_emit = Instant::now();
            }
        }
    }
    Ok(accum_sent + sent_in_folder)
}

async fn collect_entries(root: &Path, out: &mut Vec<(u8, PathBuf)>) -> Result<()> {
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
