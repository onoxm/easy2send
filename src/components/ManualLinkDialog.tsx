import {
  chainClassNames,
  portalRenderer,
  TemplateDialog
} from 'ono-react-element'
import { useState } from 'react'

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
      className: 'border border-line-200 text-ink-700',
      onClick: (close: () => void) => close()
    },
    {
      text: '连接',
      className: 'bg-brand-500 text-on-brand',
      onClick: (close: () => void) => handleConnect(manualAddr, close)
    }
  ]

  return (
    <TemplateDialog
      className="w-110 h-[257px] p-7 bg-surface-base rounded-card flex flex-col gap-4"
      dialogClose={destroy}
      onContextMenu={e => e.preventDefault()}
      animation={{ type: 'fade', startPosition: '30%' }}
    >
      {enhancedDialogClose => (
        <>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-ink-900 font-bold text-[17px]/[25px]">
              手动连接
            </h1>
            <p className="text-ink-500 font-normal text-body/[17px]">
              输入对方首页显示的地址
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-ink-700 text-card/[19px]">对方地址</p>
            <input
              type="text"
              placeholder="如 192.168.1.9:8234"
              className="w-full h-9 px-3 py-2.5 text-ink-500 font-normal text-body/[17px] rounded-control border border-line-200 outline-none"
              value={manualAddr}
              onChange={e => setManualAddr(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter')
                  handleConnect(manualAddr, enhancedDialogClose)
              }}
            />
            <p className="text-ink-500 text-caption/[16px]">
              在对方首页的状态栏可以看到这串地址
            </p>
          </div>
          <div className="flex justify-end gap-2.5">
            {btnList.map(({ text, className, onClick }) => (
              <button
                key={text}
                className={chainClassNames(
                  'px-4 py-[8.5px] text-card/[19px] rounded-control',
                  className
                )}
                onClick={() => onClick(enhancedDialogClose)}
              >
                {text}
              </button>
            ))}
          </div>
        </>
      )}
    </TemplateDialog>
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
