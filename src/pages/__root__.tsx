import { useInitConfig, useTauriDrag } from '@/hooks'
import { useConfig } from '@/hooks/useConfig'
import useStore from '@/store'
import { Outlet } from 'react-router'

export default () => {
  const { theme, savePath } = useStore(['theme', 'savePath'])

  useTauriDrag(e => {
    if (e.payload.type === 'drop') {
      console.log(e.payload.paths)
    }
  })

  useInitConfig()

  useConfig(
    {
      theme,
      savePath
    },
    useStore.setState
  )

  return (
    <main className="w-screen h-screen">
      <h2 className="text-2xl font-bold text-center">
        📁 Easy2Send：局域网文件传输
      </h2>
      <Outlet />
    </main>
  )
}
