import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'

export const usePort = (ip: string) => {
  const [port, setPort] = useState(0)

  const getFreePort = async () => {
    const port = await invoke('get_free_port', {
      ip: ip,
      start: 8000,
      end: 9000
    })
    setPort(port as number)
  }

  useEffect(() => {
    if (ip) getFreePort()
  }, [ip])

  return port
}
