import { invoke } from '@tauri-apps/api/core'

/**
 * 用户放弃退出：作废后端本次退出请求的兜底，应用继续运行。
 *
 * 后端拦住关闭 / 退出请求后会等前端回话（见后端 common/exit.rs）。用户点了
 * 「取消」必须回来说一声 —— 否则后端那道兜底还在跑，30 秒后照样把应用关掉。
 */
export const cancelExit = () => invoke<void>('cancel_exit')

/**
 * 确认退出：先断开所有连接（中断传输 + 通知对端 + 停接收服务），再退出进程。
 *
 * ⚠️ 调用之后进程随时会消失，不要在这个 promise 后面再写东西。
 */
export const quitApp = () => invoke<void>('quit_app')

/**
 * 最小化到托盘：收起主窗口，应用留在后台继续接收文件。
 *
 * 关窗确认里选「最小化到托盘」时调它。它同时在后台作废本次退出请求 ——
 * 用户既然选择留下，那道兜底超时就该失效（见后端 common/exit.rs）。
 */
export const minimizeToTray = () => invoke<void>('minimize_to_tray')

/**
 * 把主窗口拉回前台（取消最小化 + 显示 + 聚焦）。
 *
 * 弹确认框之前调：窗口可能被最小化了，或已经从托盘收起来，那样弹窗用户根本
 * 看不见，而后端那道兜底超时照样会走完、把应用关掉。
 */
export const showWindow = () => invoke<void>('show_window')
