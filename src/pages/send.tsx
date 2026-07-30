import { Layout } from '@/components'
import { useNotification } from '@/hooks'
import useStore from '@/store'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'

export default () => {
  const { ip, port } = useStore(['ip', 'port'])
  const sendNotification = useNotification()

  const [status, setStatus] = useState('就绪')
  const [progress, setProgress] = useState(0)

  // 监听后端事件
  useEffect(() => {
    // 发送进度事件
    const unlistenSend = listen('send-progress', event => {
      const [_, __, percent] = event.payload as [number, number, number]
      setProgress(percent)
      setStatus(`发送中... ${percent.toFixed(1)}%`)
    })

    // 发送完成事件
    const unlistenSendComplete = listen('send-complete', event => {
      setStatus(`✅ 发送完成: ${event.payload}`)
      setProgress(100)
      sendNotification('发送完成')
    })

    return () => {
      unlistenSend.then(fn => fn())
      unlistenSendComplete.then(fn => fn())
    }
  }, [])

  // 选择并发送文件
  const sendFile = async () => {
    const selected = await open({
      multiple: false,
      title: '选择要发送的文件'
    })
    if (!selected || typeof selected !== 'string') return

    try {
      setStatus('正在发送文件...')
      setProgress(0)
      await invoke('send_file', {
        addr: `${ip}:${port}`,
        filePath: selected
      })
    } catch (error) {
      setStatus(`❌ 发送失败: ${error}`)
    }
  }

  return (
    <Layout>
      <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
        <Link className="bg-blue-500 text-white px-4 py-2 rounded-md" to="/">
          返回首页
        </Link>

        <div style={{ marginBottom: '20px' }}>
          <h3>📤 发送端（客户端）</h3>
          <button
            className="bg-blue-500 text-white p-1 rounded-sm cursor-pointer"
            onClick={sendFile}
          >
            📤 选择并发送文件
          </button>
        </div>

        <div
          style={{
            border: '1px solid #ccc',
            padding: '10px',
            borderRadius: '4px'
          }}
        >
          <h4>状态</h4>
          <p>{status}</p>
          {progress > 0 && (
            <div>
              <progress value={progress} max="100" style={{ width: '100%' }} />
              <span>{progress.toFixed(1)}%</span>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
