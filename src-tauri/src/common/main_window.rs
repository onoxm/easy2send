use tauri::{AppHandle, Manager};

/// 把主窗口拉回前台：取消最小化 → 显示 → 聚焦。
///
/// 顺序不能换：对已最小化的窗口直接 `show()` 不会还原，必须 `unminimize()` 在前；
/// 少了 `set_focus()` 窗口虽然显示了但不会抢焦点，在托盘场景下用户会以为没反应。
///
/// 托盘双击、托盘「显示」菜单、通知点击三处都走这里。
pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
