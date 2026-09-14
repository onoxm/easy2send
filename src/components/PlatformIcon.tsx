import { Linux } from '@/components'
import { Platform } from '@/types/discovery'
import {
  IconBrandAppleFilled,
  IconBrandWindows,
  IconDeviceMobile,
  IconWorld
} from '@tabler/icons-react'

export const PlatformIcon = ({
  size,
  platform
}: {
  size: string | number
  platform: Platform
}) => {
  switch (platform) {
    case 'windows':
      return <IconBrandWindows size={size} stroke={2} />
    case 'macos':
      return <IconBrandAppleFilled size={size} stroke={2} />
    case 'linux':
      return <Linux size={size} />
    case 'phone':
      return <IconDeviceMobile size={size} stroke={2} />
    default:
      return <IconWorld size={size} stroke={2} />
  }
}
