import { listFonts, type FontFamily } from '@/api/fonts'
import { Select } from '@/components'
import { useEffect, useMemo, useState } from 'react'

/**
 * 「跟随系统」在**下拉框里**用的值。
 *
 * 不能直接用空串：实测 `defaultValue=""` 会让下拉框显示成**空白**，看起来像没加载出来
 * （同一页面上另外两个下拉的默认值都是真值，显示正常，只有这个空）。
 * 空串仍然是 store 里的语义值（= 不插用户字体、直接用系统栈），所以只在 UI 层转一次。
 */
const SYSTEM_FONT = '__system__'

interface FontPickerProps {
  value: string
  onChange: (value: string) => void
}

/**
 * 界面字体选择器。
 *
 * 存进 store 的是**可直接写进 CSS font-family 的候选名列表**（如
 * `"微软雅黑", "Microsoft YaHei"`），不是展示名。这样应用根部（useFont）不必再拿一次
 * 字体列表就能直接落值 —— 那份列表只在设置页加载，根部拿不到；顺带的好处是万一枚举失败
 * 或变慢，已经存下的设置照样生效。
 *
 * ⚠️ 本文件有三处在**绕 OnoSelect 当前的行为**（哨兵值 / 给下拉项补回皮肤 / 用
 * optionsClassName 限高），它们表达的不是设计意图。库那边一有变更，就按注释里的「实测」
 * 逐条复验，能删就删 —— 换成自绘选择器时这三块可以整块去掉。
 */
export const FontPicker = ({ value, onChange }: FontPickerProps) => {
  // null = 还在枚举；[] = 枚举完了但一个都没有（字面意义上当失败处理，见下）
  const [fonts, setFonts] = useState<FontFamily[] | null>(null)

  useEffect(() => {
    let alive = true
    listFonts()
      .then(list => {
        if (alive) setFonts(list)
      })
      .catch(e => {
        console.error('[font] 枚举系统字体失败:', e)
        if (alive) setFonts([])
      })
    return () => {
      alive = false
    }
  }, [])

  /* 固定 options 的引用：过滤、选中项查找都基于它，每次渲染都给一个新数组是白白的重算。 */
  const options = useMemo(() => {
    if (!fonts) return null
    // 存着的字体这次没枚举到（比如用户把它卸了）：补一个占位项，
    // 否则 defaultValue 在列表里找不到 → 同样显示空白，用户会以为设置丢了。
    const known = value === '' || fonts.some(f => f.css === value)
    const missing = !known
      ? [
          {
            label: value.replace(/["']/g, '').split(',')[0].trim(),
            value
          }
        ]
      : []
    return [
      { label: '跟随系统', value: SYSTEM_FONT },
      ...missing,
      ...fonts.map(f => ({ label: f.label, value: f.css }))
    ]
  }, [fonts, value])

  if (fonts === null) {
    return <p className="text-body/[1.4167] text-ink-400">正在读取系统字体…</p>
  }

  /* 一个字体都没枚举到：此时下拉里只会剩「跟随系统」一项，反而让人以为
     「我这台机器就一个字体」。不如直说读不到，也不给一个只能点「跟随系统」的控件。 */
  if (fonts.length === 0) {
    return <p className="text-body/[1.4167] text-ink-400">读不到系统字体列表</p>
  }

  return (
    <Select
      optionsClassName="max-h-[200px] overflow-y-auto overscroll-contain"
      defaultValue={value || SYSTEM_FONT}
      filterOption
      notFoundContent="没有匹配的字体"
      options={options!}
      fontFamily={value => (value === SYSTEM_FONT ? undefined : value)}
      onChange={v =>
        typeof v === 'string' && onChange(v === SYSTEM_FONT ? '' : v)
      }
    />
  )
}
