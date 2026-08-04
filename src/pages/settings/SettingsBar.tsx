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
    <div className="w-full flex gap-2 items-center">
      <div className="flex items-center gap-1 shrink-0 text-sm text-gray-500">
        <h3>{title}</h3>
        {help && (
          <Popover trigger="hover" placement="top-end" content={help}>
            <Info theme="outline" size="18" fill="#333" strokeWidth={2} />
          </Popover>
        )}
      </div>

      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}
