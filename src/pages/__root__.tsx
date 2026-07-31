import { useInitConfig, useTauriDrag } from '@/hooks'
import { useCheckUpdate } from '@/hooks/useCheckUpdate'
import { useConfig } from '@/hooks/useConfig'
import useStore from '@/store'
import { Outlet } from 'react-router'

export default () => {
  const { theme, savePath, autoCheckUpdate } = useStore([
    'theme',
    'savePath',
    'autoCheckUpdate'
  ])

  useTauriDrag(e => {
    if (e.payload.type === 'drop') {
      console.log(e.payload.paths)
    }
  })

  useInitConfig()

  useConfig(
    {
      theme,
      savePath,
      autoCheckUpdate
    },
    useStore.setState
  )

  useCheckUpdate()

  return (
    <main className="w-screen h-screen" onContextMenu={e => e.preventDefault()}>
      <Outlet />
    </main>
  )
}
