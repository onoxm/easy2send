import type { Platform } from '@/types'
import { chainClassNames } from 'ono-react-element'
import type { ReactNode } from 'react'
import { PlatformIcon } from './PlatformIcon'

/**
 * 设备身份块：名称 + 一行副信息（图标由 PeerAvatar 摆在它左边）。
 *
 * 三处共用同一套排版 —— 首页设备列表、连接请求弹窗、设置页的已信任设备列表；
 * 差别只在副信息写什么（地址 / 地址端口 / 最近连接时间）和外面那层容器。
 * 设置页那一行没有图标，正好也用不上 PeerAvatar。
 *
 * 两个 p 都带 truncate、容器带 min-w-0：原先只有设置页这么写，另两处遇到超长
 * 设备名会**顶开右侧的按钮/箭头**（flex 子项默认 min-width:auto 不收缩）。
 * 统一补上是顺带修掉这个溢出，不是纯样式统一。
 */
export const PeerIdentity = ({
  name,
  subtitle,
  className
}: {
  name: string
  subtitle: ReactNode
  className?: string
}) => (
  <div
    className={chainClassNames(
      'flex flex-1 flex-col gap-[3px] min-w-0 text-left',
      className
    )}
  >
    <p className="text-ink-900 text-card/[1.4615] truncate">{name}</p>
    <p className="text-caption text-ink-400 font-normal truncate">{subtitle}</p>
  </div>
)

/** 身份块左侧的图标位（36×36 · surface.muted 底） */
export const PeerAvatar = ({ platform }: { platform: Platform }) => (
  <div className="w-9 h-9 shrink-0 bg-surface-muted rounded-md flex justify-center items-center text-ink-600">
    <PlatformIcon platform={platform} size={20} />
  </div>
)
