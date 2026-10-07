import type { TrustedDevice } from '@/types/trust'
import { invoke } from '@tauri-apps/api/core'

/** 已信任设备列表，按最近连接时间倒序 */
export const listTrustedDevices = () =>
  invoke<TrustedDevice[]>('list_trusted_devices')

/** 取消某台设备的信任。撤销后对方下次连接会重新弹窗确认（不是拉黑） */
export const revokeTrustedDevice = (deviceId: string) =>
  invoke<boolean>('revoke_trusted_device', { deviceId })
