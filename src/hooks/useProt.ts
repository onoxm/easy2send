import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'

export const usePort = (ip: string) => {
  const [port, setPort] = useState(0)

  const getFreePort = async () => {
    // 用具体本机 IP 检测端口可用性，与 start_server 实际绑定地址一致
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
