import { startDiscovery } from '@/api/discovery'
import { useIP, usePort } from '@/hooks'
import { useCheckUpdate } from '@/hooks/useCheckUpdate'
import { useConfig } from '@/hooks/useConfig'
import useStore from '@/store'
import type { DeviceInfo } from '@/types/discovery'
import { getPlatform } from '@/types/discovery'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useRef } from 'react'
import { Outlet, useNavigate } from 'react-router'

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

  // 对等模式：应用启动即启动 TCP server + 注册 mDNS 服务（port > 0）
  // 所有设备既是发送端也是接收端，可被其他设备发现和连接
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    const ready = ip && port && savePath && deviceName && version
    if (!ready) return
    started.current = true

    let cancelled = false

    const start = async () => {
      try {
        // 1. 启动 TCP 接收服务器
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
  }, [ip, port, savePath, deviceName, version])

  // 监听对端握手：收到 incoming-connection → 存入 store → 跳转传输页
  useEffect(() => {
    const unlisten = listen<DeviceInfo>('incoming-connection', event => {
      const peer = event.payload
      console.log('[root] 收到握手:', peer.deviceName)
      useStore.setState({ connectedDevice: peer })
      navigate('/transfer')
    })

    return () => {
      unlisten.then(fn => fn())
    }
  }, [navigate])

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
    </main>
  )
}
