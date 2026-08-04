import type { ReactNode } from 'react'

interface SettingsBarProps {
  title: string
  children: ReactNode
}

export const SettingsBar = ({ title, children }: SettingsBarProps) => {
  return (
    <div className="w-full flex gap-2 items-center">
      <h3>{title}</h3>
      {children}
    </div>
  )
}
