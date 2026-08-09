import {
  createTransferTasks,
  startTransferTask,
  type TransferTaskSeed
} from '@/api/fs'
import { ICON_INFO } from '@/common/common'
// import { useNotification, useTauriDrag } from '@/hooks'
import { useTauriDrag } from '@/hooks'
import { platformIcon } from '@/pages'
import useStore from '@/store'
import { Back, Receive, Send } from '@icon-park/react'
import { Event, listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { chainClassNames } from 'ono-react-element'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { EmptyPanel } from './EmptyPanel'
import { TaskCardList } from './TaskCardList'

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

export default () => {
  const connectedDevice = useStore('connectedDevice')
  const concurrentUploads = useStore('concurrentUploads')
  const navigate = useNavigate()
  //   const sendNotification = useNotification()

  const [activeTab, setActiveTab] = useState<TransferType>('send')

  const tabList = [
    {
      type: 'send' as const,
      txt: '发送任务',
      icon: (bl: boolean) => (
        <Send {...ICON_INFO} fill={bl ? '#6366f1' : '#333'} strokeWidth={2} />
      )
    },
    {
      type: 'receive' as const,
      txt: '接收任务',
      icon: (bl: boolean) => (
        <Receive
          {...ICON_INFO}
          fill={bl ? '#6366f1' : '#333'}
          strokeWidth={2}
        />
      )
    }
  ]

  const [tasks, setTasks] = useState<Record<string, TransferTask>>({})

  // ---------------- 工具：更新/插入任务 ----------------
  const upsertTask = (id: string, patch: Partial<TransferTask>) => {
    setTasks(prev => {
      const old = prev[id]
      const now = Date.now()
      return {
        ...prev,
        [id]: {
          id,
          direction: patch.direction ?? old?.direction ?? 'send',
          name: patch.name ?? old?.name ?? '',
          path: patch.path ?? old?.path,
          total: patch.total ?? old?.total ?? 0,
          sent: patch.sent ?? old?.sent ?? 0,
          percent: patch.percent ?? old?.percent ?? 0,
          speed: patch.speed ?? old?.speed ?? 0,
          status: patch.status ?? old?.status ?? 'queued',
          kind: patch.kind ?? old?.kind ?? 'unknown',
          errorMessage: patch.errorMessage ?? old?.errorMessage,
          entryIndex: patch.entryIndex ?? old?.entryIndex,
          entryCount: patch.entryCount ?? old?.entryCount,
          createdAt: old?.createdAt ?? now
        }
      }
    })
  }

  // ---------------- 并发发送调度 ----------------
  // 每次选到新文件：先 createTransferTasks 拿到 seeds，全部插到 tasks[status=queued]
  // 再用 ref 里的"当前 running 计数器 + 并发上限"轮询调度 startTransferTask
  const seedsQueueRef = useRef<TransferTaskSeed[]>([])
  const runningCountRef = useRef(0)
  const addr = connectedDevice
    ? `${connectedDevice.ip}:${connectedDevice.port}`
    : ''

  // 调度：只要 running < concurrentUploads 且 seedsQueue 有值就启动
  const flushSchedule = () => {
    while (
      runningCountRef.current < concurrentUploads &&
      seedsQueueRef.current.length > 0
    ) {
      const seed = seedsQueueRef.current.shift()!
      runningCountRef.current += 1
      upsertTask(seed.task_id, { status: 'running' })
      startTransferTask(addr, seed.task_id, seed.path).catch(err => {
        upsertTask(seed.task_id, {
          status: 'error',
          errorMessage: String(err)
        })
        runningCountRef.current = Math.max(0, runningCountRef.current - 1)
        flushSchedule()
      })
    }
  }

  const createAndEnqueue = async (paths: string[]) => {
    if (!addr) return
    const valid = paths.filter(p => p && p.length > 0)
    if (valid.length === 0) return
    const seeds = await createTransferTasks(addr, valid)
    // 先全部插入队列（status=queued）
    const now = Date.now()
    setTasks(prev => {
      const next = { ...prev }
      for (const s of seeds) {
        next[s.task_id] = {
          id: s.task_id,
          direction: 'send',
          name: s.name,
          path: s.path,
          total: 0,
          sent: 0,
          percent: 0,
          speed: 0,
          status: 'queued',
          kind: 'unknown',
          createdAt: now
        }
      }
      return next
    })
    seedsQueueRef.current.push(...seeds)
    flushSchedule()
  }

  // ---------------- UI 事件：点击选文件 / 拖拽 ----------------
  const handlerPickFiles = async () => {
    const picked = await open({
      multiple: true,
      title: '选择要发送的文件或文件夹（支持多选，按并发设置自动排队）'
    })
    if (!picked) return
    const paths = Array.isArray(picked) ? picked : [picked]
    createAndEnqueue(paths)
  }

  useTauriDrag(
    e => {
      if (e.payload.type === 'drop' && activeTab === 'send') {
        createAndEnqueue((e.payload as { paths: string[] }).paths).catch(
          console.error
        )
      }
    },
    [activeTab, addr]
  )

  // ---------------- 监听 v2 事件（按 task_id 分条更新） ----------------
  useEffect(() => {
    let unmounted = false
    const handleSendProgress = (ev: Event<Record<string, unknown>>) => {
      const p = ev.payload as {
        task_id: string
        sent: number
        total: number
        percent: number
        speed?: number
        name?: string
        kind?: TransferTask['kind']
        entry_index?: number
        entry_count?: number
      }
      if (unmounted) return
      upsertTask(p.task_id, {
        direction: 'send',
        sent: p.sent,
        total: p.total,
        percent: p.percent,
        speed: p.speed ?? 0,
        ...(p.name !== undefined ? { name: p.name } : {}),
        ...(p.kind !== undefined ? { kind: p.kind } : {}),
        status: 'running',
        entryIndex: p.entry_index,
        entryCount: p.entry_count
      })
    }
    const handleSendComplete = (ev: Event<Record<string, unknown>>) => {
      const p = ev.payload as {
        task_id: string
        name?: string
        kind?: TransferTask['kind']
      }
      if (unmounted) return
      upsertTask(p.task_id, {
        direction: 'send',
        status: 'done',
        percent: 100,
        ...(p.name !== undefined ? { name: p.name } : {}),
        ...(p.kind !== undefined ? { kind: p.kind } : {})
      })
      runningCountRef.current = Math.max(0, runningCountRef.current - 1)
      flushSchedule()
      //   sendNotification('发送完成')
    }
    const handleSendError = (ev: Event<Record<string, unknown>>) => {
      const p = ev.payload as { task_id: string; message: string }
      if (unmounted) return
      upsertTask(p.task_id, {
        direction: 'send',
        status: 'error',
        errorMessage: p.message
      })
      runningCountRef.current = Math.max(0, runningCountRef.current - 1)
      flushSchedule()
    }

    const handleRecvStart = (ev: Event<Record<string, unknown>>) => {
      const p = ev.payload as {
        task_id: string
        name: string
        total_size: number
        kind?: TransferTask['kind']
      }
      if (unmounted) return
      upsertTask(p.task_id, {
        direction: 'receive',
        name: p.name,
        total: p.total_size,
        sent: 0,
        percent: 0,
        speed: 0,
        status: 'running',
        kind: p.kind ?? 'unknown'
      })
      // 有接收任务时自动切到接收 tab
      setActiveTab('receive')
    }
    const handleRecvProgress = (ev: Event<Record<string, unknown>>) => {
      const p = ev.payload as {
        task_id: string
        sent: number
        total: number
        percent: number
        speed?: number
        name?: string
        kind?: TransferTask['kind']
        entry_index?: number
        entry_count?: number
      }
      if (unmounted) return
      upsertTask(p.task_id, {
        direction: 'receive',
        sent: p.sent,
        total: p.total,
        percent: p.percent,
        speed: p.speed ?? 0,
        status: 'running',
        ...(p.name !== undefined ? { name: p.name } : {}),
        ...(p.kind !== undefined ? { kind: p.kind } : {}),
        entryIndex: p.entry_index,
        entryCount: p.entry_count
      })
    }
    const handleRecvComplete = (ev: Event<Record<string, unknown>>) => {
      const p = ev.payload as { task_id: string }
      if (unmounted) return
      // 不覆盖 name：后端 complete 事件默认填 "传输完成"，
      // 会替换掉 start/progress 已设置的真实文件名。
      upsertTask(p.task_id, {
        direction: 'receive',
        status: 'done',
        percent: 100
      })
      //   sendNotification('接收完成')
    }

    const proms = [
      listen('send-progress-v2', handleSendProgress),
      listen('send-complete-v2', handleSendComplete),
      listen('send-error-v2', handleSendError),
      listen('receive-start-v2', handleRecvStart),
      listen('receive-progress-v2', handleRecvProgress),
      listen('receive-complete-v2', handleRecvComplete)
    ]

    return () => {
      unmounted = true
      Promise.all(proms).then(fns => fns.forEach(f => f()))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  //   }, [sendNotification])

  // ---------------- 路由守卫 ----------------
  useEffect(() => {
    if (!connectedDevice) navigate('/')
  }, [connectedDevice, navigate])

  if (!connectedDevice) return null

  const handleBack = () => {
    useStore.setState({ connectedDevice: null })
    navigate('/')
  }

  const visibleTasks = Object.values(tasks)
    .filter(t => t.direction === activeTab)
    .sort((a, b) => a.createdAt - b.createdAt)

  return (
    <div className="h-[calc(100%-28px)] flex flex-col p-5 mx-auto w-[92%]">
      <div className="flex justify-between items-center mb-4">
        <button
          className="flex items-center gap-2 p-2 border border-solid border-[#333] rounded-[30px] hover:bg-gray-50"
          onClick={handleBack}
        >
          <Back {...ICON_INFO} strokeWidth={2} />
          <span>返回首页</span>
        </button>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className="text-xl">
            {platformIcon[connectedDevice.platform]}
          </span>
          <span className="truncate max-w-[260px]">
            {connectedDevice.deviceName} ({connectedDevice.ip}:
            {connectedDevice.port})
          </span>
        </div>
      </div>

      <div className="h-[calc(100%-58px)] flex flex-col">
        <div className="flex gap-1 border-b border-gray-200">
          {tabList.map(({ type, txt, icon }) => (
            <button
              key={type}
              className={chainClassNames(
                'flex items-center gap-2 px-4 py-2 -mb-px border-b-2 transition',
                activeTab === type
                  ? 'border-indigo-500 text-indigo-600 font-semibold'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
              onClick={() => setActiveTab(type)}
            >
              {icon(activeTab === type)}
              <span>{txt}</span>
              {Object.values(tasks).filter(t => t.direction === type).length >
                0 && (
                <span className="text-xs bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded-full min-w-[22px] text-center">
                  {
                    Object.values(tasks).filter(t => t.direction === type)
                      .length
                  }
                </span>
              )}
            </button>
          ))}
        </div>

        {visibleTasks.length === 0 ? (
          <EmptyPanel tab={activeTab} onPick={handlerPickFiles} />
        ) : (
          <TaskCardList visibleTasks={visibleTasks} />
        )}
      </div>
    </div>
  )
}
