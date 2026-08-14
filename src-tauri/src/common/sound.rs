/// 播放系统提示音（传输完成时调用）
#[tauri::command]
pub fn play_system_sound() {
    #[cfg(target_os = "windows")]
    {
        // 直接通过 FFI 调用 user32.dll 的 MessageBeep，无需额外 crate 依赖。
        // user32 在 Windows 上由 Rust std 默认链接，可直接 extern 引用。
        extern "system" {
            fn MessageBeep(u_type: u32) -> i32;
        }
        const MB_ICONINFORMATION: u32 = 0x00000040;
        unsafe {
            MessageBeep(MB_ICONINFORMATION);
        }
    }
    // 非 Windows 平台暂无实现，静默返回
    #[cfg(not(target_os = "windows"))]
    {
        // 预留：后续可用其他平台的系统提示音 API 扩展
    }
}
