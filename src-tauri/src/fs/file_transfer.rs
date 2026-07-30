use anyhow::Result;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{oneshot, Mutex}; // 关键：导入 Emitter trait

const CHUNK_SIZE: usize = 1024 * 1024;

// ---------- 服务器状态管理 ----------
pub struct ServerState {
    pub cancel_sender: Option<oneshot::Sender<()>>,
    pub task_handle: Option<tauri::async_runtime::JoinHandle<()>>,
    pub save_dir: PathBuf, // 新增
}

impl Default for ServerState {
    fn default() -> Self {
        Self {
            cancel_sender: None,
            task_handle: None,
            save_dir: PathBuf::from("received"), // 默认目录
        }
    }
}

// ---------- Tauri 命令 ----------
#[tauri::command]
pub async fn start_server(
    app: AppHandle,
    addr: String,
    save_dir: String,
    state: tauri::State<'_, Arc<Mutex<ServerState>>>,
) -> Result<(), String> {
    let save_path = PathBuf::from(&save_dir);

    // 验证路径（绝对路径）
    if !save_path.is_absolute() {
        return Err("保存路径必须是绝对路径".to_string());
    }
    // 创建目录
    if let Err(e) = tokio::fs::create_dir_all(&save_path).await {
        return Err(format!("无法创建目录: {}", e));
    }

    // 克隆一份用于后续传递给 run_server（因为之后会将 save_path 移入 state）
    let save_path_for_task = save_path.clone();

    // 检查是否已有服务器在运行，并保存路径到 state
    {
        let mut state = state.lock().await;
        if state.cancel_sender.is_some() {
            return Err("服务器已在运行".to_string());
        }
        state.save_dir = save_path; // 移动所有权到 state
    }

    let (tx, rx) = oneshot::channel();
    let app_clone = app.clone();
    let handle = tauri::async_runtime::spawn(async move {
        // 使用克隆的路径，而不是已移动的 save_path
        if let Err(e) = run_server(&addr, app_clone, rx, save_path_for_task).await {
            eprintln!("服务器错误: {}", e);
        }
    });

    {
        let mut state = state.lock().await;
        state.cancel_sender = Some(tx);
        state.task_handle = Some(handle);
    }
    Ok(())
}

#[tauri::command]
pub async fn stop_server(state: tauri::State<'_, Arc<Mutex<ServerState>>>) -> Result<(), String> {
    let mut state = state.lock().await;
    if let Some(sender) = state.cancel_sender.take() {
        let _ = sender.send(()); // 发送取消信号
        state.task_handle = None;
        Ok(())
    } else {
        Err("No server is running".to_string())
    }
}

#[tauri::command]
pub async fn send_file(app: AppHandle, addr: String, file_path: String) -> Result<(), String> {
    // 发送任务在后台执行，不阻塞 UI
    tauri::async_runtime::spawn(async move {
        if let Err(e) = run_client(&addr, &file_path, app).await {
            eprintln!("Client error: {}", e);
        }
    });
    Ok(())
}

// ---------- 核心逻辑 ----------

async fn run_server(
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
                let app_clone = app.clone();
                let save_dir_clone = save_dir.clone();  // 复制给每个连接
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

async fn handle_client(stream: &mut TcpStream, app: AppHandle, save_dir: PathBuf) -> Result<()> {
    // 1. 读取文件名长度
    let mut len_buf = [0u8; 4];
    stream.read_exact(&mut len_buf).await?;
    let name_len = u32::from_be_bytes(len_buf) as usize;

    // 2. 读取文件名
    let mut name_buf: Vec<u8> = vec![0u8; name_len];
    stream.read_exact(&mut name_buf).await?;
    let filename = String::from_utf8(name_buf)?;

    // 3. 读取文件大小
    let mut size_buf = [0u8; 8];
    stream.read_exact(&mut size_buf).await?;
    let total_size = u64::from_be_bytes(size_buf);

    // 4. 准备保存路径（使用应用数据目录）
    let app_dir = app
        .path()
        .app_data_dir()
        .unwrap_or(PathBuf::from("received"));
    tokio::fs::create_dir_all(&app_dir).await?;
    // 使用传入的 save_dir 而非硬编码
    let file_path = save_dir.join(&filename);
    let mut file = File::create(&file_path).await?;

    let mut received = 0u64;
    while received < total_size {
        let mut chunk_len_buf = [0u8; 4];
        stream.read_exact(&mut chunk_len_buf).await?;
        let chunk_len = u32::from_be_bytes(chunk_len_buf) as usize;

        let mut chunk_data = vec![0u8; chunk_len];
        stream.read_exact(&mut chunk_data).await?;
        file.write_all(&chunk_data).await?;
        received += chunk_len as u64;

        let progress = (received as f64 / total_size as f64) * 100.0;
        let _ = app.emit("receive-progress", (received, total_size, progress));
    }

    app.emit("receive-complete", filename).unwrap();
    Ok(())
}

async fn run_client(addr: &str, file_path: &str, app: AppHandle) -> Result<()> {
    let file_path = PathBuf::from(file_path);
    let filename = file_path
        .file_name()
        .ok_or_else(|| anyhow::anyhow!("Invalid file path"))?
        .to_string_lossy()
        .to_string();

    let mut file = File::open(&file_path).await?;
    let file_size = file.metadata().await?.len();

    let mut stream = TcpStream::connect(addr).await?;
    // 发送元数据
    let name_len = filename.len() as u32;
    stream.write_all(&name_len.to_be_bytes()).await?;
    stream.write_all(filename.as_bytes()).await?;
    stream.write_all(&file_size.to_be_bytes()).await?;

    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut sent = 0u64;

    loop {
        let n = file.read(&mut buffer).await?;
        if n == 0 {
            break;
        }
        let chunk = &buffer[..n];
        let chunk_len = n as u32;
        stream.write_all(&chunk_len.to_be_bytes()).await?;
        stream.write_all(chunk).await?;
        sent += n as u64;

        let progress = (sent as f64 / file_size as f64) * 100.0;
        app.emit("send-progress", (sent, file_size, progress))
            .unwrap();
    }

    app.emit("send-complete", filename).unwrap();
    Ok(())
}
