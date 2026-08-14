import { useCreateQRCode } from '@/hooks'
import { Copy } from '@icon-park/react'
import { listen } from '@tauri-apps/api/event'
import { copyText, portalRenderer, TemplateDialog } from 'ono-react-element'
import { useEffect, useRef, useState } from 'react'

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
        setStatus('请使用手机扫码上传')
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
      dialogClose={handleClose}
      onContextMenu={e => e.preventDefault()}
      animation={{ type: 'fade', startPosition: '30%' }}
    >
      {enhancedDialogClose => (
        <div className="flex flex-col items-center gap-3 bg-white p-4 rounded-md w-100">
          <h1>手机上传</h1>
          <p className="text-sm text-gray-500">
            扫描二维码，将手机文件发送到电脑
          </p>
          {qrcode ? (
            <>
              <div className="w-full mt-2 px-2 py-1 bg-gray-50 rounded text-center">
                <p className="text-xs text-gray-500">
                  电脑访问地址{' '}
                  <button
                    onClick={() => {
                      copyText(url)
                      setStatus('已复制到剪贴板')
                    }}
                  >
                    <Copy
                      theme="outline"
                      size="14"
                      fill="#333"
                      strokeWidth={3}
                    />
                  </button>
                </p>
                <p className="text-xs text-gray-800 break-all select-all">
                  {url}
                </p>
              </div>
              <div className="border border-black">
                <img src={qrcode} alt="二维码" />
              </div>
              <p className="text-xs text-blue-500">{status}</p>
            </>
          ) : (
            <div className="w-50 h-50 flex items-center justify-center">
              <p className="text-sm text-gray-400">{status}</p>
            </div>
          )}
          <button
            className="bg-transparent text-[#333] border border-[#333] btn ml-auto"
            onClick={() => {
              enhancedDialogClose()
              setTimeout(handleClose, 500)
            }}
          >
            关闭
          </button>
        </div>
      )}
    </TemplateDialog>
  )
}

export const qrUploadDialog = (options: QrUploadDialogProps) =>
  portalRenderer(QrUploadDialog, options, 'qr-upload-dialog-root')
