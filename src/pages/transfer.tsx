import { sendFile } from '@/api/fs'
import { ICON_INFO } from '@/common/common'
import { Layout, ProgressBar, type DataInfo } from '@/components'
import { useNotification, useTauriDrag } from '@/hooks'
import { platformIcon } from '@/pages'
import useStore from '@/store'
import { Back, Receiver, Send } from '@icon-park/react'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

export type TransferType = 'send' | 'receive'

export default () => {
  const connectedDevice = useStore('connectedDevice')
  const navigate = useNavigate()
  const sendNotification = useNotification()

  const [type, setType] = useState<TransferType>('send')
  const [_ready2SendFiles, setReady2SendFiles] = useState<string[]>([])

  const typeBtnList = [
    {
      type: 'send',
      txt: '发送文件',
      icon: <Send {...ICON_INFO} fill="white" />
    },
    {
      type: 'receive',
      txt: '接收文件',
      icon: <Receiver {...ICON_INFO} fill="white" />
    }
  ] as const

  // 发送进度
  const [sendInfo, setSendInfo] = useState<DataInfo>({
    status: '就绪',
    progress: 0,
    transferred: 0,
    total: 0
  })
  const updateSendInfo = (info: Partial<DataInfo>) => {
    setSendInfo(prev => ({ ...prev, ...info }))
  }

  // 接收进度
  const [recvInfo, setRecvInfo] = useState<DataInfo>({
    status: '就绪',
    progress: 0,
    transferred: 0,
    total: 0
  })
  const updateRecvInfo = (info: Partial<DataInfo>) => {
    setRecvInfo(prev => ({ ...prev, ...info }))
  }

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
        updateSendInfo({
          status: '发送中...',
          progress: percent,
          transferred: received,
          total: totalSize
        })
      }),
      listen('send-complete', event => {
        updateSendInfo({
          status: `✅ 发送完成: ${event.payload}`,
          progress: 100
        })
        sendNotification('发送完成')
      }),
      // 接收事件
      listen('receive-start', event => {
        const { name, total_size } = event.payload as {
          name: string
          total_size: number
        }
        setType('receive')
        updateRecvInfo({
          status: `接收中: ${name}`,
          progress: 0,
          transferred: 0,
          total: total_size
        })
      }),
      listen('receive-progress', event => {
        const [received, totalSize, percent] = event.payload as [
          number,
          number,
          number
        ]
        updateRecvInfo({
          status: '接收中...',
          progress: percent,
          transferred: received,
          total: totalSize
        })
      }),
      listen('receive-complete', event => {
        updateRecvInfo({
          status: `✅ 接收完成: ${event.payload}`,
          progress: 100
        })
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

  const handleBack = () => {
    useStore.setState({ connectedDevice: null })
    navigate('/')
  }

  const handlerSendFile = async () => {
    const picked = await open({
      multiple: false,
      title: '选择要发送的文件'
    })
    if (!picked || typeof picked !== 'string') return

    sendFile(
      addr,
      picked,
      () =>
        updateSendInfo({
          status: '正在发送文件...',
          progress: 0
        }),
      error =>
        updateSendInfo({
          status: `❌ 发送失败: ${error}`
        })
    )
  }

  const handlerSend = async (files: string[]) => {
    sendFile(
      addr,
      files[0],
      () =>
        updateSendInfo({
          status: '正在发送文件...',
          progress: 0
        }),
      error =>
        updateSendInfo({
          status: `❌ 发送失败: ${error}`
        })
    )
  }

  useTauriDrag(
    e => {
      if (e.payload.type === 'drop' && type === 'send') {
        const paths = (e.payload as { paths: string[] }).paths
        console.log(e.payload.paths)
        setReady2SendFiles(prev => [...prev, ...paths])
        handlerSend(paths)
      }
    },
    [type]
  )

  return (
    <Layout>
      <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
        {/* 顶部：返回 + 对端信息 */}
        <div className="flex justify-between items-center mb-4">
          <button
            className="base_btn flex items-center gap-2"
            onClick={handleBack}
          >
            <Back {...ICON_INFO} fill="white" />
            <span>返回首页</span>
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

        <div className="mb-6">
          <div className="mb-2 flex gap-2 items-center">
            {typeBtnList.map(({ type, txt, icon }) => (
              <button
                key={type}
                className="base_btn flex items-center gap-2"
                onClick={() => setType(type)}
              >
                {icon} <span>{txt}</span>
              </button>
            ))}
          </div>
          {/* {ready2SendFiles.length > 0 && (
            <div className="mb-2 flex justify-between items-center">
              <span className="text-sm text-gray-600">已发送</span>
              <span className="text-sm text-gray-600">
                {ready2SendFiles.length} 个文件
              </span>
            </div>
          )}
          {ready2SendFiles.map(file => (
            <div key={file} className="text-sm text-gray-600">
              {file}
            </div>
          ))} */}
          <ProgressBar
            type={type}
            info={type === 'send' ? sendInfo : recvInfo}
            onClick={() => {
              type === 'send' && handlerSendFile()
            }}
          />
        </div>
      </div>
    </Layout>
  )
}
