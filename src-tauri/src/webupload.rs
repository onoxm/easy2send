// 手机扫码上传模块入口
//
// 子模块：
//   state:  WebUploadState（axum 共享状态 + token 生成/校验）
//   server: axum HTTP 服务器 + 路由 + multipart handler
//
// 生命周期：用户点击扫码弹窗时启动 HTTP 服务器，关闭弹窗时停止。
// 不会在应用启动时自动启动（节省资源，仅在需要时占用端口）。

mod server;
pub(crate) mod state;

use std::path::PathBuf;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::{oneshot, Mutex};

// ---------- 服务器控制状态 ----------
// 与 transfer::ServerState 风格一致：cancel_sender 用于停止，
// task_handle 持有后台任务，port 记录实际监听端口供前端生成二维码。
// web_state 保存 axum 共享状态，供 create_pair_token 命令访问。
pub struct WebUploadServerControl {
    pub cancel_sender: Option<oneshot::Sender<()>>,
    pub task_handle: Option<tauri::async_runtime::JoinHandle<()>>,
    pub port: u16,
    pub web_state: Mutex<Option<Arc<state::WebUploadState>>>,
}

impl Default for WebUploadServerControl {
    fn default() -> Self {
        Self {
            cancel_sender: None,
            task_handle: None,
            port: 0,
            web_state: Mutex::new(None),
        }
    }
}

// ---------- Tauri 命令 ----------

/// 启动手机上传 HTTP 服务器
///
/// 绑定具体本机 IP（非 0.0.0.0）：与 TCP server 相同的防火墙约束，
/// Windows 对具体 IP 绑定的首次入站 SYN 会触发放行弹窗。
/// 端口由后端在 8000-9000 范围内分配，返回实际监听端口供前端生成二维码。
///
/// save_dir 为文件保存目录（与 TCP server 的 save_dir 一致，从前端 store.savePath 传入）。
#[tauri::command]
pub async fn start_web_upload(
    app: AppHandle,
    ip: String,
    save_dir: String,
    control: tauri::State<'_, Arc<Mutex<WebUploadServerControl>>>,
) -> Result<u16, String> {
    let save_path = PathBuf::from(&save_dir);
    if !save_path.is_absolute() {
        return Err("保存路径必须是绝对路径".to_string());
    }

    {
        let s = control.lock().await;
        if s.cancel_sender.is_some() {
            return Err("手机上传服务器已在运行".to_string());
        }
    }

    // 后端内部分配端口，避免前端两次 get_free_port 调用产生竞态
    let port = crate::common::port::get_free_port(ip.clone(), 8000, 9000)?;
    let addr = format!("{}:{}", ip, port);

    // 创建 axum 共享状态（save_dir + app handle）
    let web_state = Arc::new(state::WebUploadState::new(save_path, app.clone()));

    // 存入 control，供 create_pair_token 命令访问
    {
        let mut s = control.lock().await;
        s.web_state = Mutex::new(Some(web_state.clone()));
    }

    let (tx, rx) = oneshot::channel();
    let app_clone = app.clone();
    let handle = tauri::async_runtime::spawn(async move {
        if let Err(e) = server::run_server(&addr, app_clone, rx, web_state).await {
            eprintln!("[web-upload] 服务器错误: {}", e);
        }
    });

    {
        let mut s = control.lock().await;
        s.cancel_sender = Some(tx);
        s.task_handle = Some(handle);
        s.port = port;
    }
    Ok(port)
}

/// 停止手机上传 HTTP 服务器（幂等）
#[tauri::command]
pub async fn stop_web_upload(
    control: tauri::State<'_, Arc<Mutex<WebUploadServerControl>>>,
) -> Result<(), String> {
    let mut s = control.lock().await;
    if let Some(sender) = s.cancel_sender.take() {
        let _ = sender.send(());
        s.task_handle = None;
        s.port = 0;
        s.web_state = Mutex::new(None);
        Ok(())
    } else {
        Err("手机上传服务器未运行".to_string())
    }
}

/// 查询当前手机上传服务器监听端口（未启动返回 0）
#[tauri::command]
pub async fn get_web_upload_port(
    control: tauri::State<'_, Arc<Mutex<WebUploadServerControl>>>,
) -> Result<u16, String> {
    Ok(control.lock().await.port)
}

/// 生成配对 token（一次性，5 分钟有效）
///
/// 前端在弹出二维码弹窗时调用，将返回的 token 拼入二维码 URL：
///   http://<ip>:<port>/?token=<TOKEN>
/// 手机扫码后网页自动取 token 调 POST /api/pair 完成配对。
#[tauri::command]
pub async fn create_pair_token(
    control: tauri::State<'_, Arc<Mutex<WebUploadServerControl>>>,
) -> Result<String, String> {
    let web_state = {
        let s = control.lock().await;
        let opt = s.web_state.lock().await.clone();
        opt.ok_or_else(|| "手机上传服务器未启动".to_string())?
    };
    Ok(web_state.create_pair_token().await)
}
