import { type ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react'
import { cn } from '../../utils/format'
import Card from './Card'

type DeltaTone = 'positive' | 'negative' | 'neutral' | 'info'

const deltaStyles: Record<DeltaTone, string> = {
  positive: 'bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-500',
  negative: 'bg-danger-50 text-danger-700 dark:bg-danger-500/10 dark:text-danger-500',
  neutral: 'bg-slate-100 text-slate-600 dark:bg-navy-800 dark:text-navy-300',
  info: 'bg-info-50 text-info-700 dark:bg-info-500/10 dark:text-info-400',
}

const accentBg: Record<string, string> = {
  brand: 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400',
  success: 'bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-400',
  warning: 'bg-warning-50 text-warning-600 dark:bg-warning-500/10 dark:text-warning-400',
  danger: 'bg-danger-50 text-danger-600 dark:bg-danger-500/10 dark:text-danger-400',
  info: 'bg-info-50 text-info-600 dark:bg-info-500/10 dark:text-info-400',
  neutral: 'bg-slate-100 text-slate-500 dark:bg-navy-800 dark:text-navy-300',
}

export interface MetricCardProps {
  label: string
  value: ReactNode
  icon: LucideIcon | ReactNode
  sub?: ReactNode
  delta?: { value: string; tone?: DeltaTone }
  accent?: keyof typeof accentBg
  prominent?: boolean
  className?: string
}

export default function MetricCard({
  label,
  value,
  icon: Icon,
  sub,
  delta,
  accent = 'brand',
  prominent,
  className,
}: MetricCardProps) {
  const tone = delta?.tone ?? 'neutral'
  return (
    <Card
      padding={prominent ? 'md' : 'sm'}
      className={cn('flex flex-col justify-between gap-3', prominent && 'col-span-full sm:col-span-2 lg:col-span-1', className)}
    >
      <div className="flex items-start justify-between gap-3">
        <p className={cn('font-medium text-ink-text-soft dark:text-navy-300', prominent ? 'text-sm' : 'text-2xs')}>
          {label}
        </p>
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-card', accentBg[accent] ?? accentBg.neutral)}>
          {typeof Icon === 'function' ? <Icon className="h-4 w-4" /> : Icon}
        </span>
      </div>

      <div className="min-w-0">
        <p className={cn('font-bold tracking-tight text-ink-text dark:text-white tabular-nums', prominent ? 'text-2xl' : 'text-xl')}>
          {value}
        </p>
        {(sub || delta) && (
          <div className="mt-1 flex items-center gap-2">
            {delta && (
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-2xs font-semibold tabular-nums',
                  deltaStyles[tone],
                )}
              >
                {tone === 'negative' ? (
                  <ArrowDownRight className="h-3 w-3" />
                ) : tone === 'positive' ? (
                  <ArrowUpRight className="h-3 w-3" />
                ) : null}
                {delta.value}
              </span>
            )}
            {sub && <span className="truncate text-2xs text-ink-text-faint dark:text-navy-400">{sub}</span>}
          </div>
        )}
      </div>
    </Card>
  )
}