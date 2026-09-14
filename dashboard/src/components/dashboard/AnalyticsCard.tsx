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
    <section className={cn('group panel relative overflow-hidden', className)}>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-brand-500/50 to-transparent"
      />
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5 sm:py-4 dark:border-navy-700/60">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className="h-4 w-1 shrink-0 rounded-full bg-brand-500/80"
          />
          <div className="min-w-0">
            <h3 className="text-sm font-bold tracking-tight text-ink-text dark:text-navy-50">{title}</h3>
            {subtitle && (
              <p className="mt-0.5 text-xs text-ink-text-faint dark:text-navy-400">{subtitle}</p>
            )}
          </div>
        </div>
        {action}
      </header>
      <div className={cn('p-4 sm:p-5', bodyClassName)}>{children}</div>
    </section>
  )
}