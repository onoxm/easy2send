import useStore from '@/store'
import { ReactNode } from 'react'

interface LayoutProps {
  children: ReactNode
}

export const Layout = ({ children }: LayoutProps) => {
  const version = useStore('version')

  return (
    <div className="w-full h-full flex flex-col items-center justify-between">
      {children}
      <p className="text-center text-sm text-gray-500 mb-2">版本：{version}</p>
    </div>
  )
}
