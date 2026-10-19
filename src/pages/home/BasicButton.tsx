import type { Icon } from '@tabler/icons-react'

interface BasicButtonProps {
  Icon: Icon
  children: string
  className?: string
  onClick: (e: React.MouseEvent) => void
}

export const BasicButton = ({
  Icon,
  children,
  onClick,
  className
}: BasicButtonProps) => {
  return (
    <button type="button" className={className} onClick={onClick}>
      <Icon size={14} stroke={2} />
      <span>{children}</span>
    </button>
  )
}
