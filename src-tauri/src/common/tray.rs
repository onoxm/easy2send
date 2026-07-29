use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    App, Manager,
};

pub fn create_tray(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    TrayIconBuilder::new()
        .menu(&Menu::with_items(
            app,
            &[
                &MenuItem::with_id(app, "show", "显示", true, None::<&str>).unwrap(),
                &MenuItem::with_id(app, "hide", "隐藏", true, None::<&str>).unwrap(),
                &MenuItem::with_id(app, "restart", "重启", true, None::<&str>).unwrap(),
                &MenuItem::with_id(app, "quit", "退出", true, None::<&str>).unwrap(),
            ],
        )?)
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => {
                // 在这个例子中，当点击托盘图标时，将展示并聚焦于主窗口
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {
                tray.set_show_menu_on_left_click(false).unwrap();
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "hide" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            "restart" => {
                app.restart();
            }
            "quit" => {
                app.exit(0);
            }
            _ => {
                println!("menu item {:?} not handled", event.id);
            }
        })
        .icon(app.default_window_icon().unwrap().clone())
        .build(app)?;
    Ok(())
}
