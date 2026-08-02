use super::protocol::{CHUNK_SIZE, ENTRY_DIR, ENTRY_FILE, MODE_FILE, MODE_FOLDER, MODE_HANDSHAKE};
use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufWriter};
use tokio::net::TcpStream;

/// 发送入口：自动判断文件或文件夹
pub(super) async fn run_client(addr: &str, file_path: &str, app: AppHandle) -> Result<()> {
    let path = PathBuf::from(file_path);
    if !path.exists() {
        return Err(anyhow!("路径不存在: {}", file_path));
    }

    if path.is_dir() {
        send_folder(addr, &path, app).await
    } else {
        send_single_file(addr, &path, app).await
    }
}

/// 发送握手到指定地址（对等连接）
///
/// 连接对方 server → 发送 MODE_HANDSHAKE + 本机设备信息（含本机 server port）
/// 对端收到后可知本机的回连地址（ip 从 TCP peer_addr 推断，port 从本字段取）
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
    println!("[handshake] 已发送握手到 {} (本机 server port={})", addr, server_port);
    Ok(())
}

/// 写入 4 字节长度 + N 字节字符串
async fn write_string(stream: &mut BufWriter<TcpStream>, s: &str) -> Result<()> {
    let len = s.len() as u32;
    stream.write_all(&len.to_be_bytes()).await?;
    stream.write_all(s.as_bytes()).await?;
    Ok(())
}

// 发送单文件（mode=0）
async fn send_single_file(addr: &str, path: &Path, app: AppHandle) -> Result<()> {
    let filename = path
        .file_name()
        .ok_or_else(|| anyhow!("Invalid file path"))?
        .to_string_lossy()
        .to_string();

    let mut file = File::open(path).await?;
    let file_size = file.metadata().await?.len();

    let stream = TcpStream::connect(addr).await?;
    // 禁用 Nagle 算法，配合 BufWriter 减少 syscall
    stream.set_nodelay(true)?;
    let mut stream = BufWriter::new(stream);

    // mode + 元数据
    stream.write_all(&[MODE_FILE]).await?;
    let name_len = filename.len() as u32;
    stream.write_all(&name_len.to_be_bytes()).await?;
    stream.write_all(filename.as_bytes()).await?;
    stream.write_all(&file_size.to_be_bytes()).await?;

    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut sent = 0u64;
    let mut last_emit = Instant::now();

    loop {
        let n = file.read(&mut buffer).await?;
        if n == 0 {
            break;
        }
        let chunk_len = n as u32;
        stream.write_all(&chunk_len.to_be_bytes()).await?;
        stream.write_all(&buffer[..n]).await?;
        sent += n as u64;

        // 限频 100ms，避免进度事件风暴（与文件夹模式一致）
        if last_emit.elapsed() >= Duration::from_millis(100) || sent >= file_size {
            let progress = (sent as f64 / file_size as f64) * 100.0;
            app.emit("send-progress", (sent, file_size, progress))?;
            last_emit = Instant::now();
        }
    }
    // BufWriter 必须 flush，确保缓冲数据写入 socket
    stream.flush().await?;

    app.emit("send-complete", filename).unwrap();
    Ok(())
}

// 发送文件夹（mode=1）
async fn send_folder(addr: &str, root: &Path, app: AppHandle) -> Result<()> {
    // 1. 递归收集条目（先目录后文件，保证接收端能先建目录）
    let mut entries: Vec<(u8, PathBuf)> = Vec::new();
    collect_entries(root, &mut entries).await?;

    // 2. 计算总大小（仅文件）
    let mut total_size: u64 = 0;
    for (t, p) in &entries {
        if *t == ENTRY_FILE {
            total_size += tokio::fs::metadata(p).await?.len();
        }
    }

    let stream = TcpStream::connect(addr).await?;
    // 禁用 Nagle 算法，配合 BufWriter 减少 syscall
    stream.set_nodelay(true)?;
    let mut stream = BufWriter::new(stream);
    // mode + total_size + entry_count
    stream.write_all(&[MODE_FOLDER]).await?;
    stream.write_all(&total_size.to_be_bytes()).await?;
    stream
        .write_all(&(entries.len() as u32).to_be_bytes())
        .await?;

    let mut sent: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    let root_name = root
        .file_name()
        .ok_or_else(|| anyhow!("无效的文件夹路径"))?
        .to_string_lossy()
        .to_string();

    for (entry_type, abs_path) in &entries {
        // 相对路径：以根文件夹名为前缀，保证接收后是一个独立子目录
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

        // 文件：发送大小 + 内容（无 chunk_len 前缀，直接流式）
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
            sent += n as u64;

            if last_emit.elapsed() >= std::time::Duration::from_millis(100) || sent >= total_size {
                let progress = if total_size > 0 {
                    (sent as f64 / total_size as f64) * 100.0
                } else {
                    0.0
                };
                app.emit("send-progress", (sent, total_size, progress))?;
                last_emit = std::time::Instant::now();
            }
        }
    }

    // BufWriter 必须 flush，确保缓冲数据写入 socket
    stream.flush().await?;

    let _ = app.emit("send-progress", (total_size, total_size, 100.0));
    app.emit("send-complete", format!("文件夹: {}", root_name))?;
    Ok(())
}

// 递归收集条目：目录本身先入列，再递归子项；文件直接入列
async fn collect_entries(root: &Path, out: &mut Vec<(u8, PathBuf)>) -> Result<()> {
    if root.is_dir() {
        // 根目录自身作为目录条目
        out.push((ENTRY_DIR, root.to_path_buf()));
        let mut rd = tokio::fs::read_dir(root).await?;
        let mut entries = Vec::new();
        while let Some(entry) = rd.next_entry().await? {
            entries.push(entry.path());
        }
        // 排序保证顺序稳定（目录在前、文件在后由 is_dir 判断处理）
        entries.sort();
        for p in entries {
            if p.is_dir() {
                Box::pin(collect_entries(&p, out)).await?;
            } else {
                out.push((ENTRY_FILE, p));
            }
        }
    } else if root.is_file() {
        out.push((ENTRY_FILE, root.to_path_buf()));
    }
    Ok(())
}
