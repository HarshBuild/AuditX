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
    <section className={cn('rounded-2xl border border-slate-200/80 bg-white shadow-card ring-1 ring-slate-900/[0.03] dark:border-white/[0.07] dark:bg-navy-900 dark:ring-white/[0.02]', className)}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5 sm:py-4 dark:border-white/[0.07]">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className={cn('p-4 sm:p-5', bodyClassName)}>{children}</div>
    </section>
  )
}