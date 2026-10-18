import { invoke } from '@tauri-apps/api/core'

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

/** 中断指定的发送任务
 *
 * 真正让后端停下（而不只是前端改个状态）：后端按 task_id 找到中断标记并置位，
 * 传输循环在每个分块处检查它。只对「已启动且尚未结束」的任务有效，
 * 查不到的任务会被跳过，返回实际被标记的数量 —— 不做成错误，
 * 因为「任务恰好在用户点确认那会儿传完了」是正常竞态，不该让断开失败。
 */
export const cancelTransferTasks = (taskIds: string[]) =>
  invoke<number>('cancel_transfer_tasks', { taskIds })

/**
 * 用系统默认程序打开文件，或用文件管理器打开目录。
 *
 * 「打开保存目录」「打开刚收到的文件」两个入口共用这一条 —— 它们原先各自
 * 散着写裸 invoke，连参数名都要靠记忆对齐。
 */
export const openFile = (path: string) => invoke<void>('open_file', { path })

/** 一次清理的结果（见 `cleanPartFiles`） */
export interface CleanPartReport {
  /** 已删除的个数 */
  removed: number
  /** 删不掉（被占用 / 无权限），后端留着下次再试 */
  failed: number
  /** 条目已失效（文件不在了 / 不是普通文件） */
  skipped: number
}

/**
 * 清理上次运行遗留的 `.part` 半成品
 *
 * 只删「本程序登记过、且本次运行没在用」的临时文件 —— 后端从不扫目录、也不按
 * 后缀批量删，所以不会碰浏览器之类的其它程序留下的同名后缀文件。
 * **传输过程中调用也是安全的**：正在写的文件在 active 组里，不在清理范围内。
 */
export const cleanPartFiles = () => invoke<CleanPartReport>('clean_part_files')
