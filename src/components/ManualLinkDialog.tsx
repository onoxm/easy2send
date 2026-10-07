import { portalRenderer } from 'ono-react-element'
import { useState } from 'react'
import {
  DialogActions,
  DialogShell,
  DialogTitle,
  btnClass
} from './DialogShell'

interface ManualLinkDialogProps {
  handleConnect: (manualAddr: string, onSuccess: () => void) => void
}

const ManualLinkDialogBox = ({
  handleConnect,
  destroy
}: ManualLinkDialogProps & {
  destroy: () => void
}) => {
  const [manualAddr, setManualAddr] = useState('')

  const btnList = [
    {
      text: '取消',
      variant: 'secondary' as const,
      onClick: (close: () => void) => close()
    },
    {
      text: '连接',
      variant: 'primary' as const,
      onClick: (close: () => void) => handleConnect(manualAddr, close)
    }
  ]

  return (
    <DialogShell className="w-110 h-64.25 p-7 gap-4" onClose={destroy}>
      {enhancedDialogClose => (
        <>
          <DialogTitle title="手动连接" description="输入对方首页显示的地址" />

          <div className="flex flex-col gap-2">
            <p className="text-ink-700 text-card/[1.4615]">对方地址</p>
            {/* 聚焦态按设计稿 3:600：描边 line.200 → brand.500 且线宽 1 → 1.5，外加外发光 */}
            <input
              type="text"
              placeholder="如 192.168.1.9:8234"
              className="w-full h-9 px-3 py-2.5 text-ink-500 font-normal text-body/[1.4167] rounded-control border border-line-200 outline-none state-focus"
              value={manualAddr}
              onChange={e => setManualAddr(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter')
                  handleConnect(manualAddr, enhancedDialogClose)
              }}
            />
            <p className="text-ink-500 text-caption/[1.4545]">
              在对方首页的状态栏可以看到这串地址
            </p>
          </div>

          <DialogActions>
            {btnList.map(({ text, variant, onClick }) => (
              <button
                key={text}
                className={btnClass(variant)}
                onClick={() => onClick(enhancedDialogClose)}
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

export const manualLinkDialog = (
  handleConnect: (manualAddr: string, onSuccess: () => void) => void
) =>
  portalRenderer(
    ManualLinkDialogBox,
    { handleConnect },
    'manual-link-dialog-root'
  )
