//! 应用退出前的善后流程
//!
//! 用户点窗口关闭 / 托盘「退出」时，进程若直接结束，对端收不到任何通知 ——
//! 对方会停在「已连接」的假状态里，以为还能继续往本机发文件。所以退出这一下要被
//! 拦下来，先做完三件事：中断进行中的传输 → 逐个通知活跃对端 → 停掉接收服务。
//!
//! 为什么要绕一圈问前端：**只有前端知道还有多少任务没传完** —— 排队中的任务只活在
//! 传输页的内存里，后端一无所知。所以这里先把退出请求转给前端，由它决定是直接退、
//! 还是先弹窗问一句，再把决定回传回来。
//!
//! ## 拦截点有两个，且不能只拦一个
//!
//! - **窗口关闭按钮** → 拦 [`tauri::WindowEvent::CloseRequested`]。
//! - **托盘「退出」** → 拦 [`tauri::RunEvent::ExitRequested`]（走的是 `app.exit`）。
//!
//! ⚠️ 关闭按钮**不能**等 `ExitRequested`：看 tauri-runtime-wry 的实现，这个事件是在
//! `TaoWindowEvent::Destroyed` 之后、确认「所有窗口都没了」才发出的 —— 那时 WebView
//! 已经销毁，前端的监听器早没了，弹窗确认永远等不到人来点，只能靠下面的兜底超时退出。
//! 所以要在窗口销毁**之前**用 `api.prevent_close()` 拦下来。
//!
//! ## 两条路要问的问题不一样
//!
//! - **窗口关闭** → 问「关闭窗口后要做什么？」（最小化到托盘 / 退出软件），
//!   见前端 `components/CloseConfirmDialog.tsx`。
//! - **托盘「退出」** → 用户在托盘里已经明确说了要退出，再问一遍「要不要最小化」
//!   是明知故问；只在有任务没传完时确认一次（那关乎丢不丢文件，是另一件事）。
//!
//! 所以事件里必须带上是哪条路来的（`source`）—— 前端拿到同一个事件名要分两种处理。

use crate::discovery::SharedDiscoveryState;
use crate::tls::DeviceIdentity;
use crate::transfer::{
    cancel_all_tasks, disconnect_all_peers, stop_server_inner, ServerState, SharedPeers,
    SharedTaskRegistry,
};
use crate::trust::SharedTrustState;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

/// 等待前端回应的上限（秒）
///
/// 正常路径下前端一定会回 `quit_app` 或 `cancel_exit`，所以这个超时只可能落到
/// 「webview 已经崩溃或卡死」这一种情况上。没有它的话，`prevent_exit` 会把应用
/// 变成「点了关闭却关不掉」——那比少通知对端一次严重得多。
///
/// 给得比较宽容是刻意的：另一个会走到这里的场景是「用户点了关闭、看着弹窗就走开了」，
/// 那时超时退出正好符合他「我要关掉它」的本意；而如果他其实想留下，点一下「取消」
/// 就会让兜底失效（见 `cancel_exit`）。
const FRONTEND_RESPONSE_TIMEOUT_SECS: u64 = 30;

/// 这次退出请求是从哪条路来的
///
/// 前端要靠它决定问什么：关窗口问「最小化还是退出」，托盘退出则是明确意图。
/// 序列化成 `"close"` / `"quit"` 塞进事件 payload。
#[derive(Clone, Copy, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ExitSource {
    /// 点窗口关闭按钮
    Close,
    /// 托盘「退出」菜单
    Quit,
}

/// 退出流程的共享状态
#[derive(Default)]
pub struct ExitState {
    /// 已经决定退出（前端确认，或兜底超时）。再次收到退出 / 关闭请求时直接放行。
    pub exiting: AtomicBool,
    /// 本次退出请求已被前端取消（用户点了「取消」）⇒ 兜底作废，应用继续运行。
    pub cancelled: AtomicBool,
    /// 已经问过前端、正在等它回话。
    ///
    /// 用户连点关闭按钮时靠它去重：第一次就已经把确认弹窗推到前端了，
    /// 后面几次若也照发，只会在前一个弹窗上面再叠一个（两个弹窗对同一个决定发问）。
    pub asking: AtomicBool,
}

pub type SharedExitState = Arc<ExitState>;

/// 拦截一次退出 / 关闭请求，转给前端决定
///
/// 两个调用点（见模块头）：`WindowEvent::CloseRequested` 与 `RunEvent::ExitRequested`。
/// **调用方要先调对应的 `prevent_close()` / `prevent_exit()`** —— 这两个 api 不在
/// 这里，也从这里拿不到。
///
/// 重入是安全的：`quit_app` 里那次 `app.exit(0)` 会再次触发 ExitRequested，
/// 但那时 `exiting` 已置位，回调直接放行。
pub fn intercept_exit(app: &AppHandle, source: ExitSource) {
    let state = app.state::<SharedExitState>().inner().clone();
    if state.exiting.load(Ordering::SeqCst) {
        return;
    }
    // 用户连点关闭按钮：只问一次，等前端回话
    if state.asking.swap(true, Ordering::SeqCst) {
        return;
    }
    // 上一次请求若被取消过，这里必须清掉标记，否则本次的兜底一上来就是失效的
    state.cancelled.store(false, Ordering::SeqCst);

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // 把「后端这边正跑着几个任务」一并交给前端：排队中的任务只有前端知道，
        // 正在跑的发送任务只有后端知道（见 SharedTaskRegistry），两边各持一半，
        // 前端取大者才是全貌。
        // registry 与它的锁守卫不能写成「块尾表达式」：那样守卫这个临时值会比块内
        // 的 registry 活得久，借用在 registry 析构时仍未结束（E0597）
        let registry = app.state::<SharedTaskRegistry>().inner().clone();
        let running = registry.lock().await.len();
        let _ = app.emit(
            "app-exit-requested",
            serde_json::json!({ "runningTasks": running, "source": source }),
        );

        tokio::time::sleep(Duration::from_secs(FRONTEND_RESPONSE_TIMEOUT_SECS)).await;
        if state.exiting.load(Ordering::SeqCst) || state.cancelled.load(Ordering::SeqCst) {
            return;
        }
        eprintln!(
            "[exit] 前端 {} 秒未响应退出请求，直接退出",
            FRONTEND_RESPONSE_TIMEOUT_SECS
        );
        state.exiting.store(true, Ordering::SeqCst);
        // 兜底路径同样要断开连接：走到这里只是「前端没回应」，不是「不需要善后」
        shutdown(&app).await;
        app.exit(0);
    });
}

/// 前端取消退出：作废本次请求的兜底，应用继续运行
///
/// `asking` 一并复位 —— 用户随时可以再点一次关闭，那时要能重新问一遍。
#[tauri::command]
pub fn cancel_exit(state: tauri::State<'_, SharedExitState>) {
    state.cancelled.store(true, Ordering::SeqCst);
    state.asking.store(false, Ordering::SeqCst);
    println!("[exit] 用户取消了退出");
}

/// 最小化到托盘：收起主窗口，应用留在后台继续跑
///
/// 关窗确认里选「最小化到托盘」时调它。⚠️ 它做的其实是 `hide()` 不是 `minimize()`
/// —— 这才是「托盘图标还在、程序继续接收文件」的那个效果；`minimize()` 会把窗口
/// 留在任务栏上，那是另一回事（设计稿按钮文案叫「最小化到托盘」，沿用它的说法）。
///
/// 顺带把本次退出请求作废（与 `cancel_exit` 完全一样地复位那两个标志）：
/// 用户既然选择留下，后端那道兜底超时就不能再算数，否则 30 秒后照样把应用关掉。
/// 两件事必须一起做 —— 只复位不隐藏，窗口会停在「点了关闭却还在」的怪状态。
#[tauri::command]
pub fn minimize_to_tray(app: AppHandle, state: tauri::State<'_, SharedExitState>) {
    state.cancelled.store(true, Ordering::SeqCst);
    state.asking.store(false, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    println!("[exit] 已最小化到托盘，继续在后台运行");
}

/// 前端确认退出：断开所有连接后退出进程
#[tauri::command]
pub async fn quit_app(
    app: AppHandle,
    state: tauri::State<'_, SharedExitState>,
) -> Result<(), String> {
    // 先置位再动手：期间若有别的退出请求进来（例如用户连点两次关闭），
    // 会在 intercept_exit 里被直接放行，不会并发跑两遍善后
    state.exiting.store(true, Ordering::SeqCst);
    shutdown(&app).await;
    app.exit(0);
    Ok(())
}

/// 退出前的实际收尾
///
/// 顺序是有讲究的：
///   1. **先中断进行中的传输** —— 它的发送循环会在下一个分块处退出，之后不再
///      和下面的断开通知抢同一条链路；
///   2. **再通知活跃对端**「我走了」，让对方立刻回首页，而不是等它自己超时；
///   3. **最后停接收服务并注销 mDNS**，让本机从别人的设备列表里消失。
async fn shutdown(app: &AppHandle) {
    let registry = app.state::<SharedTaskRegistry>().inner().clone();
    cancel_all_tasks(&registry).await;

    let peers = app.state::<SharedPeers>().inner().clone();
    let discovery = app.state::<SharedDiscoveryState>().inner().clone();
    let trust = app.state::<SharedTrustState>().inner().clone();
    let identity = app.state::<Arc<DeviceIdentity>>().inner().clone();
    disconnect_all_peers(app, &peers, &discovery, &trust, &identity).await;

    // server 没启动时 stop_server_inner 会返回 Err，那是正常情况（比如启动失败过），
    // 不该阻断退出
    let server = app.state::<Arc<Mutex<ServerState>>>().inner().clone();
    let _ = stop_server_inner(&server, &discovery).await;

    println!("[exit] 已断开所有连接");
}
