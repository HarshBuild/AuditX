import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../utils/format'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean
  padding?: 'none' | 'sm' | 'md'
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive, padding = 'md', children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'panel',
        interactive && 'panel-interactive',
        padding === 'none' && 'p-0',
        padding === 'sm' && 'p-4',
        padding === 'md' && 'p-5',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
)

Card.displayName = 'Card'

export function CardHeader({
  title,
  subtitle,
  action,
  icon,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink-text dark:text-navy-100">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-ink-text-soft dark:text-navy-300">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function CardFooter({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'mt-4 flex items-center gap-3 border-t border-line pt-4 dark:border-navy-700/60',
        className,
      )}
    >
      {children}
    </div>
  )
}

export default Card