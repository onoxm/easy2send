import { invoke } from '@tauri-apps/api/core'
import {
  appDataDir,
  desktopDir,
  documentDir,
  downloadDir,
  resourceDir
} from '@tauri-apps/api/path'
import { relaunch } from '@tauri-apps/plugin-process'

// 重启应用（更新安装完成后、设置页的手动重启都走这里）
export const restartApp = () => relaunch()

export const basePath = {
  app: () => appDataDir(),
  desktop: () => desktopDir(),
  download: () => downloadDir(),
  document: () => documentDir(),
  resource: async (platform: string) => {
    const path = await resourceDir()
    const formatWindowsPath = (path: string) =>
      path.split('?')[1].split('').slice(1).join('')
    return platform === 'windows' ? formatWindowsPath(path) : path
  }
}

// 本次启动期间是否已取消过更新（会话级，重启后重置）
export const isUpdateDismissed = () => invoke<boolean>('is_update_dismissed')

export const setUpdateDismissed = () => invoke('set_update_dismissed')
