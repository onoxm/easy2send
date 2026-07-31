import { setUpdateDismissed, windowBasicOperation } from '@/api/tauri'
import { Update } from '@tauri-apps/plugin-updater'
import { Button, portalRenderer, TemplateDialog } from 'ono-react-element'
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
      setMessage('开始下载...')

      await update.downloadAndInstall(progress => {
        switch (progress.event) {
          case 'Started':
            totalRef.current = progress.data.contentLength ?? 0
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
              // 未知总大小时仅展示已下载量
              setMessage(`下载中... ${downloadedRef.current} bytes`)
            }
            break
          }
          case 'Finished':
            setPercent(100)
            setMessage('下载完成，正在安装...')
            break
          default:
            break
        }
      })

      console.log('更新安装完成，应用即将重启。')
      windowBasicOperation('main', 'restart')
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
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                width: `${percent}%`,
                height: '100%',
                background: '#22c55e',
                borderRadius: 5,
                transition: 'width 0.2s ease'
              }}
            />
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
    </TemplateDialog>
  )
}

export const updateDialog = (
  handleUpdate: (callback: (update: Update) => void) => void
) => {
  return portalRenderer(UpdateDialog, { handleUpdate }, 'update-dialog-root')
}
