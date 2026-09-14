import type { ReactNode } from 'react'
import { cn } from '../../utils/format'

interface AnalyticsCardProps {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}

export default function AnalyticsCard({
  title,
  subtitle,
  action,
  children,
  className,
  bodyClassName,
}: AnalyticsCardProps) {
  return (
    <section
      className={cn(
        'panel ',
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5 sm:py-4 dark:border-navy-700/60">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-ink-text dark:text-navy-50">{title}</h3>
          {subtitle && (
            <p className="mt-0.5 text-xs text-ink-text-faint dark:text-navy-400">{subtitle}</p>
          )}
        </div>
        {action}
      </header>
      <div className={cn('p-4 sm:p-5', bodyClassName)}>{children}</div>
    </section>
  )
}