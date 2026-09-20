import { Tip } from '@/components'
import { IconInfoCircle } from '@tabler/icons-react'
import type { ReactNode } from 'react'

interface SettingsBarProps {
  title: string
  help?: ReactNode
  children: ReactNode
}

export const SettingsBar = ({ title, help, children }: SettingsBarProps) => {
  return (
    <div className="w-full flex flex-col gap-2 bg-surface-base rounded-lg py-3.5 px-4 border border-line-200 shadow-[var(--shadow-e1)]">
      <div className="flex items-center gap-1.5">
        <h3 className="text-card/[1.4615] text-ink-700">{title}</h3>
        {help && (
          /* 设置项的说明属设计稿的长文本气泡形态（固定 240 宽逼出换行，65:27），
             气泡规格统一在 global.css 的 .tooltip-bubble */
          <Tip content={help} wide placement="top-start">
            <span
              aria-label={`关于“${title}”的说明`}
              className="text-ink-300 cursor-help"
            >
              <IconInfoCircle size={16} stroke={2} />
            </span>
          </Tip>
        )}
      </div>

      <div className="flex items-center gap-2 flex-1 min-w-0">{children}</div>
    </div>
  )
}
