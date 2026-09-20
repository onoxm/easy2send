import { startDiscovery } from '@/api/discovery'
import {
  useCheckUpdate,
  useFont,
  useIP,
  usePort,
  useTauriListeners,
  useTheme
} from '@/hooks'
import { useConfig } from '@/hooks/useConfig'
import useStore from '@/store'
import type { DeviceInfo } from '@/types/discovery'
import { getPlatform } from '@/types/discovery'
import { invoke } from '@tauri-apps/api/core'
import { Event } from '@tauri-apps/api/event'
import { useEffect, useRef } from 'react'
import { Outlet, useNavigate } from 'react-router'

export default () => {
  useConfig()

  // 主题三态：把 store 里的模式落到 <html> 的 dark 类，system 态下跟随系统变化
  useTheme()

  // 界面字体与字号缩放：同样只落到 <html>（data-font-user + 两个自定义属性）
  useFont()

  useCheckUpdate()

  const { deviceName, version, savePath } = useStore([
    'deviceName',
    'version',
    'savePath'
  ])
  const ip = useIP()
  const port = usePort(ip)
  const navigate = useNavigate()

  // 对等模式：应用启动即启动 TCP server + 注册 mDNS 服务（port > 0）
  // 所有设备既是发送端也是接收端，可被其他设备发现和连接
  //
  // deps 只用 [ready] 布尔值：version 等值会被 useConfig 异步写入，
  // 若 deps 列各原始值，其变化会触发 cleanup(stop_server) 后因 started.current
  // 已为 true 而直接 return，导致 server 被停后永不重启。
  const started = useRef(false)
  const ready = !!(ip && port && savePath && deviceName && version)

  useEffect(() => {
    if (!ready || started.current) return
    started.current = true

    let cancelled = false

    const start = async () => {
      try {
        // 1. 启动 TCP 接收服务器
        // 绑定具体本机 IP（非 0.0.0.0）：Windows 防火墙弹窗机制对具体 IP
        // 绑定的首次入站 SYN 会触发放行弹窗，0.0.0.0 可能不触发导致入站
        // TCP 被静默阻止 (os error 10060)。多网卡 IP 选错由 connect_device
        // 的多 IP 容错处理。
        await invoke('start_server', {
          addr: `${ip}:${port}`,
          saveDir: savePath
        })
        if (cancelled) return

        // 存入 store 供其他组件使用
        useStore.setState({ serverPort: port })

        // 2. 启动设备发现（port > 0 → 注册本机 mDNS 服务 + 浏览）
        await startDiscovery({
          deviceName,
          port,
          platform: getPlatform(),
          version
        })
        if (cancelled) return

        console.log(`[root] server + discovery 就绪: ${ip}:${port}`)
      } catch (error) {
        console.error('[root] 启动失败:', error)
      }
    }

    start()

    return () => {
      cancelled = true
      invoke('stop_server').catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  useTauriListeners(
    {
      'incoming-connection': (event: Event<DeviceInfo>) => {
        const peer = event.payload
        console.log('[root] 收到握手:', peer.deviceName)
        useStore.setState({ connectedDevice: peer })
        navigate('/transfer')
      },
      'web-upload-paired': () => {
        useStore.setState({
          connectedDevice: {
            deviceId: 'web-upload',
            deviceName: '网页上传',
            ip: '',
            port: 0,
            platform: 'web',
            version: '',
            https: false,
            lastSeen: Date.now()
          }
        })
        navigate('/transfer?tab=receive')
      }
    },
    [navigate]
  )

  useEffect(() => {
    useStore.setState({ ip, port })
  }, [ip, port])

  return (
    /* w-full 而不是 w-screen：w-screen 是 100vw，**包含纵向滚动条的宽度**。
       设置页内容超过窗口高度时文档出现滚动条，100vw 仍按 800 算、可用宽度只剩 785，
       于是横向也溢出一条 15px 的滚动条。用 100%（= 包含块的宽度，已扣掉滚动条）就不会。
       页面本来就不高、通常不滚动，所以这个问题只在设置页加长后才暴露出来。 */
    <main className="w-full h-screen" onContextMenu={e => e.preventDefault()}>
      <Outlet />
    </main>
  )
}
