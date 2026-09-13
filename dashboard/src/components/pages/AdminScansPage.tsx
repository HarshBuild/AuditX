import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, ScanLine, Eye, RefreshCw } from 'lucide-react'
import { fetchReportsForScan, fetchViolationsForScan, listScans } from '../../lib/db'
import { riskBand, riskTone } from '../../lib/risk'
import { severityTone } from '../../lib/ui'
import type { ReportRow, ScanRow, ViolationRow } from '../../lib/types2'
import { LoadingState, ErrorState, EmptyState } from '../ui/States'
import { ToneBadge } from '../ui/Badge'
import Pagination from '../table/Pagination'
import Button from '../ui/Button'
import ScanDetailModal from './ScanDetailModal'
import { formatDateTime } from '../../utils/format'
import { displayProductName, displayText } from '../../lib/textnorm'

function RiskBadge({ score }: { score: number | null }) {
  const risk = score ?? 100
  const band = riskBand(risk)
  return <ToneBadge tone={riskTone(band)}>{band}</ToneBadge>
}

export default function AdminScansPage() {
  const [searchParams] = useSearchParams()
  const [rows, setRows] = useState<ScanRow[]>([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(12)
  const [query, setQuery] = useState(searchParams.get('q') ?? '')
  const [status, setStatus] = useState('')
  const [risk, setRisk] = useState('')
  const [selected, setSelected] = useState<ScanRow | null>(null)
  const [detail, setDetail] = useState<{ violations: ViolationRow[]; reports: ReportRow[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listScans({ page, pageSize, query, status, risk })
      setRows(res.data)
      setCount(res.count)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, query, status, risk, refresh])

  useEffect(() => {
    void load()
  }, [load])

  const openDetail = async (s: ScanRow) => {
    setSelected(s)
    try {
      const [violations, reports] = await Promise.all([
        fetchViolationsForScan(s.id),
        fetchReportsForScan(s.id),
      ])
      setDetail({ violations, reports })
    } catch {
      setDetail({ violations: [], reports: [] })
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Product scans</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Review, verify or flag every compliance scan across the network.
          </p>
        </div>
        <Button variant="outline" icon={<RefreshCw className="h-4 w-4" />} onClick={() => setRefresh((x) => x + 1)}>
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/80 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1) }}
            placeholder="Search product, brand, manufacturer, barcode…"
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </div>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1) }}
          className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="pending_review">Pending review</option>
          <option value="analyzed">Analyzed</option>
          <option value="flagged">Flagged</option>
          <option value="manual_review">Manual review</option>
          <option value="resolved">Resolved</option>
        </select>
        <select
          value={risk}
          onChange={(e) => { setRisk(e.target.value); setPage(1) }}
          className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
          aria-label="Filter by risk band"
        >
          <option value="">All risk bands</option>
          <option value="Critical">Critical</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>
      </div>

      {loading ? (
        <LoadingState label="Loading scans…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setRefresh((x) => x + 1)} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<ScanLine className="h-8 w-8" />} title="No scans found" message="Try adjusting the search or filters, or run a new scan." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Risk</th>
                  <th className="px-4 py-3">Verdict</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Scanned</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {rows.map((s) => {
                  const verdictTone = s.verdict === 'COMPLIANT' ? 'emerald' : s.verdict === 'PARTIALLY_COMPLIANT' ? 'amber' : 'rose'
                  return (
                    <tr key={s.id} className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-800 dark:text-slate-100">{s.product_name?.trim() ? displayProductName(s.product_name) : 'Untitled'}</p>
                        <p className="text-xs text-slate-400">{displayText(s.manufacturer || s.brand) || '—'} · {s.category || 'Uncategorised'}</p>
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">{s.overall_score}<span className="text-xs font-medium text-slate-400">/100</span></td>
                      <td className="px-4 py-3"><RiskBadge score={s.risk_score} /></td>
                      <td className="px-4 py-3"><ToneBadge tone={verdictTone as 'emerald' | 'amber' | 'rose'}>{s.verdict}</ToneBadge></td>
                      <td className="px-4 py-3">
                        <ToneBadge tone={severityTone(s.status === 'flagged' ? 'high' : s.status === 'manual_review' ? 'medium' : 'low')}>{s.status.replace('_', ' ')}</ToneBadge>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">{formatDateTime(s.created_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="outline" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => void openDetail(s)}>
                          View
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            pages={Math.max(1, Math.ceil(count / pageSize))}
            total={count}
            rangeStart={count === 0 ? 0 : (page - 1) * pageSize + 1}
            rangeEnd={Math.min(page * pageSize, count)}
            onPage={setPage}
            pageSize={pageSize}
            onPageSize={(n) => { setPageSize(n); setPage(1) }}
          />
        </div>
      )}

      <ScanDetailModal
        scan={selected}
        violations={detail?.violations ?? []}
        reports={detail?.reports ?? []}
        onClose={() => setSelected(null)}
        onRefresh={() => setRefresh((x) => x + 1)}
      />
    </div>
  )
}