import { Popover } from 'ono-react-element'
import type { ReactNode } from 'react'

interface TipProps {
  /** 气泡内容 */
  content: ReactNode
  /** 长文本形态：固定 240 宽把文字逼出换行（设计稿的两种形态之一），默认跟着内容收 */
  wide?: boolean
  children: ReactNode
  placement?:
    | 'top'
    | 'bottom'
    | 'left'
    | 'right'
    | 'top-start'
    | 'left-start'
    | 'right-start'
    | 'top-end'
    | 'bottom-end'
    | 'left-end'
    | 'right-end'
}

/**
 * 悬浮说明气泡，对齐设计规范「08 悬浮说明」（画布 65:1）。
 *
 * 视觉全部交给 global.css 的 .tooltip-bubble —— 那里同时负责中和 ono Popover
 * 自带的深色皮肤与内层投影，改规格只需改一处。这里只管行为：
 * 悬停触发、优先出现在触发点上方、300ms 后淡入、不加箭头。
 */
export const Tip = ({
  content,
  wide,
  children,
  placement = 'top'
}: TipProps) => (
  <Popover
    trigger="hover"
    placement={placement}
    mouseDelay={300}
    content={content}
    isShowArrow={false}
    className={wide ? 'tooltip-bubble tooltip-bubble-wide' : 'tooltip-bubble'}
  >
    {children}
  </Popover>
)
