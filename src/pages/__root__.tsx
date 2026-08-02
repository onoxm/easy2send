import { useTauriDrag } from '@/hooks'
import { useCheckUpdate } from '@/hooks/useCheckUpdate'
import { useConfig } from '@/hooks/useConfig'
import { Outlet } from 'react-router'

export default () => {
  useTauriDrag(e => {
    if (e.payload.type === 'drop') {
      console.log(e.payload.paths)
    }
  })

  useConfig()

  useCheckUpdate()

  return (
    <main
      className="w-screen h-screen flex flex-col"
      onContextMenu={e => e.preventDefault()}
    >
      <Outlet />
    </main>
  )
}
