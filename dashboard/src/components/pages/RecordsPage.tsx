import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowUpRight, RefreshCw, ScanLine, Search } from 'lucide-react'
import Button from '../ui/Button'
import DataTable, { type DataColumn } from '../table/DataTable'
import { ToneBadge } from '../ui/Badge'
import { EmptyState, LoadingState } from '../ui/States'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../lib/auth'
import { fetchScansForUser, fetchViolationsForScan, fetchReportsForScan } from '../../lib/db'
import { scanStatusTone } from '../../lib/ui'
import { formatDateTime } from '../../utils/format'
import { displayProductName, displayText } from '../../lib/textnorm'
import type { ReportRow, ScanRow, ViolationRow } from '../../lib/types2'
import ScanDetailModal from './ScanDetailModal'

function verdictTone(s: ScanRow): 'emerald' | 'amber' | 'rose' | 'cyan' {
  if (s.verdict === 'COMPLIANT') return 'emerald'
  if (s.verdict === 'PARTIALLY_COMPLIANT') return 'amber'
  if (s.verdict === 'NON_COMPLIANT') return 'rose'
  return 'cyan'
}

export default function RecordsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const [scans, setScans] = useState<ScanRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '')
  const [status, setStatus] = useState('all')
  const [selected, setSelected] = useState<ScanRow | null>(null)
  const [violations, setViolations] = useState<ViolationRow[]>([])
  const [reports, setReports] = useState<ReportRow[]>([])

  /* The header's global search writes the query into the URL (?q=). Keep this
     page's filter in sync so typing in the header (or navigating with a query
     already set) actually filters the list. Only the URL → local direction is
     synced; the page's own input never overwrites the URL. */
  useEffect(() => {
    setQuery(searchParams.get('q') ?? '')
  }, [searchParams])

  const load = useCallback(async () => {
    if (!user?.id) return
    try {
      const rows = await fetchScansForUser(user.id, 200)
      setScans(rows)
    } catch (e) {
      toast('error', 'Could not load scans', (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [user?.id, toast])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const openDetail = async (scan: ScanRow) => {
    setSelected(scan)
    try {
      const [vs, rs] = await Promise.all([fetchViolationsForScan(scan.id), fetchReportsForScan(scan.id)])
      setViolations(vs)
      setReports(rs)
    } catch {
      setViolations([])
      setReports([])
    }
  }

  const haystack = (s: ScanRow) => [s.product_name, s.brand, s.manufacturer, s.category, s.barcode].join(' | ').toLowerCase()
  const filtered = scans.filter(
    (s) =>
      (status === 'all' || s.status === status) &&
      (query.trim() === '' || haystack(s).includes(query.trim().toLowerCase())),
  )

  const columns: Array<DataColumn<ScanRow>> = [
    {
      key: 'product',
      label: 'Product',
      render: (s) => (
        <div className="flex min-w-[220px] items-center gap-3">
          {s.image_url ? (
            <img src={s.image_url} alt="" className="h-10 w-10 rounded-lg object-cover" />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-xs font-bold text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
              {displayProductName(s.product_name).slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{s.product_name?.trim() ? displayProductName(s.product_name) : 'Untitled'}</p>
            <p className="truncate text-xs text-slate-400">{displayText(s.brand || s.manufacturer) || '—'}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      label: 'Category',
      className: 'hidden lg:table-cell',
      render: (s) => <span className="text-slate-500 dark:text-slate-400">{s.category || '—'}</span>,
    },
    {
      key: 'score',
      label: 'Score',
      className: 'text-right',
      render: (s) => <span className="font-bold text-slate-700 dark:text-slate-200">{s.overall_score}</span>,
    },
    {
      key: 'verdict',
      label: 'Verdict',
      render: (s) => <ToneBadge tone={verdictTone(s)}>{s.verdict}</ToneBadge>,
    },
    {
      key: 'status',
      label: 'Status',
      className: 'hidden sm:table-cell',
      render: (s) => <ToneBadge tone={scanStatusTone(s.status)}>{s.status.replace('_', ' ')}</ToneBadge>,
    },
    {
      key: 'created_at',
      label: 'Scanned',
      className: 'hidden md:table-cell',
      render: (s) => <span className="whitespace-nowrap text-slate-500 dark:text-slate-400">{formatDateTime(s.created_at)}</span>,
    },
    {
      key: 'open',
      label: '',
      className: 'text-right',
      render: () => <ArrowUpRight className="ml-auto h-4 w-4 text-slate-300 dark:text-slate-600" />,
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Scan History</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {scans.length} inspections · {filtered.length} matching filters
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            icon={<RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />}
            loading={refreshing}
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            Refresh
          </Button>
          <Button icon={<ScanLine className="h-4 w-4" />} onClick={() => navigate('/scan-product')}>
            New scan
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card dark:border-slate-800 dark:bg-slate-900">
          <LoadingState label="Loading your scans…" />
        </div>
      ) : scans.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card dark:border-slate-800 dark:bg-slate-900">
          <EmptyState
            title="No scans yet"
            message="Scan your first product label — the AI inspection takes under a minute."
            action={
              <Button icon={<ScanLine className="h-4 w-4" />} onClick={() => navigate('/scan-product')}>
                Scan a product
              </Button>
            }
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center dark:border-slate-800">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search product, brand, barcode…"
                className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
            >
              <option value="all">All statuses</option>
              <option value="analyzed">Analyzed</option>
              <option value="flagged">Flagged</option>
              <option value="manual_review">Manual review</option>
              <option value="pending_review">Pending review</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(s) => s.id}
            onRowClick={(s) => void openDetail(s)}
            empty={<EmptyState title="Nothing matches" message="Try a different search or status filter." />}
          />
        </div>
      )}

      <ScanDetailModal
        scan={selected}
        violations={violations}
        reports={reports}
        onClose={() => setSelected(null)}
        onRefresh={() => void load()}
      />
    </div>
  )
}