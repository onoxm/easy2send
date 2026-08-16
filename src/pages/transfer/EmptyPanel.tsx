import { ICON_INFO } from '@/common/common'
import { Receive, Send } from '@icon-park/react'
import { chainClassNames } from 'ono-react-element'
import { TransferType } from '@/types/transfer'

export const EmptyPanel = ({
  tab,
  onPick
}: {
  tab: TransferType
  onPick: () => void
}) => {
  return (
    <div className="mt-2 p-3 rounded-lg border border-dashed border-gray-300 bg-gray-50/40 min-h-[260px] cursor-pointer">
      <div
        className={chainClassNames(
          'h-[220px] flex flex-col items-center justify-center text-gray-500 gap-3',
          tab === 'send' ? ' hover:text-gray-700' : ''
        )}
        onClick={e => {
          if (tab === 'send') {
            e.stopPropagation()
            onPick()
          }
        }}
      >
        <div className="text-4xl">
          {tab === 'send' ? (
            <Send {...ICON_INFO} strokeWidth={2} />
          ) : (
            <Receive {...ICON_INFO} strokeWidth={2} />
          )}
        </div>
        <div className="text-sm">
          {tab === 'send' ? '点击或拖拽文件到此处发送' : '暂无接收中的任务'}
        </div>
        <div className="text-xs text-gray-400">
          {tab === 'send'
            ? '支持多选文件/文件夹；根据“并发传输数”自动排队'
            : '对方发送文件后，会自动创建任务卡片'}
        </div>
      </div>
    </div>
  )
}
