import type { DeviceInfo } from '@/types/discovery'
import { createStoreHook } from '@onoxm/zustand-tools'
import { selectProperties } from 'ono-react-element'
import { create } from 'zustand'
import {
  createJSONStorage,
  devtools,
  persist,
  subscribeWithSelector
} from 'zustand/middleware'

const initialState = {
  theme: 'light',
  ip: '',
  port: 0,
  savePath: '',
  version: '0.0.0',
  canUpdate: false,
  autoCheckUpdate: true,
  concurrentUploads: 2, // 同时并发传输的文件数（1-5）
  // 设备发现相关
  deviceName: '', // 本机广播别名，空则用默认值
  deviceId: '', // 本机 UUID（启动时由后端读取，不持久化）
  // 对等传输相关（不持久化，每次启动重新分配）
  serverPort: 0, // 本机 TCP 服务端口（应用启动时分配）
  connectedDevice: null as DeviceInfo | null // 当前连接的对端设备
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
              'version',
              'theme',
              'savePath',
              'canUpdate',
              'autoCheckUpdate',
              'deviceName',
              'concurrentUploads'
            ]),
          storage: createJSONStorage(() => localStorage)
        })
      )
    )
  )
)

export default useStore
