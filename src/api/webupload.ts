import { invoke } from '@tauri-apps/api/core'

/**
 * 启动手机上传 HTTP 服务器（按需启动，用户点击扫码弹窗时调用）
 *
 * 绑定具体本机 IP（非 0.0.0.0）以触发 Windows 防火墙放行弹窗。
 * 端口由后端在 8000-9000 范围内分配，返回实际监听端口供生成二维码。
 *
 * save_dir 与 TCP server 一致，从前端 store.savePath 传入。
 */
export const startWebUpload = (ip: string, saveDir: string) =>
  invoke<number>('start_web_upload', { ip, saveDir })

/** 停止手机上传 HTTP 服务器（幂等，关闭弹窗时调用） */
export const stopWebUpload = () => invoke<void>('stop_web_upload')

/** 生成配对 token（一次性，5 分钟有效，拼入二维码 URL） */
export const createPairToken = () => invoke<string>('create_pair_token')
