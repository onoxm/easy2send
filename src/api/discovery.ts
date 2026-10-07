import type { DeviceInfo, DiscoveryConfig } from '@/types/discovery'
import { invoke } from '@tauri-apps/api/core'

/** 启动设备发现（接收端注册服务+浏览；发送端 port 传 0 仅浏览） */
export const startDiscovery = (config: DiscoveryConfig) =>
  invoke<void>('start_discovery', { config })

/** 查询当前已知设备列表（同步，不触发网络请求） */
export const listDevices = () => invoke<DeviceInfo[]>('list_devices')

/** 修改本机广播别名（运行时重新注册） */
export const setDeviceName = (name: string) =>
  invoke<void>('set_device_name', { name })

/** 读取或生成本机 device_id（首次生成后持久化） */
export const getDeviceId = () => invoke<string>('get_device_id')

/**
 * 连接指定设备（发送握手）
 *
 * 从 discovery 设备表查找 device_id 对应的 ip:port →
 * TCP 连接对方 server → 发送 MODE_HANDSHAKE + 本机设备信息
 * 返回对端 DeviceInfo，前端存入 store 后跳转传输页
 */
export const connectDevice = (deviceId: string) =>
  invoke<DeviceInfo>('connect_device', { deviceId })

/**
 * 手动连接指定地址（跳过 mDNS 发现表，直接 TCP 握手）
 *
 * mDNS 发现不到对方时（跨网段/VPN/多网卡选错）使用。
 * 流程：发送 MODE_HANDSHAKE → 成功后用 MODE_PING 拉取对端 deviceName →
 * 返回构造的 DeviceInfo（ip/port 从 addr 解析，deviceName 来自 PING）
 *
 * addr 格式：IP:端口（如 "192.168.1.9:8234"）
 */
export const connectByAddr = (addr: string) =>
  invoke<DeviceInfo>('connect_by_addr', { addr })

/**
 * 提交「是否接受对方连接」的决策
 *
 * 收到陌生设备的握手时后端会挂起等待，本命令把用户的选择回传过去。
 * 点「接受」后该设备会被记入信任表，之后同一台设备再连就静默通过、不再询问。
 */
export const respondConnection = (deviceId: string, accepted: boolean) =>
  invoke<void>('respond_connection', { deviceId, accepted })

/**
 * 通知对端本机已断开连接
 *
 * 传输页「断开连接」用它告诉对方也结束这次会话 —— 对方收到后会回到首页，
 * 不会停在一个「已连接、但对面早就走了」的假状态里。
 *
 * 后端对「通知送不出去」一律静默（对方可能已关机、已断网），
 * 所以这个调用不会因为对方不在而失败；本机该断还是断。
 * 手机网页上传端没有这条协议，调用方应跳过。
 */
export const notifyDisconnect = (addr: string) =>
  invoke<void>('notify_disconnect', { addr })
