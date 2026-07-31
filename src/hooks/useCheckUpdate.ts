import { isUpdateDismissed } from '@/api/tauri'
import { updateDialog } from '@/components'
import useStore from '@/store'
import { check } from '@tauri-apps/plugin-updater'
import { useEffect } from 'react'

export const useCheckUpdate = () => {
  const autoCheckUpdate = useStore('autoCheckUpdate')

  useEffect(() => {
    async function checkForUpdates() {
      try {
        const update = await check()
        if (update) {
          // 本次启动期间已取消过更新，则不再弹窗
          if (await isUpdateDismissed()) {
            update.close()
            return
          }
          updateDialog(callback => callback(update))
        } else {
          console.log('当前已是最新版本。')
        }
      } catch (error) {
        console.error('检查更新失败:', error)
      }
    }

    if (autoCheckUpdate) checkForUpdates()
  }, [autoCheckUpdate])
}
