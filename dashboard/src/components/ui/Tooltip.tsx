import { type CSSProperties, type ReactNode } from 'react'
import { cn } from '../../utils/format'

interface TooltipProps {
  content: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  children: ReactNode
  className?: string
  style?: CSSProperties
}

/**
 * Lightweight CSS tooltip — revealed on hover and keyboard focus.
 * Also appears on focus-visible for keyboard users (no pointer required).
 */
export default function Tooltip({
  content,
  side = 'right',
  children,
  className,
  style,
}: TooltipProps) {
  return (
    <span className={cn('group/ti relative inline-flex', className)} style={style}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-dropdown hidden animate-fade-in whitespace-nowrap rounded-control bg-navy-900 px-2 py-1 text-2xs font-medium text-white shadow-md dark:bg-navy-700 group-hover/ti:block group-focus-visible/ti:block',
          side === 'right' && 'left-full top-1/2 ml-2 -translate-y-1/2',
          side === 'left' && 'right-full top-1/2 mr-2 -translate-y-1/2',
          side === 'top' && 'bottom-full left-1/2 mb-2 -translate-x-1/2',
          side === 'bottom' && 'top-full left-1/2 mt-2 -translate-x-1/2',
        )}
      >
        {content}
      </span>
    </span>
  )
}