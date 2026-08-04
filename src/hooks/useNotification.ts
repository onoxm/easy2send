import {
  isPermissionGranted,
  requestPermission,
  sendNotification
} from '@tauri-apps/plugin-notification'
import { useCallback } from 'react'

export const useNotification = () => {
  // 必须用 useCallback 稳定引用：transfer.tsx 的 useEffect 依赖此函数，
  // 若每次渲染返回新引用，会导致事件监听器频繁重注册，完成事件在间隙丢失
  const innerSendNotification = useCallback(
    async (title: string, message?: string) => {
      let permissionGranted = await isPermissionGranted()

      if (!permissionGranted) {
        const permission = await requestPermission()
        permissionGranted = permission === 'granted'
        sendNotification({ title, body: message })
        return
      }

      sendNotification({ title, body: message })
    },
    []
  )

  return innerSendNotification
}
