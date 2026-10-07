import { chainClassNames, TemplateDialog } from 'ono-react-element'
import type { ReactNode } from 'react'

/**
 * 弹窗骨架。
 *
 * 五个弹窗（确认 / 连接请求 / 手动连接 / 二维码 / 更新）的 TemplateDialog 外壳逐字
 * 相同，只有宽度与内边距有别，所以把「不变的那部分」收在这里：皮肤（surface.base +
 * card 圆角 + e3 投影）、右键菜单屏蔽、入场动画、关闭入口。调用方只传自己的尺寸类名。
 *
 * children 保持 TemplateDialog 的 render prop 形态（收到的是「带动画收起的关闭函数」），
 * 不在骨架里摊平成 `onConfirm` 之类的 props —— 关闭时机各家不同（确认弹窗要先关再回调、
 * 二维码弹窗要按是否已配对决定停不停服务器），摊平会把这些差异赶回调用方重写一遍。
 */
interface DialogShellProps {
  /** 尺寸与内边距（如 'w-110 p-7 gap-4'）；皮肤与 flex-col 已由骨架提供 */
  className?: string
  /** 关闭入口：右上角 / ESC / 点遮罩都会走到这里 */
  onClose: () => void
  children: (close: () => void) => ReactNode
}

export const DialogShell = ({
  className,
  onClose,
  children
}: DialogShellProps) => (
  <TemplateDialog
    className={chainClassNames(
      'bg-surface-base rounded-card shadow-[var(--shadow-e3)] flex flex-col',
      className
    )}
    dialogClose={onClose}
    onContextMenu={e => e.preventDefault()}
    animation={{ type: 'fade', startPosition: '30%' }}
  >
    {children}
  </TemplateDialog>
)

/**
 * 标题档位。
 *
 * 做成互斥档位而不是「允许调用方追加 text-* 覆盖」：两个 text-4.25/* 同时出现在
 * 一个元素上时，胜负由产物里两条规则的先后决定（同类同特异性），不归我们控制 ——
 * 同一元素上只能有一个。
 */
const TITLE_SIZE = {
  /** 默认：确认 / 连接请求 / 手动连接 */
  dialog: 'text-4.25/6.25',
  /** 二维码弹窗：标题下方紧跟二维码，行高收紧 */
  compact: 'text-4.25/4.75',
  /** 更新弹窗：标题里带版本号、下面还有正文，字号小一档 */
  small: 'text-base/5.75'
} as const

/** 标题区：主标题 + 一行说明 */
export const DialogTitle = ({
  title,
  description,
  size = 'dialog',
  className
}: {
  title: string
  description?: ReactNode
  size?: keyof typeof TITLE_SIZE
  /** 额外的排版类名，如二维码弹窗的居中 'items-center' */
  className?: string
}) => (
  <div className={chainClassNames('flex flex-col gap-1.5', className)}>
    <h1 className={chainClassNames('text-ink-900 font-bold', TITLE_SIZE[size])}>
      {title}
    </h1>
    {description && (
      <p className="text-ink-500 font-normal text-body/[1.4167]">
        {description}
      </p>
    )}
  </div>
)

/** 按钮区：右下角横排（需要顶到弹窗底部时用 className 补 mt-auto） */
export const DialogActions = ({
  children,
  className
}: {
  children: ReactNode
  className?: string
}) => (
  <div className={chainClassNames('flex justify-end gap-2.5', className)}>
    {children}
  </div>
)

/**
 * 弹窗按钮配方。
 *
 * 尺寸与圆角所有弹窗共用，只有底色/描边随变体变。危险按钮走「浅 danger 底 +
 * state-tint 叠色」，与项目其它危险按钮一致（没有单独的 .state-danger，
 * 浅底按钮统一叠 .state-tint，理由见 styles/global.css）。
 */
const BTN_SIZE = 'px-4 py-2.125 text-card/[1.4615] rounded-control'

const BTN_VARIANTS = {
  primary:
    'bg-brand-500 text-on-brand shadow-[var(--shadow-brand)] state-brand',
  secondary: 'border border-line-200 text-ink-700 state-neutral',
  danger: 'bg-danger-100 text-danger-600 state-tint'
} as const

export type DialogButtonVariant = keyof typeof BTN_VARIANTS

export const btnClass = (variant: DialogButtonVariant) =>
  chainClassNames(BTN_SIZE, BTN_VARIANTS[variant])
