import { windowBasicOperation } from '@/api/tauri'
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
          updateDialog({
            handleUpdate: async () => {
              // ✅ 有更新对象即表示有新版本
              console.log(`发现新版本 ${update.version}! 正在下载...`)
              // 这里可以添加UI提示，如进度条
              await update.downloadAndInstall()
              console.log('更新安装完成，应用即将重启。')
              windowBasicOperation('main', 'restart')
            }
          })
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
