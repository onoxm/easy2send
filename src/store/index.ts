import type { DeviceInfo } from '@/types/discovery'
import {
  defineGlobalState,
  persistMiddleware,
  type ThemeMode
} from 'ono-react-element'

/**
 * 点窗口关闭按钮时的行为
 *
 * - `ask`：每次弹窗问「关闭窗口后要做什么？」
 * - `tray`：直接最小化到托盘（程序留在后台继续接收文件）
 * - `quit`：直接退出软件
 *
 * 关窗弹窗里的「记住我的选择」写的就是它；设置页「关闭窗口时」是同一个值的
 * 另一处入口 —— 记住之后必须有个地方能改回来，否则等于把用户锁死在一次选择上。
 */
export type CloseAction = 'ask' | 'tray' | 'quit'

const initialState = {
  theme: 'system' as ThemeMode,
  ip: '',
  port: 0,
  savePath: '',
  version: '0.0.0',
  canUpdate: false,
  autoCheckUpdate: true,
  /* 任务传完时是否弹系统通知提醒（设置页 → 传输完成通知）。
   * 默认开启：传大文件时用户多半已经切走去干别的了，「传完了」这件事只有通知能告诉他。
   * 它连同提示音一起控制 —— 两者在这个场景里是同一个「提醒」，拆开只会让用户困惑。 */
  notifyOnComplete: true,
  concurrentUploads: 2, // 同时并发传输的文件数（1-5）
  /* 界面字体与字号缩放（设置页 → 外观）。
   * fontFamily 存的是**可直接写进 CSS font-family 的候选名列表**（如
   * `"微软雅黑", "Microsoft YaHei"`），空串 = 跟随系统 —— 让 JS 在 <html> 上直接取用，
   * 不需要在应用根部再去查一遍字体列表（那份列表只在设置页里加载，根部拿不到）。
   * 用 '' 而不是 null 表示「未自选」：它会被原样塞进 font-family，类型越简单越好，
   * 省掉「null 漏进 CSS 变成 "null" 这个字符串」的可能。 */
  fontFamily: '',
  fontScale: 100, // 百分比，100 = 设计稿原值
  /* 点窗口关闭按钮时的行为（见 CloseAction）。关窗弹窗里的「记住我的选择」
   * 与设置页「关闭窗口时」是同一个值的两处入口。默认每次询问 —— 替用户直接
   * 决定「最小化」或「退出」都太武断，尤其后者还会顺手断掉所有连接。 */
  closeAction: 'ask' as CloseAction,
  // 设备发现相关
  deviceName: '', // 本机广播别名，空则用默认值
  deviceId: '', // 本机 UUID（启动时由后端读取，不持久化）
  // 对等传输相关（不持久化，每次启动重新分配）
  serverPort: 0, // 本机 TCP 服务端口（应用启动时分配）
  connectedDevice: null as DeviceInfo | null, // 当前连接的对端设备
  /* 进行中的传输任务数（running + queued）。
   *
   * 由传输页写、由 __root__ 读 —— 退出拦截发生在根布局（它要监听窗口关闭 / 托盘
   * 退出），而任务列表只活在传输页的局部 state 里，根布局看不到。
   * 不持久化：它描述的是「此刻」。
   * ⚠️ 传输页卸载时后端可能仍有发送任务在跑（点「返回」不中断任务），
   * 所以根布局读它时要和后端报来的 runningTasks 取大者，见 __root__.tsx。 */
  activeTaskCount: 0,
  // 手机扫码上传相关（不持久化）
  webPort: 0 // 手机上传 HTTP 服务器端口（按需启动时分配）,
}

export const useStore = defineGlobalState(initialState, [
  persistMiddleware({
    name: 'easy2send',
    properties: [
      'theme',
      'version',
      'savePath',
      'canUpdate',
      'deviceName',
      'autoCheckUpdate',
      'notifyOnComplete',
      'concurrentUploads',
      'fontFamily',
      'fontScale',
      'closeAction'
    ]
  })
])
