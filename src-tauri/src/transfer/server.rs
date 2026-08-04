use super::protocol::{
    safe_join, tune_socket_buffers, CHUNK_SIZE, ENTRY_DIR, ENTRY_FILE, MODE_BATCH, MODE_FILE,
    MODE_FILE_TASK, MODE_FOLDER, MODE_FOLDER_TASK, MODE_HANDSHAKE, MODE_PING,
};
use crate::discovery::SharedDiscoveryState;
use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

/// 生成 32 位十六进制 UUID v4（接收端用 recv_task_id，事件用）
fn new_task_id() -> String {
    let mut bytes = [0u8; 16];
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
    bytes[0..8].copy_from_slice(&a.to_be_bytes());
    bytes[8..16].copy_from_slice(&b.to_be_bytes());
    bytes[6] = (bytes[6] & 0x0F) | 0x40;
    bytes[8] = (bytes[8] & 0x3F) | 0x80;
    bytes.iter().map(|x| format!("{:02x}", x)).collect()
}

fn bytes_to_task_id_hex(bytes: &[u8; 16]) -> String {
    bytes.iter().map(|x| format!("{:02x}", x)).collect()
}

pub(super) async fn run_server(
    addr: &str,
    app: AppHandle,
    mut cancel_rx: oneshot::Receiver<()>,
    save_dir: PathBuf,
    state: SharedDiscoveryState,
) -> Result<()> {
    let listener = TcpListener::bind(addr).await?;
    app.emit("server-status", "listening").unwrap();

    loop {
        tokio::select! {
            accept_result = listener.accept() => {
                let (mut stream, _peer) = accept_result?;
                let _ = stream.set_nodelay(true);
                tune_socket_buffers(&stream);
                let app_clone = app.clone();
                let save_dir_clone = save_dir.clone();
                let state_clone = state.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_client(&mut stream, app_clone, save_dir_clone, &state_clone).await {
                        // TCP 心跳用的 EOF 直接静默
                        if e.to_string().contains("unexpected end of file")
                            || e.to_string().contains("connection reset")
                        {
                            return;
                        }
                        eprintln!("处理客户端出错: {}", e);
                    }
                });
            }
            _ = &mut cancel_rx => {
                app.emit("server-status", "stopped").unwrap();
                break;
            }
        }
    }
    Ok(())
}

// 分派：MODE_FILE(0) | MODE_FOLDER(1) | MODE_HANDSHAKE(2) | MODE_BATCH(3)
//       MODE_FILE_TASK(4) | MODE_FOLDER_TASK(5) | MODE_PING(6)
async fn handle_client(
    stream: &mut TcpStream,
    app: AppHandle,
    save_dir: PathBuf,
    state: &SharedDiscoveryState,
) -> Result<()> {
    let mut mode_buf = [0u8; 1];
    match stream.read_exact(&mut mode_buf).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(()),
        Err(e) => return Err(e.into()),
    }
    let mode = mode_buf[0];

    match mode {
        MODE_FILE => {
            let task_id = new_task_id();
            receive_file_stream(stream, &app, &save_dir, &task_id, TaskKind::File).await?;
            emit_recv_complete(&app, &task_id, None);
        }
        MODE_FOLDER => {
            let task_id = new_task_id();
            receive_folder_stream(stream, &app, &save_dir, &task_id, TaskKind::Folder).await?;
            emit_recv_complete(&app, &task_id, None);
        }
        MODE_FILE_TASK => {
            // 先读 16 字节 task_id
            let mut tid_bytes = [0u8; 16];
            stream.read_exact(&mut tid_bytes).await?;
            let task_id = bytes_to_task_id_hex(&tid_bytes);
            receive_file_stream(stream, &app, &save_dir, &task_id, TaskKind::File).await?;
            emit_recv_complete(&app, &task_id, None);
        }
        MODE_FOLDER_TASK => {
            let mut tid_bytes = [0u8; 16];
            stream.read_exact(&mut tid_bytes).await?;
            let task_id = bytes_to_task_id_hex(&tid_bytes);
            receive_folder_stream(stream, &app, &save_dir, &task_id, TaskKind::Folder).await?;
            emit_recv_complete(&app, &task_id, None);
        }
        MODE_BATCH => {
            let task_id = new_task_id();
            receive_batch(stream, &app, &save_dir, &task_id).await?;
        }
        MODE_HANDSHAKE => {
            receive_handshake(stream, &app).await?;
        }
        MODE_PING => {
            // 心跳查询：回复本机 deviceName（4 字节长度 + UTF-8 字符串）
            let device_name = {
                let s = state.lock().await;
                s.last_config
                    .as_ref()
                    .map(|c| c.device_name.clone())
                    .unwrap_or_default()
            };
            let name_bytes = device_name.as_bytes();
            let len = name_bytes.len() as u32;
            stream.write_all(&len.to_be_bytes()).await?;
            stream.write_all(name_bytes).await?;
            stream.flush().await?;
        }
        _ => {
            eprintln!("[server] 非法连接尝试: 未知 mode={}", mode);
            return Err(anyhow!("未知的传输模式: {}", mode));
        }
    }
    Ok(())
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TaskKind {
    File,
    Folder,
}

fn emit_recv_complete(app: &AppHandle, task_id: &str, display: Option<&str>) {
    let _ = app.emit(
        "receive-complete-v2",
        serde_json::json!({
            "task_id": task_id,
            "name": display.unwrap_or("传输完成"),
        }),
    );
}

async fn receive_handshake(stream: &mut TcpStream, app: &AppHandle) -> Result<()> {
    let device_id = read_string(stream).await?;
    let device_name = read_string(stream).await?;
    let mut port_buf = [0u8; 2];
    stream.read_exact(&mut port_buf).await?;
    let server_port = u16::from_be_bytes(port_buf);
    let platform = read_string(stream).await?;
    let version = read_string(stream).await?;

    let peer = stream.peer_addr()?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let peer_ip = peer.ip().to_string();
    let info = serde_json::json!({
        "deviceId": device_id,
        "deviceName": device_name,
        "ip": peer_ip,
        "addresses": [peer_ip],
        "port": server_port,
        "platform": platform,
        "version": version,
        "https": false,
        "lastSeen": now,
    });
    app.emit("incoming-connection", info)?;
    Ok(())
}

async fn read_string(stream: &mut TcpStream) -> Result<String> {
    let mut len_buf = [0u8; 4];
    stream.read_exact(&mut len_buf).await?;
    let len = u32::from_be_bytes(len_buf) as usize;
    let mut buf = vec![0u8; len];
    stream.read_exact(&mut buf).await?;
    Ok(String::from_utf8(buf)?)
}

// 接收单文件，带 task_id 事件（v2 对象格式）
async fn receive_file_stream(
    stream: &mut TcpStream,
    app: &AppHandle,
    save_dir: &Path,
    task_id: &str,
    kind: TaskKind,
) -> Result<(String, u64, u64)> {
    let mut len_buf = [0u8; 4];
    stream.read_exact(&mut len_buf).await?;
    let name_len = u32::from_be_bytes(len_buf) as usize;
    let mut name_buf = vec![0u8; name_len];
    stream.read_exact(&mut name_buf).await?;
    let filename = String::from_utf8(name_buf)?;

    let mut size_buf = [0u8; 8];
    stream.read_exact(&mut size_buf).await?;
    let total_size = u64::from_be_bytes(size_buf);

    // v2 事件：task_id + name + total_size + kind
    let _ = app.emit(
        "receive-start-v2",
        serde_json::json!({
            "task_id": task_id,
            "name": filename,
            "total_size": total_size,
            "kind": if kind == TaskKind::File { "file" } else { "folder" },
        }),
    );

    let file_path = safe_join(save_dir, &filename)?;
    if let Some(parent) = file_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let mut file = File::create(&file_path).await?;

    let mut received = 0u64;
    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut last_emit = Instant::now();
    let start = Instant::now();

    while received < total_size {
        let to_read = ((total_size - received).min(CHUNK_SIZE as u64)) as usize;
        stream.read_exact(&mut buffer[..to_read]).await?;
        file.write_all(&buffer[..to_read]).await?;
        received += to_read as u64;

        if last_emit.elapsed() >= Duration::from_millis(100) || received >= total_size {
            let percent = if total_size > 0 {
                (received as f64 / total_size as f64) * 100.0
            } else {
                100.0
            };
            let elapsed = start.elapsed().as_secs_f64();
            let speed = if elapsed > 0.0 {
                received as f64 / elapsed
            } else {
                0.0
            };
            let _ = app.emit(
                "receive-progress-v2",
                serde_json::json!({
                    "task_id": task_id,
                    "sent": received,
                    "total": total_size,
                    "percent": percent,
                    "speed": speed,
                    "name": filename,
                    "kind": if kind == TaskKind::File { "file" } else { "folder" },
                }),
            );
            last_emit = Instant::now();
        }
    }
    file.flush().await?;
    Ok((filename, total_size, received))
}

// 接收文件夹，带 task_id 事件
async fn receive_folder_stream(
    stream: &mut TcpStream,
    app: &AppHandle,
    save_dir: &Path,
    task_id: &str,
    kind: TaskKind,
) -> Result<(String, u64, u64)> {
    let mut total_size_buf = [0u8; 8];
    stream.read_exact(&mut total_size_buf).await?;
    let total_size = u64::from_be_bytes(total_size_buf);

    let mut count_buf = [0u8; 4];
    stream.read_exact(&mut count_buf).await?;
    let entry_count = u32::from_be_bytes(count_buf) as usize;

    let mut first_dir_name: Option<String> = None;

    let _ = app.emit(
        "receive-start-v2",
        serde_json::json!({
            "task_id": task_id,
            "name": "文件夹",
            "total_size": total_size,
            "entry_count": entry_count,
            "kind": if kind == TaskKind::File { "file" } else { "folder" },
        }),
    );

    let mut received: u64 = 0;
    let mut last_emit = Instant::now();
    let start = Instant::now();

    for _ in 0..entry_count {
        let mut type_buf = [0u8; 1];
        stream.read_exact(&mut type_buf).await?;
        let entry_type = type_buf[0];

        let mut len_buf = [0u8; 4];
        stream.read_exact(&mut len_buf).await?;
        let name_len = u32::from_be_bytes(len_buf) as usize;
        let mut name_buf = vec![0u8; name_len];
        stream.read_exact(&mut name_buf).await?;
        let rel_path = String::from_utf8(name_buf)?;

        if first_dir_name.is_none() {
            let top = rel_path.split('/').next().unwrap_or(&rel_path).to_string();
            first_dir_name = Some(top);
        }
        let target = safe_join(save_dir, &rel_path)?;

        if entry_type == ENTRY_DIR {
            tokio::fs::create_dir_all(&target).await?;
        } else if entry_type == ENTRY_FILE {
            let mut size_buf = [0u8; 8];
            stream.read_exact(&mut size_buf).await?;
            let file_size = u64::from_be_bytes(size_buf);

            if let Some(parent) = target.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }
            let mut file = File::create(&target).await?;

            let mut remaining = file_size;
            let mut buffer = vec![0u8; CHUNK_SIZE];
            while remaining > 0 {
                let to_read = remaining.min(CHUNK_SIZE as u64) as usize;
                stream.read_exact(&mut buffer[..to_read]).await?;
                file.write_all(&buffer[..to_read]).await?;
                remaining -= to_read as u64;
                received += to_read as u64;

                if last_emit.elapsed() >= Duration::from_millis(100) || received >= total_size {
                    let percent = if total_size > 0 {
                        (received as f64 / total_size as f64) * 100.0
                    } else {
                        0.0
                    };
                    let elapsed = start.elapsed().as_secs_f64();
                    let speed = if elapsed > 0.0 {
                        received as f64 / elapsed
                    } else {
                        0.0
                    };
                    let _ = app.emit(
                        "receive-progress-v2",
                        serde_json::json!({
                            "task_id": task_id,
                            "sent": received,
                            "total": total_size,
                            "percent": percent,
                            "speed": speed,
                            "name": first_dir_name.clone().unwrap_or_else(|| "文件夹".into()),
                            "kind": "folder",
                        }),
                    );
                    last_emit = Instant::now();
                }
            }
            file.flush().await?;
        } else {
            return Err(anyhow!("未知的条目类型: {}", entry_type));
        }
    }
    // 末尾再补一次 100% 事件
    let _ = app.emit(
        "receive-progress-v2",
        serde_json::json!({
            "task_id": task_id,
            "sent": total_size,
            "total": total_size,
            "percent": 100.0,
            "speed": 0.0,
            "name": first_dir_name.clone().unwrap_or_else(|| "文件夹".into()),
            "kind": "folder",
        }),
    );
    Ok((
        first_dir_name.unwrap_or_else(|| "文件夹".to_string()),
        total_size,
        received,
    ))
}

// 批量接收：对端用 MODE_BATCH（单连接串行）。把每个条目当独立任务发事件
async fn receive_batch(
    stream: &mut TcpStream,
    app: &AppHandle,
    save_dir: &Path,
    batch_id: &str,
) -> Result<()> {
    let mut count_buf = [0u8; 4];
    stream.read_exact(&mut count_buf).await?;
    let entry_count = u32::from_be_bytes(count_buf) as usize;

    let _ = app.emit(
        "receive-start-v2",
        serde_json::json!({
            "task_id": batch_id,
            "name": format!("批量 ({} 个条目)", entry_count),
            "total_size": 0u64,
            "entry_count": entry_count,
            "kind": "batch",
        }),
    );

    let mut overall_received: u64 = 0;
    for idx in 0..entry_count {
        let mut mode_byte = [0u8; 1];
        stream.read_exact(&mut mode_byte).await?;
        // 批量内部不用 task_id，只用外部 batch_id + 条目序号组合
        let sub_task_id = format!("{}-{}", batch_id, idx + 1);
        let (name, _total, recv) = match mode_byte[0] {
            MODE_FILE => {
                receive_file_stream(stream, app, save_dir, &sub_task_id, TaskKind::File).await?
            }
            MODE_FOLDER => {
                receive_folder_stream(stream, app, save_dir, &sub_task_id, TaskKind::Folder).await?
            }
            other => return Err(anyhow!("批量模式下遇到未知条目 mode: {}", other)),
        };
        overall_received += recv;
        // 对 batch 聚合事件再发一次（整体进度，v2 对象）
        let _ = app.emit(
            "receive-progress-v2",
            serde_json::json!({
                "task_id": batch_id,
                "sent": overall_received,
                "total": 0u64,
                "percent": ((idx + 1) as f64 / entry_count as f64) * 100.0,
                "name": name,
                "kind": "batch",
                "entry_index": idx + 1,
                "entry_count": entry_count,
            }),
        );
    }

    let _ = app.emit(
        "receive-complete-v2",
        serde_json::json!({
            "task_id": batch_id,
            "name": format!("批量完成: {} 个条目", entry_count),
        }),
    );
    Ok(())
}
