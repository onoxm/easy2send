export type TransferType = 'send' | 'receive'

export type TaskStatus =
  | 'queued' // 排队中
  | 'running' // 传输中
  | 'done' // 完成
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
}
