import useStore from '@/store'
import { TaskStatus, TransferTask } from '@/types/transfer'
import {
  IconExternalLink,
  IconFile,
  IconFileUnknown,
  IconFileZip,
  IconFolder,
  IconFolderOpen
} from '@tabler/icons-react'
import { invoke } from '@tauri-apps/api/core'
import { join } from '@tauri-apps/api/path'
import {
  chainClassNames,
  createDataSource,
  FixedVirtualList,
  formatFileSize
} from 'ono-react-element'
import { ReactNode, useMemo } from 'react'

/**
 * 卡片固定高度，对齐设计稿的 height:92。
 * 它同时是虚拟列表的 itemSize —— 每行 <li> 的高度会被强制设成这个值，
 * 写小了卡片会溢出压住下一行，所以卡片高度与 itemSize 必须同源。
 * 列表行距 = 92 + gap 10 = 102（设计稿任务列表 gap:10）。
 */
const CARD_HEIGHT = 92

/** 卡片投影：即设计稿的 elevation-1（两层 DROP_SHADOW），走全局 token 不再内联 */
const CARD_SHADOW = 'shadow-[var(--shadow-e1)]'

const KIND_ICON: Record<TransferTask['kind'], ReactNode> = {
  file: <IconFile size={20} stroke={2} />,
  folder: <IconFolder size={20} stroke={2} />,
  batch: <IconFileZip size={20} stroke={2} />,
  unknown: <IconFileUnknown size={20} stroke={2} />
}

const statusText: Record<TaskStatus, string> = {
  queued: '排队中',
  running: '传输中',
  done: '完成',
  error: '失败'
}

/** 徽标配色。排队中用的是 line.100，色板里没有 ink.100（写了不生效、徽标会变透明） */
const statusColor: Record<TaskStatus, string> = {
  queued: 'bg-line-100 text-ink-500',
  running: 'bg-brand-100 text-brand-700',
  done: 'bg-success-100 text-success-600',
  error: 'bg-danger-100 text-danger-600'
}

/** 排队中的进度条是空轨道（设计稿未画填充） */
const statusProgressColor: Record<TaskStatus, string> = {
  queued: '',
  running: 'bg-brand-500',
  done: 'bg-success-600',
  error: 'bg-danger-600'
}

const size = (bytes: number) => formatFileSize(bytes, { decimalPlaces: 1 })

/** 用时：mm:ss，超过 1 小时补上小时段 */
const formatDuration = (ms: number) => {
  const sec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(sec / 3600)
  const mm = Math.floor((sec % 3600) / 60)
    .toString()
    .padStart(2, '0')
  const ss = (sec % 60).toString().padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

const TaskCard = ({ task }: { task: TransferTask }) => {
  const { direction } = task
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
    entryCount,
    startedAt,
    finishedAt
  } = task
  const savePath = useStore('savePath')

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

  // 元信息行固定「主信息 + 副信息」两段；错误信息与副信息同段（danger 色），不再另起一行
  let primaryText = ''
  let secondaryText = ''
  if (status === 'queued') {
    primaryText = total > 0 ? size(total) : ''
    secondaryText = '等待空闲通道'
  } else if (status === 'running') {
    primaryText = `${size(sent)}${total ? ` / ${size(total)}` : ''} · ${percent.toFixed(1)}%`
    secondaryText = `${size(speed)}/s · 剩余 ${eta}`
    if (entryIndex !== undefined && entryCount !== undefined) {
      secondaryText += ` · 条目 ${entryIndex}/${entryCount}`
    }
  } else if (status === 'done') {
    primaryText = entryCount
      ? `${entryCount} 个文件 · ${size(total)}`
      : `${size(total)} · ${percent >= 100 ? '100' : percent.toFixed(1)}%`
    secondaryText =
      startedAt && finishedAt
        ? `用时 ${formatDuration(finishedAt - startedAt)}`
        : ''
  } else {
    primaryText = `${size(total)} · 已中断`
    secondaryText = errorMessage ?? ''
  }

  return (
    <div
      className={chainClassNames(
        'w-full bg-surface-base flex items-center gap-[14px] px-4 rounded-control border border-line-200',
        CARD_SHADOW
      )}
      style={{ height: CARD_HEIGHT }}
    >
      <div
        className={chainClassNames(
          'w-10 h-10 shrink-0 flex justify-center items-center rounded-control',
          status === 'error'
            ? 'bg-danger-100 text-danger-600'
            : 'bg-surface-muted text-ink-600'
        )}
      >
        {KIND_ICON[kind]}
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-[9px]">
        <div className="flex justify-between items-center gap-[10px] text-ink-900 text-card/[1.4615]">
          <p className="truncate font-medium text-ink-900" title={name}>
            {name}
          </p>
          <div
            className={chainClassNames(
              'shrink-0 py-.5 px-2 rounded-pill text-caption/[1.4545] font-medium',
              statusColor[status]
            )}
          >
            {status === 'running' && direction === 'receive'
              ? '接收中'
              : statusText[status]}
          </div>
        </div>

        <div className="h-[5px] w-full bg-line-100 rounded-pill overflow-hidden">
          <div
            className={chainClassNames(
              'h-full transition-all duration-200 rounded-pill',
              statusProgressColor[status]
            )}
            style={{ width: `${percent.toFixed(2)}%` }}
          />
        </div>

        <div className="flex items-center gap-x-3 text-caption/[1.4545]">
          {primaryText && (
            <span className="shrink-0 text-ink-400">{primaryText}</span>
          )}
          {secondaryText && (
            <span
              className={chainClassNames(
                'truncate',
                status === 'error' ? 'text-danger-600' : 'text-ink-500'
              )}
              title={secondaryText}
            >
              {secondaryText}
            </span>
          )}
        </div>
      </div>

      {/* 接收端完成态：打开文件 / 打开保存目录。
          设计稿这两颗是「图标按钮·填充」形态（3:323 fill=surface.muted、无描边），
          悬停叠 6% 黑遮罩 —— 所以底色要写在常驻态，不能只在 hover 时给 surface.muted
          （那样常驻态是无底透明，等于把「填充」错当「描边」用）。 */}
      {status === 'done' && direction === 'receive' && savePath && (
        <>
          <button
            className="shrink-0 w-8 h-8 flex justify-center items-center rounded-chip bg-surface-muted text-ink-600 state-tint hover:text-ink-900 cursor-pointer"
            title="打开文件"
            aria-label="打开文件"
            onClick={async () =>
              invoke('open_file', { path: await join(savePath, name) })
            }
          >
            <IconExternalLink size={15} stroke={2} />
          </button>
          <button
            className="shrink-0 w-8 h-8 flex justify-center items-center rounded-chip bg-surface-muted text-ink-600 state-tint hover:text-ink-900 cursor-pointer"
            title="打开保存目录"
            aria-label="打开保存目录"
            onClick={() => invoke('open_file', { path: savePath })}
          >
            <IconFolderOpen size={15} stroke={2} />
          </button>
        </>
      )}
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
    <div className="h-[calc(100%-122px)]">
      <FixedVirtualList
        wrapperClassName="gap-[10px]"
        containerClassName="scroll_vertical"
        dataSource={dataSource}
        overscan={5}
        itemSize={CARD_HEIGHT}
      />
    </div>
  )
}
