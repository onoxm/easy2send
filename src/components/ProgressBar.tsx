import { formatFileSize } from 'ono-react-element'

interface ProgressBarProps {
  status: string
  progress: number
  transferred: number
  total: number
}

export const ProgressBar = ({
  status,
  progress,
  transferred,
  total
}: ProgressBarProps) => {
  return (
    <div
      style={{
        border: '1px solid #ccc',
        padding: '10px',
        borderRadius: '4px'
      }}
    >
      <h4>状态</h4>
      <p>{status}</p>
      {progress > 0 && (
        <div>
          <span>{progress.toFixed(1)}%</span>
          <progress value={progress} max="100" style={{ width: '100%' }} />
          <span>
            {formatFileSize(transferred, { decimalPlaces: 1 })} /{' '}
            {formatFileSize(total, { decimalPlaces: 1 })}
          </span>
        </div>
      )}
    </div>
  )
}
