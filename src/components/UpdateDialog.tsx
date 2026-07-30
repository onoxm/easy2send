import { Button, portalRenderer, TemplateDialog } from 'ono-react-element'
import { useState } from 'react'

interface UpdateDialogProps {
  handleUpdate: () => void
}

const UpdateDialog = ({
  destroy,
  handleUpdate
}: UpdateDialogProps & {
  destroy: () => void
}) => {
  const [loading, setLoading] = useState(false)

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
            handleUpdate()
            setLoading(true)
          }}
        >
          更新
        </Button>
      </div>
    </TemplateDialog>
  )
}

export const updateDialog = (options: UpdateDialogProps) => {
  return portalRenderer(UpdateDialog, options, 'update-dialog-root')
}
