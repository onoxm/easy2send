import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'

export const usePort = (ipv4: string) => {
  const [port, setPort] = useState(0)

  function getRandomPort() {
    return Math.floor(Math.random() * (10000 - 1024 + 1)) + 1024
  }

  const get_port = async () =>
    setPort(
      (await invoke('check_port', {
        ip: ipv4,
        port: getRandomPort()
      })) as number
    )

  useEffect(() => {
    if (ipv4) get_port()
  }, [ipv4])

  return [port, get_port] as const
}
