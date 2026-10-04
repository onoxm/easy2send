import { setUpdateDismissed, windowBasicOperation } from '@/api/tauri'
import { useStore } from '@/store'
import { Update } from '@tauri-apps/plugin-updater'
import {
  Button,
  chainClassNames,
  formatFileSize,
  portalRenderer,
  TemplateDialog
} from 'ono-react-element'
import { useRef, useState } from 'react'

interface UpdateDialogProps {
  update: Update
}

const UpdateDialog = ({
  update,
  destroy
}: UpdateDialogProps & { destroy: () => void }) => {
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [percent, setPercent] = useState(0)
  const [message, setMessage] = useState('')
  // 服务器未返回 Content-Length 时使用不确定进度模式
  const [indeterminate, setIndeterminate] = useState(false)
  // 剩余时间提示，仅在能算出速度时才有值
  const [eta, setEta] = useState('')

  // 用 ref 累计已下载字节数与总字节数，避免闭包取到旧值
  const downloadedRef = useRef(0)
  const totalRef = useRef(0)
  const startedAtRef = useRef(0)

  // 按「已下载 / 已耗时」推平均速度，再拿剩余字节除以速度。
  // 采样时间太短时速度抖动大（除数极小），索性先不给数。
  const estimateEta = () => {
    const elapsed = (Date.now() - startedAtRef.current) / 1000
    if (elapsed < 0.5) return ''
    const speed = downloadedRef.current / elapsed
    if (speed <= 0) return ''
    const remain = (totalRef.current - downloadedRef.current) / speed
    return remain <= 1 ? '即将完成' : `约剩 ${Math.ceil(remain)} 秒`
  }

  const handleConfirm = async () => {
    setLoading(true)
    setDownloading(true)
    downloadedRef.current = 0
    totalRef.current = 0
    startedAtRef.current = Date.now()
    setPercent(0)
    setIndeterminate(false)
    setEta('')
    setMessage('开始下载…')

    await update.downloadAndInstall(progress => {
      switch (progress.event) {
        case 'Started':
          totalRef.current = progress.data.contentLength ?? 0
          // contentLength 为 null/0 时说明服务器未返回总大小，切换不确定模式
          setIndeterminate(totalRef.current <= 0)
          startedAtRef.current = Date.now()
          setMessage('开始下载…')
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
            setMessage(`正在下载更新包… ${p}%`)
            setEta(estimateEta())
          } else {
            setMessage(
              `正在下载更新包… 已下载 ${formatFileSize(downloadedRef.current, { decimalPlaces: 1 })}`
            )
          }
          break
        }
        case 'Finished':
          setPercent(100)
          setIndeterminate(false)
          setEta('')
          setMessage('下载完成，正在安装…')
          break
        default:
          break
      }
    })

    setMessage('更新安装完成，应用即将重启。')
    useStore.setState({ canUpdate: false })
    windowBasicOperation({ type: 'restart' })
  }

  // 取消更新：标记本次启动期间已取消，避免其它窗口再次弹窗
  const handleCancel = () => {
    setUpdateDismissed()
    destroy()
  }

  // 更新说明来自 latest.json 的 notes 字段（@tauri-apps/plugin-updater 映射为 body）。
  // 老版本或流水线未写入时为 undefined，此时不展示说明块。
  const notes = update.body?.trim()

  const btnList = [
    {
      text: '稍后再说',
      className: 'border border-line-200 text-ink-700 state-neutral',
      onClick: handleCancel
    },
    {
      text: '立即更新',
      /* ono 的 Button 默认 type=primary，自带 .ono-btn-primary:hover{opacity:.9}，
         会在设计稿的 8% 黑遮罩之上再压一层透明度，这里用 hover:opacity-100 顶掉。 */
      className:
        'bg-brand-500 text-on-brand shadow-[var(--shadow-brand)] state-brand hover:opacity-100',
      onClick: handleConfirm
    }
  ]

  return (
    <TemplateDialog
      className="w-130 min-h-69 p-6 bg-surface-base border border-line-200 rounded-card shadow-[var(--shadow-e3)] flex flex-col gap-4"
      dialogClose={() => {
        if (!loading) handleCancel()
      }}
      onContextMenu={e => e.preventDefault()}
    >
      <div className="flex flex-col gap-1.5">
        <h1 className="text-base/5.75 text-ink-900 font-bold">
          发现新版本 v{update.version}
        </h1>
        <p className="text-ink-500 text-body/[1.4167] font-normal">
          当前版本 v{update.currentVersion}
        </p>
      </div>

      {downloading && (
        <div className="w-full flex flex-col gap-2.25">
          <div className="w-full h-1.5 bg-line-100 rounded-pill overflow-hidden relative">
            {indeterminate ? (
              <div
                className="absolute top-0 w-[40%] h-full bg-brand-500 rounded-pill"
                style={{
                  animation: 'update-indeterminate 1s ease-in-out infinite'
                }}
              />
            ) : (
              <div
                className="h-full bg-brand-500 rounded-pill"
                style={{
                  width: `${percent}%`,
                  transition: 'width 0.2s ease'
                }}
              />
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-caption text-ink-500">{message}</span>
            {eta && (
              <span className="text-caption text-ink-400 shrink-0">{eta}</span>
            )}
          </div>
        </div>
      )}

      {/* 更新说明取自 latest.json 的 notes（Rust 侧映射为 Update.body），
          由发布流水线按提交记录生成；缺失时整块不渲染，避免留一个空灰块 */}
      {notes && (
        <p className="bg-surface-muted p-2.75 rounded-control text-ink-600 text-caption/[1.4545] font-normal whitespace-pre-line max-h-35 overflow-y-auto">
          {notes}
        </p>
      )}

      <div className="h-.25"></div>

      <div className="mt-auto flex justify-end gap-2.5">
        {btnList.map(({ text, className, onClick }) => (
          <Button
            key={text}
            className={chainClassNames(
              'px-4 py-2.125 text-card/[1.4615] rounded-control',
              className
            )}
            disabled={loading}
            onClick={onClick}
          >
            {text}
          </Button>
        ))}
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

export const updateDialog = (update: Update) =>
  portalRenderer(UpdateDialog, { update }, 'update-dialog-root')
