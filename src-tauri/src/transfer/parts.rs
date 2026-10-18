//! 未完成传输留下的临时文件（`.part`）的登记与清理
//!
//! ## 为什么是「登记表」而不是「扫目录里的 *.part 删掉」
//!
//! `.part` 是业界通用后缀 —— 浏览器、下载工具、命令行工具都会留下同名同后缀的
//! 半成品。递归扫描用户的下载目录、把同后缀文件全删掉，会顺手把别人的东西删了，
//! 而那是不可逆的。本程序没有资格判断「下载目录里这个 .part 是不是我写的」，
//! 所以这里只记录**本程序自己创建过**的路径，清理时逐条删，绝不按目录扫。
//!
//! ## 两级状态：active 与 stale
//!
//! - `active`：本次运行中已创建、尚未完成的临时文件。
//! - `stale`：上次运行遗留的路径（启动时从索引文件读入）。
//!
//! 清理**只碰 `stale`**。这条边界不只是分类方便，它保证了两件事：
//! 1. 运行中在设置页点「立即清理」时，正在写的 `.part` 不会被删（它在 `active` 里）；
//! 2. 进程被强杀时 `active` 留在索引文件里，下次启动自动变成 `stale` —— 那正是
//!    需要清理的那批文件。
//!
//! 索引文件写的是两组路径的并集：关掉清理选项时 `stale` 要留着（下次开启还能清），
//! 不能因为这次不清理就把它忘掉。

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

/// 索引文件名（存放在 app_data_dir 下）
const PART_INDEX_FILE: &str = "pending_parts.json";

pub type SharedPartTracker = Arc<Mutex<PartTracker>>;

#[derive(Default, serde::Serialize, serde::Deserialize)]
struct PartIndex {
    #[serde(default)]
    files: Vec<String>,
}

/// 一次清理的结果（设置页据此给出提示文案）
#[derive(Debug, Default, serde::Serialize)]
pub struct CleanReport {
    /// 已删除的个数
    pub removed: usize,
    /// 删不掉（被占用 / 无权限），留到下次再试
    pub failed: usize,
    /// 条目已失效（文件不在了，或不是普通文件），直接丢弃
    pub skipped: usize,
}

pub struct PartTracker {
    index_path: PathBuf,
    active: HashSet<PathBuf>,
    stale: Vec<PathBuf>,
}

impl PartTracker {
    pub fn load(app: &AppHandle) -> Self {
        let index_path = app
            .path()
            .app_data_dir()
            .map(|dir| dir.join(PART_INDEX_FILE))
            .unwrap_or_else(|_| PathBuf::from(PART_INDEX_FILE));

        // 读不出来（文件缺失 / 损坏）就当作「没有残留」：最坏结果是这次不清理，
        // 而不是拦住启动。上一份完整的索引还在盘上，下次仍可能读到。
        let stale = std::fs::read_to_string(&index_path)
            .ok()
            .and_then(|text| serde_json::from_str::<PartIndex>(&text).ok())
            .map(|index| index.files.into_iter().map(PathBuf::from).collect())
            .unwrap_or_default();

        Self {
            index_path,
            active: HashSet::new(),
            stale,
        }
    }

    /// 登记一个即将创建的 `.part`
    ///
    /// ⚠️ 必须在 `File::create` **之前**调用：两步之间若被强杀，盘上会多出一个
    /// 没人知道的半成品，清理时永远找不到它。
    pub fn register(&mut self, path: &Path) {
        let inserted = self.active.insert(path.to_path_buf());
        // 同一个路径可能同时在上次的残留名单里（上次传到一半、这次重传）。
        // 它现在归本次运行管，必须从 stale 摘掉 —— 否则运行中点「清理」会把
        // 正在写的文件删掉。这是本模块唯一会「误删活文件」的路径，别删这段。
        let was_stale = match self.stale.iter().position(|p| p == path) {
            Some(i) => {
                self.stale.remove(i);
                true
            }
            None => false,
        };
        if inserted || was_stale {
            self.save();
        }
    }

    /// 临时文件已改名成正式文件（或已放弃），从 active 摘掉
    pub fn finish(&mut self, path: &Path) {
        if self.active.remove(path) {
            self.save();
        }
    }

    /// 清理上次运行遗留的 `.part`
    pub fn clean_stale(&mut self) -> CleanReport {
        let mut report = CleanReport::default();
        let mut keep: Vec<PathBuf> = Vec::new();

        for path in std::mem::take(&mut self.stale) {
            // 索引是一份可被手工编辑的普通 JSON，加一道后缀校验：
            // 万一里面被写上别的路径（或我们自己写错过），也只会跳过、不会误删。
            if !is_part_file(&path) {
                report.skipped += 1;
                continue;
            }
            match std::fs::symlink_metadata(&path) {
                // 只删普通文件：目录、符号链接都不碰（链接可能指向别处）
                Ok(meta) if meta.is_file() => match std::fs::remove_file(&path) {
                    Ok(()) => report.removed += 1,
                    // 被别的程序占用 / 无权限：留在名单里，下次启动再试。
                    // 一次删不掉就永久忘掉它，会让「清理」变成「删一次就算」
                    Err(e) => {
                        eprintln!("[parts] 删除临时文件失败 {}: {}", path.display(), e);
                        report.failed += 1;
                        keep.push(path);
                    }
                },
                _ => report.skipped += 1,
            }
        }

        self.stale = keep;
        self.save();
        report
    }

    /// 把两组路径写回索引文件
    ///
    /// 用 std::fs 而不是 tokio::fs：文件只有几十字节，同步写完比在 async 函数里
    /// 多一次 await 更省事；**但调用方不能持锁跨越 await**（用 std Mutex 时）。
    fn save(&self) {
        let mut files: Vec<String> = self
            .active
            .iter()
            .chain(self.stale.iter())
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        // 排序 + 去重只为让文件内容稳定，人工打开时能看出改了什么
        files.sort();
        files.dedup();

        let Ok(json) = serde_json::to_string_pretty(&PartIndex { files }) else {
            return;
        };
        if let Some(dir) = self.index_path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        // 先写临时文件再改名：写到一半被强杀时，盘上那份索引仍然完整
        let tmp = self.index_path.with_extension("json.tmp");
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, &self.index_path);
        }
    }
}

/// 只认 `.part` 后缀（Windows 上大小写不敏感，这里统一按忽略大小写判）
fn is_part_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("part"))
        .unwrap_or(false)
}

/// 登记（供接收链路调用）
///
/// 索引写盘失败**不阻断传输** —— 清理是尽力而为的附带能力，不该因为一个 JSON
/// 没写成就让用户传不了文件。代价只是这次残留下次找不到，需要手动删。
pub fn register_part(app: &AppHandle, path: &Path) {
    if let Some(tracker) = app.try_state::<SharedPartTracker>() {
        if let Ok(mut t) = tracker.lock() {
            t.register(path);
        }
    }
}

/// 注销（改名成功后调用）
pub fn finish_part(app: &AppHandle, path: &Path) {
    if let Some(tracker) = app.try_state::<SharedPartTracker>() {
        if let Ok(mut t) = tracker.lock() {
            t.finish(path);
        }
    }
}

/// 清理上次运行遗留的 `.part`（设置页「清理未完成的文件」）
///
/// 只处理 `stale`，所以**在传输过程中调用也是安全的**：正在写的文件在 `active` 里。
#[tauri::command]
pub fn clean_part_files(
    tracker: tauri::State<'_, SharedPartTracker>,
) -> Result<CleanReport, String> {
    let mut t = tracker
        .lock()
        .map_err(|_| "临时文件索引状态异常，请重启应用".to_string())?;
    Ok(t.clean_stale())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 每个用例一个独立目录，避免并行跑测试时互相踩
    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "e2s-parts-{}-{}-{}",
            tag,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).expect("前置条件：临时目录应可创建");
        dir
    }

    fn tracker_with(index: PathBuf, stale: Vec<PathBuf>) -> PartTracker {
        PartTracker {
            index_path: index,
            active: HashSet::new(),
            stale,
        }
    }

    #[test]
    fn 只删_part_普通文件_别的条目只跳过() {
        let dir = temp_dir("clean");
        let index = dir.join("pending_parts.json");

        let part = dir.join("movie.mkv.part");
        std::fs::write(&part, b"half").unwrap();
        // 同目录下不是 .part 的文件：即便被写进索引也绝不能删
        let other = dir.join("notes.txt");
        std::fs::write(&other, b"keep me").unwrap();
        // 目录带 .part 后缀：不是普通文件，跳过
        let dir_part = dir.join("folder.part");
        std::fs::create_dir_all(&dir_part).unwrap();
        // 已经不存在的条目
        let gone = dir.join("gone.bin.part");

        let mut t = tracker_with(
            index,
            vec![part.clone(), other.clone(), dir_part.clone(), gone],
        );
        let report = t.clean_stale();

        assert_eq!(report.removed, 1, "只应删除那一个 .part 普通文件");
        assert_eq!(report.skipped, 3, "非 .part / 目录 / 已不存在都应跳过");
        assert_eq!(report.failed, 0);
        assert!(!part.exists());
        assert!(other.exists(), "非 .part 后缀的文件必须保留");
        assert!(dir_part.is_dir(), "目录不能被当成文件删掉");
        assert!(t.stale.is_empty(), "清理完 stale 应清空");
    }

    #[test]
    fn 重传同名文件时_该路径必须从残留名单里摘掉() {
        let dir = temp_dir("handover");
        let index = dir.join("pending_parts.json");
        let part = dir.join("a.zip.part");
        std::fs::write(&part, b"old").unwrap();

        // 上次的残留名单里有它，本次运行又开始重传同一个文件
        let mut t = tracker_with(index, vec![part.clone()]);
        t.register(&part);
        assert!(t.stale.is_empty(), "已接管的路径不能留在 stale 里");

        // 此时运行中触发清理，绝不能删掉正在写的文件
        let report = t.clean_stale();
        assert_eq!(report.removed, 0);
        assert!(part.exists(), "正在传输的 .part 不能被清理删掉");
    }

    #[test]
    fn 登记与注销都要落盘() {
        let dir = temp_dir("persist");
        let index = dir.join("pending_parts.json");
        let part = dir.join("x.bin.part");

        let mut t = tracker_with(index.clone(), Vec::new());
        t.register(&part);
        let text = std::fs::read_to_string(&index).unwrap();
        assert!(text.contains("x.bin.part"), "登记后索引文件应含该路径");

        t.finish(&part);
        let text = std::fs::read_to_string(&index).unwrap();
        assert!(!text.contains("x.bin.part"), "注销后索引文件不应再含它");
    }

    #[test]
    fn 后缀判定忽略大小写() {
        assert!(is_part_file(Path::new("C:/a/b.PART")));
        assert!(is_part_file(Path::new("C:/a/b.part")));
        assert!(!is_part_file(Path::new("C:/a/b.part.txt")));
        assert!(!is_part_file(Path::new("C:/a/part")));
    }
}
