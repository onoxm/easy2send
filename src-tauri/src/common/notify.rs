use notify_rust::{Notification, NotificationResponse};
use tauri::{AppHandle, Emitter};

use super::main_window::show_main_window;

/// 用户点击系统通知本体时向前端广播的事件名。
///
/// 前端用 `listen('notification-clicked', ...)` 接，比如收到后刷新任务列表。
pub const NOTIFICATION_CLICKED_EVENT: &str = "notification-clicked";

/// 发送系统通知，并在用户点击通知本体时把主窗口拉回前台。
///
/// 为什么不用前端的 `sendNotification`：Tauri 的 notification 插件只在**移动端**上报
/// 点击事件（官方文档把 Actions 标为 Mobile Only），桌面端 `desktop.rs` 里连 `emit`
/// 都没有，`onAction` 注册了也永远等不到回调。而点击回调必须在**创建通知时**就挂上，
/// 所以只能由 Rust 侧自己发。
#[tauri::command]
pub fn send_notification(app: AppHandle, title: String, body: Option<String>) {
    let app_for_main = app.clone();

    // 必须在主线程创建：WinRT 的 Toast 依赖已初始化的 COM 公寓，而主线程是唯一
    // 保证初始化过的线程（WebView2 的硬性要求）。官方插件里的 Win7 通知实现
    // 同样用 `run_on_main_thread`。（闭包里不能阻塞，否则会卡住 Tauri 事件循环。）
    let _ = app.run_on_main_thread(move || {
        let mut notification = Notification::new();
        notification.summary(&title);
        if let Some(body) = body.as_deref() {
            notification.body(body);
        }
        notification.auto_icon();

        #[cfg(target_os = "windows")]
        set_app_id(&mut notification, &app_for_main);

        match notification.show() {
            Ok(handle) => {
                // `show()` 只是把通知交给系统，得到点击结果要等用户操作。
                // `wait_for_response` 是阻塞调用，单独开线程等，别占住 Tauri 的运行时线程。
                let app_for_click = app_for_main.clone();
                std::thread::spawn(move || {
                    // 参数类型必须显式写成引用：不写时闭包会被推断成按值接收，
                    // 与 ResponseHandler 要求的 `FnOnce(&NotificationResponse)` 对不上
                    let _ = handle.wait_for_response(|response: &NotificationResponse| {
                        // 只有 Default 是「点了通知本体」。Closed(_) 是被划掉或超时，
                        // 那种情况下把窗口弹出来是骚扰，直接忽略。
                        //
                        // 注意别改用 `wait_for_action`：它把 Default 和 Closed 一起
                        // 归成 "__closed"，根本分不出「点击」和「关闭」。
                        if matches!(response, NotificationResponse::Default) {
                            show_main_window(&app_for_click);
                            let _ = app_for_click.emit(NOTIFICATION_CLICKED_EVENT, ());
                        }
                    });
                });
            }
            Err(err) => eprintln!("发送系统通知失败: {err}"),
        }
    });
}

/// Windows 需要显式设置 AppUserModelID，否则通知会顶着 PowerShell 的名字和图标出现。
#[cfg(target_os = "windows")]
fn set_app_id(notification: &mut Notification, app: &AppHandle) {
    // 开发态 exe 跑在 target/debug|release 下，此时这个 AUMID 还没注册进系统，
    // 设了反而容易导致通知发不出来 —— 与官方插件的判断保持一致，只在安装版设置。
    if !running_from_target_dir() {
        notification.app_id(&app.config().identifier);
    }
}

/// 判断当前是否跑在 `target/debug` / `target/release` 下（即 `tauri dev` / 本地构建）。
#[cfg(target_os = "windows")]
fn running_from_target_dir() -> bool {
    use std::path::Path;

    let Some(profile_dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    else {
        return false;
    };

    let is_profile_dir = matches!(
        profile_dir.file_name().and_then(|name| name.to_str()),
        Some("debug") | Some("release")
    );
    let under_target = profile_dir
        .parent()
        .and_then(|dir| dir.file_name())
        .and_then(|name| name.to_str())
        == Some("target");

    // 两个条件都要满足，避免误判名字刚好叫 debug/release 的目录
    is_profile_dir && under_target
}
