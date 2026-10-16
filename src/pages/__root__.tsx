import { cancelExit, minimizeToTray, quitApp, showWindow } from '@/api/app'
import { respondConnection, startDiscovery } from '@/api/discovery'
import {
  closeConfirmDialog,
  confirmDialog,
  connectionRequestDialog,
  innerToast
} from '@/components'
import {
  useCheckUpdate,
  useFont,
  useIP,
  usePort,
  useTauriListeners
} from '@/hooks'
import { useConfig } from '@/hooks/useConfig'
import { useStore } from '@/store'
import type { DeviceInfo } from '@/types/discovery'
import { getPlatform } from '@/types/discovery'
import { invoke } from '@tauri-apps/api/core'
import { Event } from '@tauri-apps/api/event'
import { useEffect, useRef } from 'react'
import { Outlet, useNavigate } from 'react-router'

/**
 * 真要退出了：有任务没传完就先确认一次，再走善后
 *
 * 中断会把正在传的文件留成半成品，值得让用户明确点一次；没有任务就直接退，
 * 不拿一句废话拦一道。窗口可能正收在托盘里，弹确认框之前先把它拉回前台 ——
 * 否则用户根本看不到，而后端那道兜底超时照样会把应用关掉。
 *
 * 定义在组件外：它只读 store 的即时快照、不依赖任何渲染期状态，
 * 放进组件里反而会被 useTauriListeners 的闭包钉在旧渲染上。
 */
const requestQuit = async (pending: number) => {
  if (pending === 0) {
    quitApp().catch(() => {})
    return
  }

  try {
    await showWindow()
  } catch {
    // 窗口没拉起来不该拦住退出决定，照样把确认框推出去
  }

  confirmDialog({
    title: '退出 Easy2Send',
    // 只有「真要退出」才会走到这里：最小化到托盘在调用处就 return 了 —— 程序没关、
    // 任务也没中断，那条路径上不存在代价，也就不该出现这条警示。
    warn: `还有 ${pending} 个任务未完成，退出后会被中断`,
    confirmText: '退出',
    danger: true,
    onConfirm: () => quitApp().catch(() => {}),
    // 用户选择留下：必须回后端一声，否则它那道兜底超时后照样会关掉应用
    onCancel: () => cancelExit().catch(() => {})
  })
}

export default () => {
  useConfig()

  // 界面字体与字号缩放：同样只落到 <html>（data-font-user + 两个自定义属性）
  useFont()

  useCheckUpdate()

  const { deviceName, version, savePath, connectedDevice } = useStore([
    'deviceName',
    'version',
    'savePath',
    'connectedDevice'
  ])
  // 只取 deviceId 单独当依赖：监听器要的只是「当前会话的对端是谁」这一个原始值，
  // 直接拿 connectedDevice 对象进 deps 会让每次渲染都重新注册一遍监听
  const peerDeviceId = connectedDevice?.deviceId ?? ''
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
        //
        // 返回值是**实际**监听的端口，未必等于上面探测出的 port：webview 重载后
        // 主进程的监听 socket 从未释放，重探必然落在一个更大的空闲端口上。
        // 以后端回报的为准去覆盖，否则界面会显示一个并没有在监听的端口号
        // （对端按它来连也会连不上）。
        const listenPort: number = await invoke('start_server', {
          addr: `${ip}:${port}`,
          saveDir: savePath
        })
        if (cancelled) return

        // 存入 store 供其他组件使用
        useStore.setState({ port: listenPort, serverPort: listenPort })

        // 2. 启动设备发现（port > 0 → 注册本机 mDNS 服务 + 浏览）
        // 同样广播实际端口：对端是拿 TXT 里的 port 来连的
        await startDiscovery({
          deviceName,
          port: listenPort,
          platform: getPlatform(),
          version
        })
        if (cancelled) return

        console.log(`[root] server + discovery 就绪: ${ip}:${listenPort}`)
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
      // 只有「尚未被信任」的设备才会走到这里；已信任设备由后端静默放行，
      // 走下面那个 'incoming-connection-trusted'（不弹窗、直接进传输页）。
      // 所以这一步不能直接跳转，要先让用户决定要不要接纳这台设备——
      // 确认一次之后它就进信任表，以后同一台设备连接不再打扰。
      'incoming-connection': (event: Event<DeviceInfo>) => {
        const peer = event.payload
        console.log('[root] 收到陌生设备的连接请求:', peer.deviceName)
        connectionRequestDialog({
          device: peer,
          onRespond: async (accepted, close) => {
            close()
            try {
              await respondConnection(peer.deviceId, accepted)
            } catch (e) {
              // 多半是对方已超时放弃，不必再打扰用户
              console.warn('[root] 提交连接决策失败:', e)
            }
            if (accepted) {
              useStore.setState({ connectedDevice: peer })
              navigate('/transfer')
            }
          }
        })
      },
      // 已信任设备连入：后端静默放行（不再询问用户），但**必须**通知本机前端 ——
      // 接收端「进传输页」同样靠事件驱动，少了这一步就会停在
      // 「对方已经进了传输页、本机还留在首页」的假状态里。
      // 这里不弹窗：用户此前已经确认过这台设备，再问一次只是打扰。
      'incoming-connection-trusted': (event: Event<DeviceInfo>) => {
        const peer = event.payload
        console.log('[root] 已信任设备连入:', peer.deviceName)
        useStore.setState({ connectedDevice: peer })
        navigate('/transfer')
      },
      // 对端主动断开：它那边已经结束会话回首页了，本机也必须跟着退出 ——
      // 否则会停在一个「显示已连接、其实对面早走了」的假状态里，
      // 用户接着发文件只会得到一句莫名其妙的连接失败。
      'peer-disconnected': (
        event: Event<{ device_id: string; device_name: string }>
      ) => {
        const { device_id, device_name } = event.payload
        // 只认当前会话的对端。列表里另一台设备断开，不该把正在进行的会话一起踢掉
        if (peerDeviceId !== device_id) return
        useStore.setState({ connectedDevice: null })
        navigate('/')
        // 页面会自己跳回首页，但不说明原因的话用户会以为自己点错了什么
        innerToast.warning(`${device_name || '对方'}已断开连接`)
      },
      // 退出请求：窗口关闭与托盘「退出」都被后端拦在这里，等本机回话
      // （见后端 common/exit.rs）。两条路要问的问题不一样，靠 payload.source 区分。
      'app-exit-requested': (
        event: Event<{ runningTasks?: number; source?: 'close' | 'quit' }>
      ) => {
        // 后端只报得出「正在跑的发送任务」；排队中的任务和接收方向的任务只记在
        // 本机（store.activeTaskCount 由传输页维护）。两边各持一半，取大者才是全貌。
        const pending = Math.max(
          useStore.getState().activeTaskCount,
          event.payload?.runningTasks ?? 0
        )

        // 托盘「退出」：用户在托盘里已经明确说了要退出，再问一遍「要不要最小化到
        // 托盘」是明知故问 —— 那个问题是关窗口才有的。只有「还有任务没传完」值得确认。
        if (event.payload?.source !== 'close') {
          requestQuit(pending)
          return
        }

        // 关窗口：勾过「记住我的选择」就照它办，不再打扰
        const remembered = useStore.getState().closeAction
        if (remembered === 'tray') {
          minimizeToTray().catch(() => {})
          return
        }
        if (remembered === 'quit') {
          requestQuit(pending)
          return
        }

        // 窗口可能是从托盘里被唤起的（点了 X 说明它可见，但最小化状态下同样收不到），
        // 先把它拉回前台再弹 —— 弹窗看不见，后端那道兜底超时就变成唯一的结局了
        showWindow().catch(() => {})
        closeConfirmDialog({
          onChoose: ({ action, remember }) => {
            if (remember) useStore.setState({ closeAction: action })
            if (action === 'tray') minimizeToTray().catch(() => {})
            else requestQuit(pending)
          },
          // ESC / 右上角 / 点遮罩：什么都没选，窗口保持原样。同样要回后端一声，
          // 否则兜底超时到了照样会把应用关掉
          onCancel: () => cancelExit().catch(() => {})
        })
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
      },
      // 托盘「关于」：Rust 侧已经把窗口拉回前台，这里只管把路由切到设置页。
      // 走 state 而不是查询参数，是为了让「人已经在设置页、又点了一次托盘」也能再滚到底
      // —— 每次 navigate 都会生成新的 location.key，设置页据此重跑滚动。
      'open-about': () => {
        navigate('/settings', { state: { scrollToAbout: true } })
      }
    },
    [navigate, peerDeviceId]
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
