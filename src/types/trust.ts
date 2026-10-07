/** 已信任设备（对应后端 trusted_devices.json 里的一条记录） */
export interface TrustedDevice {
  /** 设备唯一标识，即 mDNS 广播的 deviceId */
  deviceId: string
  /** 设备别名 */
  deviceName: string
  /**
   * 对端自签证书的 SHA-256 指纹（小写十六进制）
   *
   * 真正的身份凭据：deviceId 走 mDNS 明文广播、可被冒用，只能当标签用。
   * 升级前留下的旧记录没有这个字段（后端读出来是空串），会退化成「需要重新确认」。
   */
  fingerprint: string
  /** 首次确认信任的时间（Unix 毫秒） */
  firstSeen: number
  /** 最近一次通过校验的时间（Unix 毫秒） */
  lastSeen: number
}
