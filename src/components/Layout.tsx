import useStore from '@/store'
import { ReactNode } from 'react'

export const Layout = ({ children }: { children: ReactNode }) => {
  const version = useStore('version')

  return (
    <>
      {children}
      <div className="text-center text-sm text-gray-500">版本：{version}</div>
    </>
  )
}
