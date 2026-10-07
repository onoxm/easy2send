// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod common;
mod discovery;
mod fs;
mod tls;
mod transfer;
mod trust;
mod webupload;
use common::{
    fonts::list_fonts,
    hostname_ip::get_lan_ip,
    notify::send_notification,
    port::get_free_port,
    single_instance::{acquire as acquire_single_instance, SingleInstance},
    sound::play_system_sound,
    tray::create_tray,
    update_state::{is_update_dismissed, set_update_dismissed},
    version::get_version,
};
use discovery::{
    get_device_id, list_devices, set_device_name, start_discovery, stop_discovery,
    unregister_service, DiscoveryState, SharedDiscoveryState,
};
use fs::open::open_file;
use std::sync::Arc;
use tauri::Manager;
use tls::DeviceIdentity;
use tokio::sync::Mutex;
use transfer::{
    cancel_transfer_tasks, connect_by_addr, connect_device, create_transfer_tasks,
    new_task_registry, notify_disconnect, respond_connection, start_server, start_transfer_task,
    stop_server, ServerState,
};
use trust::{list_trusted_devices, revoke_trusted_device, SharedTrustState, TrustState};
use webupload::{
    create_pair_token, start_web_upload, stop_web_upload, WebUploadServerControl,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let server_state = Arc::new(Mutex::new(ServerState::default()));
    let discovery_state: SharedDiscoveryState = Arc::new(Mutex::new(DiscoveryState::default()));
    let webupload_state = Arc::new(Mutex::new(WebUploadServerControl::default()));
    tauri::Builder::default()
        .manage(server_state)
        .manage(discovery_state)
        .manage(webupload_state)
        // 进行中发送任务的中断登记表（传输页「断开连接」用它让后端真正停下）
        .manage(new_task_registry())
        // 单实例：第二个进程启动时被拦在这里并立刻退出，改为把已有实例的窗口拉回前台。
        // 注册顺序有讲究 —— 官方要求它是**第一个**插件，必须先于其它插件初始化，
        // 否则第二个实例可能已经建好自己的托盘 / 资源才被拦下。
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // 复用托盘双击 / 「显示」菜单 / 通知点击走的那套聚焦逻辑
            common::main_window::show_main_window(app);
        }))
        .setup(|app| {
            // 单实例兜底（判据的两处漏洞见 common/single_instance.rs）。
            // 放在所有副作用之前：托盘、TLS 证书都不该在第二个实例里被创建。
            match acquire_single_instance(app.handle()) {
                SingleInstance::Acquired(guard) => {
                    app.manage(guard);
                }
                // 走到这里说明插件那一层漏判了。静默退出，与插件行为一致 ——
                // 让用户看到「启动后没反应」，而不是一个崩溃弹窗。
                SingleInstance::AlreadyRunning => std::process::exit(0),
                // 守卫自己坏了就放行，不能因此让应用打不开
                SingleInstance::Unavailable => {}
            }

            create_tray(app)?;
            // 信任表在启动时读一次。文件缺失或损坏都按空表处理：最坏结果是
            // 已信任设备要重新确认一次，不会拦住启动，更不会误放行。
            let trust_state: SharedTrustState =
                Arc::new(Mutex::new(TrustState::load(app.handle())));
            app.manage(trust_state);

            // 本机加密身份（自签证书 + 私钥）：首次启动生成，之后一直复用。
            //
            // 传输链路两端都要它——服务端凭它向对方出示身份，客户端凭它接受对方校验。
            // 这里失败了就直接启动失败：没有身份意味着所有传输都退回明文，
            // 与其带着一个「以为已加密」的假象运行，不如起不来。
            let tls_dir = DeviceIdentity::default_dir(app.handle());
            let identity = Arc::new(
                DeviceIdentity::load_or_create(&tls_dir)
                    .map_err(|e| format!("初始化本机加密身份失败: {}", e))?,
            );
            println!("[tls] 本机证书指纹 {}", identity.fingerprint());
            app.manage(identity);
            Ok(())
        })
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_version,
            get_lan_ip,
            start_server,
            stop_server,
            create_transfer_tasks,
            start_transfer_task,
            // 中断进行中的发送任务 + 通知对端本机已断开（传输页「断开连接」）
            cancel_transfer_tasks,
            notify_disconnect,
            connect_device,
            connect_by_addr,
            // 提交「是否接受对方连接」的用户决策
            respond_connection,
            // 已信任设备管理（设置页「已信任设备」）
            list_trusted_devices,
            revoke_trusted_device,
            get_free_port,
            is_update_dismissed,
            set_update_dismissed,
            play_system_sound,
            // 系统通知（点击后把主窗口拉回前台）
            send_notification,
            open_file,
            // 设备发现（mDNS）
            start_discovery,
            stop_discovery,
            list_devices,
            set_device_name,
            get_device_id,
            // 注销本机服务（不停 browse）
            unregister_service,
            // 手机扫码上传（HTTP 服务器）
            start_web_upload,
            stop_web_upload,
            create_pair_token,
            // 系统字体枚举（设置页「界面字体」下拉框；WebView 自己拿不到这个列表）
            list_fonts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
