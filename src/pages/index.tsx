import { connectDevice } from '@/api/discovery'
import { createNewWindow } from '@/api/tauri'
import { ICON_INFO } from '@/common/common'
import { Layout } from '@/components'
import { useDevices } from '@/hooks'
import useStore from '@/store'
import { Apple, SettingTwo, TencentQq, Windows } from '@icon-park/react'
import { useState } from 'react'
import { useNavigate } from 'react-router'

/** 平台对应的展示图标（emoji 简化版） */
export const platformIcon = {
  windows: <Windows {...ICON_INFO} strokeWidth={2} />,
  macos: <Apple {...ICON_INFO} strokeWidth={2} />,
  linux: <TencentQq {...ICON_INFO} strokeWidth={2} />
}

export default () => {
  const { devices, refresh } = useDevices()
  const navigate = useNavigate()
  const deviceName = useStore('deviceName')
  const [connecting, setConnecting] = useState<string | null>(null)

  // 点击设备 → 发送握手 → 跳转传输页
  const handleConnect = async (deviceId: string) => {
    setConnecting(deviceId)
    try {
      const peer = await connectDevice(deviceId)
      useStore.setState({ connectedDevice: peer })
      navigate('/transfer')
    } catch (error) {
      alert(`连接失败: ${error}`)
    } finally {
      setConnecting(null)
    }
  }

  return (
    <Layout>
      <div className="flex flex-col gap-4 w-full flex-1 justify-center items-center relative p-6">
        {/* 设置按钮 */}
        <button
          className="little_btn absolute top-2 right-2"
          onClick={() => {
            createNewWindow('settings', {
              url: '/settings',
              width: 600,
              height: 500
            })
          }}
        >
          <SettingTwo {...ICON_INFO} />
        </button>

        {/* 标题 */}
        <div className="text-center">
          <h2 className="text-xl font-bold mb-1">Easy2Send</h2>
          <p className="text-sm text-gray-500">
            {deviceName || '...'} · 点击设备开始互传
          </p>
        </div>

        {/* 设备列表 */}
        <div className="w-full max-w-md">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-gray-600">
              在线设备（{devices.length}）
            </span>
            <button
              className="text-xs text-blue-500 hover:underline cursor-pointer"
              onClick={refresh}
            >
              刷新
            </button>
          </div>

          {devices.length === 0 ? (
            <div className="text-center text-gray-400 py-8 border border-dashed rounded-md">
              暂无在线设备，请确认其他设备已启动 Easy2Send
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {devices.map(d => (
                <button
                  key={d.deviceId}
                  className="flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-colors hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50"
                  onClick={() => handleConnect(d.deviceId)}
                  disabled={connecting !== null}
                >
                  <span className="text-2xl">{platformIcon[d.platform]}</span>
                  <div className="flex-1 text-left">
                    <div className="font-medium">{d.deviceName}</div>
                    <div className="text-xs text-gray-500">
                      {d.ip}:{d.port} · {d.platform} · v{d.version}
                    </div>
                  </div>
                  {connecting === d.deviceId && (
                    <span className="text-xs text-blue-500">连接中...</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
