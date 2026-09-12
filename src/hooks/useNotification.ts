import { invoke } from '@tauri-apps/api/core'
import { useCallback } from 'react'

/**
 * 发送系统通知，并让「点击通知 → 主窗口回到前台」生效。
 *
 * 走 Rust 命令而不是插件的 `sendNotification`：插件的点击事件（`onAction`）只在移动端
 * 上报，桌面端拿不到任何回调。而点击回调必须在创建通知时就挂上，所以改由 Rust 侧发送。
 *
 * 顺带去掉了原来的权限询问：桌面端 `isPermissionGranted` 恒为 true，
 * `requestPermission` 是个空实现，这段分支永远不会真正生效。
 */
export const useNotification = () => {
  // 必须用 useCallback 稳定引用：transfer.tsx 的 useEffect 依赖此函数，
  // 若每次渲染返回新引用，会导致事件监听器频繁重注册，完成事件在间隙丢失
  const innerSendNotification = useCallback(
    async (title: string, message?: string) => {
      // body 显式传 null：Tauri 把 null 反序列化成 None，缺键则可能被当成必填参数报错
      invoke('send_notification', { title, body: message ?? null })
      invoke('play_system_sound')
    },
    []
  )

  return innerSendNotification
}
