import { IconArrowLeft } from '@tabler/icons-react'

/**
 * 页头返回按钮。
 *
 * 传输页与设置页各写了一份、逐字相同（图标尺寸、内边距、字重、圆角全一样），
 * 收成组件的唯一理由是：改一处漏一处只是时间问题。
 *
 * 圆角用语义类 rounded-control（=10）而不是原先的 rounded-[10px]：值一样，
 * 但硬编码的 10 会在改圆角 token 时被漏掉。
 */
export const BackButton = ({ onClick }: { onClick: () => void }) => (
  <button
    className="flex items-center gap-1.5 px-2.5 py-[7.5px] border border-line-200 bg-surface-base rounded-control shrink-0 state-neutral"
    onClick={onClick}
  >
    <span className="text-ink-600">
      <IconArrowLeft size={14} stroke={2} />
    </span>
    <span className="text-ink-700 text-body/[1.4167] font-medium">返回</span>
  </button>
)
