import { PeerAvatar, PeerIdentity } from '@/components'
import { DeviceInfo } from '@/types'
import { IconChevronRight, IconLoader2 } from '@tabler/icons-react'

interface DeviceTileProps {
  waiting: boolean
  disabled: boolean
  device: DeviceInfo
  onClick: () => void
}

export const DeviceTile = ({
  disabled,
  onClick,
  waiting,
  device
}: DeviceTileProps) => {
  const { ip, port, platform, deviceName, version } = device

  return (
    <button
      className="w-full h-15 border border-line-200 flex items-center gap-2.5 px-3 justify-center rounded-md state-neutral disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
    >
      <PeerAvatar platform={platform} />
      <PeerIdentity
        name={deviceName}
        subtitle={
          waiting ? (
            <span className="text-brand-500">等待对方确认...</span>
          ) : (
            `${ip}:${port} · ${platform} · v${version}`
          )
        }
      />

      {
        <div className={waiting ? 'text-brand-500 loading' : 'text-ink-300'}>
          {waiting ? (
            <IconLoader2 size={16} stroke={2} />
          ) : (
            <IconChevronRight size={16} stroke={2} />
          )}
        </div>
      }
    </button>
  )
}
