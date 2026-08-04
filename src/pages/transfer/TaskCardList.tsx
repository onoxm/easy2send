import { ICON_INFO } from '@/common/common'
import { FolderClose, Picture, Send, Zip } from '@icon-park/react'
import {
  chainClassNames,
  createDataSource,
  EstimatedVirtualList,
  formatFileSize
} from 'ono-react-element'
import { ReactNode, useMemo } from 'react'
import { TaskStatus, TransferTask } from '.'

const KIND_ICON: Record<TransferTask['kind'], ReactNode> = {
  file: <Picture {...ICON_INFO} strokeWidth={2} />,
  folder: <FolderClose {...ICON_INFO} strokeWidth={2} />,
  batch: <Zip {...ICON_INFO} strokeWidth={2} />,
  unknown: <Send {...ICON_INFO} strokeWidth={2} />
}

const TaskCard = ({ task }: { task: TransferTask }) => {
  const {
    name,
    total,
    sent,
    percent,
    speed,
    status,
    kind,
    errorMessage,
    entryIndex,
    entryCount
  } = task

  const eta = useMemo(() => {
    if (status !== 'running' || speed <= 0 || !total) return '--:--'
    const remainBytes = Math.max(0, total - sent)
    const remainSec = remainBytes / speed
    if (!isFinite(remainSec) || remainSec >= 24 * 3600) return '> 24h'
    const h = Math.floor(remainSec / 3600)
    const m = Math.floor((remainSec - h * 3600) / 60)
    const s = Math.floor(remainSec - h * 3600 - m * 60)
    return h > 0
      ? `${h}h ${m.toString().padStart(2, '0')}m`
      : `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }, [status, speed, total, sent])

  const statusText: Record<TaskStatus, string> = {
    queued: '排队中',
    running: '传输中',
    done: '完成',
    error: '失败'
  }

  const statusColor: Record<TaskStatus, string> = {
    queued: 'bg-gray-200 text-gray-700',
    running: 'bg-indigo-100 text-indigo-700',
    done: 'bg-green-100 text-green-700',
    error: 'bg-red-100 text-red-700'
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-gray-50 text-gray-600 shrink-0">
          {KIND_ICON[kind]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="truncate font-medium text-gray-800" title={name}>
              {name}
            </div>
            <span
              className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${statusColor[status]}`}
            >
              {statusText[status]}
            </span>
          </div>

          <div className="h-1.5 w-full bg-gray-100 rounded overflow-hidden mb-2">
            <div
              className={chainClassNames(
                'h-full transition-all duration-200 rounded',
                status === 'error'
                  ? 'bg-red-400'
                  : status === 'done'
                    ? 'bg-green-600'
                    : 'bg-indigo-500'
              )}
              style={{ width: `${percent.toFixed(2)}%` }}
            />
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500">
            <span>
              {formatFileSize(sent, { decimalPlaces: 1 })}{' '}
              {total ? `/ ${formatFileSize(total, { decimalPlaces: 1 })}` : ''}
            </span>
            <span>{percent.toFixed(1)}%</span>
            {status === 'running' && speed >= 0 && (
              <span>{formatFileSize(speed, { decimalPlaces: 1 })}/s</span>
            )}
            {status === 'running' && <span>剩余 {eta}</span>}
            {entryIndex !== undefined && entryCount !== undefined && (
              <span className="text-gray-400">
                条目 {entryIndex}/{entryCount}
              </span>
            )}
          </div>

          {status === 'error' && errorMessage && (
            <div
              className="mt-1 text-xs text-red-600 truncate"
              title={errorMessage}
            >
              {errorMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export const TaskCardList = ({
  visibleTasks
}: {
  visibleTasks: TransferTask[]
}) => {
  const dataSource = useMemo(
    () => createDataSource(visibleTasks, t => <TaskCard task={t} />),
    [visibleTasks]
  )

  return (
    <div className="mt-2 p-3 rounded-lg border border-dashed border-gray-300 bg-gray-50/40 cursor-pointer h-[calc(100%-40px)]">
      <EstimatedVirtualList
        wrapperStyle={{ gap: 8 }}
        dataSource={dataSource}
        estimatedSize={50}
        overscanCount={5}
      />
    </div>
  )
}
