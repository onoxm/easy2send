use super::protocol::{
    collect_entries, emit_progress, new_task_id, read_string, should_emit, task_id_hex_to_bytes,
    write_string, CHUNK_SIZE, ENTRY_DIR, ENTRY_FILE, MODE_DISCONNECT, MODE_FILE_TASK_AUTH,
    MODE_FOLDER_TASK_AUTH, MODE_HANDSHAKE, REPLY_ACCEPTED,
};
use super::CancelFlag;
use crate::tls::{self, ClientTlsStream, DeviceIdentity};
use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::fs::File;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt, BufWriter};

/// 用户主动中断传输时返回的错误
///
/// 用独立类型而不是错误消息字符串：上层要据此区分「中断」与「真出错」，
/// 前者发 send-cancelled-v2、后者发 send-error-v2。字符串比较在两处文案不一致时
/// 会静默退化成「普通错误」，而类型判定不依赖任何文案。
#[derive(Debug)]
pub struct TransferCancelled;

impl std::fmt::Display for TransferCancelled {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("传输已中断")
    }
}

impl std::error::Error for TransferCancelled {}

/// 每个分块前检查一次中断标记
///
/// 响应粒度就是 `CHUNK_SIZE`（4MB）：千兆网约 30ms、百兆网约 300ms，
/// 用户点「断开」后最多等这么久。**不再做细**是刻意的 —— 再细就得给每次 write
/// 套 select，而取消的语义本来就是「放弃这条连接」，不必为它维持流的一致性。
fn check_cancelled(cancel: &CancelFlag) -> Result<()> {
    if cancel.load(Ordering::Relaxed) {
        return Err(TransferCancelled.into());
    }
    Ok(())
}

/// 握手结果
pub struct HandshakeOutcome {
    /// 对方是否接受本次连接
    pub accepted: bool,
    /// 对方出示的证书指纹
    ///
    /// 本机据此把它记进信任表：这样**下一次**连它时就能固定住这个指纹（防中间人）。
    /// 首次接触拿不到可比对的对象，只能先接受对方出示的证书 —— TOFU 的固有代价。
    pub peer_fingerprint: Option<String>,
    /// 对端（接收方）自报的 device_id / device_name
    ///
    /// 只有**接受**时才有：接收端会把这两个字段紧跟在 REPLY_ACCEPTED 后面回过来。
    /// 没有它们，本机没法把对端记进自己的信任表（信任表以 device_id 为键），
    /// 于是「对方发起、本机接受」之后本机就发不出文件 —— 对方不认为本机被信任。
    ///
    /// `None` 表示对端是没这条扩展的旧版本：那 1 个字节之后它就关连接了，
    /// 本机读不到身份，只能退回旧行为（不记信任，固定指纹仍可用）。
    pub peer_device_id: Option<String>,
    pub peer_device_name: Option<String>,
}

/// 发送单条路径（带 task_id 与来源身份），MODE_FILE_TASK_AUTH / MODE_FOLDER_TASK_AUTH
///
/// 布局：mode(1B) + device_id(4B 长度前缀 + UTF-8) + task_id(16B) + payload，
/// 整段跑在 TLS 之内。
///
/// 进度 / 完成事件统一用对象：
///   send-progress: { task_id, sent, total, percent, path, name }
///   send-complete: { task_id, name }
pub async fn run_client_with_task_id(
    addr: &str,
    path: &Path,
    identity: &DeviceIdentity,
    device_id: &str,
    expected_fingerprint: Option<String>,
    task_id: &str,
    cancel: &CancelFlag,
    app: &AppHandle,
) -> Result<()> {
    if !path.exists() {
        return Err(anyhow!("路径不存在: {}", path.display()));
    }
    check_cancelled(cancel)?;
    let stream = tls::connect(addr, identity, expected_fingerprint).await?;
    let mut stream = BufWriter::new(stream);

    // 先写 mode，再写来源 device_id、16 字节 task_id，最后才是 payload。
    // 接收端读到 mode 后先去查本机（即发起方）的证书指纹，未受信任的直接拒绝，
    // 这样「谁连上端口都能往接收目录写文件」的敞口才真正关上。
    let mode = if path.is_dir() {
        MODE_FOLDER_TASK_AUTH
    } else {
        MODE_FILE_TASK_AUTH
    };
    stream.write_all(&[mode]).await?;
    write_string(&mut stream, device_id).await?;
    stream.write_all(&task_id_hex_to_bytes(task_id)).await?;

    // 等接收端的准入应答：对方要先查信任表才决定收不收。
    // 先拿到这个字节再发内容，是为了让「被拒绝」能报成一句人话，
    // 而不是 payload 写到一半才抛一个 broken pipe。
    // （BufWriter 只缓冲写，get_mut 取裸流读不会吞掉入站数据）
    stream.flush().await?;
    let mut ack = [0u8; 1];
    stream.get_mut().read_exact(&mut ack).await?;
    if ack[0] != REPLY_ACCEPTED {
        return Err(anyhow!("对方未授权本机传输，请在对方设备上确认连接请求"));
    }

    // 等准入应答这段时间里用户也可能已经点了断开
    check_cancelled(cancel)?;

    let mut last_emit = Instant::now();
    if mode == MODE_FILE_TASK_AUTH {
        write_file_payload_v2(
            &mut stream,
            path,
            app,
            task_id,
            path.file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default(),
            &mut last_emit,
            cancel,
        )
        .await?;
    } else {
        write_folder_payload_v2(&mut stream, path, app, task_id, &mut last_emit, cancel).await?;
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

/// 通知对端本机已断开连接
///
/// 布局：mode(1B) + device_id + device_name，整段跑在 TLS 之内。
///
/// **不读回包**：这是一条单向通知，对方收下就够 —— 两端都回通知会变成互相触发的
/// 循环（详见 protocol.rs 里 MODE_DISCONNECT 的说明）。
pub async fn send_disconnect(
    addr: &str,
    identity: &DeviceIdentity,
    device_id: &str,
    device_name: &str,
    expected_fingerprint: Option<String>,
) -> Result<()> {
    let stream = tls::connect(addr, identity, expected_fingerprint).await?;
    let mut stream = BufWriter::new(stream);
    stream.write_all(&[MODE_DISCONNECT]).await?;
    write_string(&mut stream, device_id).await?;
    write_string(&mut stream, device_name).await?;
    stream.flush().await?;
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

// 此处原有 run_client_batch（MODE_BATCH：单连接串行发送多条路径）。
// 该模式在协议上不携带来源 device_id，无法参与信任校验，留着就是一个绕过口；
// 而前端早已改用 create_transfer_tasks + start_transfer_task 的并发调度，
// 所以整条批量路径连同其载荷写入函数一并移除，只保留带身份的发送链路。

/// 发送握手到指定地址（对等连接），并等待对端确认
///
/// 返回对端是否接受，以及它出示的证书指纹（供调用方记进信任表）。
/// 等待时长由调用方用 `tokio::time::timeout` 控制（见 transfer.rs::connect_device）——
/// 接收端可能要点一下确认，所以这里的等待窗口比建连超时宽得多。
///
/// 对端若是尚不支持加密链路的旧版本，会在 TLS 握手阶段就失败（对方根本不发
/// ServerHello），调用方按「连接失败」处理：旧版本不会被放进信任圈。
pub async fn send_handshake(
    addr: &str,
    identity: &DeviceIdentity,
    expected_fingerprint: Option<String>,
    device_id: &str,
    device_name: &str,
    server_port: u16,
    platform: &str,
    version: &str,
) -> Result<HandshakeOutcome> {
    let mut stream = tls::connect(addr, identity, expected_fingerprint).await?;
    let peer_fingerprint = tls::peer_fingerprint_client(&stream);

    stream.write_all(&[MODE_HANDSHAKE]).await?;
    write_string(&mut stream, device_id).await?;
    write_string(&mut stream, device_name).await?;
    stream.write_all(&server_port.to_be_bytes()).await?;
    write_string(&mut stream, platform).await?;
    write_string(&mut stream, version).await?;
    stream.flush().await?;

    let reply = read_handshake_reply(&mut stream).await?;
    Ok(HandshakeOutcome {
        accepted: reply.accepted,
        peer_fingerprint,
        peer_device_id: reply.peer_device_id,
        peer_device_name: reply.peer_device_name,
    })
}

/// 握手应答的解析结果
///
/// 不含指纹 —— 指纹来自 TLS 层（`peer_fingerprint_client`），与这段字节无关。
struct HandshakeReply {
    accepted: bool,
    peer_device_id: Option<String>,
    peer_device_name: Option<String>,
}

/// 读取握手应答：1 字节结果，接受时后面再跟两段长度前缀字符串（对端身份）
///
/// 抽成泛型是为了能在单测里直接喂字节：这段的兼容语义比看上去脆弱 ——
/// 旧版对端只回 1 个字节、随后立刻关连接，必须按「身份未知」降级而不是报错，
/// 否则「新版本连旧版本」会从「能连上但发不了文件」退化成「完全连不上」。
async fn read_handshake_reply<R: AsyncRead + Unpin>(stream: &mut R) -> Result<HandshakeReply> {
    let mut reply = [0u8; 1];
    stream.read_exact(&mut reply).await?;
    if reply[0] != REPLY_ACCEPTED {
        return Ok(HandshakeReply {
            accepted: false,
            peer_device_id: None,
            peer_device_name: None,
        });
    }

    // 接受之后紧跟对端身份（见 server::receive_handshake）。这是同一条连接上的追加写，
    // 正常情况下紧随 reply 到达，1 秒足够；超时或 EOF 都只说明对方是旧版本，
    // 不该让一次已经成功的握手因此失败 —— 拿不到就按「身份未知」继续。
    let identity = tokio::time::timeout(Duration::from_secs(1), async {
        let id = read_string(stream).await?;
        let name = read_string(stream).await?;
        Ok::<_, anyhow::Error>((id, name))
    })
    .await;

    let (peer_device_id, peer_device_name) = match identity {
        Ok(Ok((id, name))) if !id.is_empty() => (Some(id), Some(name)),
        Ok(Ok(_)) => (None, None),
        _ => {
            println!("[connect] 对端未回身份（旧版本或已断开），本次不记信任");
            (None, None)
        }
    };

    Ok(HandshakeReply {
        accepted: true,
        peer_device_id,
        peer_device_name,
    })
}

async fn write_file_payload_v2(
    stream: &mut BufWriter<ClientTlsStream>,
    path: &Path,
    app: &AppHandle,
    task_id: &str,
    display_name: String,
    last_emit: &mut Instant,
    cancel: &CancelFlag,
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
        check_cancelled(cancel)?;
        let n = file.read(&mut buffer).await?;
        if n == 0 {
            break;
        }
        stream.write_all(&buffer[..n]).await?;
        sent_in_file += n as u64;

        if should_emit(last_emit, sent_in_file >= file_size) {
            let mut extra = serde_json::Map::new();
            extra.insert("path".into(), path.to_string_lossy().to_string().into());
            emit_progress(
                app,
                "send-progress-v2",
                task_id,
                sent_in_file,
                file_size,
                &display_name,
                "file",
                start,
                Some(&extra),
            );
            *last_emit = Instant::now();
        }
    }
    Ok(())
}

async fn write_folder_payload_v2(
    stream: &mut BufWriter<ClientTlsStream>,
    root: &Path,
    app: &AppHandle,
    task_id: &str,
    last_emit: &mut Instant,
    cancel: &CancelFlag,
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
        check_cancelled(cancel)?;
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
            check_cancelled(cancel)?;
            let n = file.read(&mut buffer).await?;
            if n == 0 {
                break;
            }
            stream.write_all(&buffer[..n]).await?;
            remaining -= n as u64;
            sent_in_folder += n as u64;

            if should_emit(last_emit, sent_in_folder >= own_total) {
                let mut extra = serde_json::Map::new();
                extra.insert("path".into(), root.to_string_lossy().to_string().into());
                emit_progress(
                    app,
                    "send-progress-v2",
                    task_id,
                    sent_in_folder,
                    own_total,
                    &display_name,
                    "folder",
                    start,
                    Some(&extra),
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

// 原 write_file_payload_batch / write_folder_payload_batch 随批量模式一并移除
// （它们只服务于不带身份的 MODE_BATCH，见上方说明）。

//
// 这里钉的是「握手应答怎么解析」，也就是这次修的 bug 的协议面：
// 接受方必须把自己的身份带回来，发起方才有键可写信任表；而旧版对端只回 1 个字节，
// 那条路必须降级成「身份未知」而不是失败。
#[cfg(test)]
mod tests {
    use super::*;
    use crate::transfer::protocol::REPLY_REJECTED;

    /// 新版对端：accepted + 两段身份 → 解析出对方 device_id / name
    #[tokio::test]
    async fn accepted_reply_carries_peer_identity() {
        let mut buf: Vec<u8> = vec![REPLY_ACCEPTED];
        write_string(&mut buf, "dev-peer")
            .await
            .expect("写 device_id 失败");
        write_string(&mut buf, "对方的电脑")
            .await
            .expect("写 device_name 失败");

        let mut input: &[u8] = &buf;
        let reply = read_handshake_reply(&mut input)
            .await
            .expect("解析握手应答失败");

        assert!(reply.accepted, "accepted 字节应被识别");
        assert_eq!(reply.peer_device_id.as_deref(), Some("dev-peer"));
        assert_eq!(reply.peer_device_name.as_deref(), Some("对方的电脑"));
    }

    /// 旧版对端：accepted 之后立刻关连接 → 握手仍算成功，只是拿不到身份
    ///
    /// 这是**跨版本**的关键断言：如果这里报错，新版本连旧版本会从「连上但发不了文件」
    /// 退化成「完全连不上」，等于用修复一个方向换来毁掉另一个方向。
    #[tokio::test]
    async fn accepted_without_identity_degrades_to_none() {
        let buf: Vec<u8> = vec![REPLY_ACCEPTED];
        let mut input: &[u8] = &buf;

        let reply = read_handshake_reply(&mut input)
            .await
            .expect("旧版对端只回 1 个字节时不应报错");

        assert!(reply.accepted, "只回 1 个字节也代表对方接受了连接");
        assert_eq!(reply.peer_device_id, None, "拿不到身份时应按未知处理");
        assert_eq!(reply.peer_device_name, None);
    }

    /// 被拒绝：只读 1 个字节就返回，不尝试读身份（否则会干等 1 秒超时）
    #[tokio::test]
    async fn rejected_reply_has_no_identity() {
        let buf: Vec<u8> = vec![REPLY_REJECTED];
        let mut input: &[u8] = &buf;

        let reply = read_handshake_reply(&mut input)
            .await
            .expect("解析拒绝应答失败");

        assert!(!reply.accepted);
        assert_eq!(reply.peer_device_id, None);
        assert_eq!(reply.peer_device_name, None);
    }
}
