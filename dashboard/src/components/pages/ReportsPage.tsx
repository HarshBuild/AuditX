import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, Download, FileJson, FileSpreadsheet, RefreshCw, FileText } from 'lucide-react'
import AnalyticsCard from '../dashboard/AnalyticsCard'
import Button from '../ui/Button'
import { ToneBadge } from '../ui/Badge'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../lib/auth'
import { fetchScansForUser } from '../../lib/db'
import { scanStatusTone } from '../../lib/ui'
import { SUPPORTED_LANGUAGES } from '../../i18n/report'
import { downloadInspectionPdf } from '../../lib/pdf'
import { formatDateTime } from '../../utils/format'
import { displayProductName, displayText } from '../../lib/textnorm'
import type { ScanRow } from '../../lib/types2'

function verdictTone(s: ScanRow): 'emerald' | 'amber' | 'rose' | 'cyan' {
  if (s.verdict === 'COMPLIANT') return 'emerald'
  if (s.verdict === 'PARTIALLY_COMPLIANT') return 'amber'
  if (s.verdict === 'NON_COMPLIANT') return 'rose'
  return 'cyan'
}

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function ReportsPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [scans, setScans] = useState<ScanRow[]>([])
  const [loading, setLoading] = useState(true)
  const [lang, setLang] = useState('en')
  const [exportingId, setExportingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user?.id) return
    try {
      const rows = await fetchScansForUser(user.id, 200)
      setScans(rows.filter((s) => s.status !== 'pending_review'))
    } catch (e) {
      toast('error', 'Could not load reports', (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [user?.id, toast])

  useEffect(() => {
    void load()
  }, [load])

  const exportPdf = async (scan: ScanRow) => {
    setExportingId(scan.id)
    try {
      const name = await downloadInspectionPdf(scan, lang)
      toast('success', 'Report saved', name)
    } catch (e) {
      toast('error', 'Export failed', (e as Error).message)
    } finally {
      setExportingId(null)
    }
  }

  const exportCsv = () => {
    if (scans.length === 0) return
    const header = ['ID', 'Product', 'Brand', 'Manufacturer', 'Category', 'Score', 'Verdict', 'Risk', 'Status', 'Scanned', 'Language']
    const rows = scans.map((s) =>
      [s.id, s.product_name, s.brand, s.manufacturer, s.category, s.overall_score, s.verdict, s.risk_score, s.status, s.created_at, lang]
        .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
        .join(','),
    )
    downloadText('auditx-reports.csv', [header.join(','), ...rows].join('\n'), 'text/csv;charset=utf-8')
    toast('success', 'CSV exported', `${scans.length} reports written to auditx-reports.csv`)
  }

  const exportJson = () => {
    if (scans.length === 0) return
    downloadText('auditx-reports.json', JSON.stringify(scans, null, 2), 'application/json;charset=utf-8')
    toast('success', 'JSON exported', `${scans.length} reports written to auditx-reports.json`)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">My Reports</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {scans.length} verified inspection reports · export any of them as a PDF in your chosen language.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            aria-label="Report language"
            className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-white/15 dark:bg-navy-950 dark:text-slate-200"
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
          <Button variant="outline" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={exportCsv} disabled={scans.length === 0}>
            CSV
          </Button>
          <Button variant="outline" icon={<FileJson className="h-4 w-4" />} onClick={exportJson} disabled={scans.length === 0}>
            JSON
          </Button>
        </div>
      </div>

      <AnalyticsCard
        title="Generated Reports"
        subtitle={`Inspection reports from your ${scans.length} analyzed scans`}
        action={<span className="hidden items-center gap-1.5 text-xs text-slate-400 sm:inline-flex"><CalendarClock className="h-3.5 w-3.5" /> Syncs live with your scans</span>}
        bodyClassName="p-0"
      >
        {loading ? (
          <p className="px-5 py-8 text-center text-sm text-slate-400">Loading reports…</p>
        ) : scans.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">No reports yet</p>
            <p className="mt-1 text-sm text-slate-400">Scan a product and the inspection report will appear here.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {scans.map((s) => (
              <div key={s.id} className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-slate-50/70 sm:flex-row sm:items-center dark:hover:bg-slate-800/40">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-500/15">
                  <FileText className="h-5 w-5 text-brand-600 dark:text-brand-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{s.product_name?.trim() ? displayProductName(s.product_name) : 'Untitled'}</p>
                    <ToneBadge tone={verdictTone(s)}>{s.verdict}</ToneBadge>
                    <ToneBadge tone={scanStatusTone(s.status)}>{s.status.replace('_', ' ')}</ToneBadge>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">
                    <span className="font-mono font-semibold">{s.id.slice(0, 10)}…</span> · {displayText(s.brand || s.manufacturer) || '—'} · Score{' '}
                    <b className="text-slate-600 dark:text-slate-300">{s.overall_score}/100</b> · Risk <b className="text-slate-600 dark:text-slate-300">{s.risk_score}</b> ·{' '}
                    {formatDateTime(s.created_at)}
                  </p>
                </div>
                <button
                  onClick={() => void exportPdf(s)}
                  disabled={exportingId === s.id}
                  className="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-60 sm:self-auto dark:border-white/15 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {exportingId === s.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} PDF
                </button>
              </div>
            ))}
          </div>
        )}
      </AnalyticsCard>
    </div>
  )
}