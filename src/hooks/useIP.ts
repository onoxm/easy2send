import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'

export const useIP = () => {
  const [ip, setIp] = useState('')

  const getIp = async () => {
    const ip = await invoke('get_lan_ip')
    setIp(ip as string)
  }

  useEffect(() => {
    getIp()
  }, [])

  return ip
}
