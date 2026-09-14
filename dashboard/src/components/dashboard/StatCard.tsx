import { TrendingDown, TrendingUp } from 'lucide-react'
import type { StatDefinition } from '../../types'
import { cn } from '../../utils/format'

const accentMap: Record<StatDefinition['accent'], string> = {
  brand: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400',
  emerald: 'bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500',
  amber: 'bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-500',
  rose: 'bg-danger-50 text-danger-600 dark:bg-danger-500/15 dark:text-danger-500',
  violet: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400',
  cyan: 'bg-info-50 text-info-600 dark:bg-info-500/15 dark:text-info-400',
}

export default function StatCard({ stat, prominent }: { stat: StatDefinition; prominent?: boolean }) {
  const Icon = stat.icon
  return (
    <div
      className={cn(
        'panel transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
        prominent &&
          'border-brand-200/70 bg-gradient-to-br from-brand-50/70 via-surface to-surface sm:col-span-2 dark:border-brand-500/20 dark:from-brand-500/[0.08] dark:via-navy-900 dark:to-navy-900 lg:col-span-1',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-text-faint dark:text-navy-400">
            {stat.title}
          </p>
          <p
            className={cn(
              'mt-2 font-extrabold tracking-tight text-ink-text dark:text-navy-50',
              prominent ? 'text-4xl' : 'text-3xl',
            )}
          >
            {stat.value}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            {stat.change && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
                  stat.trend === 'up'
                    ? 'bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500'
                    : 'bg-danger-50 text-danger-600 dark:bg-danger-500/15 dark:text-danger-500',
                )}
              >
                {stat.trend === 'up' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {stat.change}
              </span>
            )}
            {stat.hint && (
              <span className="text-[11px] font-medium text-ink-text-faint dark:text-navy-400">
                {stat.hint}
              </span>
            )}
          </div>
        </div>
        <div
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105',
            accentMap[stat.accent],
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}