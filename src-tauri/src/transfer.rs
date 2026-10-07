// 文件/文件夹传输模块入口
// 子模块：
//   protocol: 协议常量 + 路径安全工具
//   server:   接收链路
//   client:   发送链路
mod client;
pub(crate) mod protocol;
mod server;

use self::protocol::HANDSHAKE_CONFIRM_TIMEOUT_SECS;
use crate::discovery::{unregister_service, DeviceInfo, SharedDiscoveryState};
use crate::tls::DeviceIdentity;
use crate::trust::SharedTrustState;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, Mutex};

/// 取本机 device_id：传输连接必须自带来源身份，否则接收端无从识别来源。
///
/// 优先用 discovery 里已加载的那份；discovery 尚未启动时回落到持久化的
/// device_id.txt 现读一次（宁可多读一次文件，也不发一条无身份的连接）。
async fn self_device_id(state: &SharedDiscoveryState, app: &AppHandle) -> Result<String, String> {
    {
        let s = state.lock().await;
        if let Some(id) = s.self_device_id.as_ref() {
            return Ok(id.clone());
        }
    }
    crate::discovery::device_id::get_or_create_device_id(app)
        .await
        .map_err(|e| e.to_string())
}

/// 按地址反查对端已记录的证书指纹
///
/// 传输命令的入参只有地址，而指纹是按 device_id 记的，所以先用 IP 去发现表里找
/// 对应设备。找不到（设备已从列表消失、或走的是手动连接）就返回 None，
/// 调用方按首次接触处理、不做指纹固定。
async fn expected_fingerprint_for_addr(
    addr: &str,
    discovery: &SharedDiscoveryState,
    trust: &SharedTrustState,
) -> Option<String> {
    let peer_ip = addr.rsplit_once(':').map(|(ip, _)| ip)?;
    let device_id = {
        let s = discovery.lock().await;
        s.devices
            .iter()
            .find(|(_, d)| d.ip == peer_ip || d.addresses.iter().any(|a| a == peer_ip))
            .map(|(id, _)| id.clone())
    }?;
    let t = trust.lock().await;
    t.pinned_fingerprint_of(&device_id)
}

// ---------- 任务取消注册表 ----------

/// 单个发送任务的中断标记（true = 已被要求停止）
pub type CancelFlag = Arc<AtomicBool>;

/// 正在运行的发送任务登记表：task_id → 中断标记
///
/// 发送任务 spawn 出去后就拿不到句柄了（见 `start_transfer_task`），要让它停下来
/// 只能靠一个它自己会去看的共享标记位。任务在结束时自己摘掉登记，
/// 所以表的大小只等于「此刻真正在传的任务数」，不会随累计任务数增长。
pub type SharedTaskRegistry = Arc<Mutex<HashMap<String, CancelFlag>>>;

/// 建一张空的登记表（在 lib.rs 的 setup 里 manage 进应用状态）
pub fn new_task_registry() -> SharedTaskRegistry {
    Arc::new(Mutex::new(HashMap::new()))
}

// ---------- 服务器状态管理 ----------
pub struct ServerState {
    pub cancel_sender: Option<oneshot::Sender<()>>,
    pub task_handle: Option<tauri::async_runtime::JoinHandle<()>>,
    pub save_dir: PathBuf,
    /// 当前**实际**监听的端口。
    ///
    /// 存它是为了让 `start_server` 在「已在运行」时能回报真实端口：前端每次挂载都会
    /// 自己 `get_free_port` 探一遍，而主进程里的监听 socket 可能根本没释放过
    /// （webview 重载就是这种情况），探出来的端口号必然偏大。前端拿这个值校正显示。
    pub listen_port: Option<u16>,
}

impl Default for ServerState {
    fn default() -> Self {
        Self {
            cancel_sender: None,
            task_handle: None,
            save_dir: PathBuf::from("received"),
            listen_port: None,
        }
    }
}

// ---------- Tauri 命令 ----------
/// 启动接收服务器，**返回实际监听的端口**。
///
/// 幂等：若服务器已在运行，直接返回它当前监听的端口，而不是报错。
///
/// 为什么必须幂等：前端每次挂载都会重新 `get_free_port` 探测一遍，但监听 socket
/// 是主进程持有的、webview 重载并不会释放它。此时探测值（8001）与真实端口（8000）
/// 不一致，而旧实现返回 `Err` 会被根布局的 catch 静默吞掉 —— 连带后面的
/// `start_discovery` 永不执行，表现为「界面显示已就绪、设备列表却恒空」。
#[tauri::command]
pub async fn start_server(
    app: AppHandle,
    addr: String,
    save_dir: String,
    state: tauri::State<'_, Arc<Mutex<ServerState>>>,
    discovery_state: tauri::State<'_, SharedDiscoveryState>,
    trust_state: tauri::State<'_, SharedTrustState>,
    identity: tauri::State<'_, Arc<DeviceIdentity>>,
) -> Result<u16, String> {
    let save_path = PathBuf::from(&save_dir);

    if !save_path.is_absolute() {
        return Err("保存路径必须是绝对路径".to_string());
    }
    if let Err(e) = tokio::fs::create_dir_all(&save_path).await {
        return Err(format!("无法创建目录: {}", e));
    }

    // 端口先自己解析一次：原实现把 addr 整个丢给 run_server 在后台任务里绑定，
    // 地址格式错只会 eprintln，前端拿不到任何反馈。这里提前校验并留下端口值。
    let listen_port: u16 = addr
        .rsplit_once(':')
        .and_then(|(_, p)| p.parse().ok())
        .ok_or_else(|| format!("无效的监听地址: {}", addr))?;

    let save_path_for_task = save_path.clone();

    {
        let mut state = state.lock().await;
        if state.cancel_sender.is_some() {
            return Ok(state.listen_port.unwrap_or(listen_port));
        }
        state.save_dir = save_path;
    }

    let (tx, rx) = oneshot::channel();
    let app_clone = app.clone();
    let discovery_state = discovery_state.inner().clone();
    let trust = trust_state.inner().clone();
    let identity = identity.inner().clone();
    let handle = tauri::async_runtime::spawn(async move {
        if let Err(e) = server::run_server(
            &addr,
            app_clone,
            rx,
            save_path_for_task,
            discovery_state,
            trust,
            identity,
        )
        .await
        {
            eprintln!("服务器错误: {}", e);
        }
    });

    {
        let mut state = state.lock().await;
        state.cancel_sender = Some(tx);
        state.task_handle = Some(handle);
        state.listen_port = Some(listen_port);
    }
    Ok(listen_port)
}

#[tauri::command]
pub async fn stop_server(
    state: tauri::State<'_, Arc<Mutex<ServerState>>>,
    discovery_state: tauri::State<'_, SharedDiscoveryState>,
) -> Result<(), String> {
    {
        let mut s = state.lock().await;
        if let Some(sender) = s.cancel_sender.take() {
            let _ = sender.send(());
            s.task_handle = None;
            // 端口跟着一起清：再启动时 `start_server` 不能拿旧值当「已在运行」的回报。
            s.listen_port = None;
        } else {
            return Err("No server is running".to_string());
        }
    }

    // 停止接收的同时注销本机 mDNS 服务。
    //
    // 少了这一步，本机在对端设备列表里仍然是「在线」的，对方会一直以为还能往这里发，
    // 得等它自己的心跳超时（30s）才把人清掉。这里只注销**服务注册**，browse 不动
    // —— browse 由根布局常驻，与「是否在接收」无关。
    //
    // 注销失败不阻断停止流程：server 已经停了，这里只是让对端早一点知道。
    let _ = unregister_service(discovery_state).await;
    Ok(())
}

// 原 send_file（单文件旧入口：自动判断文件或文件夹）已移除。它调用 client::run_client
// 且没有 task_id 与中断入口，早已被「create_transfer_tasks + start_transfer_task」取代，
// 前端零调用。单文件传送现在同样走任务组：前端建一个任务再启动它。
//
// 原 send_files（MODE_BATCH：单连接串行批量）已移除。该模式在协议上不携带来源
// device_id，无法通过接收端的信任校验，留着就是一条绕过路径。批量场景请走
// create_transfer_tasks + start_transfer_task，由前端按并发上限逐条建连。

/// 创建传输任务组：前端按并发数排队调度
///
/// 返回 JSON 数组：[{ task_id, path, name }]
/// 前端逐个调用 `start_transfer_task` 开始传输，按并发上限控制同时运行数
#[tauri::command]
pub async fn create_transfer_tasks(
    addr: String,
    file_paths: Vec<String>,
) -> std::result::Result<Vec<serde_json::Value>, String> {
    let list = client::build_transfer_task_seeds(&addr, &file_paths).map_err(|e| e.to_string())?;
    Ok(list
        .into_iter()
        .map(|(task_id, path, name)| {
            serde_json::json!({
                "task_id": task_id,
                "path": path.to_string_lossy().to_string(),
                "name": name,
            })
        })
        .collect())
}

/// 启动单个传输任务（由 create_transfer_tasks 得到的 task_id）
///
/// 每个任务单独建立一条 TLS 连接 + MODE_FILE_TASK_AUTH/MODE_FOLDER_TASK_AUTH
/// 事件使用 `send-progress-v2` / `send-complete-v2`（带 task_id）
#[tauri::command]
pub async fn start_transfer_task(
    app: AppHandle,
    addr: String,
    task_id: String,
    file_path: String,
    discovery_state: tauri::State<'_, SharedDiscoveryState>,
    trust_state: tauri::State<'_, SharedTrustState>,
    identity: tauri::State<'_, Arc<DeviceIdentity>>,
    registry: tauri::State<'_, SharedTaskRegistry>,
) -> Result<(), String> {
    let device_id = self_device_id(discovery_state.inner(), &app).await?;
    let expected =
        expected_fingerprint_for_addr(&addr, discovery_state.inner(), trust_state.inner()).await;
    let identity = identity.inner().clone();

    // 登记中断标记：cancel_transfer_tasks 靠它让这条传输停下来
    let cancel: CancelFlag = Arc::new(AtomicBool::new(false));
    let registry_handle = registry.inner().clone();
    registry_handle
        .lock()
        .await
        .insert(task_id.clone(), cancel.clone());

    tauri::async_runtime::spawn(async move {
        let p = PathBuf::from(&file_path);
        let result = client::run_client_with_task_id(
            &addr, &p, &identity, &device_id, expected, &task_id, &cancel, &app,
        )
        .await;

        // 先摘登记再处理结果：成功、失败、被中断都要摘，
        // 否则中断过的任务会永远留在表里、越积越多
        registry_handle.lock().await.remove(&task_id);

        match result {
            Ok(()) => {}
            // 用户主动中断：前端已自行把任务标成「已中断」，这里只补一条确认事件。
            // **不能走 send-error-v2** —— 那会把刚标好的中断态盖成失败态，
            // 用户看到的就是「我主动断的，怎么显示失败了」。
            Err(e) if e.downcast_ref::<client::TransferCancelled>().is_some() => {
                let _ = app.emit("send-cancelled-v2", serde_json::json!({ "task_id": task_id }));
            }
            Err(e) => {
                eprintln!("transfer task {} error: {}", task_id, e);
                let _ = app.emit(
                    "send-error-v2",
                    serde_json::json!({
                        "task_id": task_id,
                        "message": e.to_string(),
                    }),
                );
            }
        }
    });
    Ok(())
}

/// 中断指定的发送任务
///
/// 只负责把登记表里的标记置起来，真正的停止发生在任务的发送循环里
/// （每读一个 CHUNK_SIZE 分块检查一次，见 `client::check_cancelled`）。
///
/// 返回实际被标记的任务数。找不到的 task_id 不报错 —— 前端拿着一个可能已经跑完的
/// 任务列表来取消是常态（某个任务恰好在用户点确认那会儿传完了），
/// 为此报错只会让「断开」失败在一个无关紧要的竞态上。
#[tauri::command]
pub async fn cancel_transfer_tasks(
    task_ids: Vec<String>,
    registry: tauri::State<'_, SharedTaskRegistry>,
) -> Result<usize, String> {
    let reg = registry.lock().await;
    let mut marked = 0;
    for id in &task_ids {
        if let Some(flag) = reg.get(id) {
            flag.store(true, Ordering::Relaxed);
            marked += 1;
        }
    }
    Ok(marked)
}

/// 通知对端本机已断开连接
///
/// 传输页的「断开连接」用它告诉对方也收工（对方收到后结束会话、回到首页）。
///
/// **通知失败一律静默**：断开是本机单方面就能完成的动作，而对方可能已关机、
/// 已断网，或者本来就是个没有这条协议的手机网页端。这些情况下本机该断还得断 ——
/// 把通知失败抛给前端，只会让用户以为「断开失败」而反复点击，
/// 而实际上他早就断开了。
///
/// 手机网页上传模式没有这条协议，前端不会调用本命令。
#[tauri::command]
pub async fn notify_disconnect(
    app: AppHandle,
    addr: String,
    discovery_state: tauri::State<'_, SharedDiscoveryState>,
    trust_state: tauri::State<'_, SharedTrustState>,
    identity: tauri::State<'_, Arc<DeviceIdentity>>,
) -> Result<(), String> {
    let device_id = self_device_id(discovery_state.inner(), &app).await?;
    let expected =
        expected_fingerprint_for_addr(&addr, discovery_state.inner(), trust_state.inner()).await;
    // 本机昵称：优先取 discovery 的当前配置。取不到就用空串 ——
    // 对方只拿它做提示文案，缺了它不影响断开本身
    let device_name = {
        let s = discovery_state.lock().await;
        s.last_config
            .as_ref()
            .map(|c| c.device_name.clone())
            .unwrap_or_default()
    };
    let identity = identity.inner().clone();

    if let Err(e) = client::send_disconnect(&addr, &identity, &device_id, &device_name, expected).await
    {
        eprintln!("[transfer] 断开通知未能送达 {}（不影响本机断开）: {}", addr, e);
    }
    Ok(())
}

/// 连接指定设备（发送握手）
///
/// 从 discovery 设备表查找 device_id → 取其全部候选 IP →
/// 逐个尝试建立加密连接并向对方发送 MODE_HANDSHAKE + 本机设备信息，
/// 每个候选 IP 的建连超时在 tls::connect 内部（3s，避免单 IP 不可达时卡很久）。
/// 返回对端 DeviceInfo（ip 字段更新为实际握手成功的 IP），前端存入 store 后跳转传输页
///
/// 对方接受后，本机会顺势记住它的证书指纹 —— 这样后续传输连接可以固定住对端
/// （防中间人）。注意这只写入「已知对端」，**不等于**把它加进信任名单：
/// 那是对方（接收方）用户点击确认时才发生的事。
#[tauri::command]
pub async fn connect_device(
    device_id: String,
    state: tauri::State<'_, SharedDiscoveryState>,
    trust_state: tauri::State<'_, SharedTrustState>,
    identity: tauri::State<'_, Arc<DeviceIdentity>>,
) -> Result<DeviceInfo, String> {
    let identity = identity.inner().clone();

    // 从 discovery state 查找对端设备 + 本机设备信息
    let (info, self_info) = {
        let s = state.lock().await;
        let info = s
            .devices
            .get(&device_id)
            .cloned()
            .ok_or_else(|| format!("设备未找到: {}", device_id))?;
        let cfg = s.last_config.as_ref().ok_or("discovery 未启动")?;
        let did = s.self_device_id.as_ref().ok_or("device_id 未设置")?;
        (
            info,
            (
                did.clone(),
                cfg.device_name.clone(),
                cfg.port,
                cfg.platform.clone(),
                cfg.version.clone(),
            ),
        )
    };
    let (self_device_id, self_device_name, server_port, platform, version) = self_info;

    // 若本机之前连过它，就用记下的指纹固定对端证书；没有则按首次接触处理
    let expected = {
        let t = trust_state.lock().await;
        t.pinned_fingerprint_of(&device_id)
    };

    // 候选地址：首选 IP 在前，其余 addresses 去重后追加
    // 多网卡环境下 mDNS 注册多 IP，首选可能不可达，需逐个尝试
    let mut candidates: Vec<String> = vec![info.ip.clone()];
    for a in &info.addresses {
        if !candidates.contains(a) {
            candidates.push(a.clone());
        }
    }

    println!(
        "[connect] 尝试连接 {}:{} ({}), 候选地址: {:?}",
        info.device_name, info.port, device_id, candidates
    );

    let mut last_err = String::new();
    for ip in &candidates {
        let addr = format!("{}:{}", ip, info.port);
        // 建连阶段由 tls::connect 内部限时（多网卡下不可达地址要快速跳过），
        // 这里的外层超时只覆盖「等对方点确认」，所以给得宽得多。
        match tokio::time::timeout(
            Duration::from_secs(HANDSHAKE_CONFIRM_TIMEOUT_SECS),
            client::send_handshake(
                &addr,
                &identity,
                expected.clone(),
                &self_device_id,
                &self_device_name,
                server_port,
                &platform,
                &version,
            ),
        )
        .await
        {
            Ok(Ok(outcome)) if outcome.accepted => {
                println!("[connect] 握手成功 {}", addr);
                // 记住对端的证书指纹，后续传输连接据此固定它（防中间人）
                if let Some(fp) = outcome.peer_fingerprint {
                    let mut t = trust_state.lock().await;
                    if let Err(e) = t.remember_peer(&device_id, &fp) {
                        eprintln!("[connect] 记录对端指纹失败: {}", e);
                    }
                }
                // 若用了非首选 IP，更新 info.ip 为实际成功的 IP，
                // 后续发文件直接用这个可达 IP，无需再次容错
                let mut result = info.clone();
                result.ip = ip.clone();
                return Ok(result);
            }
            // 对方明确点了拒绝：换 IP 重试也是被拒，直接返回
            Ok(Ok(_)) => {
                println!("[connect] 对方拒绝连接 {}", addr);
                return Err("对方拒绝了本次连接请求".to_string());
            }
            Ok(Err(e)) => {
                last_err = format!("{}: {}", addr, e);
                eprintln!("[connect] 握手失败 {}: {}", addr, e);
                continue;
            }
            // 等确认等到超时：对方很可能没在看屏幕，换 IP 重试同样是干等，直接返回
            Err(_) => {
                println!("[connect] 等待对方确认超时 {}", addr);
                return Err(format!(
                    "等待对方确认超时（{} 秒），请让对方在连接请求中点击接受",
                    HANDSHAKE_CONFIRM_TIMEOUT_SECS
                ));
            }
        }
    }
    Err(format!(
        "连接失败（尝试 {} 个地址均失败）: {}",
        candidates.len(),
        last_err
    ))
}

/// 手动连接指定地址（跳过 mDNS 发现表，直接建立加密连接并握手）
///
/// 供前端"手动连接"按钮调用：mDNS 发现不到对方时（跨网段/VPN/多网卡选错），
/// 用户手动输入 `ip:port` 发起握手。
///
/// 流程：发送 MODE_HANDSHAKE → 成功后用 MODE_PING 拉取对端 deviceName →
/// 构造 DeviceInfo 返回（ip/port 从 addr 解析，deviceName 来自 PING）
///
/// 手动连接无法固定对端指纹：地址是用户现输入的，发现表里没有对应 device_id，
/// 也就查不到记录。这是该入口的固有代价（用户本来就是在「我知道我在连谁」的场景下用它）。
#[tauri::command]
pub async fn connect_by_addr(
    addr: String,
    state: tauri::State<'_, SharedDiscoveryState>,
    identity: tauri::State<'_, Arc<DeviceIdentity>>,
) -> Result<DeviceInfo, String> {
    let identity = identity.inner().clone();

    // 从 discovery state 拿本机设备信息（用于握手）
    let (self_device_id, self_device_name, server_port, platform, version) = {
        let s = state.lock().await;
        let cfg = s
            .last_config
            .as_ref()
            .ok_or("discovery 未启动，无法获取本机信息")?;
        let did = s.self_device_id.as_ref().ok_or("device_id 未设置")?;
        (
            did.clone(),
            cfg.device_name.clone(),
            cfg.port,
            cfg.platform.clone(),
            cfg.version.clone(),
        )
    };

    println!("[connect] 手动连接: {}", addr);

    // 1. 发送握手并等待对方确认（建连限时在 tls::connect 内部）
    let outcome = tokio::time::timeout(
        Duration::from_secs(HANDSHAKE_CONFIRM_TIMEOUT_SECS),
        client::send_handshake(
            &addr,
            &identity,
            None,
            &self_device_id,
            &self_device_name,
            server_port,
            &platform,
            &version,
        ),
    )
    .await
    .map_err(|_| {
        format!(
            "等待对方确认超时（{} 秒），请让对方在连接请求中点击确认",
            HANDSHAKE_CONFIRM_TIMEOUT_SECS
        )
    })?
    .map_err(|e| format!("握手失败 {}: {}", addr, e))?;

    if !outcome.accepted {
        return Err("对方拒绝了本次连接请求".to_string());
    }

    println!("[connect] 手动握手成功 {}", addr);

    // 2. 解析 addr 为 ip + port
    let socket_addr = addr
        .parse::<std::net::SocketAddr>()
        .map_err(|e| format!("地址格式错误（应为 IP:端口）: {}", e))?;
    let peer_ip = socket_addr.ip().to_string();
    let peer_port = socket_addr.port();

    // 3. 用 MODE_PING 拉取对端 deviceName（失败则用占位符）
    let peer_name = match tokio::time::timeout(
        Duration::from_secs(3),
        crate::discovery::health::ping_device(&addr, &identity),
    )
    .await
    {
        Ok(Ok(Some(name))) => name,
        _ => format!("未知设备({})", peer_ip),
    };

    // 4. 构造 DeviceInfo 返回
    Ok(DeviceInfo {
        device_id: String::new(),
        device_name: peer_name,
        ip: peer_ip.clone(),
        addresses: vec![peer_ip],
        port: peer_port,
        platform: String::new(),
        version: String::new(),
        https: false,
        last_seen: crate::discovery::state::current_unix_ms(),
    })
}

/// 前端提交「是否接受对方连接」的决策
///
/// 接收端收到陌生设备握手时会挂起等待；本命令把用户的选择回传过去。
/// 用户点「接受」后由接收端把这台设备的**证书指纹**记入信任表（之后它再来就静默通过），
/// 所以这里只负责传结果，不碰信任表本身——判定与写入留在同一处。
#[tauri::command]
pub async fn respond_connection(
    device_id: String,
    accepted: bool,
    trust_state: tauri::State<'_, SharedTrustState>,
) -> Result<(), String> {
    let mut t = trust_state.lock().await;
    if t.resolve_pending(&device_id, accepted) {
        Ok(())
    } else {
        Err("没有等待确认的连接请求（可能已超时）".to_string())
    }
}
