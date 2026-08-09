use std::{env::consts, path::Path, process::Command};
use tauri::command;

/// 打开文件或文件夹
///
/// - 文件夹：用文件管理器打开（Windows: explorer，macOS: open，Linux: xdg-open）
/// - 文件：用系统默认关联程序打开（Windows: cmd /c start，macOS: open，Linux: xdg-open）
///
/// Windows 上 explorer 打开文件时行为不稳定（可能弹"找不到应用程序"），
/// 因此文件改用 `cmd /c start` 走默认关联程序。
#[command]
pub fn open_file(path: String) {
    let platform = consts::OS;
    let is_dir = Path::new(&path).is_dir();

    let result = match (platform, is_dir) {
        ("windows", true) => Command::new("explorer").arg(&path).spawn(),
        ("windows", false) => Command::new("cmd")
            .args(["/c", "start", "", &path])
            .spawn(),
        ("macos", _) => Command::new("open").arg(&path).spawn(),
        ("linux", _) => Command::new("xdg-open").arg(&path).spawn(),
        _ => {
            eprintln!("Unsupported platform: {}", platform);
            return;
        }
    };

    match result {
        Ok(child) => {
            println!("文件/文件夹已尝试打开: {}", path);
            drop(child);
        }
        Err(e) => {
            eprintln!("启动命令失败: {}", e);
        }
    }
}
