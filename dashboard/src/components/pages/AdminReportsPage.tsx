import { useEffect, useState } from 'react'
import { FileText, Loader2, Search } from 'lucide-react'
import AnalyticsCard from '../dashboard/AnalyticsCard'
import Button from '../ui/Button'
import { ToneBadge } from '../ui/Badge'
import { useToast } from '../ui/Toast'
import { listReports, updateReportStatus } from '../../lib/db'
import type { ReportRow, ReportStatus } from '../../lib/types2'
import { timeAgo } from '../../utils/format'

const STATUS_OPTIONS: { label: string; value: string }[] = [
  { label: 'All', value: '' },
  { label: 'Pending', value: 'Pending' },
  { label: 'Reviewing', value: 'Reviewing' },
  { label: 'Resolved', value: 'Resolved' },
  { label: 'Rejected', value: 'Rejected' },
]

export default function AdminReportsPage() {
  const { toast } = useToast()
  const [reports, setReports] = useState<ReportRow[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [updating, setUpdating] = useState<string | null>(null)

  async function reload(q?: string, p?: number, status?: string) {
    setLoading(true)
    try {
      const res = await listReports({ page: p ?? page, pageSize: 20, query: q ?? search, status: status ?? (statusFilter || undefined) })
      setReports(res.data)
      setCount(res.count)
    } catch (e) {
      toast('error', 'Load failed', (e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void reload() }, [])

  const handleStatusChange = async (reportId: string, status: ReportStatus) => {
    setUpdating(reportId)
    try {
      await updateReportStatus(reportId, status)
      toast('success', 'Updated', `Report marked as ${status}.`)
      await reload()
    } catch (e) {
      toast('error', 'Update failed', (e as Error).message)
    } finally {
      setUpdating(null)
    }
  }

  const totalPages = Math.max(1, Math.ceil(count / 20))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); void reload(e.target.value, 1) }}
            placeholder="Search reports..."
            className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { setStatusFilter(opt.value); setPage(1); void reload(search, 1, opt.value) }}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                statusFilter === opt.value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <AnalyticsCard title="Compliance Reports" subtitle={`${count} total reports`}>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-brand-500" /></div>
        ) : reports.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="h-12 w-12 text-slate-300 dark:text-slate-600" />
            <p className="mt-4 text-sm font-medium text-slate-500">No reports found</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800">
                    <th className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-400">Title</th>
                    <th className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-400">Product</th>
                    <th className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-400">Priority</th>
                    <th className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-400">Status</th>
                    <th className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-400">Created</th>
                    <th className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {reports.map((r) => {
                    const ptone = r.priority === 'Critical' ? 'rose' : r.priority === 'High' ? 'amber' : r.priority === 'Medium' ? 'amber' : 'slate'
                    const stone = r.status === 'Resolved' ? 'emerald' : r.status === 'Rejected' ? 'slate' : 'amber'
                    return (
                      <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="max-w-[200px] truncate px-3 py-2 font-medium text-slate-700 dark:text-slate-200">{r.title}</td>
                        <td className="max-w-[150px] truncate px-3 py-2 text-slate-500 dark:text-slate-400">{r.product_name || '—'}</td>
                        <td className="px-3 py-2"><ToneBadge tone={ptone as 'emerald' | 'amber' | 'rose' | 'slate'}>{r.priority}</ToneBadge></td>
                        <td className="px-3 py-2"><ToneBadge tone={stone as 'emerald' | 'amber' | 'rose' | 'slate'}>{r.status}</ToneBadge></td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-400">{timeAgo(r.created_at)}</td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            {r.status === 'Pending' && (
                              <button
                                disabled={updating === r.id}
                                onClick={() => void handleStatusChange(r.id, 'Reviewing')}
                                className="rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50 dark:bg-emerald-500/10 dark:text-emerald-400"
                              >
                                {updating === r.id ? '...' : 'Start Review'}
                              </button>
                            )}
                            {(r.status === 'Reviewing' || r.status === 'Investigating') && (
                              <button
                                disabled={updating === r.id}
                                onClick={() => void handleStatusChange(r.id, 'Resolved')}
                                className="rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50 dark:bg-emerald-500/10 dark:text-emerald-400"
                              >
                                {updating === r.id ? '...' : 'Resolve'}
                              </button>
                            )}
                            {r.status !== 'Rejected' && r.status !== 'Resolved' && (
                              <button
                                disabled={updating === r.id}
                                onClick={() => void handleStatusChange(r.id, 'Rejected')}
                                className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-400"
                              >
                                Reject
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="mt-3 flex items-center justify-center gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => { setPage(page - 1); void reload(search, page - 1) }}>Previous</Button>
                <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
                <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => { setPage(page + 1); void reload(search, page + 1) }}>Next</Button>
              </div>
            )}
          </>
        )}
      </AnalyticsCard>
    </div>
  )
}
