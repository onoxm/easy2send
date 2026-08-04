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

export const sendFiles = async (
  addr: string,
  filePaths: string[],
  onSending?: () => void,
  onError?: (error: unknown) => void
) => {
  try {
    onSending?.()
    await invoke('send_files', { addr, filePaths })
  } catch (error) {
    onError?.(error)
  }
}

export interface TransferTaskSeed {
  task_id: string
  path: string
  name: string
}

/** 批量创建传输任务（不实际发送，仅分配 task_id）
 *
 * 返回 { task_id, path, name }[]
 * 随后调用方按并发上限，串行/并行调用 `startTransferTask`
 */
export const createTransferTasks = (addr: string, filePaths: string[]) =>
  invoke<TransferTaskSeed[]>('create_transfer_tasks', { addr, filePaths })

/** 发送单个已创建的传输任务（每次调用独立建 TCP 连接） */
export const startTransferTask = (
  addr: string,
  taskId: string,
  filePath: string
) =>
  invoke<void>('start_transfer_task', {
    addr,
    taskId,
    filePath
  })
