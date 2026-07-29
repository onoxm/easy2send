import { useIP, useNotification, usePort } from '@/hooks'
import useStore from '@/store'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'

export default () => {
  const savePath = useStore('savePath')
  const ip = useIP()
  const port = usePort(ip)
  const sendNotification = useNotification()

  const [status, setStatus] = useState('就绪')
  const [progress, setProgress] = useState(0)

  // 监听后端事件
  useEffect(() => {
    // 服务器状态事件
    const unlistenStatus = listen('server-status', event => {
      setStatus(event.payload as string)
      if (event.payload === 'stopped') console.log('服务器已停止')
      if (event.payload === 'listening') console.log('服务器已监听')
    })

    // 接收进度事件
    const unlistenReceive = listen('receive-progress', event => {
      const [_, __, percent] = event.payload as [number, number, number]
      setProgress(percent)
      setStatus(`接收中... ${percent.toFixed(1)}%`)
    })

    // 接收完成事件
    const unlistenReceiveComplete = listen('receive-complete', event => {
      setStatus(`✅ 接收完成: ${event.payload}`)
      setProgress(100)
      sendNotification('接收完成')
    })

    return () => {
      unlistenStatus.then(fn => fn())
      unlistenReceive.then(fn => fn())
      unlistenReceiveComplete.then(fn => fn())
    }
  }, [])

  useEffect(() => {
    // 启动服务器
    const startServer = async () => {
      if (!savePath) {
        alert('请先选择保存目录')
        return
      }
      try {
        setStatus('正在启动服务器...')
        await invoke('start_server', {
          addr: `${ip}:${port}`,
          saveDir: savePath
        })
        setStatus('✅ 服务器已启动，等待接收文件...')
      } catch (error) {
        setStatus(`❌ 启动失败: ${error}`)
      }
    }

    // 停止服务器
    const stopServer = async () => {
      try {
        await invoke('stop_server')
        setStatus('✅ 服务器已停止')
        setProgress(0)
      } catch (error) {
        setStatus(`❌ 停止失败: ${error}`)
      }
    }

    if (ip && port && savePath) startServer()

    return () => {
      if (ip && port && savePath) stopServer()
    }
  }, [ip, port, savePath])

  // 选择保存目录
  const selectSaveDir = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: '选择文件保存目录'
    })

    if (selected && typeof selected === 'string') {
      useStore.setState({ savePath: selected })
    }
  }

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
      <Link className="bg-blue-500 text-white px-4 py-2 rounded-md" to="/">
        返回首页
      </Link>
      <div style={{ marginBottom: '20px' }}>
        <h3>
          📥 接收端（服务器）ip：{ip} port：{port}{' '}
        </h3>
        <div>
          <button
            className="bg-blue-500 text-white p-1 rounded-sm cursor-pointer"
            onClick={selectSaveDir}
            style={{ marginRight: '10px' }}
          >
            📂 选择保存目录
          </button>
          <span>{savePath || '未选择'}</span>
        </div>
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
  )
}
