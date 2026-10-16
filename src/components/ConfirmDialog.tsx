import { portalRenderer } from 'ono-react-element'
import { useRef } from 'react'
import {
  DialogActions,
  DialogShell,
  DialogTitle,
  DialogWarn,
  btnClass
} from './DialogShell'

interface ConfirmDialogProps {
  /** 标题（如「断开连接」） */
  title: string
  /** 正文说明，补充背景（中性语气；讲代价请用下面的 warn） */
  description?: string
  /**
   * 一行警示：「这么做会损坏什么」（如「还有 2 个任务未完成，退出后会被中断」）
   *
   * 与 description 分成两个字段而不是共用：同样是正文，代价要显眼、背景不抢戏。
   * 传不传由调用方按条件决定（有代价才传），弹窗自身不做判断。
   */
  warn?: string
  /** 确认按钮文案，默认「确定」 */
  confirmText?: string
  /** 取消按钮文案，默认「取消」 */
  cancelText?: string
  /**
   * 确认按钮用危险配方（浅 danger 底 + danger 文字 + state-tint 叠加）
   *
   * 用于有代价、会丢掉进行中工作的动作。「危险按钮 = danger.100」是设计规范
   * 05 组件与状态给出的配方，与项目其它危险按钮保持一致。
   */
  danger?: boolean
  /** 点「确认」后的回调。回调触发时弹窗已经收起 */
  onConfirm: () => void
  /**
   * 「不确认」的回调：点取消按钮、按 ESC、点右上角、点遮罩都算。
   *
   * 只有「取消也得做点什么」的调用方才传 —— 例如退出确认要回后端一句
   * 「用户不退了」，否则后端会一直停在等待里。最多被调用一次。
   */
  onCancel?: () => void
}

/**
 * 通用二次确认弹窗
 *
 * 与项目其它弹窗共用同一套骨架（DialogShell → portalRenderer + TemplateDialog）。
 *
 * ⚠️ 确认时**先收起弹窗再回调**：portalRenderer 把弹窗挂在 body 下的独立 root 上，
 * 路由跳转并不会卸载它 —— 忘了关就会一直盖在屏幕上。所以关闭这件事不能交给调用方，
 * 否则每个调用点都要记得关，漏一个就留一个幽灵弹窗。
 */
const ConfirmDialogBox = ({
  title,
  description,
  warn,
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onCancel,
  destroy
}: ConfirmDialogProps & { destroy: () => void }) => {
  /* 这两个 ref 解决的是同一件事的两面：关闭入口（取消按钮 / ESC / 右上角 / 遮罩）
     不止一个，而它们最终都可能走到同一个 dialogClose 上，于是 onCancel 存在被
     触发两次的路径；反过来，点「确认」时也要保证 onCancel 一次都不触发。
     所以用一个「已确认」挡板加一个「已通知过取消」挡板，把 onCancel 钉成最多一次。 */
  const confirmedRef = useRef(false)
  const cancelNotifiedRef = useRef(false)

  const closeAsCancel = () => {
    if (confirmedRef.current || cancelNotifiedRef.current) return
    cancelNotifiedRef.current = true
    onCancel?.()
  }

  const btnList = [
    { text: cancelText, variant: 'secondary' as const, isConfirm: false },
    {
      text: confirmText,
      variant: danger ? ('danger' as const) : ('primary' as const),
      isConfirm: true
    }
  ]

  return (
    <DialogShell
      className="w-110 p-7 gap-4"
      onClose={() => {
        destroy()
        closeAsCancel()
      }}
    >
      {enhancedDialogClose => (
        <>
          <DialogTitle title={title} description={description} />

          {warn && <DialogWarn>{warn}</DialogWarn>}

          <DialogActions>
            {btnList.map(({ text, variant, isConfirm }) => (
              <button
                key={text}
                className={btnClass(variant)}
                onClick={() => {
                  // 先置位再关闭：关闭动作有可能同步触发上面的 onClose
                  if (isConfirm) confirmedRef.current = true
                  enhancedDialogClose()
                  if (isConfirm) onConfirm()
                  else closeAsCancel()
                }}
              >
                {text}
              </button>
            ))}
          </DialogActions>
        </>
      )}
    </DialogShell>
  )
}

export const confirmDialog = (options: ConfirmDialogProps) =>
  portalRenderer(ConfirmDialogBox, options, 'confirm-dialog-root')
