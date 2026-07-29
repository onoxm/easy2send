import { StateType } from '@/store'
import operationConfig from '@/uitls/operationConfig'
import { useEffect } from 'react'

type ConfigType = Pick<StateType, 'theme' | 'savePath'>

export const useConfig = (
  config: ConfigType,
  onGet: (conf: ConfigType) => void
) => {
  useEffect(() => {
    operationConfig.get(onGet)
  }, [])

  useEffect(() => {
    operationConfig.set(config)
  }, [config])
}
