import useStore from '@/store'
import type { ThemeType } from 'ono-react-element'
import { useTheme as innerUseTheme } from 'ono-react-element'

/** 三态循环顺序：跟随系统 → 浅色 → 深色 */
const THEME_ORDER: ThemeType[] = ['system', 'light', 'dark']

const systemPrefersDark = () =>
  window.matchMedia('(prefers-color-scheme: dark)').matches

/** 把模式解析成实际生效的主题 */
const resolveTheme = (mode: ThemeType): 'light' | 'dark' =>
  mode === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : mode

/**
 * 主题只有一个出口：<html> 上的 dark 类。
 * variables.css 的 :root.dark 覆盖全部颜色令牌，而 UnoCSS 的 bg-* / text-* 都指向
 * 那些变量，所以切主题是纯 CSS 生效，不需要任何组件重渲染。
 */
const applyTheme = (mode: ThemeType) => {
  document.documentElement.classList.toggle(
    'dark',
    resolveTheme(mode) === 'dark'
  )
}

/**
 * 主题三态：跟随系统（默认） / 浅色 / 深色。
 *
 * 用 useLayoutEffect 而不是 useEffect：后者要等浏览器画完这一帧才跑，
 * 深色主题在首次挂载时会先闪一帧浅色再翻转。
 */
export const useTheme = () => {
  const theme = useStore('theme')

  innerUseTheme({
    theme,
    onDark: () => applyTheme('dark'),
    onLight: () => applyTheme('light')
  })

  /** 循环切换：跟随系统 → 浅色 → 深色 → 跟随系统 */
  const cycleTheme = () =>
    useStore.setState({
      theme: THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]
    })

  return { theme, cycleTheme }
}
