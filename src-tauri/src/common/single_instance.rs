//! 单实例兜底守卫
//!
//! `tauri-plugin-single-instance` 负责主路径：第二个进程在插件 setup 阶段就 `exit(0)`，
//! 并把已有实例的窗口拉回前台。但它判断「自己是不是第一个实例」用的是**命名互斥体 +
//! 找窗口**，这条判据有两处会漏：
//!
//! 1. 互斥体已存在时，它还要用 `FindWindowW` 找到已有实例那个隐藏的接收窗口才会退出；
//!    窗口尚未创建就什么都不做、直接放行 —— 而且该进程自己也不注册互斥体，
//!    于是它之后的实例连它都拦不住。
//! 2. `CreateMutexW` 因安全描述符被拒时（一边以管理员启动、一边普通权限），
//!    `GetLastError` 不是 `ERROR_ALREADY_EXISTS`，插件会把自己误判成第一个实例。
//!
//! 两条都源于「用一个可能失效的信号判断自己是不是第一个」。这里用**文件锁**再拦一道，
//! 它不依赖窗口是否存在、也不受完整性级别影响：拿不到锁就说明已有实例在跑。
//! 进程退出（含被强制结束）时锁由内核释放，所以不会留下
//! 「锁文件残留、应用再也打不开」的坑。
//!
//! 正常情况走不到这里 —— 第二个进程在插件那一层就退出了。

use std::fs::{File, OpenOptions, TryLockError};
use std::path::Path;
use tauri::{AppHandle, Manager};

/// 只需持有到进程结束，锁由内核在进程退出时释放，这里不主动 unlock。
pub struct SingleInstanceGuard {
    _file: File,
}

/// 取锁结果
pub enum SingleInstance {
    /// 本进程是唯一实例。`guard` 必须活到进程结束（由调用方 `manage` 住）。
    Acquired(SingleInstanceGuard),
    /// 已有实例在运行 —— 调用方应退出。
    AlreadyRunning,
    /// 守卫本身不可用（定位不到数据目录、目录不可写、文件系统不支持锁…）。
    ///
    /// 调用方**应当放行**：宁可多开一个，也不能因为一道兜底守卫自己坏了就让应用起不来。
    Unavailable,
}

/// 尝试取得单实例锁（见模块说明）
pub fn acquire(app: &AppHandle) -> SingleInstance {
    let Ok(dir) = app.path().app_data_dir() else {
        return SingleInstance::Unavailable;
    };
    acquire_in(&dir)
}

/// 锁的实现本体。与 Tauri 解耦（只吃一个目录），这样单测能直接喂临时目录自证。
///
/// ⚠️ 同一进程内对同一个文件再取一次锁**同样会被拒** —— 锁是按句柄算的，不是按进程。
/// 本文件末尾的测试正是靠这一点来验证「第二个实例会被拦下」。
fn acquire_in(dir: &Path) -> SingleInstance {
    if std::fs::create_dir_all(dir).is_err() {
        return SingleInstance::Unavailable;
    }

    // 显式写 truncate(false)：只是借这个文件当锁，不能截断 —— 否则每次启动都改写它
    // （虽然无害但没必要）。clippy 的 suspicious_open_options 也要求显式表态。
    let file = match OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(dir.join("instance.lock"))
    {
        Ok(f) => f,
        Err(_) => return SingleInstance::Unavailable,
    };

    match file.try_lock() {
        Ok(()) => SingleInstance::Acquired(SingleInstanceGuard { _file: file }),
        // 锁已被别的进程持有 = 已有实例在跑
        Err(TryLockError::WouldBlock) => SingleInstance::AlreadyRunning,
        // 其他错误（例如文件系统根本不支持锁）：放行，理由见枚举说明
        Err(TryLockError::Error(_)) => SingleInstance::Unavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// 每个用例一个独立目录：锁是按文件算的，共用目录会让用例互相干扰
    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("easy2send-si-{}", tag));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    /// 「禁止多开」这条能力的可自证部分。
    ///
    /// GUI 层面的「开第二个进程会被拦下」在这里测不了（要真的起两个实例），
    /// 但拦下它的**判据**就是这一条：锁被持有期间，再取一次必须拿不到。
    #[test]
    fn second_acquire_is_rejected_while_guard_is_alive() {
        let dir = scratch("basic");

        let first = acquire_in(&dir);
        assert!(
            matches!(first, SingleInstance::Acquired(_)),
            "首次取锁应当成功"
        );

        let second = acquire_in(&dir);
        assert!(
            matches!(second, SingleInstance::AlreadyRunning),
            "锁被占用时应当判定为「已有实例在运行」，否则第二个进程就会放行"
        );

        // 释放 = 已有实例退出，此后应当能重新取到（不能出现「退出了却再也打不开」）
        drop(first);
        let third = acquire_in(&dir);
        assert!(
            matches!(third, SingleInstance::Acquired(_)),
            "锁释放后应当能重新取到"
        );

        std::fs::remove_dir_all(&dir).ok();
    }
}
