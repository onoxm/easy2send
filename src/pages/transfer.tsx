import { Layout, ProgressBar } from '@/components'
import { useNotification } from '@/hooks'
import useStore from '@/store'
import { platformIcon } from '@/pages'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

export default () => {
  const connectedDevice = useStore('connectedDevice')
  const navigate = useNavigate()
  const sendNotification = useNotification()

  // 发送进度
  const [sendStatus, setSendStatus] = useState('就绪')
  const [sendProgress, setSendProgress] = useState(0)
  const [sendTransferred, setSendTransferred] = useState(0)
  const [sendTotal, setSendTotal] = useState(0)

  // 接收进度
  const [recvStatus, setRecvStatus] = useState('就绪')
  const [recvProgress, setRecvProgress] = useState(0)
  const [recvTransferred, setRecvTransferred] = useState(0)
  const [recvTotal, setRecvTotal] = useState(0)

  // 监听后端事件
  useEffect(() => {
    const unlistens = [
      // 发送事件
      listen('send-progress', event => {
        const [received, totalSize, percent] = event.payload as [
          number,
          number,
          number
        ]
        setSendProgress(percent)
        setSendTransferred(received)
        setSendTotal(totalSize)
        setSendStatus('发送中...')
      }),
      listen('send-complete', event => {
        setSendStatus(`✅ 发送完成: ${event.payload}`)
        setSendProgress(100)
        sendNotification('发送完成')
      }),
      // 接收事件
      listen('receive-progress', event => {
        const [received, totalSize, percent] = event.payload as [
          number,
          number,
          number
        ]
        setRecvProgress(percent)
        setRecvTransferred(received)
        setRecvTotal(totalSize)
        setRecvStatus('接收中...')
      }),
      listen('receive-complete', event => {
        setRecvStatus(`✅ 接收完成: ${event.payload}`)
        setRecvProgress(100)
        sendNotification('接收完成')
      })
    ]

    return () => {
      unlistens.forEach(u => u.then(fn => fn()))
    }
  }, [sendNotification])

  // 未连接设备时返回首页
  useEffect(() => {
    if (!connectedDevice) {
      navigate('/')
    }
  }, [connectedDevice, navigate])

  if (!connectedDevice) return null

  const addr = `${connectedDevice.ip}:${connectedDevice.port}`

  const sendFile = async () => {
    const picked = await open({
      multiple: false,
      title: '选择要发送的文件'
    })
    if (!picked || typeof picked !== 'string') return

    try {
      setSendStatus('正在发送文件...')
      setSendProgress(0)
      await invoke('send_file', { addr, filePath: picked })
    } catch (error) {
      setSendStatus(`❌ 发送失败: ${error}`)
    }
  }

  const sendFolder = async () => {
    const picked = await open({
      multiple: false,
      directory: true,
      title: '选择要发送的文件夹'
    })
    if (!picked || typeof picked !== 'string') return

    try {
      setSendStatus('正在发送文件夹...')
      setSendProgress(0)
      await invoke('send_file', { addr, filePath: picked })
    } catch (error) {
      setSendStatus(`❌ 发送失败: ${error}`)
    }
  }

  const handleBack = () => {
    useStore.setState({ connectedDevice: null })
    navigate('/')
  }

  return (
    <Layout>
      <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
        {/* 顶部：返回 + 对端信息 */}
        <div className="flex justify-between items-center mb-4">
          <button
            className="bg-blue-500 text-white px-4 py-2 rounded-md cursor-pointer"
            onClick={handleBack}
          >
            返回首页
          </button>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span className="text-xl">
              {platformIcon[connectedDevice.platform]}
            </span>
            <span>
              {connectedDevice.deviceName} ({connectedDevice.ip}:
              {connectedDevice.port})
            </span>
          </div>
        </div>

        {/* 发送区 */}
        <div className="mb-6">
          <h3 className="mb-2">📤 发送文件</h3>
          <div className="flex gap-2 mb-3">
            <button
              className="bg-blue-500 text-white px-4 py-2 rounded-md cursor-pointer hover:bg-blue-600"
              onClick={sendFile}
            >
              📄 选择并发送文件
            </button>
            <button
              className="bg-blue-500 text-white px-4 py-2 rounded-md cursor-pointer hover:bg-blue-600"
              onClick={sendFolder}
            >
              📁 选择并发送文件夹
            </button>
          </div>
          <ProgressBar
            status={sendStatus}
            progress={sendProgress}
            transferred={sendTransferred}
            total={sendTotal}
          />
        </div>

        {/* 接收区 */}
        <div>
          <h3 className="mb-2">📥 接收文件</h3>
          <ProgressBar
            status={recvStatus}
            progress={recvProgress}
            transferred={recvTransferred}
            total={recvTotal}
          />
        </div>
      </div>
    </Layout>
  )
}
