import { IconCheck } from '@tabler/icons-react'
import { chainClassNames, portalRenderer } from 'ono-react-element'
import { useRef, useState } from 'react'
import {
  DialogActions,
  DialogShell,
  DialogTitle,
  btnClass
} from './DialogShell'

/** 用户在关窗弹窗里的选择 */
export interface CloseChoice {
  /** 最小化到托盘（留在后台继续接收文件）/ 退出软件（断开所有连接后退出） */
  action: 'tray' | 'quit'
  /** 是否记住这次的选择（由调用方写进 store 的 closeAction） */
  remember: boolean
}

interface CloseConfirmDialogProps {
  /** 点了「最小化到托盘」或「退出软件」 */
  onChoose: (choice: CloseChoice) => void
  /** 「什么都没选」的回调：按 ESC、点右上角、点遮罩都算 */
  onCancel: () => void
}

/**
 * 「关闭窗口后要做什么？」—— 点窗口关闭按钮时弹的去留选择
 *
 * 与通用确认弹窗（ConfirmDialog）刻意分开：那个是「一件事要不要做」，
 * 这个是「在两条路里选一条」，而且多一个「记住我的选择」。
 * 皮肤、标题档位、按钮配方仍复用 DialogShell，不另起一套观感。
 *
 * 两个按钮都是「有结果」的出口，所以没有「取消」按钮 —— 但用户仍可以按 ESC 或
 * 点遮罩反悔（见下面的 onCancel），那等于「关上这个弹窗、窗口保持原样」。
 */
const CloseConfirmDialogBox = ({
  onChoose,
  onCancel,
  destroy
}: CloseConfirmDialogProps & { destroy: () => void }) => {
  const [remember, setRemember] = useState(false)
  /* 和确认弹窗同一个道理：关闭入口不止一个（ESC / 右上角 / 点遮罩），最终都会汇到
     下面的 onClose 上。用一个挡板保证 onCancel 最多触发一次，并且点了两个按钮
     之后不再被当成「取消」—— 那时用户已经做过选择了。 */
  const decidedRef = useRef(false)

  const closeAsCancel = () => {
    if (decidedRef.current) return
    decidedRef.current = true
    onCancel()
  }

  return (
    <DialogShell
      className="w-115 p-7 gap-6"
      onClose={() => {
        destroy()
        closeAsCancel()
      }}
    >
      {enhancedDialogClose => (
        <>
          <DialogTitle
            title="关闭窗口后要做什么？"
            description="最小化到托盘时，程序会继续在后台接收文件。"
          />

          <div className="flex items-center gap-2.5">
            {/* 复选框用「视觉隐藏的原生 input + 相邻 span 画样子」：input 直接
                appearance-none 的话勾画不出来（它是替换元素，伪元素不渲染），
                而 hidden 又会让键盘没法聚焦。sr-only 把焦点留在 input 上，
                聚焦环则靠 peer-focus-visible 画在外面那个盒子上。 */}
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={remember}
                onChange={e => setRemember(e.target.checked)}
              />
              <span
                className={chainClassNames(
                  'size-5 shrink-0 grid place-items-center rounded-chip border transition-colors',
                  'peer-focus-visible:border-brand-500',
                  remember
                    ? 'bg-brand-500 border-brand-500 text-on-brand'
                    : 'border-line-200 bg-surface-base'
                )}
              >
                {remember && <IconCheck size={13} stroke={3} />}
              </span>
              <span className="text-ink-700 text-body/[1.4167] font-normal">
                记住我的选择
              </span>
            </label>

            {/* buttons 靠 ml-auto 顶到右边：设计稿里它与左侧「记住」之间是弹性留白 */}
            <DialogActions className="ml-auto">
              <button
                className={btnClass('primary')}
                onClick={() => {
                  // 先置位再关闭：关闭动作有可能同步触发上面的 onClose
                  decidedRef.current = true
                  enhancedDialogClose()
                  onChoose({ action: 'tray', remember })
                }}
              >
                最小化到托盘
              </button>
              <button
                className={btnClass('secondary')}
                onClick={() => {
                  decidedRef.current = true
                  enhancedDialogClose()
                  onChoose({ action: 'quit', remember })
                }}
              >
                退出软件
              </button>
            </DialogActions>
          </div>
        </>
      )}
    </DialogShell>
  )
}

export const closeConfirmDialog = (options: CloseConfirmDialogProps) =>
  portalRenderer(CloseConfirmDialogBox, options, 'close-confirm-dialog-root')
