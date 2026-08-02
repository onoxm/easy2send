use anyhow::{anyhow, Result};
use std::path::{Component, Path, PathBuf};

/// 单次读取/写入的缓冲区大小
pub const CHUNK_SIZE: usize = 1024 * 1024;

// ---------- 协议标识 ----------
/// 单文件模式（兼容旧版接收端）
pub const MODE_FILE: u8 = 0;
/// 文件夹模式
pub const MODE_FOLDER: u8 = 1;

// ---------- 条目类型（文件夹模式内） ----------
pub const ENTRY_FILE: u8 = 0;
pub const ENTRY_DIR: u8 = 1;

/// 安全路径拼接：规范化并确保结果仍位于 base 之内，防止路径遍历（../ 注入）
pub fn safe_join(base: &Path, rel: &str) -> Result<PathBuf> {
    // 统一用 normalize 折叠 .. 和 .，避免 canonicalize 在 Windows 上产生 \\?\ 前缀
    // 导致与候选路径前缀不一致
    let normalized_base = normalize(base);
    let normalized = normalize(&base.join(rel));
    if !normalized.starts_with(&normalized_base) {
        return Err(anyhow!("非法路径，已拒绝: {}", rel));
    }
    Ok(normalized)
}

/// 不依赖文件系统存在的路径规范化（折叠 .. 和 .）
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}
