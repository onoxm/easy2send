import { basePath } from '@/api/tauri'
import useStore from '@/store'
import { initConfig } from '@/uitls/operationConfig'
import { invoke } from '@tauri-apps/api/core'
import { useEffect } from 'react'

export const useInitConfig = () => {
  const savePath = useStore('savePath')

  const getVersion = async () => {
    const version = (await invoke('get_version')) as string
    useStore.setState({ version })
  }

  const setSavePath = async () => {
    const downloadPath = await basePath.download()
    useStore.setState({ savePath: downloadPath })
  }

  useEffect(() => {
    getVersion()
    initConfig().catch(console.error)
  }, [])

  useEffect(() => {
    if (savePath === '') setSavePath()
  }, [savePath])
}
