import { useId, type ReactNode } from 'react'
import { cn } from '../../utils/format'

export interface TabItem {
  key: string
  label: ReactNode
  icon?: ReactNode
  count?: number
}

interface TabsProps {
  tabs: TabItem[]
  value: string
  onChange: (key: string) => void
  variant?: 'segmented' | 'underline'
  size?: 'sm' | 'md'
  className?: string
  'aria-label'?: string
}

export default function Tabs({
  tabs,
  value,
  onChange,
  variant = 'segmented',
  size = 'md',
  className,
  'aria-label': ariaLabel,
}: TabsProps) {
  const baseId = useId()
  return (
    <div
      role="tablist"
      aria-label={ariaLabel || 'Tabs'}
      className={cn(
        'no-scrollbar flex items-center gap-1',
        variant === 'segmented' && 'panel-inset w-fit max-w-full overflow-x-auto p-1',
        className,
      )}
    >
      {tabs.map((tab) => {
        const selected = tab.key === value
        return (
          <button
            key={tab.key}
            role="tab"
            id={`${baseId}-${tab.key}`}
            aria-selected={selected}
            aria-controls={`${baseId}-panel`}
            onClick={() => onChange(tab.key)}
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-field font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
              size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-3.5 text-sm',
              selected
                ? 'bg-white text-brand-700 shadow-sm ring-1 ring-line dark:bg-navy-800 dark:text-brand-300 dark:ring-navy-700'
                : 'text-ink-text-soft hover:text-ink-text dark:text-navy-300 dark:hover:text-navy-100',
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 text-2xs font-semibold tabular-nums',
                  selected
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                    : 'bg-slate-100 text-slate-500 dark:bg-navy-800 dark:text-navy-300',
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}