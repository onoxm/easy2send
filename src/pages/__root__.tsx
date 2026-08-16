import { startDiscovery } from '@/api/discovery'
import { useCheckUpdate, useIP, usePort, useTauriListeners } from '@/hooks'
import { useConfig } from '@/hooks/useConfig'
import useStore from '@/store'
import type { DeviceInfo } from '@/types/discovery'
import { getPlatform } from '@/types/discovery'
import { invoke } from '@tauri-apps/api/core'
import { Event } from '@tauri-apps/api/event'
import { useEffect, useRef } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'

export default () => {
  useConfig()

  useCheckUpdate()

  const { deviceName, version, savePath } = useStore([
    'deviceName',
    'version',
    'savePath'
  ])
  const ip = useIP()
  const port = usePort(ip)
  const navigate = useNavigate()
  const location = useLocation()

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
        location.pathname !== '/settings' && navigate('/transfer')
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
        location.pathname !== '/settings' && navigate('/transfer?tab=receive')
      }
    },
    [navigate, location.pathname]
  )

  useEffect(() => {
    useStore.setState({ ip, port })
  }, [ip, port])

  // useEffect(() => {
  //   document.documentElement.classList.remove('dark')
  //   document.documentElement.classList.add(theme)
  // }, [theme])

  return (
    <main
      className="w-screen h-screen flex flex-col"
      onContextMenu={e => e.preventDefault()}
    >
      <Outlet />
      <p className="text-center text-sm text-gray-500 mb-2">版本：{version}</p>
    </main>
  )
}
