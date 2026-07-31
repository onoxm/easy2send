use std::sync::atomic::{AtomicBool, Ordering};
use tauri::command;

// 本次启动期间的“已取消更新”标记，仅存在于内存中，重启后自动清除
static UPDATE_DISMISSED: AtomicBool = AtomicBool::new(false);

#[command]
pub fn is_update_dismissed() -> bool {
    UPDATE_DISMISSED.load(Ordering::SeqCst)
}

#[command]
pub fn set_update_dismissed() {
    UPDATE_DISMISSED.store(true, Ordering::SeqCst);
}
