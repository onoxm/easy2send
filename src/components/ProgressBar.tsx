import { TransferType } from '@/pages/transfer'
import { formatFileSize } from 'ono-react-element'

export interface DataInfo {
  status: string
  progress: number
  transferred: number
  total: number
}

interface ProgressBarProps {
  type: TransferType
  info: DataInfo
  onClick?: () => void
}

export const ProgressBar = ({
  type,
  info: { status, progress, transferred, total },
  onClick
}: ProgressBarProps) => {
  return (
    <div
      style={{
        border: '1px solid #ccc',
        padding: '10px',
        borderRadius: '4px'
      }}
      onClick={onClick}
    >
      <h4>状态</h4>
      <p>{status}</p>
      {progress > 0 ? (
        <div>
          <span>{progress.toFixed(1)}%</span>
          <progress value={progress} max="100" style={{ width: '100%' }} />
          <span>
            {formatFileSize(transferred, { decimalPlaces: 1 })} /{' '}
            {formatFileSize(total, { decimalPlaces: 1 })}
          </span>
        </div>
      ) : (
        progress === 0 && type === 'send' && <div>点击或拖拽文件到此处发送</div>
      )}
    </div>
  )
}
