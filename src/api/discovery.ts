import type { DeviceInfo, DiscoveryConfig } from "@/types/discovery";
import { invoke } from "@tauri-apps/api/core";

/** 启动设备发现（接收端注册服务+浏览；发送端 port 传 0 仅浏览） */
export const startDiscovery = (config: DiscoveryConfig) =>
  invoke<void>("start_discovery", { config });

/** 停止设备发现（幂等） */
export const stopDiscovery = () => invoke<void>("stop_discovery");

/** 查询当前已知设备列表（同步，不触发网络请求） */
export const listDevices = () => invoke<DeviceInfo[]>("list_devices");

/** 修改本机广播别名（运行时重新注册） */
export const setDeviceName = (name: string) =>
  invoke<void>("set_device_name", { name });

/** 读取或生成本机 device_id（首次生成后持久化） */
export const getDeviceId = () => invoke<string>("get_device_id");

/** 检测 Easy2Send mDNS 防火墙规则是否存在（非 Windows 恒返回 true） */
export const checkFirewallRule = () => invoke<boolean>("check_firewall_rule");

/** 提权添加防火墙规则（Windows 下会弹 UAC 确认，非 Windows 直接返回） */
export const ensureFirewallRule = () => invoke<void>("ensure_firewall_rule");

/** 注销本机 mDNS 服务（不停 browse，接收端退出时调用） */
export const unregisterService = () => invoke<void>("unregister_service");

/**
 * 连接指定设备（发送握手）
 *
 * 从 discovery 设备表查找 device_id 对应的 ip:port →
 * TCP 连接对方 server → 发送 MODE_HANDSHAKE + 本机设备信息
 * 返回对端 DeviceInfo，前端存入 store 后跳转传输页
 */
export const connectDevice = (deviceId: string) =>
  invoke<DeviceInfo>("connect_device", { deviceId });
