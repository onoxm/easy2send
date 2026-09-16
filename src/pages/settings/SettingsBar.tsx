import { IconInfoCircle } from '@tabler/icons-react'
import { Popover } from 'ono-react-element'
import type { ReactNode } from 'react'

interface SettingsBarProps {
  title: string
  help?: ReactNode
  children: ReactNode
}

export const SettingsBar = ({ title, help, children }: SettingsBarProps) => {
  return (
    <div className="w-full flex flex-col gap-2 bg-white rounded-lg py-3.5 px-4 border border-line-200 shadow-sm">
      <div className="flex items-center gap-1.5">
        <h3 className="text-card/[19px] text-ink-700">{title}</h3>
        {help && (
          <Popover trigger="hover" placement="top-end" content={help}>
            <span
              aria-label={`关于“${title}”的说明`}
              className="text-ink-300 cursor-help"
            >
              <IconInfoCircle size={16} stroke={2} />
            </span>
          </Popover>
        )}
      </div>

      <div className="flex items-center gap-2 flex-1 min-w-0">{children}</div>
    </div>
  )
}
