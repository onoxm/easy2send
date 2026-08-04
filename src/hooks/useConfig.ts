import { getDeviceId } from '@/api/discovery'
import { basePath } from '@/api/tauri'
import useStore from '@/store'
import operationConfig, { initConfig } from '@/utils/operationConfig'
import { invoke } from '@tauri-apps/api/core'
import { useEffect } from 'react'

export const useConfig = () => {
  const { deviceId, ...config } = useStore([
    'theme',
    'savePath',
    'autoCheckUpdate',
    'deviceId',
    'deviceName'
  ])

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
    getDeviceId()
      .then(id => useStore.setState({ deviceId: id }))
      .catch(console.error)
    initConfig().catch(console.error)
    operationConfig.get(useStore.setState)
  }, [])

  // deviceId 就绪后，若未设置过 deviceName，生成默认值
  useEffect(() => {
    if (deviceId && !config.deviceName) {
      useStore.setState({
        deviceName: `Easy2Send-${deviceId.slice(0, 6)}`
      })
    }
  }, [deviceId, config.deviceName])

  useEffect(() => {
    if (config.savePath === '') setSavePath()
  }, [config.savePath])

  useEffect(() => {
    operationConfig.set(config)
  }, [config])
}
