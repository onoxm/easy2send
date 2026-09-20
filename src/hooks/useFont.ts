import useStore from '@/store'
import { useLayoutEffect } from 'react'

/**
 * 字体设置只有一个出口：<html> 上的 data-font-user 标记 + 两个内联自定义属性。
 *
 * 为什么走 CSS 变量而不是让组件读 store 再拼 className：与主题同一套路数 ——
 * variables.css 的 --font-family-sans / --font-size-* 是所有样式的上游，改这两处即全局
 * 生效，不需要任何组件重渲染。
 */
const applyFont = (fontFamily: string, fontScale: number) => {
  const root = document.documentElement

  if (fontFamily) {
    // 顺序要紧：先写变量、再打标记。global.css 里 :root[data-font-user] 那条规则会引用
    // var(--font-family-user)，反过来先打标记，中间就有一瞬引用到尚未写入的变量。
    root.style.setProperty('--font-family-user', fontFamily)
    root.dataset.fontUser = '1'
  } else {
    // 「跟随系统」= 撤掉这两样，--font-family-sans 自然回落成 variables.css 的系统栈
    delete root.dataset.fontUser
    root.style.removeProperty('--font-family-user')
  }

  // 内联自定义属性优先级最高，直接盖过 variables.css 里 --font-scale 的默认值。
  root.style.setProperty('--font-scale', String(fontScale / 100))
}

/**
 * 界面字体与字号缩放。
 *
 * 用 useLayoutEffect 而不是 useEffect：后者要等浏览器画完这一帧才跑，启动时会先按
 * 系统字体画一帧、再跳成用户选的字体 —— 与 useTheme 同一个理由。
 */
export const useFont = () => {
  // store 的持久化存储是 localStorage（同步），首帧就能拿到存下来的值，不会闪。
  // 注意 useStore([...]) 返回的是**对象**（与 useTheme 的单键调用不同）。
  const { fontFamily, fontScale } = useStore(['fontFamily', 'fontScale'])

  useLayoutEffect(() => {
    applyFont(fontFamily, fontScale)
  }, [fontFamily, fontScale])
}
