import { invoke } from '@tauri-apps/api/core'

/** 一个系统已安装的字体家族，字段含义见 src-tauri/src/common/fonts.rs */
export interface FontFamily {
  /** 展示名，优先中文本地化名（「微软雅黑」而不是「Microsoft YaHei」） */
  label: string
  /** 可直接写进 CSS font-family 的候选名列表（本地化名 + 英文名都带） */
  css: string
}

/**
 * 枚举系统已安装的字体家族。
 *
 * 这是**只有 Rust 侧拿得到**的数据：WebView 不让网页枚举系统字体，前端甚至判断不了
 * 「某个字体在不在」—— `document.fonts.check('16px "不存在的字体"')` 会返回 `true`（实测）。
 * 命令是 async 的，首次枚举（实测本机 76 个家族约 0.4s）不会卡住窗口，且结果在 Rust 侧
 * 有缓存，之后是瞬时的。
 */
export const listFonts = () => invoke<FontFamily[]>('list_fonts')
