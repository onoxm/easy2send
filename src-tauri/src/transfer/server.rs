use super::protocol::{
    bytes_to_task_id_hex, emit_progress, part_path_of, read_string, safe_join, should_emit,
    tune_socket_buffers, CHUNK_SIZE, ENTRY_DIR, ENTRY_FILE, HANDSHAKE_CONFIRM_TIMEOUT_SECS,
    MAX_PATH_LEN, MAX_STRING_LEN, MODE_BATCH, MODE_DISCONNECT, MODE_FILE, MODE_FILE_TASK,
    MODE_FILE_TASK_AUTH, MODE_FOLDER, MODE_FOLDER_TASK, MODE_FOLDER_TASK_AUTH, MODE_HANDSHAKE,
    MODE_PING, REPLY_ACCEPTED, REPLY_REJECTED,
};
use crate::discovery::state::current_unix_ms;
use crate::discovery::SharedDiscoveryState;
use crate::tls::{self, DeviceIdentity, ServerTlsStream};
use crate::trust::SharedTrustState;
use anyhow::{anyhow, Result};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

pub(super) async fn run_server(
    addr: &str,
    app: AppHandle,
    mut cancel_rx: oneshot::Receiver<()>,
    save_dir: PathBuf,
    state: SharedDiscoveryState,
    trust: SharedTrustState,
    identity: Arc<DeviceIdentity>,
) -> Result<()> {
    let listener = TcpListener::bind(addr).await?;
    let tls_config = identity.server_config()?;
    app.emit("server-status", "listening").unwrap();

    loop {
        tokio::select! {
            accept_result = listener.accept() => {
                let (tcp, peer) = accept_result?;
                let _ = tcp.set_nodelay(true);
                // socket 缓冲区必须在裸 TCP 上调：TLS 包一层之后拿不到 SockRef。
                tune_socket_buffers(&tcp);
                let app_clone = app.clone();
                let save_dir_clone = save_dir.clone();
                let state_clone = state.clone();
                let trust_clone = trust.clone();
                let config = tls_config.clone();
                tokio::spawn(async move {
                    // TLS 握手放进 spawn 里做：一条慢速或半开的连接不能把整个 accept
                    // 循环拖住（tls::accept 内部带超时）。
                    let mut stream = match tls::accept(tcp, config).await {
                        Ok(s) => s,
                        Err(e) => {
                            eprintln!("[server] {} 的 TLS 握手未完成: {}", peer, e);
                            return;
                        }
                    };
                    // 指纹在读到任何应用层字节之前就能拿到。拒绝得越早越好 ——
                    // 未受信任的设备根本走不到「解析 payload」那一步。
                    let Some(peer_fp) = tls::peer_fingerprint_server(&stream) else {
                        eprintln!("[server] 对端未出示客户端证书，拒绝: {}", peer);
                        return;
                    };
                    if let Err(e) = handle_client(
                        &mut stream,
                        peer,
                        &peer_fp,
                        app_clone,
                        save_dir_clone,
                        &state_clone,
                        &trust_clone,
                    )
                    .await
                    {
                        // TCP 心跳 / 探测连接断开是常态，不必刷日志
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

// 分派（全部跑在 TLS 之上，对端身份已由证书指纹确定）：
//   MODE_FILE_TASK_AUTH(7) | MODE_FOLDER_TASK_AUTH(8) —— 带来源身份的传输
//   MODE_HANDSHAKE(2) —— 握手（陌生设备需用户确认）
//   MODE_PING(6)      —— 心跳查询
// 其余旧模式（MODE_FILE/FOLDER/BATCH/FILE_TASK/FOLDER_TASK）都不带来源身份，一律拒绝。
async fn handle_client(
    stream: &mut ServerTlsStream,
    peer: SocketAddr,
    peer_fp: &str,
    app: AppHandle,
    save_dir: PathBuf,
    state: &SharedDiscoveryState,
    trust: &SharedTrustState,
) -> Result<()> {
    let mut mode_buf = [0u8; 1];
    match stream.read_exact(&mut mode_buf).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(()),
        Err(e) => return Err(e.into()),
    }
    let mode = mode_buf[0];

    match mode {
        MODE_FILE_TASK_AUTH | MODE_FOLDER_TASK_AUTH => {
            receive_authorized(stream, peer_fp, &app, &save_dir, trust, mode).await?;
        }
        MODE_HANDSHAKE => {
            receive_handshake(stream, peer, peer_fp, &app, trust).await?;
        }
        MODE_DISCONNECT => {
            receive_disconnect(stream, &app).await?;
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
        other => {
            // 这些旧模式（MODE_FILE/FOLDER/BATCH/FILE_TASK/FOLDER_TASK）的协议里
            // 没有任何来源标识，无法区分「同一台受信任设备」和「网段里任意一台机器」，
            // 放行等于把接收目录敞开给整个网段，所以统一拒绝。
            // 区分「旧版协议」与「纯属乱发」只是为了日志好排查。
            let what = if matches!(
                other,
                MODE_FILE | MODE_FOLDER | MODE_BATCH | MODE_FILE_TASK | MODE_FOLDER_TASK
            ) {
                "旧版协议"
            } else {
                "未知模式"
            };
            eprintln!("[server] 拒绝不带来源身份的{}请求: mode={}", what, other);
            return Err(anyhow!("拒绝不带来源身份的{}请求（mode={}）", what, other));
        }
    }
    Ok(())
}

/// 处理对端的断开通知：读出来源身份后广播给前端，随即结束
///
/// 不回包、也不校验信任表。理由：能走到这里的连接已经通过了 TLS 双向认证，
/// 也就是对方出示了本机曾接受过的客户端证书；而拒绝一条「我要走了」的通知，
/// 只会让本机停在一个假的「已连接」状态里 —— 对方已经回首页了，本机还显示连着。
async fn receive_disconnect(stream: &mut ServerTlsStream, app: &AppHandle) -> Result<()> {
    let device_id = read_string(stream).await?;
    // 昵称只用于提示文案：读不到就当空串，不让一条文案把断开流程搞挂
    let device_name = read_string(stream).await.unwrap_or_default();
    let _ = app.emit(
        "peer-disconnected",
        serde_json::json!({
            "device_id": device_id,
            "device_name": device_name,
        }),
    );
    Ok(())
}

/// 处理一条带来源身份的传输连接
///
/// 这里是**唯一的资源访问入口**，准入判定必须落在这一层。握手阶段确认过并不代表
/// 这条连接可信——握手和传输是两条独立的 TCP 连接，攻击者完全可以跳过握手直接
/// 连过来，所以每一条传输连接都要各自查一次信任表。
///
/// 判定依据是 `peer_fp`（TLS 握手期就确定的证书指纹），不是协议里的 device_id：
/// 后者来自对端的自述，任何人都能填。
async fn receive_authorized(
    stream: &mut ServerTlsStream,
    peer_fp: &str,
    app: &AppHandle,
    save_dir: &Path,
    trust: &SharedTrustState,
    mode: u8,
) -> Result<()> {
    let device_id = read_string(stream).await?;
    let mut tid_bytes = [0u8; 16];
    stream.read_exact(&mut tid_bytes).await?;
    let task_id = bytes_to_task_id_hex(&tid_bytes);

    let authorized = {
        let mut t = trust.lock().await;
        if t.is_trusted_fingerprint(peer_fp) {
            // 传输连接的协议里不带 device_name，只能刷新「最近用过」的时间。
            // 这里也绝不能拿 device_id 去反查或写信任表 —— 它是对端自述的，谁都能填。
            t.touch_last_seen(peer_fp, current_unix_ms());
            true
        } else {
            false
        }
    };

    // 先回准入结果、再决定收不收：发送端正在等这 1 个字节，
    // 被拒时它才能报出「未授权」，而不是 payload 写到一半突然断管。
    if !authorized {
        eprintln!(
            "[server] 拒绝未受信任设备的传输: 自述 device_id={}, 证书指纹={}",
            device_id,
            &peer_fp[..peer_fp.len().min(12)]
        );
        let _ = stream.write_all(&[REPLY_REJECTED]).await;
        return Ok(());
    }
    stream.write_all(&[REPLY_ACCEPTED]).await?;
    stream.flush().await?;

    if mode == MODE_FILE_TASK_AUTH {
        receive_file_stream(stream, app, save_dir, &task_id, TaskKind::File).await?;
        emit_recv_complete(app, &task_id, None);
    } else {
        receive_folder_stream(stream, app, save_dir, &task_id, TaskKind::Folder).await?;
        emit_recv_complete(app, &task_id, None);
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

/// 接收握手，并按信任状态回写接受/拒绝
///
/// 判定同样看**证书指纹**：已受信任的设备直接放行，不打扰用户；指纹陌生的设备则挂起
/// 等待用户在弹窗里决策，超过 HANDSHAKE_CONFIRM_TIMEOUT_SECS 未答复按拒绝处理。
/// 用户点「接受」时写入信任表的是**这次握手里的指纹**，而不是对端自述的 device_id——
/// 后者只作为展示标签一起存下来。
///
/// 注意这里**不是**授权点：即便握手通过，随后的传输连接仍会各自查一次信任表
/// （见 receive_authorized）。握手只负责「决定要不要把这台设备记进信任表」。
async fn receive_handshake(
    stream: &mut ServerTlsStream,
    peer: SocketAddr,
    peer_fp: &str,
    app: &AppHandle,
    trust: &SharedTrustState,
) -> Result<()> {
    let device_id = read_string(stream).await?;
    let device_name = read_string(stream).await?;
    let mut port_buf = [0u8; 2];
    stream.read_exact(&mut port_buf).await?;
    let server_port = u16::from_be_bytes(port_buf);
    let platform = read_string(stream).await?;
    let version = read_string(stream).await?;

    let now = current_unix_ms();
    let peer_ip = peer.ip().to_string();

    let already_trusted = {
        let t = trust.lock().await;
        t.is_trusted_fingerprint(peer_fp)
    };

    // 对端信息只构造一份：陌生设备走弹窗、已信任设备直接进传输页，
    // 两条路发给前端的 payload 完全相同，区别只在事件名。
    let peer_info = serde_json::json!({
        "deviceId": device_id.clone(),
        "deviceName": device_name.clone(),
        "ip": peer_ip,
        "addresses": [peer_ip],
        "port": server_port,
        "platform": platform,
        "version": version,
        "https": false,
        "lastSeen": now,
    });

    let accepted = if already_trusted {
        // 老朋友：静默通过，刷新最近时间，并把设备名同步为「这次连接自述的名字」——
        // 否则设置页会一直显示用户改名之前的旧名字。
        let mut t = trust.lock().await;
        t.touch_fingerprint(peer_fp, &device_name, now);
        // ⚠️「静默」指的是不打扰用户，**不是**不通知本机前端。
        // 接收端进传输页同样是事件驱动的（见 pages/__root__.tsx），少了这一步本机会停在
        // 「对方已经进了传输页、自己还留在首页」的假状态里；更糟的是此时对端发来的文件
        // 仍会被照常收下（传输连接各自查一次信任表，通得过），
        // 等于在用户完全没看到界面的情况下往磁盘写文件。
        let _ = app.emit("incoming-connection-trusted", &peer_info);
        true
    } else {
        // 陌生设备：先登记回传通道，再通知前端弹窗等用户决策
        let rx = {
            let mut t = trust.lock().await;
            t.register_pending(&device_id)
        };

        let _ = app.emit("incoming-connection", &peer_info);

        // 应用内弹窗只在窗口可见时才有用，而这个确认窗口只有 30 秒 ——
        // 窗口最小化或被别的窗口挡住恰恰是最常见的场景，所以补一条系统通知。
        // 点它会由 common/notify.rs 把主窗口拉回前台，那时弹窗通常还在有效期内。
        notify_incoming_connection(app, &device_name, &peer_ip);

        match tokio::time::timeout(Duration::from_secs(HANDSHAKE_CONFIRM_TIMEOUT_SECS), rx).await {
            Ok(Ok(true)) => {
                // 用户点了接受 → 把这台设备的**证书指纹**记入信任表。
                // 之后它再来（无论自称什么 device_id）都靠指纹直接放行。
                let mut t = trust.lock().await;
                t.trust(&device_id, &device_name, peer_fp, now)?;
                true
            }
            _ => {
                // 超时或通道被丢弃：清掉挂起项，并让前端收起弹窗
                let mut t = trust.lock().await;
                t.cancel_pending(&device_id);
                let _ = app.emit("incoming-connection-timeout", &device_id);
                false
            }
        }
    };

    let reply = if accepted {
        REPLY_ACCEPTED
    } else {
        REPLY_REJECTED
    };
    stream.write_all(&[reply]).await?;
    stream.flush().await?;
    Ok(())
}

/// 陌生设备请求连接时，若主窗口不在前台，补发一条系统通知
///
/// 只在窗口不可见（未聚焦或已最小化）时发：窗口就在眼前还要弹通知是纯粹的噪音。
/// 不额外做开关 —— 它只在这一个场景、且只在窗口看不见时才出现。
fn notify_incoming_connection(app: &AppHandle, device_name: &str, peer_ip: &str) {
    let in_foreground = app
        .get_webview_window("main")
        .map(|w| w.is_focused().unwrap_or(false) && !w.is_minimized().unwrap_or(false))
        .unwrap_or(false);
    if in_foreground {
        return;
    }
    crate::common::notify::send_notification(
        app.clone(),
        "连接请求".to_string(),
        Some(format!(
            "{}（{}）请求连接本机，请在 {} 秒内确认",
            device_name, peer_ip, HANDSHAKE_CONFIRM_TIMEOUT_SECS
        )),
    );
}

/// 读取「4 字节长度前缀 + 原始字节」的字段，并在 `vec!` 分配**之前**校验长度上限
///
/// 文件名与文件夹内的条目路径走的是内联读取（不是 read_string），
/// 同样不能把分配多大内存这件事交给对端决定。
///
/// 注：自加密链路起这些字段已经在 TLS 之内，能走到这里说明对端已出示可验证的证书；
/// 但校验仍然保留——纵深防御不该依赖「上一层已经挡住了」。
async fn read_sized_bytes(stream: &mut ServerTlsStream, max: usize, what: &str) -> Result<Vec<u8>> {
    let mut len_buf = [0u8; 4];
    stream.read_exact(&mut len_buf).await?;
    let len = u32::from_be_bytes(len_buf) as usize;
    if len > max {
        return Err(anyhow!("{}长度 {} 超出上限 {}", what, len, max));
    }
    let mut buf = vec![0u8; len];
    stream.read_exact(&mut buf).await?;
    Ok(buf)
}

// 接收单文件
async fn receive_file_stream(
    stream: &mut ServerTlsStream,
    app: &AppHandle,
    save_dir: &Path,
    task_id: &str,
    kind: TaskKind,
) -> Result<(String, u64, u64)> {
    let filename = String::from_utf8(read_sized_bytes(stream, MAX_STRING_LEN, "文件名").await?)?;

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
    // 先写临时文件、写完再改名（见 part_path_of）：传输中断时目录里留下的是
    // `xxx.part`，而不是一个看起来正常、实际被截断的文件。
    let part_path = part_path_of(&file_path);
    let mut file = File::create(&part_path).await?;

    let mut received = 0u64;
    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut last_emit = Instant::now();
    let start = Instant::now();
    let kind_str = if kind == TaskKind::File {
        "file"
    } else {
        "folder"
    };

    while received < total_size {
        let to_read = ((total_size - received).min(CHUNK_SIZE as u64)) as usize;
        stream.read_exact(&mut buffer[..to_read]).await?;
        file.write_all(&buffer[..to_read]).await?;
        received += to_read as u64;

        if should_emit(&last_emit, received >= total_size) {
            emit_progress(
                app,
                "receive-progress-v2",
                task_id,
                received,
                total_size,
                &filename,
                kind_str,
                start,
                None,
            );
            last_emit = Instant::now();
        }
    }
    file.flush().await?;
    // tokio 的 File 在 drop 时把关闭操作丢给后台线程，Windows 上 rename 一个句柄尚未
    // 释放的文件会失败（os error 32）。into_std 拿到 std::fs::File 后同步 drop，确保句柄已关。
    drop(file.into_std().await);
    tokio::fs::rename(&part_path, &file_path).await?;
    Ok((filename, total_size, received))
}

// 接收文件夹，带 task_id 事件
async fn receive_folder_stream(
    stream: &mut ServerTlsStream,
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

        let rel_path =
            String::from_utf8(read_sized_bytes(stream, MAX_PATH_LEN, "条目路径").await?)?;

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
            // 与单文件一致：先写 .part 再改名，中途失败时目录里留的是明确的半成品
            let part_path = part_path_of(&target);
            let mut file = File::create(&part_path).await?;

            let mut remaining = file_size;
            let mut buffer = vec![0u8; CHUNK_SIZE];
            while remaining > 0 {
                let to_read = remaining.min(CHUNK_SIZE as u64) as usize;
                stream.read_exact(&mut buffer[..to_read]).await?;
                file.write_all(&buffer[..to_read]).await?;
                remaining -= to_read as u64;
                received += to_read as u64;

                if should_emit(&last_emit, received >= total_size) {
                    let name = first_dir_name.clone().unwrap_or_else(|| "文件夹".into());
                    emit_progress(
                        app,
                        "receive-progress-v2",
                        task_id,
                        received,
                        total_size,
                        &name,
                        "folder",
                        start,
                        None,
                    );
                    last_emit = Instant::now();
                }
            }
            file.flush().await?;
            // 与单文件同样的原子落盘：句柄确实释放后再改名
            drop(file.into_std().await);
            tokio::fs::rename(&part_path, &target).await?;
        } else {
            return Err(anyhow!("未知的条目类型: {}", entry_type));
        }
    }
    // 末尾再补一次 100% 事件
    let final_name = first_dir_name.clone().unwrap_or_else(|| "文件夹".into());
    let _ = app.emit(
        "receive-progress-v2",
        serde_json::json!({
            "task_id": task_id,
            "sent": total_size,
            "total": total_size,
            "percent": 100.0,
            "speed": 0.0,
            "name": final_name,
            "kind": "folder",
        }),
    );
    Ok((
        first_dir_name.unwrap_or_else(|| "文件夹".to_string()),
        total_size,
        received,
    ))
}

// 此处原有 receive_batch（MODE_BATCH 的接收端）。该模式不带来源身份、
// 无法参与信任校验，已随发送端的批量路径一并移除——批量传输现在由
// create_transfer_tasks + start_transfer_task 逐条建连完成，每条都带 device_id。
