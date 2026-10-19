import { chainClassNames } from 'ono-react-element'
import { ReactNode } from 'react'

interface IconButtonProps {
  title?: string
  ariaLabel?: string
  className?: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  children: ReactNode
}

export const IconButton = ({
  title,
  ariaLabel,
  className,
  onClick,
  children
}: IconButtonProps) => {
  return (
    <button
      type="button"
      className={chainClassNames(
        'border border-line-200 rounded-md text-ink-600 shrink-0 p-1.5 bg-surface-base state-neutral',
        className
      )}
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
