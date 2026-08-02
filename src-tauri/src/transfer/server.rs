use super::protocol::{
    safe_join, CHUNK_SIZE, ENTRY_DIR, ENTRY_FILE, MODE_FILE, MODE_FOLDER, MODE_HANDSHAKE,
};
use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

/// 运行接收服务器，直到收到取消信号
pub(super) async fn run_server(
    addr: &str,
    app: AppHandle,
    mut cancel_rx: oneshot::Receiver<()>,
    save_dir: PathBuf,
) -> Result<()> {
    let listener = TcpListener::bind(addr).await?;
    app.emit("server-status", "listening").unwrap();

    loop {
        tokio::select! {
            accept_result = listener.accept() => {
                let (mut stream, peer) = accept_result?;
                // 禁用 Nagle 算法，减少小包延迟
                let _ = stream.set_nodelay(true);
                let app_clone = app.clone();
                let save_dir_clone = save_dir.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_client(&mut stream, app_clone, save_dir_clone).await {
                        eprintln!("处理客户端 {} 出错: {}", peer, e);
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

// 分派到单文件 / 文件夹接收逻辑
async fn handle_client(stream: &mut TcpStream, app: AppHandle, save_dir: PathBuf) -> Result<()> {
    let mut mode_buf = [0u8; 1];
    stream.read_exact(&mut mode_buf).await?;
    let mode = mode_buf[0];

    match mode {
        MODE_FILE => receive_single_file(stream, &app, &save_dir).await,
        MODE_FOLDER => receive_folder(stream, &app, &save_dir).await,
        MODE_HANDSHAKE => receive_handshake(stream, &app).await,
        _ => Err(anyhow!("未知的传输模式: {}", mode)),
    }
}

/// 接收握手消息（mode=2）
///
/// 解析对端设备信息（含对端 server port）→ emit "incoming-connection" 事件 → 前端跳转传输页
/// 对端 IP 从 TCP peer_addr 推断，port 从握手 payload 中读取（对端的监听端口）
async fn receive_handshake(stream: &mut TcpStream, app: &AppHandle) -> Result<()> {
    let device_id = read_string(stream).await?;
    let device_name = read_string(stream).await?;

    // 读取对端 server 监听端口（2 字节 u16）
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
    // camelCase 与前端 DeviceInfo 类型对齐
    let info = serde_json::json!({
        "deviceId": device_id,
        "deviceName": device_name,
        "ip": peer.ip().to_string(),
        "port": server_port,
        "platform": platform,
        "version": version,
        "https": false,
        "lastSeen": now,
    });

    println!(
        "[handshake] 收到 {} 的握手 (ip={}, server_port={})",
        device_name,
        peer.ip(),
        server_port
    );
    app.emit("incoming-connection", info)?;
    Ok(())
}

/// 读取 4 字节长度 + N 字节 UTF-8 字符串
async fn read_string(stream: &mut TcpStream) -> Result<String> {
    let mut len_buf = [0u8; 4];
    stream.read_exact(&mut len_buf).await?;
    let len = u32::from_be_bytes(len_buf) as usize;
    let mut buf = vec![0u8; len];
    stream.read_exact(&mut buf).await?;
    Ok(String::from_utf8(buf)?)
}

// 接收单文件（mode=0）
async fn receive_single_file(
    stream: &mut TcpStream,
    app: &AppHandle,
    save_dir: &Path,
) -> Result<()> {
    let mut len_buf = [0u8; 4];
    stream.read_exact(&mut len_buf).await?;
    let name_len = u32::from_be_bytes(len_buf) as usize;

    let mut name_buf = vec![0u8; name_len];
    stream.read_exact(&mut name_buf).await?;
    let filename = String::from_utf8(name_buf)?;

    let mut size_buf = [0u8; 8];
    stream.read_exact(&mut size_buf).await?;
    let total_size = u64::from_be_bytes(size_buf);

    let file_path = safe_join(save_dir, &filename)?;
    if let Some(parent) = file_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let mut file = File::create(&file_path).await?;

    let mut received = 0u64;
    // 循环外创建一次 buffer 复用，避免每 chunk 重新分配 1MB
    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut last_emit = std::time::Instant::now();

    while received < total_size {
        let mut chunk_len_buf = [0u8; 4];
        stream.read_exact(&mut chunk_len_buf).await?;
        let chunk_len = u32::from_be_bytes(chunk_len_buf) as usize;

        stream.read_exact(&mut buffer[..chunk_len]).await?;
        file.write_all(&buffer[..chunk_len]).await?;
        received += chunk_len as u64;

        // 限频 100ms，与文件夹模式一致
        if last_emit.elapsed() >= std::time::Duration::from_millis(100) || received >= total_size {
            let progress = (received as f64 / total_size as f64) * 100.0;
            let _ = app.emit("receive-progress", (received, total_size, progress));
            last_emit = std::time::Instant::now();
        }
    }

    app.emit("receive-complete", filename).unwrap();
    Ok(())
}

// 接收文件夹（mode=1）
async fn receive_folder(stream: &mut TcpStream, app: &AppHandle, save_dir: &Path) -> Result<()> {
    // 1. 总大小 + 条目数
    let mut total_size_buf = [0u8; 8];
    stream.read_exact(&mut total_size_buf).await?;
    let total_size = u64::from_be_bytes(total_size_buf);

    let mut count_buf = [0u8; 4];
    stream.read_exact(&mut count_buf).await?;
    let entry_count = u32::from_be_bytes(count_buf) as usize;

    let mut received: u64 = 0;
    let mut last_emit = std::time::Instant::now();

    for _ in 0..entry_count {
        // 2. 条目类型
        let mut type_buf = [0u8; 1];
        stream.read_exact(&mut type_buf).await?;
        let entry_type = type_buf[0];

        // 3. 相对路径
        let mut len_buf = [0u8; 4];
        stream.read_exact(&mut len_buf).await?;
        let name_len = u32::from_be_bytes(len_buf) as usize;
        let mut name_buf = vec![0u8; name_len];
        stream.read_exact(&mut name_buf).await?;
        let rel_path = String::from_utf8(name_buf)?;

        let target = safe_join(save_dir, &rel_path)?;

        if entry_type == ENTRY_DIR {
            tokio::fs::create_dir_all(&target).await?;
        } else if entry_type == ENTRY_FILE {
            // 4. 文件大小
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
            }
            file.flush().await?;

            // 限频发送进度，避免事件风暴
            if last_emit.elapsed() >= std::time::Duration::from_millis(100)
                || received >= total_size
            {
                let progress = if total_size > 0 {
                    (received as f64 / total_size as f64) * 100.0
                } else {
                    0.0
                };
                let _ = app.emit("receive-progress", (received, total_size, progress));
                last_emit = std::time::Instant::now();
            }
        } else {
            return Err(anyhow!("未知的条目类型: {}", entry_type));
        }
    }

    let _ = app.emit("receive-progress", (total_size, total_size, 100.0));
    app.emit("receive-complete", "文件夹传输完成").unwrap();
    Ok(())
}
