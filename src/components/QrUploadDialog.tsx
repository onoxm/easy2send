import { useCreateQRCode } from '@/hooks'
import { IconCopy } from '@tabler/icons-react'
import { listen } from '@tauri-apps/api/event'
import { copyText, portalRenderer, TemplateDialog } from 'ono-react-element'
import { useEffect, useRef, useState } from 'react'
import { innerToast } from './toast'

interface QrUploadDialogProps {
  /** 二维码内容（含 token 的完整 URL，由调用方在启动服务器后传入） */
  url: string
  /** 用户手动关闭弹窗时的回调（停止 HTTP 服务器，仅在未配对时触发） */
  onClose?: () => void
  width?: number
  margin?: number
  color?: string
  bgColor?: string
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
}

const QrUploadDialog = ({
  url,
  onClose,
  width,
  margin,
  color,
  bgColor,
  errorCorrectionLevel,
  destroy
}: QrUploadDialogProps & { destroy: () => void }) => {
  const [qrcode, setQrcode] = useState('')
  const [status, setStatus] = useState('正在生成二维码...')
  const createQRCode = useCreateQRCode()
  // 标记是否已配对：配对后弹窗自动关闭，不触发 onClose（不停服务器）
  const pairedRef = useRef(false)

  useEffect(() => {
    let unlistenPaired: (() => void) | null = null

    const genQR = async () => {
      try {
        const qr = await createQRCode(url, {
          width,
          margin,
          color,
          bgColor,
          errorCorrectionLevel
        })
        setQrcode(qr)
        setStatus('等待手机扫码…')
      } catch (e) {
        setStatus('二维码生成失败: ' + String(e))
      }
    }
    genQR()

    // 配对成功：标记已配对 + 关闭弹窗（只调 destroy 不触发 onClose，服务器保持运行）
    listen('web-upload-paired', () => {
      setStatus('手机已连接，正在跳转...')
      pairedRef.current = true
      setTimeout(() => destroy(), 600)
    }).then(fn => {
      unlistenPaired = fn
    })

    return () => {
      if (unlistenPaired) unlistenPaired()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 用户手动关闭：未配对时停止服务器；已配对则仅销毁弹窗
  const handleClose = () => {
    if (!pairedRef.current) {
      onClose?.()
    }
    destroy()
  }

  return (
    <TemplateDialog
      className="flex flex-col items-center gap-5 bg-surface-base p-7 rounded-card shadow-[var(--shadow-e3)] w-140"
      dialogClose={handleClose}
      onContextMenu={e => e.preventDefault()}
      animation={{ type: 'fade', startPosition: '30%' }}
    >
      {enhancedDialogClose => (
        <>
          <div className="flex flex-col gap-1.5 items-center">
            <h1 className="text-ink-900 font-bold text-4.25/4.75">手机上传</h1>
            <p className="text-body/[1.4167] text-ink-500 font-normal">
              扫描二维码，将手机文件发送到电脑
            </p>
          </div>
          {qrcode ? (
            <>
              <div className="border border-line-200 rounded-card shadow-[var(--shadow-e1)] overflow-hidden">
                <img src={qrcode} alt="二维码" />
              </div>
              <div className="w-full flex flex-col gap-1.25 px-3 py-2.5 bg-surface-muted rounded-control text-left">
                <p className="text-xs text-ink-500 flex items-center justify-between">
                  <span className="text-caption/[1.4545] font-normal">
                    电脑访问地址
                  </span>
                  <button
                    onClick={() => {
                      copyText(url)
                      innerToast.success('已复制到剪贴板')
                    }}
                  >
                    <IconCopy size={14} stroke={1.5} />
                  </button>
                </p>
                <p className="text-caption/[1.4545] text-ink-700 break-all select-all">
                  {url}
                </p>
              </div>
              <div className="flex items-center justify-center gap-1.75">
                <div className="w-1.75 h-1.75 rounded-full bg-brand-500"></div>
                <p className="text-body/[1.4167] text-ink-500 font-normal">
                  {status}
                </p>
              </div>
            </>
          ) : (
            <div className="w-50 h-50 flex items-center justify-center">
              <p className="text-body/[1.4167] text-ink-500 font-normal">
                {status}
              </p>
            </div>
          )}
          <button
            className="w-full h-9.5 text-ink-700 border border-line-200 rounded-control text-card/[1.4615] state-neutral"
            onClick={enhancedDialogClose}
          >
            取消
          </button>
        </>
      )}
    </TemplateDialog>
  )
}

export const qrUploadDialog = (options: QrUploadDialogProps) =>
  portalRenderer(QrUploadDialog, options, 'qr-upload-dialog-root')
