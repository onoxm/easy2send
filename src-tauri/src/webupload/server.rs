use super::state::WebUploadState;
use crate::transfer::protocol::{emit_progress, new_task_id, safe_join, should_emit};
use anyhow::Result;
use axum::body::Body as AxumBody;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::Router;
use futures_util::StreamExt;
use http_body_util::BodyStream;
use serde::Deserialize;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tower_http::limit::RequestBodyLimitLayer;

/// 内嵌的网页资源（编译时打包进二进制，单文件分发）
///
/// include_str! 相对当前文件 src-tauri/src/webupload/server.rs 解析：
///   ../web/index.html → src-tauri/src/web/index.html
///   ../web/style.css  → src-tauri/src/web/style.css
///   ../web/script.js  → src-tauri/src/web/script.js
const INDEX_HTML: &str = include_str!("./index.html");
const STYLE_CSS: &str = include_str!("./style.css");
const SCRIPT_JS: &str = include_str!("./script.js");

/// 启动 axum HTTP 服务器
///
/// 绑定具体本机 IP:port，提供以下路由：
///   GET  /          → 返回内嵌移动端网页
///   POST /api/pair  → 配对验证（校验一次性 token，签发 session）
///   POST /api/upload→ 文件上传（multipart 流式落盘，复用 receive-*-v2 事件）
///
/// state 由调用方（start_web_upload）创建并共享给 create_pair_token 命令，
/// 必须传入同一个 Arc<WebUploadState> 实例，否则 token 读写会落到不同实例上
/// 导致配对永远失败。
pub(super) async fn run_server(
    addr: &str,
    app: AppHandle,
    mut cancel_rx: oneshot::Receiver<()>,
    state: Arc<WebUploadState>,
) -> Result<()> {
    let listener = TcpListener::bind(addr).await?;
    let local_addr = listener.local_addr()?;
    println!("[web-upload] HTTP 服务器监听: http://{}", local_addr);

    let router = Router::new()
        .route("/", get(index_handler))
        .route("/style.css", get(css_handler))
        .route("/script.js", get(js_handler))
        .route("/api/pair", post(pair_handler))
        .route("/api/upload", post(upload_handler))
        // 上传大文件：放宽默认 2MB 限制到 10GB（multipart 流式落盘不占内存）
        // 用 tower-http 的 RequestBodyLimitLayer 而非 axum 的 DefaultBodyLimit，
        // 后者在 Windows MSVC debug + cdylib 下会触发 LNK2019 链接错误
        .layer(RequestBodyLimitLayer::new(10 * 1024 * 1024 * 1024))
        .with_state(state);

    let _ = app.emit("web-upload-status", "listening");
    let server = axum::serve(listener, router);

    tokio::select! {
        res = server => {
            if let Err(e) = res {
                eprintln!("[web-upload] 服务器结束: {}", e);
            }
        }
        _ = &mut cancel_rx => {
            println!("[web-upload] 收到停止信号，关闭服务器");
        }
    }

    let _ = app.emit("web-upload-status", "stopped");
    Ok(())
}

/// GET / —— 返回内嵌网页
async fn index_handler() -> impl IntoResponse {
    (
        [("content-type", "text/html; charset=utf-8")],
        INDEX_HTML,
    )
}

/// GET /style.css —— 返回内嵌样式表
async fn css_handler() -> impl IntoResponse {
    (
        [("content-type", "text/css; charset=utf-8")],
        STYLE_CSS,
    )
}

/// GET /script.js —— 返回内嵌脚本
async fn js_handler() -> impl IntoResponse {
    (
        [("content-type", "application/javascript; charset=utf-8")],
        SCRIPT_JS,
    )
}

/// POST /api/pair —— 配对验证
///
/// 请求体 JSON: { "token": "<配对token>" }
/// 校验成功：销毁配对 token（单次使用），签发 session token，emit web-upload-paired
/// 校验失败：返回 401
#[derive(Deserialize)]
struct PairRequest {
    token: String,
}

async fn pair_handler(
    State(state): State<Arc<WebUploadState>>,
    axum::Json(req): axum::Json<PairRequest>,
) -> impl IntoResponse {
    let valid = state.validate_and_consume_pair_token(&req.token).await;
    if !valid {
        return (
            StatusCode::UNAUTHORIZED,
            "无效或已过期的配对 token",
        )
            .into_response();
    }
    let session = state.create_session().await;

    // 通知前端：手机已配对
    let _ = state.app.emit(
        "web-upload-paired",
        serde_json::json!({ "message": "手机已连接" }),
    );

    axum::Json(serde_json::json!({
        "session": session,
    }))
    .into_response()
}

/// POST /api/upload —— 文件上传（multipart/form-data）
///
/// Header: Authorization: Bearer <session>
///         X-File-Size: <文件字节数>（multipart field 无内置大小，前端需额外传）
/// Body: multipart/form-data，field name="file"，field filename=文件名
///
/// 流式落盘到 save_dir/filename，复用 receive-start-v2 / progress / complete 事件
async fn upload_handler(
    State(state): State<Arc<WebUploadState>>,
    headers: HeaderMap,
    body: AxumBody,
) -> impl IntoResponse {
    println!("[web-upload] 收到上传请求");

    // 1. 校验 session（Authorization: Bearer <token>）
    let session = match headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
    {
        Some(t) => t.to_string(),
        None => {
            println!("[web-upload] 拒绝：缺少 Authorization 头");
            return (StatusCode::UNAUTHORIZED, "缺少 Authorization 头").into_response();
        }
    };
    if !state.validate_session(&session).await {
        println!("[web-upload] 拒绝：session 无效或已过期");
        return (StatusCode::UNAUTHORIZED, "session 无效或已过期").into_response();
    }
    println!("[web-upload] session 校验通过");

    // 2. 从 X-File-Size 头取文件总大小（前端必传，用于进度百分比计算）
    let total_size: u64 = headers
        .get("x-file-size")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    println!("[web-upload] 文件大小: {} 字节", total_size);

    // 3. 从 Content-Type 提取 boundary，用 multer 直接从底层 stream 解析
    //    不用 axum 的 Multipart 提取器（受 DefaultBodyLimit 默认 2MB 限制）
    let content_type = match headers.get("content-type").and_then(|v| v.to_str().ok()) {
        Some(ct) => ct,
        None => {
            return (StatusCode::BAD_REQUEST, "缺少 Content-Type").into_response();
        }
    };
    let boundary = match multer::parse_boundary(content_type) {
        Ok(b) => b,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                format!("解析 boundary 失败: {}", e),
            )
                .into_response();
        }
    };
    let stream = BodyStream::new(body).map(|result| {
        let data: Result<axum::body::Bytes, Box<dyn std::error::Error + Send + Sync>> = match result {
            Ok(frame) => match frame.into_data() {
                Ok(data) => Ok(data),
                Err(_) => Err(Box::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "non-data frame",
                ))),
            },
            Err(e) => Err(Box::new(e)),
        };
        data
    });
    let mut multipart = multer::Multipart::new(stream, boundary);

    // 4. 解析 multipart，取第一个 file field
    let field = match multipart.next_field().await {
        Ok(Some(f)) => f,
        Err(e) => {
            println!("[web-upload] multipart 解析失败: {}", e);
            return (
                StatusCode::BAD_REQUEST,
                format!("multipart 解析失败: {}", e),
            )
                .into_response();
        }
        Ok(None) => {
            println!("[web-upload] 拒绝：未找到文件字段");
            return (
                StatusCode::BAD_REQUEST,
                "未找到文件字段",
            )
                .into_response();
        }
    };
    let filename = field
        .file_name()
        .unwrap_or("unknown")
        .to_string();
    println!("[web-upload] 开始接收文件: {}", filename);

    // 5. 安全拼接路径 + 创建文件
    let file_path = match safe_join(&state.save_dir, &filename) {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                format!("非法文件名: {}", e),
            )
                .into_response();
        }
    };
    if let Some(parent) = file_path.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("创建目录失败: {}", e),
            )
                .into_response();
        }
    }
    let mut file = match File::create(&file_path).await {
        Ok(f) => f,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("创建文件失败: {}", e),
            )
                .into_response();
        }
    };

    // 5. 生成 task_id，emit receive-start-v2（与 TCP 接收端事件格式一致）
    let task_id = new_task_id();
    let _ = state.app.emit(
        "receive-start-v2",
        serde_json::json!({
            "task_id": task_id,
            "name": filename,
            "total_size": total_size,
            "kind": "file",
        }),
    );

    // 6. 流式读取 multipart field 数据 → 写文件 + emit 进度（100ms 限频）
    let mut received: u64 = 0;
    let mut last_emit = Instant::now();
    let start = Instant::now();
    let mut field = field;

    while let Ok(Some(chunk)) = field.chunk().await {
        if let Err(e) = file.write_all(&chunk).await {
            let _ = state.app.emit(
                "send-error-v2",
                serde_json::json!({
                    "task_id": task_id,
                    "message": format!("写入文件失败: {}", e),
                }),
            );
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("写入文件失败: {}", e),
            )
                .into_response();
        }
        received += chunk.len() as u64;

        if should_emit(&last_emit, false) {
            emit_progress(
                &state.app,
                "receive-progress-v2",
                &task_id,
                received,
                total_size,
                &filename,
                "file",
                start,
                None,
            );
            last_emit = Instant::now();
        }
    }

    file.flush().await.ok();

    // 7. 最终进度（100%）+ 完成事件
    let _ = state.app.emit(
        "receive-progress-v2",
        serde_json::json!({
            "task_id": task_id,
            "sent": received,
            "total": total_size,
            "percent": 100.0,
            "speed": 0.0,
            "name": filename,
            "kind": "file",
        }),
    );
    let _ = state.app.emit(
        "receive-complete-v2",
        serde_json::json!({
            "task_id": task_id,
            "name": filename,
        }),
    );

    println!("[web-upload] 文件接收完成: {} ({} 字节)", filename, received);
    (StatusCode::OK, "上传成功").into_response()
}
