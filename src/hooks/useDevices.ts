import { listDevices } from '@/api/discovery'
import type { DeviceInfo } from '@/types/discovery'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useState } from 'react'

/**
 * 设备列表 hook（只读）
 *
 * 职责：订阅 `device-online` / `device-updated` / `device-offline` 事件，
 * 维护当前已知设备列表。**不负责** discovery 的启停——
 * discovery 生命周期由 receive 页管理（接收端启动时注册服务+浏览）。
 *
 * 使用方：send 页消费设备列表，点选目标设备后发起传输。
 */
export const useDevices = () => {
  const [devices, setDevices] = useState<DeviceInfo[]>([])

  useEffect(() => {
    // 新增或更新设备
    const upsert = (d: DeviceInfo) =>
      setDevices(prev => {
        const i = prev.findIndex(x => x.deviceId === d.deviceId)
        if (i === -1) return [...prev, d]
        const next = [...prev]
        next[i] = d
        return next
      })

    // 移除设备
    const remove = (id: string) =>
      setDevices(prev => prev.filter(x => x.deviceId !== id))

    // 订阅后端事件（事件是全局广播，即使 discovery 由 receive 页启动，send 页也能收到）
    const unlistens = [
      listen<DeviceInfo>('device-online', e => upsert(e.payload)),
      listen<DeviceInfo>('device-updated', e => upsert(e.payload)),
      listen<string>('device-offline', e => remove(e.payload))
    ]

    // 首次拉取当前已知设备（覆盖订阅前已在线的设备）
    listDevices()
      .then(setDevices)
      .catch(e => console.error('list_devices failed:', e))

    return () => {
      unlistens.forEach(u => u.then(fn => fn()))
    }
  }, [])

  /** 手动刷新设备列表 */
  const refresh = async () => {
    try {
      setDevices(await listDevices())
    } catch (e) {
      console.error('refresh failed:', e)
    }
  }

  return { devices, refresh }
}
