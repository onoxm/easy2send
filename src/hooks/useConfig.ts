import { basePath } from '@/api/tauri'
import useStore from '@/store'
import operationConfig, { initConfig } from '@/uitls/operationConfig'
import { invoke } from '@tauri-apps/api/core'
import { useEffect } from 'react'

export const useConfig = () => {
  const config = useStore(['theme', 'savePath', 'autoCheckUpdate'])

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
    operationConfig.get(useStore.setState)
  }, [])

  useEffect(() => {
    if (config.savePath === '') setSavePath()
  }, [config.savePath])

  useEffect(() => {
    operationConfig.set(config)
  }, [config])
}
