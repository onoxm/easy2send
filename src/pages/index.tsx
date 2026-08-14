import { connectByAddr, connectDevice } from '@/api/discovery'
import { createNewWindow } from '@/api/tauri'
import { createPairToken, startWebUpload, stopWebUpload } from '@/api/webupload'
import { ICON_INFO } from '@/common/common'
import { qrUploadDialog } from '@/components'
import { useDevices } from '@/hooks'
import useStore from '@/store'
import {
  Apple,
  Down,
  Info,
  Phone,
  SettingTwo,
  TencentQq,
  Sphere,
  Windows
} from '@icon-park/react'
import { chainClassNames, Popover, toast } from 'ono-react-element'
import { useState } from 'react'
import { useNavigate } from 'react-router'

/** 平台对应的展示图标（emoji 简化版） */
export const platformIcon = {
  windows: <Windows {...ICON_INFO} strokeWidth={2} />,
  macos: <Apple {...ICON_INFO} strokeWidth={2} />,
  linux: <TencentQq {...ICON_INFO} strokeWidth={2} />,
  phone: <Phone {...ICON_INFO} strokeWidth={2} />,
  web: <Sphere {...ICON_INFO} strokeWidth={2} />
}

export default () => {
  const { devices, refresh } = useDevices()
  const { deviceName, ip, port, savePath } = useStore([
    'deviceName',
    'ip',
    'port',
    'savePath'
  ])
  // const { deviceName, theme } = useStore(["deviceName", "theme"]);
  const [connecting, setConnecting] = useState<string | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualAddr, setManualAddr] = useState('')
  const navigate = useNavigate()

  // const [, changeTheme] = useThemePro({
  //   initTheme: theme as 'light' | 'dark',
  //   themeRules: isDark => {
  //     const theme = isDark ? 'dark' : 'light'
  //     useStore.setState({ theme })
  //   }
  // })

  // const changeThemeIcon = () =>
  //   theme === 'light' ? <SunOne {...ICON_INFO} /> : <Moon {...ICON_INFO} />

  // 点击设备 → 发送握手 → 跳转传输页
  const handleConnect = async (deviceId: string) => {
    setConnecting(deviceId)
    try {
      const peer = await connectDevice(deviceId)
      useStore.setState({ connectedDevice: peer })
      navigate('/transfer')
    } catch (error) {
      toast.error(`连接失败: ${error}`)
    } finally {
      setConnecting(null)
    }
  }

  // 手动输入 IP:端口 连接（mDNS 发现不到对方时使用）
  const handleManualConnect = async () => {
    const addr = manualAddr.trim()
    if (!addr) return
    setConnecting('manual')
    try {
      const peer = await connectByAddr(addr)
      useStore.setState({ connectedDevice: peer })
      navigate('/transfer')
    } catch (error) {
      toast.error(`连接失败: ${error}`)
    } finally {
      setConnecting(null)
    }
  }

  // 手机上传：点击时启动 HTTP 服务器 + 生成 token + 打开二维码弹窗
  // 服务器在用户扫码配对后保持运行，退出传输页时才停止
  const handleWebUpload = async () => {
    try {
      if (!ip || !savePath) {
        toast.error('网络或保存路径未就绪，请稍后再试')
        return
      }
      const webPort = await startWebUpload(ip, savePath)
      const token = await createPairToken()
      const url = `http://${ip}:${webPort}/?token=${token}`
      qrUploadDialog({
        url,
        // 用户手动关闭弹窗且未配对时才停止服务器；
        // 配对成功后弹窗自动关闭，服务器保持运行直到退出传输页
        onClose: () => stopWebUpload().catch(() => {})
      })
    } catch (e) {
      toast.error(`启动手机上传失败: ${e}`)
      stopWebUpload().catch(() => {})
    }
  }

  const btnList = [
    {
      text: '刷新',
      onClick: refresh
    },
    {
      text: '扫码连接',
      onClick: handleWebUpload
    },
    {
      text: '手动连接',
      onClick: () => setManualOpen(v => !v),
      icon: (
        <Down
          theme="outline"
          size="10"
          fill="#3b82f6"
          strokeWidth={3}
          className={`transition-transform ${manualOpen ? 'rotate-180' : ''}`}
        />
      )
    }
  ]

  return (
    <div className="flex flex-col gap-4 w-full flex-1 justify-center items-center relative p-6">
      <div className="flex items-center gap-2 absolute top-2 right-2">
        {/* <button
            className="little_btn"
            onClick={(e) =>
              changeTheme({
                targetTheme: theme === 'light' ? 'dark' : 'light',
                element: e.currentTarget
              })
            }
          >
            {changeThemeIcon()}
          </button> */}

        <button
          className="little_btn"
          onClick={() => {
            createNewWindow('settings', {
              title: 'Easy2Send设置',
              url: '/settings',
              width: 600,
              height: 500,
              minWidth: 500,
              minHeight: 400
            })
          }}
        >
          <SettingTwo {...ICON_INFO} />
        </button>
      </div>
      {/* 标题 */}
      <div className="text-center">
        <h2 className="text-xl font-bold mb-1">Easy2Send</h2>
        <div className="flex items-center gap-1">
          <p className="text-sm text-gray-500">
            {deviceName || '...'} · 点击设备开始互传
          </p>
          <Popover
            trigger="hover"
            placement="top-end"
            content={`当前地址: ${ip}:${port}`}
          >
            <button
              aria-label={`关于“当前地址”的说明`}
              className="text-gray-400 hover:text-gray-600 cursor-help"
            >
              <Info theme="outline" size="14" strokeWidth={2} />
            </button>
          </Popover>
        </div>
      </div>
      {/* 设备列表 */}
      <div className="w-full max-w-md">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-gray-600">
            在线设备（{devices.length}）
          </span>
          <div className="flex items-center gap-3">
            {btnList.map(({ text, icon, onClick }) => (
              <button
                key={text}
                className={chainClassNames(
                  'text-xs text-blue-500 hover:underline cursor-pointer',
                  icon ? 'flex items-center gap-0.5' : ''
                )}
                onClick={onClick}
              >
                {icon ? <span>{text}</span> : text}
                {icon}
              </button>
            ))}
          </div>
        </div>

        {manualOpen && (
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={manualAddr}
              onChange={e => setManualAddr(e.target.value)}
              placeholder="IP:端口 (如 192.168.1.9:8234)"
              className="flex-1 text-sm border border-gray-300 rounded-md px-2 py-1 outline-none focus:border-blue-400"
              onKeyDown={e => {
                if (e.key === 'Enter') handleManualConnect()
              }}
              disabled={connecting !== null}
            />
            <button
              className="text-xs bg-blue-500 text-white px-3 py-1 rounded-md hover:bg-blue-600 disabled:opacity-50"
              onClick={handleManualConnect}
              disabled={connecting !== null || !manualAddr.trim()}
            >
              {connecting === 'manual' ? '连接中...' : '连接'}
            </button>
          </div>
        )}

        {devices.length === 0 ? (
          <div className="text-center text-gray-400 py-8 border border-dashed rounded-md">
            暂无在线设备，请确认其他设备已启动 Easy2Send
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {devices.map(
              ({ deviceId, deviceName, ip, port, platform, version }) => (
                <button
                  key={deviceId}
                  className="flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-colors hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50"
                  onClick={() => handleConnect(deviceId)}
                  disabled={connecting !== null}
                >
                  <span className="text-2xl">{platformIcon[platform]}</span>
                  <div className="flex-1 text-left">
                    <div className="font-medium">{deviceName}</div>
                    <div className="text-xs text-gray-500">
                      {ip}:{port} · {platform} · v{version}
                    </div>
                  </div>
                  {connecting === deviceId && (
                    <span className="text-xs text-blue-500">连接中...</span>
                  )}
                </button>
              )
            )}
          </div>
        )}
      </div>
    </div>
  )
}
