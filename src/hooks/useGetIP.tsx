import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'

export const useGetIP = () => {
  const [ipv4, setIpv4] = useState('')

  const getIpv4 = async () => {
    const ipv4 = await invoke('get_ip')
    setIpv4(ipv4 as string)
  }

  useEffect(() => {
    getIpv4()
  }, [])

  return ipv4
}
