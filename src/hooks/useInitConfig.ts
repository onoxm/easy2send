import { basePath } from '@/api/tauri'
import useStore from '@/store'
import { initConfig } from '@/uitls/operationConfig'
import { useEffect } from 'react'

export const useInitConfig = () => {
  const savePath = useStore('savePath')

  const setSavePath = async () => {
    const downloadPath = await basePath.download()
    useStore.setState({ savePath: downloadPath })
  }

  useEffect(() => {
    initConfig().catch(console.error)
  }, [])

  useEffect(() => {
    if (savePath === '') setSavePath()
  }, [savePath])
}
