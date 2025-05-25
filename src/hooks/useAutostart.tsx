import useStore from '@/store'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { useEffect } from 'react'

export const useAutostart = () => {
  const autostart = useStore(state => state.autostart)

  const toggleAutostart = async () => {
    if (autostart) {
      await disable()
      useStore.setState({ autostart: false })
    } else {
      await enable()
      useStore.setState({ autostart: true })
    }
  }

  const getIsEnabled = async () => {
    const bl = await isEnabled()
    useStore.setState({ autostart: bl })
  }

  useEffect(() => {
    getIsEnabled()
  }, [])

  return [autostart, toggleAutostart] as const
}
