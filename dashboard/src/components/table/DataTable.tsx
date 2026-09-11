import type { ReactNode } from 'react'
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { cn } from '../../utils/format'

export interface DataColumn<T> {
  key: string
  label: string
  sortable?: boolean
  className?: string
  render?: (row: T) => ReactNode
}

interface DataTableProps<T> {
  columns: DataColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  sortKey?: string
  sortDir?: 'asc' | 'desc'
  onSort?: (key: string) => void
  empty?: ReactNode
  onRowClick?: (row: T) => void
  compact?: boolean
}

export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  sortKey,
  sortDir,
  onSort,
  empty,
  onRowClick,
  compact,
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return <div className="py-4">{empty}</div>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left dark:border-slate-800">
            {columns.map((col) => {
              const active = sortKey === col.key
              return (
                <th
                  key={col.key}
                  scope="col"
                  className={cn(
                    'px-4 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 first:pl-5 last:pr-5',
                    compact ? 'py-2.5' : 'py-3',
                    col.className,
                  )}
                >
                  {col.sortable && onSort ? (
                    <button
                      onClick={() => onSort(col.key)}
                      className="inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-slate-700 dark:hover:text-slate-300"
                    >
                      {col.label}
                      {active ? (
                        sortDir === 'asc' ? (
                          <ChevronUp className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" />
                        )
                      ) : (
                        <ChevronsUpDown className="h-3.5 w-3.5" />
                      )}
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={() => onRowClick?.(row)}
              className={cn(
                'transition-colors',
                onRowClick && 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40',
              )}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    'px-4 align-middle text-slate-700 first:pl-5 last:pr-5 dark:text-slate-300',
                    compact ? 'py-2.5' : 'py-3.5',
                    col.className,
                  )}
                >
                  {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}