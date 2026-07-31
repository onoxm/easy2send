import { windowBasicOperation } from '@/api/tauri'
import useStore from '@/store'
import { Update } from '@tauri-apps/plugin-updater'
import { Button, portalRenderer, TemplateDialog } from 'ono-react-element'
import { useState } from 'react'

interface UpdateDialogProps {
  handleUpdate: (callback: (update: Update) => void) => void
  destroy: () => void
}

const UpdateDialog = ({ destroy, handleUpdate }: UpdateDialogProps) => {
  const version = useStore('version')
  const [loading, setLoading] = useState(false)
  const [newVersion, setNewVersion] = useState('')

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
        justifyContent: 'center',
        alignItems: 'center'
      }}
    >
      <h1>检测到新版本，是否更新？</h1>
      <h2>当前版本：{version}</h2>
      <h2>新版本：{newVersion}</h2>
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
        <Button
          type="success"
          loading={loading}
          onClick={() => {
            handleUpdate(async update => {
              // ✅ 有更新对象即表示有新版本
              setNewVersion(update.version)
              window.alert(JSON.stringify(update))
              // 这里可以添加UI提示，如进度条
              await update.downloadAndInstall()
              console.log('更新安装完成，应用即将重启。')
              windowBasicOperation('main', 'restart')
            })
            setLoading(true)
          }}
        >
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
