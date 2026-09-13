import { useState } from 'react'
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  FileQuestion,
  MapPin,
  Scale as ScaleIcon,
  Flag,
  ClipboardCheck,
} from 'lucide-react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import { ToneBadge } from '../ui/Badge'
import { useToast } from '../ui/Toast'
import { riskBand, riskTone } from '../../lib/risk'
import { severityTone, violationStatusTone } from '../../lib/ui'
import { setScanStatus } from '../../lib/services'
import type { ReportRow, ScanRow, ViolationRow } from '../../lib/types2'
import ManualReviewModal from './ManualReviewModal'
import InspectionReport from '../inspection/InspectionReport'
import { formatDateTime } from '../../utils/format'
import { displayProductName, displaySentence, displayText } from '../../lib/textnorm'

function verdictTone(verdict: string): 'brand' | 'emerald' | 'amber' | 'rose' {
  if (verdict === 'COMPLIANT') return 'emerald'
  if (verdict === 'PARTIALLY_COMPLIANT') return 'amber'
  return 'rose'
}

function RuleStatusBadge({ status }: { status: string }) {
  const tone = status === 'PASS' ? 'emerald' : status === 'WARNING' ? 'amber' : status === 'FAIL' ? 'rose' : 'slate'
  return <ToneBadge tone={tone as 'emerald' | 'amber' | 'rose' | 'slate'}>{status}</ToneBadge>
}

export default function ScanDetailModal({
  scan,
  violations,
  reports,
  onClose,
  onRefresh,
}: {
  scan: ScanRow | null
  violations: ViolationRow[]
  reports: ReportRow[]
  onClose: () => void
  onRefresh: () => void
}) {
  const { toast } = useToast()
  const [status, setStatus] = useState(scan?.status ?? 'analyzed')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(scan?.notes ?? '')
  const [manualOpen, setManualOpen] = useState(false)

  if (!scan) return null

  const risk = scan.risk_score ?? 100 - scan.overall_score
  const band = riskBand(risk)
  const openViolations = violations.filter((v) => !['Resolved', 'Rejected'].includes(v.status))
  const stats: Array<{ label: string; value: React.ReactNode }> = [
    { label: 'Compliance score', value: <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">{scan.overall_score}<span className="text-base font-bold text-slate-400">/100</span></span> },
    { label: 'Risk score', value: (
      <span className="inline-flex flex-wrap items-center justify-center gap-1.5">
        <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">{risk}</span>
        <ToneBadge tone={riskTone(band)}>{band} risk</ToneBadge>
      </span>
    ) },
    { label: 'Violations', value: <span className="text-2xl font-extrabold text-rose-600 dark:text-rose-400">{openViolations.length}<span className="text-base font-bold text-slate-400"> open</span></span> },
    { label: 'Reports', value: <span className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">{reports.length}</span> },
  ]

  const updateStatus = async (s: string) => {
    setBusy(true)
    try {
      await setScanStatus(scan.id, s as ScanRow['status'], note)
      setStatus(s as typeof status)
      toast('success', 'Scan updated', `Status is now ${s}.`)
      onRefresh()
    } catch (e) {
      toast('error', 'Update failed', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal
        open={!!scan}
        onClose={onClose}
        size="xl"
        title={scan.product_name?.trim() ? displayProductName(scan.product_name) : 'Untitled scan'}
        description={`${displayText(scan.brand || scan.manufacturer) || 'Unknown'} · scanned ${formatDateTime(scan.created_at)}`}
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <select
              value={status}
              onChange={(e) => void updateStatus(e.target.value)}
              className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm font-medium text-slate-700 disabled:opacity-60 dark:border-white/15 dark:bg-navy-900 dark:text-slate-200"
              disabled={busy}
              aria-label="Update scan status"
            >
              <option value="analyzed">Analyzed</option>
              <option value="flagged">Flagged</option>
              <option value="manual_review">Manual review</option>
              <option value="resolved">Resolved</option>
            </select>
            <Button variant="outline" icon={<Flag className="h-4 w-4" />} onClick={() => void updateStatus('flagged')} loading={busy}>
              Flag
            </Button>
            <Button icon={<ClipboardCheck className="h-4 w-4" />} onClick={() => setManualOpen(true)}>
              Manual Review
            </Button>
          </div>
        }
      >
        {/* Risk profile */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-white/10 dark:bg-navy-950/40">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{s.label}</p>
              <div className="mt-1.5">{s.value}</div>
            </div>
          ))}
        </div>

        {/* Label photos */}
        {(() => {
          const images = scan.image_urls?.length ? scan.image_urls : scan.image_url ? [scan.image_url] : []
          if (images.length === 0) return null
          return (
            <div className="mt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Label photos</h3>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {images.map((url, i) => (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="block overflow-hidden rounded-lg border border-slate-200 dark:border-white/10"
                  >
                    <img src={url} alt={`Label photo ${i + 1}`} className="h-16 w-full object-cover transition-transform hover:scale-105" />
                  </a>
                ))}
              </div>
            </div>
          )
        })()}

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* AI result */}
          <section className="rounded-2xl border border-slate-200/80 p-4 dark:border-white/10">
            <header className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                <BrainCircuit className="h-4 w-4 text-brand-500" /> AI Analysis
              </h3>
              <ToneBadge tone={verdictTone(scan.verdict)}>{scan.verdict}</ToneBadge>
            </header>
            {scan.summary && <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{displaySentence(scan.summary)}</p>}
            <ul className="mt-3 space-y-2">
              {(scan.rules ?? []).map((r, i) => (
                <li key={i} className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 dark:bg-navy-950/50">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                      <span className="font-mono text-brand-600 dark:text-brand-400">{r.rule_id}</span> · {displayText(r.field) || '—'}
                    </p>
                    {r.issue && <p className="mt-0.5 text-xs text-slate-400">{displaySentence(r.issue)}</p>}
                  </div>
                  <RuleStatusBadge status={r.status} />
                </li>
              ))}
              {(scan.rules ?? []).length === 0 && <p className="text-sm text-slate-400">No rule checks recorded.</p>}
            </ul>
          </section>

          <div className="space-y-4">
            {/* OCR / AI insights */}
            <section className="rounded-2xl border border-slate-200/80 p-4 dark:border-white/10">
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                <FileQuestion className="h-4 w-4 text-brand-500" /> OCR & insights
              </h3>
              {(scan.ai_insights ?? []).length > 0 ? (
                <ul className="mt-2 space-y-1.5">
                  {scan.ai_insights.slice(0, 6).map((a, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                      <span><b className="font-mono">{a.rule_id}</b> {a.field}: {a.issue}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-slate-400">{scan.ocr_text ? 'OCR text captured but insight extraction not available.' : 'No OCR insights recorded.'}</p>
              )}
              {scan.manufacturer && (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-navy-950/50 dark:text-slate-400">
                  Manufacturer: <b className="text-slate-700 dark:text-slate-200">{displayText(scan.manufacturer)}</b>
                </p>
              )}
              {scan.location_name && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
                  <MapPin className="h-3.5 w-3.5" /> {scan.location_name}
                </p>
              )}
            </section>

            {/* Manual result (if reviewed) */}
            <section className="rounded-2xl border border-slate-200/80 p-4 dark:border-white/10">
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                <ScaleIcon className="h-4 w-4 text-brand-500" /> Manual result
              </h3>
              {scan.manual_result ? (
                <div className="mt-2 space-y-1.5 text-sm">
                  <p className="text-slate-500 dark:text-slate-400">Verified score: <b className="text-slate-800 dark:text-slate-100">{scan.manual_result.score}/100</b></p>
                  {Object.keys(scan.manual_result.corrections ?? {}).length > 0 && (
                    <p className="text-xs text-slate-400">{Object.entries(scan.manual_result.corrections).length} field correction(s) applied</p>
                  )}
                  {scan.manual_result.notes && <p className="text-xs text-slate-500 dark:text-slate-400">{scan.manual_result.notes}</p>}
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-400">Not yet reviewed by an inspector.</p>
              )}
            </section>
          </div>
        </div>

        {/* AI assistant, multi-label, OCR & export */}
        <div className="mt-6">
          <InspectionReport scan={scan} />
        </div>

        {/* Violations */}
        {violations.length > 0 && (
          <section className="mt-4 rounded-2xl border border-slate-200/80 p-4 dark:border-white/10">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Linked violations ({violations.length})</h3>
            <ul className="mt-2 space-y-1.5">
              {violations.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-rose-50/60 px-3 py-2 text-xs dark:bg-rose-500/10">
                  <ToneBadge tone={severityTone(v.severity)}>{v.severity}</ToneBadge>
                  <span className="font-semibold text-slate-700 dark:text-slate-200">{v.type || 'Rule violation'}</span>
                  <span className="text-slate-400">{v.description}</span>
                  <span className="ml-auto"><ToneBadge tone={violationStatusTone(v.status as ViolationRow['status'])}>{v.status}</ToneBadge></span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Admin note */}
        <section className="mt-4">
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Administrative notes</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Notes for the inspection trail…"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-white/15 dark:bg-navy-950 dark:text-slate-100"
          />
          <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Status changes & reviews are logged to the audit trail.
          </p>
        </section>
      </Modal>

      <ManualReviewModal
        open={manualOpen}
        scan={scan}
        violations={violations}
        onClose={() => setManualOpen(false)}
        onSaved={() => {
          setManualOpen(false)
          onRefresh()
        }}
      />
    </>
  )
}