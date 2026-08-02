import { setUpdateDismissed, windowBasicOperation } from '@/api/tauri'
import useStore from '@/store'
import { Update } from '@tauri-apps/plugin-updater'
import {
  Button,
  formatFileSize,
  portalRenderer,
  TemplateDialog
} from 'ono-react-element'
import { useRef, useState } from 'react'

interface UpdateDialogProps {
  handleUpdate: (callback: (update: Update) => void) => void
  destroy: () => void
}

const UpdateDialog = ({ destroy, handleUpdate }: UpdateDialogProps) => {
  const [loading, setLoading] = useState(false)
  const [version, setVersion] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [percent, setPercent] = useState(0)
  const [message, setMessage] = useState('')
  // 服务器未返回 Content-Length 时使用不确定进度模式
  const [indeterminate, setIndeterminate] = useState(false)

  // 用 ref 累计已下载字节数与总字节数，避免闭包取到旧值
  const downloadedRef = useRef(0)
  const totalRef = useRef(0)

  const handleConfirm = async () => {
    setLoading(true)
    handleUpdate(async update => {
      setVersion(update.version)
      setDownloading(true)
      downloadedRef.current = 0
      totalRef.current = 0
      setPercent(0)
      setIndeterminate(false)
      setMessage('开始下载...')

      await update.downloadAndInstall(progress => {
        switch (progress.event) {
          case 'Started':
            totalRef.current = progress.data.contentLength ?? 0
            // contentLength 为 null/0 时说明服务器未返回总大小，切换不确定模式
            setIndeterminate(totalRef.current <= 0)
            setMessage('开始下载...')
            setPercent(0)
            break
          case 'Progress': {
            downloadedRef.current += progress.data.chunkLength
            if (totalRef.current > 0) {
              const p = Math.min(
                100,
                Math.round((downloadedRef.current / totalRef.current) * 100)
              )
              setPercent(p)
              setMessage(`下载中... ${p}%`)
            } else {
              setMessage(
                `下载中... 已下载 ${formatFileSize(downloadedRef.current, { decimalPlaces: 1 })}`
              )
            }
            break
          }
          case 'Finished':
            setPercent(100)
            setIndeterminate(false)
            setMessage('下载完成，正在安装...')
            break
          default:
            break
        }
      })

      setMessage('更新安装完成，应用即将重启。')
      useStore.setState({ canUpdate: false })
      windowBasicOperation({ type: 'restart' })
    })
  }

  // 取消更新：标记本次启动期间已取消，避免其它窗口再次弹窗
  const handleCancel = () => {
    setUpdateDismissed()
    destroy()
  }

  return (
    <TemplateDialog
      dialogClose={() => {
        if (!loading) handleCancel()
      }}
      style={{
        width: 400,
        height: 240,
        background: 'white',
        border: '1px solid #333',
        borderRadius: 8,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center'
      }}
    >
      <h1>检测到新版本{version}，是否更新？</h1>
      {downloading && (
        <div
          style={{
            width: 300,
            margin: '16px 0',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6
          }}
        >
          <div
            style={{
              width: '100%',
              height: 10,
              background: '#e5e7eb',
              borderRadius: 5,
              overflow: 'hidden',
              position: 'relative'
            }}
          >
            {indeterminate ? (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  height: '100%',
                  width: '40%',
                  background: '#22c55e',
                  borderRadius: 5,
                  animation: 'update-indeterminate 1s ease-in-out infinite'
                }}
              />
            ) : (
              <div
                style={{
                  width: `${percent}%`,
                  height: '100%',
                  background: '#22c55e',
                  borderRadius: 5,
                  transition: 'width 0.2s ease'
                }}
              />
            )}
          </div>
          <span style={{ fontSize: 12, color: '#666' }}>{message}</span>
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          right: 16,
          bottom: 16,
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8
        }}
      >
        <Button type="primary" disabled={loading} onClick={handleCancel}>
          取消
        </Button>
        <Button type="success" loading={loading} onClick={handleConfirm}>
          更新
        </Button>
      </div>
      <style>{`
        @keyframes update-indeterminate {
          0% { left: -40%; }
          100% { left: 100%; }
        }
      `}</style>
    </TemplateDialog>
  )
}

export const updateDialog = (
  handleUpdate: (callback: (update: Update) => void) => void
) => {
  return portalRenderer(UpdateDialog, { handleUpdate }, 'update-dialog-root')
}
