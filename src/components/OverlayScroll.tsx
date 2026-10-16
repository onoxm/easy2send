import { OverlayScrollbars, type PartialOptions } from 'overlayscrollbars'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'

/** defer：true 走默认超时，也可以直接给 requestIdleCallback 的选项 */
type DeferOption = boolean | IdleRequestOptions

interface OverlayScrollProps {
  className?: string
  options?: PartialOptions
  defer?: DeferOption
  children: ReactNode
}

/**
 * 把初始化推迟到浏览器空闲、再等一帧，避免它跟首屏渲染抢主线程。
 * 调度与 overlayscrollbars-react 内置的那套一致：有 requestIdleCallback 就用它，
 * 没有则退化成 requestAnimationFrame。
 */
const useDeferrer = () =>
  useMemo(() => {
    let idleId: number | undefined
    let frameId: number | undefined

    const cancel = () => {
      if (idleId !== undefined) window.cancelIdleCallback(idleId)
      if (frameId !== undefined) window.cancelAnimationFrame(frameId)
      idleId = frameId = undefined
    }

    const schedule = (task: () => void, defer: DeferOption) => {
      cancel()
      if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(
          () => {
            cancel()
            frameId = window.requestAnimationFrame(task)
          },
          typeof defer === 'object' ? defer : { timeout: 2233 }
        )
      } else {
        frameId = window.requestAnimationFrame(task)
      }
    }

    return [schedule, cancel] as const
  }, [])

/**
 * OverlayScrollbars 的 React 绑定（自持，用来替掉 overlayscrollbars-react 依赖）。
 *
 * 行为按官方那个包的实现逐条对齐，需要换回去时能对上：
 *
 * ① **必须自己提供 viewport 容器**，并把 `elements: { viewport, content }` 传进去。
 *    不传的话 OverlayScrollbars 会自建 viewport、再把已有的子节点**搬走** —— 之后
 *    React 插入新节点时挂的仍是外层 host（fiber 里记的是它），新节点就落在 viewport
 *    外面：列表新增的行看不见、也不跟着滚动。所以子节点始终留在 React 渲染的这个
 *    div 里，从头到尾没被移动过。
 * ② 卸载时要**既取消待执行的初始化、又销毁实例**。StrictMode 下 effect 会
 *    挂载 → 卸载 → 再挂载，只销毁不取消的话，上一次排队的空闲回调醒来后仍会去初始化。
 */
export const OverlayScroll = ({
  className,
  options,
  defer,
  children
}: OverlayScrollProps) => {
  const hostRef = useRef<HTMLDivElement>(null)
  const contentsRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<OverlayScrollbars | undefined>(undefined)
  const [schedule, cancelSchedule] = useDeferrer()

  // 初始化可能被推迟到空闲，所以回调要读「当时最新」的入参，而不是闭包里的首次值
  const optionsRef = useRef(options)
  const deferRef = useRef(defer)

  useEffect(() => {
    deferRef.current = defer
  }, [defer])

  // 配置变了就地更新（第二个参数是 force），不重建实例 —— 重建会把滚动位置丢掉
  useEffect(() => {
    optionsRef.current = options
    const instance = instanceRef.current
    if (OverlayScrollbars.valid(instance)) {
      instance.options(options ?? {}, true)
    }
  }, [options])

  useEffect(() => {
    const host = hostRef.current
    const contents = contentsRef.current
    if (!host || !contents) return
    // 已经活着就不重复初始化（StrictMode 下这个 effect 会跑两次）
    if (OverlayScrollbars.valid(instanceRef.current)) return

    const init = () => {
      instanceRef.current = OverlayScrollbars(
        { target: host, elements: { viewport: contents, content: contents } },
        optionsRef.current ?? {}
      )
    }

    if (deferRef.current) {
      schedule(init, deferRef.current)
    } else {
      init()
    }

    return () => {
      cancelSchedule()
      instanceRef.current?.destroy()
      instanceRef.current = undefined
    }
  }, [schedule, cancelSchedule])

  return (
    <div
      ref={hostRef}
      data-overlayscrollbars-initialize=""
      className={className}
    >
      <div ref={contentsRef} data-overlayscrollbars-contents="">
        {children}
      </div>
    </div>
  )
}
