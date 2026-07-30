import useStore from '@/store'
import { ReactNode } from 'react'

export const Layout = ({ children }: { children: ReactNode }) => {
  const version = useStore('version')

  return (
    <>
      <h2 className="text-2xl font-bold text-center">
        📁 Easy2Send：局域网文件传输
      </h2>
      {children}
      <div className="text-center text-sm text-gray-500">版本：{version}</div>
    </>
  )
}
