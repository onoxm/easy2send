import { notifyDisconnect } from '@/api/discovery'
import {
  cancelTransferTasks,
  createTransferTasks,
  openFile,
  startTransferTask,
  type TransferTaskSeed
} from '@/api/fs'
import { stopWebUpload } from '@/api/webupload'
import { BackButton, confirmDialog, Layout, PlatformIcon } from '@/components'
import { useNotification, useQuery, useTauriDrag } from '@/hooks'
import { useStore } from '@/store'
import type { TransferTask, TransferType } from '@/types'
import {
  IconArrowBarToDown,
  IconArrowUp,
  IconFolder
} from '@tabler/icons-react'
import { Event, listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { AutoSliderList, chainClassNames } from 'ono-react-element'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { EmptyPanel } from './EmptyPanel'
import { TaskCardList } from './TaskCardList'

/** 终态：进入这些状态时要记下结束时刻（卡片据此算「用时」） */
const isEndStatus = (status?: TransferTask['status']) =>
  status === 'done' || status === 'error' || status === 'interrupted'

/** v2 传输事件里 progress 的字段（send / receive 两种事件的 payload 完全一致） */
interface ProgressPayload {
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

export default () => {
  const { connectedDevice, concurrentUploads, ip, port, savePath } = useStore([
    'ip',
    'port',
    'savePath',
    'connectedDevice',
    'concurrentUploads'
  ])
  const navigate = useNavigate()
  const tab = useQuery().tab as TransferType | null
  const sendNotification = useNotification()

  const [activeTab, setActiveTab] = useState<TransferType>(tab || 'send')

  const tabList = [
    {
      type: 'send' as const,
      txt: '发送任务',
      icon: <IconArrowUp stroke={2} />
    },
    {
      type: 'receive' as const,
      txt: '接收任务',
      icon: <IconArrowBarToDown stroke={2} />
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
          // 只在第一次进入 running / 结束态时打点，卡片用它算「用时」
          startedAt:
            old?.startedAt ?? (patch.status === 'running' ? now : undefined),
          finishedAt:
            old?.finishedAt ?? (isEndStatus(patch.status) ? now : undefined),
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
  const recvRunningRef = useRef(0)
  // 接收完成防抖定时器：递减到 0 后延迟触发通知，期间若有新任务到达则重置
  const recvCompleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
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

    /** send / receive 的 progress 事件字段完全一致，只有方向不同 —— 合成一条 */
    const applyProgress = (
      ev: Event<ProgressPayload>,
      direction: 'send' | 'receive'
    ) => {
      const p = ev.payload
      if (unmounted) return
      upsertTask(p.task_id, {
        direction,
        sent: p.sent,
        total: p.total,
        percent: p.percent,
        speed: p.speed ?? 0,
        status: 'running',
        // name / kind 缺省时**不覆盖**已有值：receive-complete 事件默认填
        // 「传输完成」，覆盖上去会把 start/progress 已设置的真实文件名换掉
        ...(p.name !== undefined ? { name: p.name } : {}),
        ...(p.kind !== undefined ? { kind: p.kind } : {}),
        entryIndex: p.entry_index,
        entryCount: p.entry_count
      })
    }

    /**
     * send 任务收尾：归还一个并发额度，并把排队中的下一个补上去。
     *
     * 通知只给 complete / error ——「断开连接」造成的中断不给，那是用户自己的
     * 动作、页面随即就要卸载，再弹一句「发送完成」是错的。
     */
    const settleSend = (notify: boolean) => {
      runningCountRef.current = Math.max(0, runningCountRef.current - 1)
      flushSchedule()
      if (
        notify &&
        runningCountRef.current === 0 &&
        seedsQueueRef.current.length === 0
      ) {
        sendNotification('发送完成')
      }
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
      settleSend(true)
    }
    const handleSendError = (ev: Event<Record<string, unknown>>) => {
      const p = ev.payload as { task_id: string; message: string }
      if (unmounted) return
      upsertTask(p.task_id, {
        direction: 'send',
        status: 'error',
        errorMessage: p.message
      })
      settleSend(true)
    }

    // 后端确认任务已停下。走「断开连接」时通常收不到这条 —— 页面那时已经卸载、
    // 监听器也被清掉了（那条路径由 disconnectNow 自己标记）。留着它是为了将来
    // 「取消单个任务」这类不离开页面的中断，以及后端先行中断的情况
    const handleSendCancelled = (ev: Event<Record<string, unknown>>) => {
      const p = ev.payload as { task_id: string }
      if (unmounted) return
      upsertTask(p.task_id, { direction: 'send', status: 'interrupted' })
      settleSend(false)
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
      recvRunningRef.current += 1
      // 新任务到达：取消挂起的完成通知定时器
      if (recvCompleteTimerRef.current) {
        clearTimeout(recvCompleteTimerRef.current)
        recvCompleteTimerRef.current = null
      }
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
      recvRunningRef.current = Math.max(0, recvRunningRef.current - 1)
      if (recvRunningRef.current === 0) {
        // 延迟 200ms 再触发：等待是否还有后续接收任务到达，
        // 期间若收到新的 receive-start 会清除本定时器，避免误报完成。
        if (recvCompleteTimerRef.current) {
          clearTimeout(recvCompleteTimerRef.current)
        }
        recvCompleteTimerRef.current = setTimeout(() => {
          recvCompleteTimerRef.current = null
          if (unmounted) return
          if (recvRunningRef.current === 0) {
            sendNotification('接收完成')
          }
        }, 200)
      }
    }

    const proms = [
      listen<ProgressPayload>('send-progress-v2', ev =>
        applyProgress(ev, 'send')
      ),
      listen('send-complete-v2', handleSendComplete),
      listen('send-error-v2', handleSendError),
      listen('send-cancelled-v2', handleSendCancelled),
      listen('receive-start-v2', handleRecvStart),
      listen<ProgressPayload>('receive-progress-v2', ev =>
        applyProgress(ev, 'receive')
      ),
      listen('receive-complete-v2', handleRecvComplete)
    ]

    return () => {
      unmounted = true
      if (recvCompleteTimerRef.current) {
        clearTimeout(recvCompleteTimerRef.current)
        recvCompleteTimerRef.current = null
      }
      Promise.all(proms).then(fns => fns.forEach(f => f()))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendNotification])

  // ---------------- 路由守卫 ----------------
  useEffect(() => {
    if (!connectedDevice) navigate('/')
  }, [connectedDevice, navigate])

  if (!connectedDevice) return null

  // 结束本次会话：停掉本机为它开启的服务、清掉连接状态、回首页。
  // 「返回」与「断开连接」都走这里 —— 前者不打断进行中的任务，后者会。
  const teardown = () => {
    // 手机上传模式：退出传输页时停止 HTTP 服务器
    if (connectedDevice?.deviceId === 'web-upload') {
      stopWebUpload().catch(() => {})
    }
    useStore.setState({ connectedDevice: null })
    navigate('/')
  }

  const handleBack = () => teardown()

  /** 把任务标成「已中断」。走 upsertTask 是为了让结束时刻等字段由它统一补齐 */
  const markInterrupted = (ids: string[]) => {
    for (const id of ids) upsertTask(id, { status: 'interrupted' })
  }

  const disconnectNow = (pending: TransferTask[]) => {
    if (pending.length > 0) {
      // 1) 让后端真的停下来。只改前端状态的话，文件其实还在往外发
      const startedIds = pending
        .filter(t => t.direction === 'send' && t.status === 'running')
        .map(t => t.id)
      if (startedIds.length > 0) {
        cancelTransferTasks(startedIds).catch(() => {})
      }
      // 2) 还没轮到发的直接从队列里丢掉，否则调度器会接着把它们发出去
      seedsQueueRef.current = []
      runningCountRef.current = 0
      // 3) 前端状态立刻落定。不等后端回 send-cancelled-v2 —— 页面随即就要卸载，
      //    那时候监听器已经被清掉，事件没人收了
      markInterrupted(pending.map(t => t.id))
    }

    // 通知对方也结束这次会话。失败静默：断开是本机单方面就能完成的动作，
    // 对方可能已经关机、断网，没理由因此卡住。手机网页端没有这条协议，跳过。
    if (addr && connectedDevice?.deviceId !== 'web-upload') {
      notifyDisconnect(addr).catch(() => {})
    }

    teardown()
  }

  /** 断开连接：结束会话并通知对方，对方收到后也会回到首页 */
  const handleDisconnect = () => {
    // 进行中的任务是「断开」与「返回」的全部区别 —— 有它们才值得问一句。
    // 接收方向也算：对方会因这条断开通知而停发，我这边的接收同样会断
    const pending = Object.values(tasks).filter(
      t => t.status === 'running' || t.status === 'queued'
    )
    if (pending.length === 0) {
      disconnectNow([])
      return
    }
    confirmDialog({
      title: '断开连接',
      description: `还有 ${pending.length} 个任务未完成，断开后会被中断`,
      confirmText: '断开',
      danger: true,
      onConfirm: () => disconnectNow(pending)
    })
  }

  const visibleTasks = Object.values(tasks)
    .filter(t => t.direction === activeTab)
    .sort((a, b) => a.createdAt - b.createdAt)

  return (
    <Layout>
      <div className="h-full flex flex-col w-[92%] gap-[14px]">
        <div className="flex gap-3 items-center">
          <BackButton onClick={handleBack} />

          <div className="flex-1 flex flex-col gap-.75">
            <div className="flex items-center gap-[7px] text-ink-900">
              <PlatformIcon platform={connectedDevice.platform} size={16} />
              <span className="peer-name">{connectedDevice.deviceName}</span>
            </div>
            <div className="flex items-center gap-[6px]">
              <div className="w-[6px] h-[6px] rounded-full bg-success-600"></div>
              <p className="text-caption/[1.4545] text-ink-400 font-normal">
                已连接 ·{' '}
                {connectedDevice.deviceId === 'web-upload'
                  ? `http://${ip}:${port}`
                  : `${connectedDevice.ip}:${connectedDevice.port}`}
              </p>
            </div>
          </div>

          <button
            className="bg-surface-base border border-line-200 rounded-md text-ink-700 text-body/[1.4167] font-medium py-[7.5px] px-3 state-neutral"
            onClick={handleDisconnect}
          >
            断开连接
          </button>
        </div>

        <div className="flex justify-between">
          <AutoSliderList
            list={tabList}
            className="bg-line-100 border border-line-200 flex gap-[3px] p-[3px] rounded-md"
            currentIndex={tabList.findIndex(t => t.type === activeTab)}
            slider={Slider => (
              <Slider className="bg-surface-base rounded-md shadow-[var(--shadow-segment)]" />
            )}
          >
            {({ item: { type, txt, icon }, isActive }) => (
              <button
                className={chainClassNames(
                  'flex items-center gap-[7px] h-8 px-3.5 disabled:cursor-not-allowed',
                  isActive ? 'text-ink-900' : 'text-ink-500'
                )}
                disabled={type === 'send' && connectedDevice.platform === 'web'}
                onClick={() => setActiveTab(type)}
              >
                {icon}
                <span className="text-body/[1.4167]">{txt}</span>
                {Object.values(tasks).filter(t => t.direction === type).length >
                  0 && (
                  <span className="count-badge bg-brand-100 text-brand-700 rounded-full min-w-[22px] min-h-[22px] flex items-center justify-center">
                    {
                      Object.values(tasks).filter(t => t.direction === type)
                        .length
                    }
                  </span>
                )}
              </button>
            )}
          </AutoSliderList>

          <button
            className="bg-surface-base flex items-center border border-line-200 gap-[7px] rounded-md py-[8.5px] px-3.5 state-neutral"
            onClick={() => openFile(savePath)}
          >
            <span className="text-ink-600">
              <IconFolder size={15} stroke={2} />
            </span>
            <span className="text-ink-700 text-card/[1.4615] font-medium">
              打开保存目录
            </span>
          </button>
        </div>

        {visibleTasks.length === 0 ? (
          <EmptyPanel tab={activeTab} onPick={handlerPickFiles} />
        ) : (
          <TaskCardList visibleTasks={visibleTasks} />
        )}
      </div>
    </Layout>
  )
}
