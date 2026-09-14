import { type ReactNode } from 'react'
import { AlertTriangle, FileSearch, RefreshCw, SearchX } from 'lucide-react'
import { AuditXMark } from '../brand/AuditXMark'
import Button from './Button'
import { cn } from '../../utils/format'

export function LoadingState({ label = 'Loading data…' }: { label?: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-4 text-ink-text-faint" role="status">
      <span className="relative flex h-10 w-10 items-center justify-center">
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full border-2 border-slate-200/80 dark:border-white/10"
        />
        <span
          aria-hidden="true"
          className="absolute inset-0 animate-spin rounded-full border-2 border-brand-500 border-r-transparent border-t-transparent"
        />
        <AuditXMark size="sm" />
      </span>
      <p className="text-sm font-medium text-ink-text-soft dark:text-navy-300">{label}</p>
    </div>
  )
}

/** Shimmering skeleton placeholder — build loading layouts from it. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('skeleton rounded-control', className)} />
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: ReactNode
  title: string
  message: string
  action?: ReactNode
}) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-navy-800">
        {icon ?? <AuditXMark size="sm" />}
      </div>
      <p className="mt-1 text-sm font-semibold text-ink-text dark:text-navy-100">{title}</p>
      <p className="max-w-sm text-sm text-ink-text-soft dark:text-navy-300">{message}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function NoResults({ query, onClear }: { query: string; onClear?: () => void }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-navy-800">
        <SearchX className="h-6 w-6 text-ink-text-faint dark:text-navy-400" />
      </div>
      <p className="mt-1 text-sm font-semibold text-ink-text dark:text-navy-100">
        No records found{query ? ` for \u201c${query}\u201d` : ''}
      </p>
      <p className="max-w-sm text-sm text-ink-text-soft dark:text-navy-300">
        Try adjusting your search terms or clearing the active filters.
      </p>
      {onClear && (
        <Button variant="outline" size="sm" className="mt-2" onClick={onClear}>
          <RefreshCw className="h-3.5 w-3.5" /> Reset filters
        </Button>
      )}
    </div>
  )
}

export function ErrorState({
  message = 'Something went wrong while loading your data.',
  onRetry,
  icon,
}: {
  message?: string
  onRetry?: () => void
  icon?: ReactNode
}) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-50 dark:bg-danger-500/10">
        {icon ?? <AlertTriangle className="h-6 w-6 text-danger-500" />}
      </div>
      <p className="mt-1 text-sm font-semibold text-ink-text dark:text-navy-100">Unable to load</p>
      <p className="max-w-sm text-sm text-ink-text-soft dark:text-navy-300">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </Button>
      )}
    </div>
  )
}

export function TableIcon({ children }: { children: ReactNode }) {
  return <div className="flex justify-center py-10">{children ?? <FileSearch className="h-6 w-6 text-slate-300" />}</div>
}