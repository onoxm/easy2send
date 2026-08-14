/** 平台标识（与后端 TXT 记录 platform 字段对齐） */
export type Platform = 'windows' | 'macos' | 'linux' | 'web' | 'phone'

/** 发现模块对外暴露的设备信息（与后端 DeviceInfo 结构对齐） */
export interface DeviceInfo {
  /** 设备唯一标识（UUID v4） */
  deviceId: string
  /** 用户可见别名 */
  deviceName: string
  /** 设备 IP（与本机同网段者优先；connect_device 成功后为实际握手成功的 IP） */
  ip: string
  /** 设备所有可达 IPv4 地址（mDNS 注册的全部 IP，供连接失败时逐个尝试） */
  addresses?: string[]
  /** TCP 传输端口 */
  port: number
  /** 平台：windows / macos / linux */
  platform: Platform
  /** app 版本号 */
  version: string
  /** 是否启用 HTTPS（v1 恒 false） */
  https: boolean
  /** 最后一次收到该设备消息的 Unix 时间戳（毫秒） */
  lastSeen: number
}

/** 启动发现时的入参（与后端 DiscoveryConfig 对齐，camelCase） */
export interface DiscoveryConfig {
  /** 本机设备别名 */
  deviceName: string
  /** 本机 TCP 监听端口；接收端传实际端口，发送端传 0 表示仅浏览 */
  port: number
  /** 平台标识 */
  platform: Platform
  /** app 版本号 */
  version: string
}

/** 发现层状态 */
export type DiscoveryStatus = 'running' | 'stopped' | 'error'

/**
 * 检测当前平台（桌面应用 UA 真实，可直接用 navigator 判断）
 */
export function getPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('win')) return 'windows'
  if (ua.includes('mac')) return 'macos'
  return 'linux'
}
