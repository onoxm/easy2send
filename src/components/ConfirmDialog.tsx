import { portalRenderer } from 'ono-react-element'
import {
  DialogActions,
  DialogShell,
  DialogTitle,
  btnClass
} from './DialogShell'

interface ConfirmDialogProps {
  /** 标题（如「断开连接」） */
  title: string
  /** 正文说明，用来讲清代价（如「还有 2 个任务未完成，断开后会被中断」） */
  description?: string
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
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
  onConfirm,
  destroy
}: ConfirmDialogProps & { destroy: () => void }) => {
  const btnList = [
    { text: cancelText, variant: 'secondary' as const, isConfirm: false },
    {
      text: confirmText,
      variant: danger ? ('danger' as const) : ('primary' as const),
      isConfirm: true
    }
  ]

  return (
    <DialogShell className="w-110 p-7 gap-4" onClose={destroy}>
      {enhancedDialogClose => (
        <>
          <DialogTitle title={title} description={description} />

          <DialogActions>
            {btnList.map(({ text, variant, isConfirm }) => (
              <button
                key={text}
                className={btnClass(variant)}
                onClick={() => {
                  enhancedDialogClose()
                  if (isConfirm) onConfirm()
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
