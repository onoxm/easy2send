import { invoke } from '@tauri-apps/api/core'

export const sendFile = async (
  addr: string,
  filePath: string,
  onSending?: () => void,
  onError?: (error: unknown) => void
) => {
  try {
    onSending?.()
    await invoke('send_file', { addr, filePath })
  } catch (error) {
    onError?.(error)
  }
}
