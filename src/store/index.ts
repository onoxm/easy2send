import type { DeviceInfo } from '@/types/discovery'
import { createStoreHook } from '@onoxm/zustand-tools'
import { selectProperties, type ThemeType } from 'ono-react-element'
import { create } from 'zustand'
import {
  createJSONStorage,
  devtools,
  persist,
  subscribeWithSelector
} from 'zustand/middleware'

const initialState = {
  theme: 'system' as ThemeType,
  ip: '',
  port: 0,
  savePath: '',
  version: '0.0.0',
  canUpdate: false,
  autoCheckUpdate: true,
  concurrentUploads: 2, // 同时并发传输的文件数（1-5）
  /* 界面字体与字号缩放（设置页 → 外观）。
   * fontFamily 存的是**可直接写进 CSS font-family 的候选名列表**（如
   * `"微软雅黑", "Microsoft YaHei"`），空串 = 跟随系统 —— 让 JS 在 <html> 上直接取用，
   * 不需要在应用根部再去查一遍字体列表（那份列表只在设置页里加载，根部拿不到）。
   * 用 '' 而不是 null 表示「未自选」：它会被原样塞进 font-family，类型越简单越好，
   * 省掉「null 漏进 CSS 变成 "null" 这个字符串」的可能。 */
  fontFamily: '',
  fontScale: 100, // 百分比，100 = 设计稿原值
  // 设备发现相关
  deviceName: '', // 本机广播别名，空则用默认值
  deviceId: '', // 本机 UUID（启动时由后端读取，不持久化）
  // 对等传输相关（不持久化，每次启动重新分配）
  serverPort: 0, // 本机 TCP 服务端口（应用启动时分配）
  connectedDevice: null as DeviceInfo | null, // 当前连接的对端设备
  // 手机扫码上传相关（不持久化）
  webPort: 0 // 手机上传 HTTP 服务器端口（按需启动时分配）
}

export type StateType = typeof initialState

const useStore = createStoreHook(
  create<StateType>()(
    devtools(
      subscribeWithSelector(
        persist(() => initialState, {
          name: 'ono-storage',
          partialize: state =>
            selectProperties(state, [
              'theme',
              'version',
              'savePath',
              'canUpdate',
              'deviceName',
              'autoCheckUpdate',
              'concurrentUploads',
              // 字体两项必须在这里登记，否则只是「改了当场生效、重启就忘」——
              // persist 的 partialize 是个白名单，漏登记不会报错，只会静默不存。
              'fontFamily',
              'fontScale'
            ]),
          storage: createJSONStorage(() => localStorage)
        })
      )
    )
  )
)

export default useStore
