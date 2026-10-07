import { useTauriListener } from '@/hooks'
import type { DeviceInfo } from '@/types/discovery'
import { portalRenderer } from 'ono-react-element'
import { useRef } from 'react'
import {
  DialogActions,
  DialogShell,
  DialogTitle,
  btnClass
} from './DialogShell'
import { PeerAvatar, PeerIdentity } from './PeerIdentity'

interface ConnectionRequestDialogProps {
  /** 发起连接请求的对方设备 */
  device: DeviceInfo
  /** 用户提交决策：accepted 为 true 表示接受；close 用于收起弹窗 */
  onRespond: (accepted: boolean, close: () => void) => void
}

/**
 * 陌生设备的连接请求确认弹窗
 *
 * 只在对方**尚未被信任**时出现：已信任设备走的是静默通过，不弹这个。
 * 用户点「接受」后对方会被记入信任表，之后同一台设备再连就不打扰了。
 */
const ConnectionRequestDialogBox = ({
  device,
  onRespond,
  destroy
}: ConnectionRequestDialogProps & { destroy: () => void }) => {
  // 一次请求只能提交一次决策。点「接受」时走的 enhancedDialogClose 会触发关闭流程，
  // 而关闭流程又会走到下面的 handleClose（那条按「拒绝」算）—— 没有这道守卫就会
  // 先接受、再补一个拒绝，把刚写进信任表的设备又推回去。
  const responded = useRef(false)
  const submit = (accepted: boolean, close: () => void) => {
    if (responded.current) return
    responded.current = true
    onRespond(accepted, close)
  }

  // 对方等待答复是有时限的（后端 30s 超时后会按拒绝处理），
  // 超时后这个弹窗必须自己收起来 —— 否则用户点「接受」提交的是一个
  // 早已失效的请求，只会拿到一句「没有等待确认的连接请求」。
  //
  // 这条路径**不提交决策**：后端已按超时处理、挂起项也清掉了，
  // 再补一个「拒绝」只会拿到同一句错误。
  //
  // 依赖留空 = 只在挂载时订阅一次：这个弹窗的一生就对应一台设备，收起来后不会再变。
  useTauriListener<string>('incoming-connection-timeout', e => {
    if (e.payload === device.deviceId) destroy()
  })

  // 关闭弹窗（右上角 / ESC / 点遮罩）一律按「拒绝」提交：
  // 用户明明表达了「不想接」，原先只 destroy 的话对方要干等满 30 秒才吃到超时。
  //
  // ⚠️ 但**已经提交过决策**时要只做卸载。这条 handleClose 还会被另一条路径走到：
  // 点按钮 → `enhancedDialogClose` 播离场动画 → 动画结束回调 dialogClose(= 这里)。
  // 而 `responded` 守卫的本意只是「别再补一个决策」，**不是**「连卸载也拦掉」——
  // 拦掉它会让 portal 根连同全屏遮罩永久留在 body 上，从此吃掉整页点击。
  // 2026-10-07 实测：点「接受」跳到传输页后，「返回 / 断开连接 / 发送任务 / 打开保存目录」
  // 全部被 `ono-dialog-mask-leave` 挡住，再等 3 秒也不会自愈。
  const handleClose = () => {
    if (responded.current) {
      destroy()
      return
    }
    submit(false, destroy)
  }

  const btnList = [
    { text: '拒绝', variant: 'secondary' as const, accepted: false },
    { text: '接受', variant: 'primary' as const, accepted: true }
  ]

  return (
    <DialogShell className="w-110 p-7 gap-4" onClose={handleClose}>
      {enhancedDialogClose => (
        <>
          <DialogTitle
            title="连接请求"
            description="接受后将记住该设备，以后连接不再询问"
          />

          <div className="w-full h-15 border border-line-200 flex items-center gap-3 px-3 rounded-md">
            <PeerAvatar platform={device.platform} />
            <PeerIdentity
              name={device.deviceName || '未知设备'}
              subtitle={`${device.ip}${device.port ? `:${device.port}` : ''}`}
            />
          </div>

          <DialogActions>
            {btnList.map(({ text, variant, accepted }) => (
              <button
                key={text}
                className={btnClass(variant)}
                onClick={() => submit(accepted, enhancedDialogClose)}
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

export const connectionRequestDialog = (
  options: ConnectionRequestDialogProps
) =>
  portalRenderer(
    ConnectionRequestDialogBox,
    options,
    'connection-request-dialog-root'
  )
