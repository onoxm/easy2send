use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::OnceLock;
use tauri::command;

/// 一个可选的界面字体家族，直接喂给设置页的下拉框。
///
/// `Clone` 是因为缓存取出时要复制一份给调用方（`list_fonts` 返回的是值而不是引用，
/// 避免把 OnceLock 的生命周期泄漏到命令签名里）。
#[derive(Serialize, Clone)]
pub struct FontFamily {
    /// 展示名。中文用户看「微软雅黑」比看「Microsoft YaHei」直观，所以优先本地化名。
    pub label: String,
    /// 可直接写进 CSS `font-family` 的候选名 —— **本地化名与英文名都带上**。
    ///
    /// 各引擎解析本地化 family 名的能力不一致（Chromium 走 DirectWrite、WebKit 走
    /// CoreText、Linux 走 fontconfig）。只写一个的话，万一那个名字不被识别，结果就是
    /// 「选了字体但界面毫无变化」——静默失败，最难查。两个都写就稳。
    pub css: String,
}

/// 名字里含汉字 ⇒ 认为是中文本地化名。
///
/// 刻意不用 ttf-parser 的 `Language::Chinese_*` 常量去精确匹配：那要绑死一个
/// 上游常量名，而这里的意图只是「有中文名就显示中文名」，按形状判断更稳也更直白。
fn has_cjk(s: &str) -> bool {
    s.chars()
        .any(|c| matches!(c, '\u{3400}'..='\u{4dbf}' | '\u{4e00}'..='\u{9fff}'))
}

/// 枚举系统已安装的字体家族，供设置页的「界面字体」下拉框使用。
///
/// **为什么必须放在 Rust 侧**：WebView 出于指纹识别考虑不让网页枚举系统字体 ——
/// `document.fonts` 只含 @font-face 与已被用到的本地字体，不给全量列表；
/// `window.queryLocalFonts()`（Local Font Access API）只有 Chromium 系实现
/// （= Windows 的 WebView2），macOS 的 WKWebView 与 Linux 的 WebKitGTK 都没有。
/// 而且前端连「某个字体在不在」都判断不了：实测
/// `document.fonts.check('16px "不存在的字体"')` 会返回 `true`。
///
/// 去重按**家族**而不是 face：一个家族通常有 Regular / Bold / Italic 等多个 face，
/// 下拉框只需要家族。归一键用英文名（fontdb 已保证 `families[0]` 是 en-US），
/// 这样同一家族不会因本地化名的差异被拆成多条；而 fontdb 优先取 nameID 16
/// （Typographic Family），所以「Noto Sans SC Medium」这类带字重后缀的 legacy 名
/// 也不会分裂成独立条目。
///
/// 刻意**不**过滤符号字体（Webdings / Segoe UI Symbol 之类）：Windows 上要拿到
/// 「隐藏」标记得绕去读注册表，代价不小；这些条目在下拉框里靠搜索即可避开，
/// 而且误选了也不会出事 —— 它们没有汉字，汉字仍会落到我们保留的兜底栈上。
fn build_font_families() -> Vec<FontFamily> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();

    // BTreeMap 让输出天然按 key 有序，前端再排一次也不会出现随机顺序。
    let mut by_family: BTreeMap<String, Vec<String>> = BTreeMap::new();

    for face in db.faces() {
        // families 非空是 fontdb 的保证（parse_names 为空时会整个跳过该 face）。
        let Some((en, _)) = face.families.first() else {
            continue;
        };

        let names = by_family.entry(en.to_lowercase()).or_default();
        for (name, _) in &face.families {
            if !names.iter().any(|n| n == name) {
                names.push(name.clone());
            }
        }
    }

    by_family
        .into_values()
        .map(|names| FontFamily {
            label: names
                .iter()
                .find(|n| has_cjk(n))
                .unwrap_or(&names[0])
                .clone(),
            css: names
                .iter()
                .map(|n| format!("\"{n}\""))
                .collect::<Vec<_>>()
                .join(", "),
        })
        .collect()
}

/// 枚举一次就够：字体列表在应用生命周期内不会变（用户新装了字体要重开应用才生效，
/// 这个代价可以接受），而首次枚举要读上百个字体文件的 name 表 —— 实测本机 76 个家族
/// 约 0.4s。缓存住，设置页反复进出就是瞬时的。
fn system_font_families() -> &'static Vec<FontFamily> {
    static CACHE: OnceLock<Vec<FontFamily>> = OnceLock::new();
    CACHE.get_or_init(build_font_families)
}

/// 命令声明成 async：Tauri 会把 async 命令放到运行时线程池上执行，首次那 0.4s 的枚举
/// 就不会卡住主线程（**同步命令是在主线程上跑的**，会冻住窗口）。
#[command]
pub async fn list_fonts() -> Vec<FontFamily> {
    system_font_families().clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 冒烟检查：只断言「跑得通、返回的东西像样」，**不断言具体字体名** ——
    /// 那会依赖跑测试的机器上装了什么。想看实际列表用
    /// `cargo test --lib fonts -- --nocapture`。
    #[test]
    fn lists_system_fonts() {
        let fonts = system_font_families();

        assert!(!fonts.is_empty(), "系统字体列表不应为空");
        assert!(
            fonts.iter().all(|f| !f.css.is_empty() && !f.label.is_empty()),
            "每个家族都要有展示名与可用的 CSS 候选名"
        );

        println!("共 {} 个字体家族", fonts.len());
        for f in fonts.iter().take(5) {
            println!("  {} -> {}", f.label, f.css);
        }
        // 中文名优先这条落没落地：至少应该有一条展示名含汉字（雅黑/宋体等）
        println!(
            "展示名含汉字的条目: {}",
            fonts.iter().filter(|f| has_cjk(&f.label)).count()
        );

        // 缓存确实生效：第二次取到的应当是同一份地址
        assert!(std::ptr::eq(fonts, system_font_families()));
    }
}
