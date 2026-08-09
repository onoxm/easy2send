import { Info } from '@icon-park/react'
import { Popover } from 'ono-react-element'
import type { ReactNode } from 'react'

interface SettingsBarProps {
  title: string
  help?: ReactNode
  children: ReactNode
}

export const SettingsBar = ({ title, help, children }: SettingsBarProps) => {
  return (
    <div className="w-full flex gap-3 items-center bg-white rounded-lg p-3 border border-gray-100 shadow-sm">
      <div className="flex items-center gap-1 shrink-0 w-20 text-sm text-gray-600">
        <h3 className="shrink-0">{title}</h3>
        {help && (
          <Popover trigger="hover" placement="top-end" content={help}>
            <button
              aria-label={`关于“${title}”的说明`}
              className="text-gray-400 hover:text-gray-600 cursor-help"
            >
              <Info theme="outline" size="14" strokeWidth={2} />
            </button>
          </Popover>
        )}
      </div>

      <div className="flex items-center gap-2 flex-1 min-w-0">{children}</div>
    </div>
  )
}
