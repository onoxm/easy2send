import type { Event } from '@tauri-apps/api/event'
import { type DragDropEvent, getCurrentWebview } from '@tauri-apps/api/webview'
import { DependencyList, useEffect } from 'react'

export const useTauriDrag = (
  handler: (event: Event<DragDropEvent>) => void,
  deps: DependencyList = []
) => {
  useEffect(() => {
    const webview = getCurrentWebview()
    let unlisten: (() => void) | undefined

    // 注册拖放事件监听
    webview.onDragDropEvent(handler).then(unlistenFn => {
      unlisten = unlistenFn
    })

    // 组件卸载时取消监听
    return () => {
      if (unlisten) unlisten()
    }
  }, deps)
}
