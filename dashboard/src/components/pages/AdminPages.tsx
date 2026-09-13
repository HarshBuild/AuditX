import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import AnalyticsCard from '../dashboard/AnalyticsCard'
import DataTable, { type DataColumn } from '../table/DataTable'
import { EmptyState, LoadingState } from '../ui/States'
import { ToneBadge } from '../ui/Badge'
import { useToast } from '../ui/Toast'
import { listViolations, setViolationStatus, listScans } from '../../lib/db'
import { severityTone, violationStatusTone } from '../../lib/ui'
import { formatDateTime } from '../../utils/format'
import { displayProductName, displayText } from '../../lib/textnorm'
import type { ScanRow, ViolationRow } from '../../lib/types2'

export function ViolationsPage() {
  const { toast } = useToast()
  const [rows, setRows] = useState<ViolationRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await listViolations({ page: 1, pageSize: 200 })
      setRows(res.data)
    } catch (e) {
      toast('error', 'Could not load violations', (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const setStatus = async (v: ViolationRow, status: ViolationRow['status']) => {
    try {
      await setViolationStatus(v.id, status)
      setRows((list) => list.map((x) => (x.id === v.id ? { ...x, status } : x)))
      toast('success', 'Violation updated', `Status is now ${status}.`)
    } catch (e) {
      toast('error', 'Update failed', (e as Error).message)
    }
  }

  const columns: Array<DataColumn<ViolationRow>> = [
    {
      key: 'product',
      label: 'Product',
      render: (v) => (
        <div className="min-w-[200px]">
          <p className="font-semibold text-slate-800 dark:text-slate-100">{v.product_name?.trim() ? displayProductName(v.product_name) : '—'}</p>
          <p className="text-xs text-slate-400">{displayText(v.manufacturer) || v.type}</p>
        </div>
      ),
    },
    { key: 'type', label: 'Type', render: (v) => <span className="text-slate-600 dark:text-slate-300">{v.type || '—'}</span> },
    {
      key: 'severity',
      label: 'Severity',
      render: (v) => <ToneBadge tone={severityTone(v.severity)}>{v.severity}</ToneBadge>,
    },
    {
      key: 'status',
      label: 'Status',
      className: 'hidden md:table-cell',
      render: (v) => <ToneBadge tone={violationStatusTone(v.status)}>{v.status}</ToneBadge>,
    },
    { key: 'description', label: 'Description', className: 'hidden lg:table-cell max-w-[260px]', render: (v) => <span className="truncate text-slate-500 dark:text-slate-400">{v.description || '—'}</span> },
    { key: 'created_at', label: 'Reported', className: 'hidden xl:table-cell', render: (v) => <span className="whitespace-nowrap text-slate-500 dark:text-slate-400">{formatDateTime(v.created_at)}</span> },
    { key: 'actions', label: 'Actions', className: 'text-right', render: (v) => (
      <div className="flex items-center justify-end gap-1.5">
        {v.status !== 'Resolved' && (
          <button
            onClick={() => void setStatus(v, 'Resolved')}
            className="rounded-lg border border-emerald-200 px-2.5 py-1 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
          >
            Resolve
          </button>
        )}
        {v.status !== 'Rejected' && (
          <button
            onClick={() => void setStatus(v, 'Rejected')}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 dark:border-white/15 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Reject
          </button>
        )}
      </div>
    ) },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5 rounded-2xl border border-rose-200/70 bg-rose-50/60 px-4 py-3 dark:border-rose-500/20 dark:bg-rose-500/10">
          <AlertTriangle className="h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
          <p className="text-sm text-rose-700 dark:text-rose-300">
            <b>{rows.length}</b> violation{rows.length === 1 ? '' : 's'} detected across scans.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-slate-800/60"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      <AnalyticsCard title="Violations" subtitle="Managed during scan review" bodyClassName="p-0">
        {loading ? (
          <LoadingState label="Loading violations…" />
        ) : rows.length === 0 ? (
          <EmptyState title="No violations" message="No violations have been detected yet." />
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(v) => v.id} />
        )}
      </AnalyticsCard>
    </div>
  )
}

interface ManufacturerRow {
  name: string
  count: number
  avgScore: number
  nonCompliant: number
  categories: string[]
}

export function ManufacturersPage() {
  const { toast } = useToast()
  const [rows, setRows] = useState<ManufacturerRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await listScans({ page: 1, pageSize: 500 })
      const map = new Map<string, ManufacturerRow>()
      for (const s of res.data as ScanRow[]) {
        const name = (s.manufacturer || s.brand || 'Unknown').trim() || 'Unknown'
        const existing = map.get(name)
        const score = s.overall_score ?? 0
        if (existing) {
          existing.count += 1
          existing.avgScore = (existing.avgScore * (existing.count - 1) + score) / existing.count
          if (s.verdict !== 'COMPLIANT') existing.nonCompliant += 1
          if (s.category && !existing.categories.includes(s.category)) existing.categories.push(s.category)
        } else {
          map.set(name, {
            name,
            count: 1,
            avgScore: score,
            nonCompliant: s.verdict !== 'COMPLIANT' ? 1 : 0,
            categories: s.category ? [s.category] : [],
          })
        }
      }
      setRows([...map.values()].sort((a, b) => b.count - a.count))
    } catch (e) {
      toast('error', 'Could not load manufacturers', (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const columns: Array<DataColumn<ManufacturerRow>> = [
    { key: 'name', label: 'Manufacturer', render: (r) => <span className="font-semibold text-slate-800 dark:text-slate-100">{r.name}</span> },
    { key: 'count', label: 'Products', className: 'text-right', render: (r) => <span className="font-bold">{r.count}</span> },
    { key: 'avgScore', label: 'Avg Score', className: 'text-right', render: (r) => <span className="font-semibold text-slate-700 dark:text-slate-200">{Math.round(r.avgScore)}</span> },
    {
      key: 'nonCompliant',
      label: 'Non-compliant',
      className: 'text-right',
      render: (r) => (r.nonCompliant > 0 ? <span className="font-bold text-rose-500">{r.nonCompliant}</span> : <span className="text-emerald-500">0</span>),
    },
    {
      key: 'categories',
      label: 'Categories',
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.categories.slice(0, 3).map((c) => (
            <ToneBadge key={c} tone="slate">{c}</ToneBadge>
          ))}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Manufacturers</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{rows.length} manufacturers across your scanned products.</p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-slate-800/60"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>
      <AnalyticsCard title="Manufacturer overview" subtitle="Aggregated from inspection scans" bodyClassName="p-0">
        {loading ? (
          <LoadingState label="Loading manufacturers…" />
        ) : rows.length === 0 ? (
          <EmptyState title="No manufacturers yet" message="Scan products to see manufacturer summaries." />
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.name} />
        )}
      </AnalyticsCard>
    </div>
  )
}