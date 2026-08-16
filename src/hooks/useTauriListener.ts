import { type Event, type UnlistenFn, listen } from '@tauri-apps/api/event'
import { type DependencyList, useEffect } from 'react'

// 事件映射类型：事件名 -> payload 类型
type EventMap = Record<string, any>

// 根据事件映射生成监听器对象类型
type ListenerMap<T extends EventMap> = {
  [K in keyof T]?: (event: Event<T[K]>) => void
}

export const useTauriListener = <T>(
  eventName: string,
  callback: (event: Event<T>) => void,
  deps: DependencyList = []
) => {
  useEffect(() => {
    const unlisten = listen<T>(eventName, callback)

    return () => {
      unlisten.then(fn => fn())
    }
  }, deps)
}

export const useTauriListeners = <T extends EventMap>(
  listeners: ListenerMap<T>,
  deps: DependencyList = []
) => {
  useEffect(() => {
    const unlistens: Promise<UnlistenFn>[] = []

    for (const [eventName, callback] of Object.entries(listeners)) {
      if (callback) {
        unlistens.push(
          listen(eventName, callback as (event: Event<any>) => void)
        )
      }
    }

    return () => {
      unlistens.forEach(promise => promise.then(unlisten => unlisten()))
    }
  }, deps)
}
