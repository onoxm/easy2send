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

    // macOS：afplay 后台播放系统自带音效（Glass.aiff 清脆，适合完成提示）
    // spawn 不阻塞当前线程，fire-and-forget
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("afplay")
            .arg("/System/Library/Sounds/Glass.aiff")
            .spawn()
            .ok();
    }

    // Linux：paplay 播放 freedesktop 标准完成音效
    // 需要 sound-theme-freedesktop 包（多数发行版默认安装），缺失则静默返回
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("paplay")
            .arg("/usr/share/sounds/freedesktop/stereo/complete.oga")
            .spawn()
            .ok();
    }
}
