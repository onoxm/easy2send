import useStore from '@/store'
import { invoke } from '@tauri-apps/api/core'

export const useVersion = () => {
  const version = useStore(state => state.version)

  const getVersion = async () =>
    useStore.setState({ version: await invoke('get_version') })

  return [version, getVersion] as const
}
