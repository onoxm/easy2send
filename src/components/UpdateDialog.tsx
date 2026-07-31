import { windowBasicOperation } from '@/api/tauri'
import { listen } from '@tauri-apps/api/event'
import { Update } from '@tauri-apps/plugin-updater'
import { Button, portalRenderer, TemplateDialog } from 'ono-react-element'
import { useState } from 'react'

// 定义进度事件的 payload 类型
interface UpdaterProgressPayload {
  downloaded: number
  total: number
  chunkLength: number
}

interface UpdateDialogProps {
  handleUpdate: (callback: (update: Update) => void) => void
  destroy: () => void
}

const UpdateDialog = ({ destroy, handleUpdate }: UpdateDialogProps) => {
  const [loading, setLoading] = useState(false)
  const [version, setVersion] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [message, setMessage] = useState('')

  const handleConfirm = async () => {
    const unlisten = await listen<UpdaterProgressPayload>(
      'updater://progress',
      event => {
        const { downloaded, total } = event.payload
        if (total > 0) {
          const percent = Math.round((downloaded / total) * 100)
          setMessage(`下载中... ${percent}%`)
        }
      }
    )

    handleUpdate(async update => {
      // ✅ 有更新对象即表示有新版本
      setVersion(update.version)
      // 这里可以添加UI提示，如进度条
      await update.downloadAndInstall(progress => {
        setDownloading(true)
        // progress 是一个包含 event 和 data 的对象
        switch (progress.event) {
          case 'Started':
            setMessage('开始下载...')
            break
          case 'Finished':
            setMessage('下载完成！')
            unlisten()
            break
          default:
            break
        }
      })
      console.log('更新安装完成，应用即将重启。')
      windowBasicOperation('main', 'restart')
    })
    setLoading(true)
  }

  return (
    <TemplateDialog
      dialogClose={() => {
        if (!loading) destroy()
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
            height: 10,
            background: '#333',
            borderRadius: 5,
            margin: '16px 0'
          }}
        >
          {message}
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
        <Button type="primary" disabled={loading} onClick={destroy}>
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
