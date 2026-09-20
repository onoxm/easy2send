import { TransferType } from '@/types/transfer'
import { IconDownload, IconSend } from '@tabler/icons-react'

export const EmptyPanel = ({
  tab,
  onPick
}: {
  tab: TransferType
  onPick: () => void
}) => {
  return (
    <div
      className="h-65 gap-3 flex flex-col justify-center items-center rounded-card border border-dashed border-line-200 bg-surface-muted cursor-pointer"
      onClick={e => {
        if (tab === 'send') {
          e.stopPropagation()
          onPick()
        }
      }}
    >
      <div className="text-ink-400">
        {tab === 'send' ? (
          <IconSend size={36} stroke={2} />
        ) : (
          <IconDownload stroke={2} />
        )}
      </div>
      <div className="text-body/[1.4167] text-ink-600">
        {tab === 'send' ? '点击或拖拽文件到此处发送' : '暂无接收中的任务'}
      </div>
      <div className="text-caption/[1.4545] text-ink-400">
        {tab === 'send'
          ? '支持多选文件 / 文件夹，按并发数自动排队        '
          : '对方发送文件后，会自动创建任务卡片'}
      </div>
    </div>
  )
}
