import { useStore } from '@/store'
import { ReactNode } from 'react'

interface LayoutProps {
  children: ReactNode
}

export const Layout = ({ children }: LayoutProps) => {
  const version = useStore('version')

  return (
    <div className="w-full h-full flex flex-col items-center justify-between py-5 px-8">
      {children}
      <p className="text-center text-caption text-ink-400">
        Easy2Send v{version}
      </p>
    </div>
  )
}
