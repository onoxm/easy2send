use std::{env::consts, process::Command};
use tauri::command;

#[command]
pub fn open_file(path: String) {
    let platform = consts::OS;
    let command_name = match platform {
        "windows" => "explorer",
        "macos" => "open",
        "linux" => "xdg-open",
        _ => panic!("Unsupported platform: {}", platform),
    };

    let result = Command::new(command_name).arg(path).spawn(); // 启动进程，不等待退出

    match result {
        Ok(child) => {
            // 可以选择等待（但退出码不靠谱），或直接认为启动成功
            println!("文件/文件夹已尝试打开");
            // 如果需要清理子进程，可以 drop(child) 或 wait() 等待退出
            drop(child);
        }
        Err(e) => {
            eprintln!("启动命令失败: {}", e);
        }
    }
}
