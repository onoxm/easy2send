export type TransferType = 'send' | 'receive'

export type TaskStatus =
  | 'queued' // 排队中
  | 'running' // 传输中
  | 'done' // 完成
  // 被「断开连接」中断。与 error 分开：这是用户主动的结果，不该显示成失败
  | 'interrupted'
  | 'error' // 失败

export interface TransferTask {
  id: string
  /** send / receive */
  direction: 'send' | 'receive'
  name: string
  /** 绝对路径（发送端），空字符串（接收端） */
  path?: string
  total: number
  sent: number
  percent: number
  /** bytes/sec */
  speed: number
  status: TaskStatus
  kind: 'file' | 'folder' | 'batch' | 'unknown'
  errorMessage?: string
  /** 批量内部条目序号（1-based），仅 MODE_BATCH 事件带 */
  entryIndex?: number
  entryCount?: number
  createdAt: number
  /** 真正开始传输的时刻（排队结束），用于算「用时」 */
  startedAt?: number
  /** 传输结束的时刻（完成或失败） */
  finishedAt?: number
}
