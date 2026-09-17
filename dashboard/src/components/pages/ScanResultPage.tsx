import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Eye,
  FileText,
  GitCompareArrows,
  Info,
  Loader2,
  MessageSquareText,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react'
import Button from '../ui/Button'
import { ToneBadge } from '../ui/Badge'
import { useToast } from '../ui/Toast'
import {
  getInspection,
  resolvePhotoUrls,
  retryAnalysis,
  saveRemarks,
  verifyChanges,
  type AdjudicatedField,
  type Finding,
  type InspectionDoc,
  type VerificationSummary,
} from '../../lib/inspection'
import { downloadInspectionReport } from '../../lib/pdf'
import { formatDateTime, cn } from '../../utils/format'
import { useLanguage } from '../../i18n/LanguageContext'
import type { DictKey } from '../../i18n/en'

const statusTone = (s: InspectionDoc['status']) =>
  s === 'compliant' ? 'emerald' : s === 'needs_review' ? 'amber' : s === 'violation' ? 'rose' : 'rose'

const findingTone = (f: Finding) =>
  f.status === 'compliant' ? 'emerald' : f.status === 'na' ? 'slate' : f.status === 'needs_review' ? 'amber' : 'rose'

function ScoreRing({ score, status, statusLabel }: { score: number; status: InspectionDoc['status']; statusLabel?: string }) {
  const color = status === 'compliant' ? '#10b981' : status === 'needs_review' ? '#f59e0b' : '#ef4444'
  const r = 54
  const c = 2 * Math.PI * r
  const off = c - (Math.min(100, Math.max(0, score)) / 100) * c
  return (
    <div className="relative grid h-36 w-36 place-items-center">
      <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
        <circle cx="64" cy="64" r={r} fill="none" stroke="currentColor" strokeWidth="10" className="text-slate-200 dark:text-navy-700" />
        <circle cx="64" cy="64" r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <div className="absolute text-center">
        <div className="text-3xl font-extrabold text-ink-text dark:text-white">{score}<span className="text-base font-semibold text-slate-400">/100</span></div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{statusLabel ?? status}</div>
      </div>
    </div>
  )
}

interface DetailRow {
  key: string
  label: string
  value: string
}

/* ================================================================ */
/* Multi-AI Evidence Verification & Adjudication                      */
/* ================================================================ */

const ADJ_TONE: Record<AdjudicatedField['status'], 'emerald' | 'amber' | 'rose' | 'slate'> = {
  VERIFIED: 'emerald',
  NEEDS_REVIEW: 'amber',
  CONFLICT: 'rose',
  NOT_DETECTED: 'slate',
  LOW_CONFIDENCE: 'amber',
}

const PROVIDER_LABEL: Record<string, string> = {
  paddle: 'OCR',
  gemini: 'GEMINI',
  openrouter: 'OPENROUTER',
  mock: 'MOCK',
}

function reportTitle(name: string, provider: string): string {
  const n = name === 'report_1' ? 'REPORT 1' : name === 'report_2' ? 'REPORT 2' : name === 'report_3' ? 'REPORT 3' : name.toUpperCase()
  return `${n} (${PROVIDER_LABEL[provider] ?? provider.toUpperCase()})`
}

type VerFilter = 'all' | 'conflicts' | 'verified' | 'review' | 'notdetected'

function VerificationSection({
  doc,
  photos,
  onRetry,
  retryBusy,
}: {
  doc: InspectionDoc
  photos: Array<string | null>
  onRetry: () => void
  retryBusy: boolean
}) {
  const v: VerificationSummary | null | undefined = doc.verification
  const { t: vt } = useLanguage()
  const ADJ_LABEL: Record<AdjudicatedField['status'], string> = {
    VERIFIED: vt('result.stVerified'),
    NEEDS_REVIEW: vt('result.stReview'),
    CONFLICT: vt('result.stConflict'),
    NOT_DETECTED: vt('result.stMissing'),
    LOW_CONFIDENCE: vt('result.stLow'),
  }
  const [filter, setFilter] = useState<VerFilter>('all')
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [evidenceField, setEvidenceField] = useState<AdjudicatedField | null>(null)
  const [rawOpen, setRawOpen] = useState(false)
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null)
  const tableRef = useRef<HTMLDivElement | null>(null)

  const fields = useMemo(() => v?.fields ?? [], [v])
  const counts = v?.counts

  const filtered = useMemo(() => {
    if (filter === 'verified') return fields.filter((f) => f.status === 'VERIFIED')
    if (filter === 'review') return fields.filter((f) => f.status === 'NEEDS_REVIEW' || f.status === 'LOW_CONFIDENCE')
    if (filter === 'notdetected') return fields.filter((f) => f.status === 'NOT_DETECTED')
    if (filter === 'conflicts') return fields.filter((f) => f.status === 'CONFLICT' || f.conflicting_reports.length > 0)
    return fields
  }, [fields, filter])

  const decimalConflicts = useMemo(() => fields.filter((f) => f.decimal_conflict), [fields])

  if (!v) return null

  const gotoConflicts = () => {
    setFilter('conflicts')
    window.setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const voteFor = (f: AdjudicatedField, reportName: string) => f.votes.find((x) => x.report === reportName) ?? null

  const evPhotoUrl = evidenceField?.evidence_image != null ? (photos[(evidenceField.evidence_image ?? 1) - 1] ?? null) : null

  const filterBtn = (key: VerFilter, label: string, count: number) => (
    <button
      key={key}
      type="button"
      onClick={() => setFilter(key)}
      className={cn(
        'rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
        filter === key
          ? 'border-brand-500 bg-brand-500/10 text-brand-600 dark:text-brand-400'
          : 'border-line bg-white text-ink-text-soft hover:border-line-strong dark:border-white/10 dark:bg-navy-950 dark:text-navy-300',
      )}
    >
      {label} ({count})
    </button>
  )

  return (
    <section className="mt-6 rounded-2xl border border-line bg-white/60 p-5 dark:border-white/10 dark:bg-navy-900/60">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink-text dark:text-white">{vt('result.verTitle')}</h2>
          <p className="mt-1 text-xs text-ink-text-soft dark:text-navy-300">
            Field-by-field triangulation across {v.reports.map((r) => reportTitle(r.name, r.provider)).join(', ')}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-lg bg-white px-2.5 py-1 shadow-sm dark:bg-navy-950">
              {vt('result.verTrust')} <span className="font-bold text-ink-text dark:text-white">{v.trust_score}/100</span>
            </span>
            {v.reports.map((r) => (
              <span key={r.name} className="rounded-lg bg-white px-2.5 py-1 shadow-sm dark:bg-navy-950" title={r.ok ? `${r.engines.join('+') || r.provider}` : (r.error ?? 'unavailable')}>
                <span className={cn('mr-1 inline-block h-1.5 w-1.5 rounded-full', r.ok ? 'bg-emerald-500' : 'bg-slate-300')} />
                {reportTitle(r.name, r.provider)}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" icon={<Eye className="h-4 w-4" />} onClick={() => setRawOpen(true)}>
            {vt('result.verRawBtn')}
          </Button>
          <Button variant="outline" size="sm" loading={retryBusy} icon={<RefreshCw className="h-4 w-4" />} onClick={onRetry}>
            {vt('result.verRerunBtn')}
          </Button>
          <Button variant="outline" size="sm" icon={<GitCompareArrows className="h-4 w-4" />} onClick={gotoConflicts}>
            {vt('result.verConflictsBtn')}
          </Button>
        </div>
      </div>

      {v.single_source && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-xs text-amber-700 dark:text-amber-300">{v.single_source_note ?? 'Single-source result.'}</p>
        </div>
      )}

      {/* Summary cards */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: vt('result.verCardVerified'), value: counts?.verified ?? 0, cls: 'text-emerald-600 dark:text-emerald-400' },
          { label: vt('result.verCardUncertain'), value: (counts?.needs_review ?? 0) + (counts?.low_confidence ?? 0), cls: 'text-amber-600 dark:text-amber-400' },
          { label: vt('result.verCardResolved'), value: counts?.resolved ?? 0, cls: 'text-sky-600 dark:text-sky-400' },
          { label: vt('result.verCardDisagree'), value: counts?.disagreements ?? 0, cls: 'text-rose-600 dark:text-rose-400' },
          { label: vt('result.verCardMissing'), value: counts?.not_detected ?? 0, cls: 'text-slate-500 dark:text-slate-300' },
        ].map((c) => (
          <div key={c.label} className="rounded-xl bg-white p-3 text-center shadow-sm dark:bg-navy-950">
            <div className={cn('text-2xl font-extrabold', c.cls)}>{c.value}</div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Disagreement insights */}
      {decimalConflicts.length > 0 && (
        <button
          type="button"
          onClick={gotoConflicts}
          className="mt-3 flex w-full items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2.5 text-left"
        >
          <TriangleAlert className="h-4 w-4 shrink-0 text-rose-500" />
          <span className="text-xs text-ink-text dark:text-slate-200">
            <span className="font-bold text-rose-600 dark:text-rose-400">⚠ {decimalConflicts.length} {vt('result.verDecimal')}</span>
            {' — '}
            {decimalConflicts.map((f) => f.label).join(', ')}. {vt('result.verDecimalMsg')}
          </span>
        </button>
      )}

      {/* Filters */}
      <div ref={tableRef} className="mt-4 flex flex-wrap items-center gap-2 scroll-mt-24">
        {filterBtn('all', vt('result.filterAll'), counts?.total ?? fields.length)}
        {filterBtn('conflicts', vt('result.filterConflicts'), fields.filter((f) => f.status === 'CONFLICT' || f.conflicting_reports.length > 0).length)}
        {filterBtn('verified', vt('result.filterVerified'), counts?.verified ?? 0)}
        {filterBtn('review', vt('result.filterReview'), (counts?.needs_review ?? 0) + (counts?.low_confidence ?? 0) + (counts?.conflict ?? 0))}
        {filterBtn('notdetected', vt('result.filterMissing'), counts?.not_detected ?? 0)}
        <span className="ml-auto text-xs text-slate-400">{vt('result.showing', { n: filtered.length })}</span>
      </div>

      {/* Comparison table */}
      <div className="mt-3 overflow-hidden rounded-xl border border-line dark:border-white/10">
        <div className="hidden grid-cols-[150px_1.2fr_1fr_1fr_1fr_44px] gap-2 bg-slate-50 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 md:grid dark:bg-navy-950 dark:text-navy-400">
          <span>{vt('result.colField')}</span>
          <span>{vt('result.colFinal')}</span>
          {v.reports.map((r) => (
            <span key={r.name}>{reportTitle(r.name, r.provider)}</span>
          ))}
          <span>{vt('result.colDetails')}</span>
        </div>
        {filtered.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-slate-400">{vt('result.noFilterMatch')}</p>
        )}
        {filtered.map((f) => {
          const open = openKey === f.key
          return (
            <div key={f.key} className="border-t border-line first:border-t-0 dark:border-white/5">
              <div className="grid gap-2 px-3 py-3 md:grid-cols-[150px_1.2fr_1fr_1fr_1fr_44px] md:items-start">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 md:hidden">{vt('result.colField')}</div>
                  <div className="text-sm font-semibold text-ink-text dark:text-slate-100">{f.label}</div>
                  <div className="font-mono text-[10px] text-slate-400">{f.key}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 md:hidden">{vt('result.colFinal')}</div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ToneBadge tone={ADJ_TONE[f.status]}>{ADJ_LABEL[f.status]}</ToneBadge>
                    <span className="text-xs font-bold text-ink-text dark:text-white">{Math.round(f.confidence * 100)}%</span>
                  </div>
                  <div className="mt-1 break-words text-sm font-medium text-ink-text dark:text-slate-200">{f.final_value ?? '—'}</div>
                  {f.supporting_reports.length > 0 && (
                    <div className="mt-0.5 text-[11px] text-slate-400">{vt('result.source')} {f.supporting_reports.join(' + ')}</div>
                  )}
                </div>
                {v.reports.map((r) => {
                  const vote = voteFor(f, r.name)
                  return (
                    <div key={r.name}>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 md:hidden">{reportTitle(r.name, r.provider)}</div>
                      {!r.ok ? (
                        <span className="text-xs italic text-slate-400" title={r.error ?? 'unavailable'}>unavailable</span>
                      ) : vote?.value ? (
                        <>
                          <div className="break-words text-sm text-ink-text dark:text-slate-200">{vote.value}</div>
                          <div className="text-[11px] text-slate-400">{vote.confidence != null ? `${Math.round(vote.confidence * 100)}%` : '—'}</div>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </div>
                  )
                })}
                <div className="flex md:justify-end">
                  <button
                    type="button"
                    aria-label={open ? vt('result.collapse') : vt('result.expand')}
                    onClick={() => setOpenKey(open ? null : f.key)}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-line text-ink-text-soft hover:border-line-strong dark:border-white/10 dark:text-navy-300"
                  >
                    <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
                  </button>
                </div>
              </div>

              {open && (
                <div className="border-t border-dashed border-line bg-slate-50/60 px-3 py-3 dark:border-white/10 dark:bg-navy-950/60">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{vt('result.allOutputs')}</p>
                      <ul className="mt-1.5 space-y-1.5">
                        {f.votes.map((vt, i) => (
                          <li key={i} className="text-xs text-ink-text dark:text-slate-200">
                            <span className="font-semibold">{vt.report} ({PROVIDER_LABEL[vt.provider] ?? vt.provider})</span>
                            {' — '}
                            <span className="break-words">{vt.value ?? '—'}</span>
                            <span className="text-slate-400"> · {vt.confidence != null ? `${Math.round(vt.confidence * 100)}%` : 'n/a'}</span>
                            {vt.normalized && vt.normalized !== (vt.value ?? '').toLowerCase() && (
                              <span className="block font-mono text-[11px] text-slate-400">normalized: {vt.normalized}</span>
                            )}
                          </li>
                        ))}
                        {f.votes.length === 0 && <li className="text-xs text-slate-400">{vt('result.noVotes')}</li>}
                      </ul>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500 dark:text-navy-300">
                        {f.similarity != null && <span className="rounded bg-white px-2 py-0.5 shadow-sm dark:bg-navy-900">{vt('result.similarity')} {Math.round(f.similarity * 100)}%</span>}
                        <span className="rounded bg-white px-2 py-0.5 shadow-sm dark:bg-navy-900">{vt('result.method')} {f.verification_method}</span>
                        {f.decimal_conflict && <span className="rounded bg-rose-500/10 px-2 py-0.5 font-semibold text-rose-600 dark:text-rose-400">{vt('result.decimalTag')}</span>}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{vt('result.decision')}</p>
                      <p className="mt-1.5 text-xs leading-relaxed text-ink-text dark:text-slate-200">{f.reasoning}</p>
                      {f.evidence_text && (
                        <p className="mt-1.5 text-[11px] text-slate-500 dark:text-navy-300">
                          Evidence{f.evidence_image ? ` · photo ${f.evidence_image}` : ''}{f.evidence_bbox ? ` · box [${f.evidence_bbox.join(', ')}]` : ''}:{' '}
                          <span className="font-mono">{f.evidence_text}</span>
                        </p>
                      )}
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => { setImgDims(null); setEvidenceField(f) }}>
                          {vt('result.viewEvidence')}
                        </Button>
                        <Button variant="outline" size="sm" loading={retryBusy} icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={onRetry}>
                          {vt('result.rescan')}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        {vt('result.adjudicatedOn')} {v.adjudicated_at ? new Date(v.adjudicated_at).toLocaleString() : ''} · {vt('result.trustNote')}
      </p>

      {/* Evidence modal */}
      {evidenceField && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/60 p-4" onClick={() => setEvidenceField(null)}>
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-5 dark:bg-navy-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-ink-text dark:text-white">{vt('result.evidenceFor')} {evidenceField.label}</h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-navy-300">
                  {evidenceField.final_value ?? '—'} · {Math.round(evidenceField.confidence * 100)}% · {ADJ_LABEL[evidenceField.status]}
                </p>
              </div>
              <button type="button" aria-label={vt('result.close')} onClick={() => setEvidenceField(null)} className="grid h-8 w-8 place-items-center rounded-lg border border-line dark:border-white/10">
                <X className="h-4 w-4" />
              </button>
            </div>
            {evPhotoUrl ? (
              <div className="relative mt-3 overflow-hidden rounded-xl border border-line dark:border-white/10">
                <img
                  src={evPhotoUrl}
                  alt={`Evidence for ${evidenceField.label}`}
                  className="max-h-[55vh] w-full touch-pinch-zoom object-contain"
                  onLoad={(e) => setImgDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                />
                {evidenceField.evidence_bbox && imgDims && (
                  <div
                    className="pointer-events-none absolute rounded border-2 border-emerald-400 bg-emerald-400/15"
                    style={{
                      left: `${(evidenceField.evidence_bbox[0] / imgDims.w) * 100}%`,
                      top: `${(evidenceField.evidence_bbox[1] / imgDims.h) * 100}%`,
                      width: `${(evidenceField.evidence_bbox[2] / imgDims.w) * 100}%`,
                      height: `${(evidenceField.evidence_bbox[3] / imgDims.h) * 100}%`,
                    }}
                  />
                )}
              </div>
            ) : (
              <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-navy-950 dark:text-navy-300">
                {vt('result.noPhoto')}
              </p>
            )}
            <p className="mt-2 text-[11px] text-slate-400">{vt('result.regionApprox')}</p>
            <ul className="mt-3 space-y-1.5">
              {evidenceField.votes.map((vt, i) => (
                <li key={i} className="text-xs text-ink-text dark:text-slate-200">
                  <span className="font-semibold">{vt.report} ({PROVIDER_LABEL[vt.provider] ?? vt.provider})</span>
                  {' — '}{vt.value ?? '—'}
                  <span className="text-slate-400"> · {vt.confidence != null ? `${Math.round(vt.confidence * 100)}%` : 'n/a'}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs italic text-slate-500 dark:text-navy-300">{evidenceField.reasoning}</p>
          </div>
        </div>
      )}

      {/* Raw evidence modal */}
      {rawOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/60 p-4" onClick={() => setRawOpen(false)}>
          <div
            className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-5 dark:bg-navy-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-ink-text dark:text-white">{vt('result.rawEvTitle')}</h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-navy-300">{vt('result.rawEvSub')}</p>
              </div>
              <button type="button" aria-label={vt('result.close')} onClick={() => setRawOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg border border-line dark:border-white/10">
                <X className="h-4 w-4" />
              </button>
            </div>
            {photos.some(Boolean) ? (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {photos.map((u, i) => u ? (
                  <a key={i} href={u} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-line dark:border-white/10">
                    <img src={u} alt={`Raw evidence ${i + 1}`} className="h-36 w-full object-cover" loading="lazy" />
                  </a>
                ) : null)}
              </div>
            ) : (
              <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-navy-950">{vt('result.noStoredPhotos')}</p>
            )}
            <p className="mt-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">{vt('result.regions')} ({(doc.ocr_regions ?? []).length})</p>
            <ul className="mt-1.5 max-h-48 space-y-1 overflow-auto">
              {(doc.ocr_regions ?? []).map((r, i) => {
                const reg = r as { text?: unknown; conf?: unknown } | null
                return (
                  <li key={i} className="flex items-start gap-2 text-xs text-ink-text dark:text-slate-200">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                    <span className="font-mono text-[11px]">{String(reg?.text ?? '')}</span>
                    {typeof reg?.conf === 'number' && <span className="text-slate-400">{Math.round(reg.conf * 100)}%</span>}
                  </li>
                )
              })}
              {(doc.ocr_regions ?? []).length === 0 && <li className="text-xs text-slate-400">{vt('result.noRegions')}</li>}
            </ul>
            <p className="mt-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">{vt('result.rawTranscript')}</p>
            <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-navy-950 dark:text-slate-400">
              {doc.ocr_text ?? '—'}
            </pre>
          </div>
        </div>
      )}
    </section>
  )
}

export default function ScanResultPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { t } = useLanguage()

  const [doc, setDoc] = useState<InspectionDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [busy, setBusy] = useState(false)
  const [photos, setPhotos] = useState<Array<string | null>>([])
  const [remarks, setRemarks] = useState('')
  const [savingRemarks, setSavingRemarks] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const timerRef = useRef<number | null>(null)

  const load = useCallback(
    async (polling = false) => {
      if (!id) return
      if (!polling) setLoading(true)
      try {
        const d = await getInspection(id)
        setNotFound(false)
        setDoc(d)
        setRemarks(d.remarks ?? d.notes ?? '')
      } catch {
        setNotFound(true)
      } finally {
        if (!polling) setLoading(false)
      }
    },
    [id],
  )

  useEffect(() => {
    void load()
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [load])

  // Poll while the analysis is still pending on the server.
  useEffect(() => {
    if (!doc || doc.ocr_status !== 'pending' || loading) return
    timerRef.current = window.setTimeout(() => void load(true), 2500)
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [doc, loading, load])

  useEffect(() => {
    void resolvePhotoUrls(doc?.photo_paths ?? []).then(setPhotos)
  }, [doc?.photo_paths])

  const findings = useMemo(() => doc?.compliance_findings ?? [], [doc])
  const counts = useMemo(() => {
    const c = { passed: 0, review: 0, failed: 0, criticalFailed: 0, na: 0 }
    for (const f of findings) {
      if (f.status === 'compliant') c.passed++
      else if (f.status === 'needs_review') c.review++
      else if (f.status === 'critical_failed') c.criticalFailed++
      else if (f.status === 'failed') c.failed++
      else c.na++
    }
    return c
  }, [findings])

  const details: DetailRow[] = useMemo(() => {
    const f = doc?.ocr_fields ?? {}
    const rows: Array<[string, DictKey]> = [
      ['commodity_name', 'field.commodity_name'],
      ['brand', 'field.brand'],
      ['manufacturer', 'field.manufacturer'],
      ['net_quantity', 'field.net_quantity'],
      ['mrp', 'field.mrp'],
      ['batch_no', 'field.batch_no'],
      ['mfg_date', 'field.mfg_date'],
      ['expiry_date', 'field.expiry_date'],
      ['ingredients_text', 'field.ingredients_text'],
      ['allergen_info', 'field.allergen_info'],
      ['required_declarations', 'field.required_declarations'],
      ['warnings', 'field.warnings'],
      ['certification_details', 'field.certification_details'],
      ['country_of_origin', 'field.country_of_origin'],
      ['storage_conditions', 'field.storage_conditions'],
      ['customer_care_details', 'field.customer_care_details'],
      ['contact_info', 'field.contact_info'],
      ['imported_manufacturer_detail', 'field.imported_manufacturer_detail'],
    ]
    return rows
      .map(([key, labelKey]) => ({ key, label: t(labelKey), value: f[key] ?? '' }))
      .filter((r) => r.value)
  }, [doc, t])

  const onRetry = async () => {
    if (!id) return
    setBusy(true)
    try {
      const res = await retryAnalysis(id)
      if (!res.ok) throw new Error(res.error ?? t('result.retryFail'))
      toast('info', t('result.retryRunning'), t('result.retryMsg'))
      await load()
    } catch (e) {
      toast('error', t('result.retryFail'), (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const onVerify = async () => {
    if (!id) return
    setVerifying(true)
    try {
      await verifyChanges(id, true)
      await load()
      toast('success', t('result.verifyOk'), t('result.verifyOkMsg'))
    } catch (e) {
      toast('error', t('result.verifyFail'), (e as Error).message)
    } finally {
      setVerifying(false)
    }
  }

  const onSaveRemarks = async () => {
    if (!id) return
    setSavingRemarks(true)
    try {
      await saveRemarks(id, remarks)
      toast('success', t('result.remarksOk'), '')
    } catch (e) {
      toast('error', t('result.remarksFail'), (e as Error).message)
    } finally {
      setSavingRemarks(false)
    }
  }

  const onDownloadPdf = async () => {
    if (!doc) return
    try {
      await downloadInspectionReport(doc)
      toast('success', t('result.pdfOk'), '')
    } catch (e) {
      toast('error', t('result.pdfFail'), (e as Error).message)
    }
  }

  /* ------------------------------------------------------------ screens */
  if (loading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-500" />
          <p className="mt-3 text-sm text-ink-text-soft dark:text-navy-300">{t('result.loading')}</p>
        </div>
      </div>
    )
  }

  if (notFound || !doc) {
    return (
      <div className="grid min-h-[60vh] place-items-center px-4">
        <div className="max-w-sm text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-rose-500" />
          <h1 className="mt-4 text-lg font-bold text-ink-text dark:text-white">{t('result.notFound')}</h1>
          <p className="mt-1 text-sm text-ink-text-soft dark:text-navy-300">
            {t('result.notFoundMsg')}
          </p>
          <Button className="mt-5" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/scan-history')}>
            {t('result.backToHistory')}
          </Button>
        </div>
      </div>
    )
  }

  // Pending / failed (no analysis yet)
  if (doc.ocr_status === 'pending' || doc.ocr_status === 'failed') {
    const failed = doc.ocr_status === 'failed'
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-12 text-center">
        {failed ? (
          <TriangleAlert className="mx-auto h-10 w-10 text-amber-500" />
        ) : (
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-brand-500" />
        )}
        <h1 className="mt-4 text-xl font-bold text-ink-text dark:text-white">
          {failed ? t('result.readFailTitle') : t('result.analyzingTitle')}
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-text-soft dark:text-navy-300">
          {failed
            ? (doc.ocr_error ?? t('result.readFailDefault'))
            : t('result.analyzingMsg')}
        </p>
        <p className="mt-3 text-xs text-slate-400">
          {t('result.scanned')} <span className="font-medium text-slate-500 dark:text-navy-300">{formatDateTime(doc.created_at)}</span>
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          {failed && (
            <Button loading={busy} icon={<RefreshCw className="h-4 w-4" />} onClick={() => void onRetry()}>
              {t('result.retry')}
            </Button>
          )}
          <Button variant="outline" icon={<ScanLine className="h-4 w-4" />} onClick={() => navigate('/scan-product')}>
            {t('result.newScan')}
          </Button>
        </div>
      </div>
    )
  }

  /* ------------------------------------------------------------ ready  */
  const score = doc.compliance_score ?? doc.overall_score ?? 0
  const status = doc.status
  const verified = doc.changes_verified ?? false
  const statusText =
    status === 'compliant' ? t('history.tabCompliant')
    : status === 'needs_review' ? t('history.tabReview')
    : status === 'violation' ? t('history.tabViolation')
    : t('history.tabCritical')
  const findingText = (s: Finding['status']): string =>
    s === 'compliant' ? t('result.passed')
    : s === 'needs_review' ? t('result.review')
    : s === 'failed' ? t('result.failed')
    : s === 'critical_failed' ? t('result.critical')
    : t('result.na')

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate(-1)}>
            {t('result.back')}
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-ink-text dark:text-white">
                {doc.product_name || t('result.fallbackTitle')}
              </h1>
              <ToneBadge tone={statusTone(status)}>{statusText}</ToneBadge>
            </div>
            <p className="text-xs text-ink-text-soft dark:text-navy-300">
              {formatDateTime(doc.analyzed_at ?? doc.created_at)} · {doc.ocr_language ?? 'en'} · engine {doc.ocr_provider ?? 'unknown'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {doc.photo_paths && doc.photo_paths.length > 0 && (
            <Button variant="outline" size="sm" icon={<FileText className="h-4 w-4" />} onClick={() => void onDownloadPdf()}>
              {t('result.pdf')}
            </Button>
          )}
          <Button variant="outline" size="sm" icon={<ScanLine className="h-4 w-4" />} onClick={() => navigate('/scan-product')}>
            {t('result.newScan')}
          </Button>
        </div>
      </div>

      {/* Hero + score */}
      <section className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <div className="flex flex-col items-center justify-center rounded-2xl border border-line bg-white/60 p-4 dark:border-white/10 dark:bg-navy-900/60">
          <ScoreRing score={score} status={status} statusLabel={statusText} />
          <p className="mt-3 text-center text-xs text-ink-text-soft dark:text-navy-300">
            {doc.product_name
              ? `${findings.length ? `${findings.length} ${t('result.checks')} · ` : ''}${doc.category === 'non_edible' ? t('result.nonEdible') : t('result.edible')}`
              : t('result.labelInspection')}
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-white/60 p-5 dark:border-white/10 dark:bg-navy-900/60">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">{t('result.summary')}</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-text dark:text-slate-100">
            {doc.summary ?? t('result.readyFallback')}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-xl bg-emerald-500/10 p-3 text-center">
              <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{counts.passed}</div>
              <div className="text-[10px] uppercase tracking-wide text-ink-text-soft dark:text-navy-300">{t('result.passed')}</div>
            </div>
            <div className="rounded-xl bg-amber-500/10 p-3 text-center">
              <div className="text-lg font-bold text-amber-600 dark:text-amber-400">{counts.review}</div>
              <div className="text-[10px] uppercase tracking-wide text-ink-text-soft dark:text-navy-300">{t('result.review')}</div>
            </div>
            <div className="rounded-xl bg-rose-500/10 p-3 text-center">
              <div className="text-lg font-bold text-rose-600 dark:text-rose-400">{counts.failed}</div>
              <div className="text-[10px] uppercase tracking-wide text-ink-text-soft dark:text-navy-300">{t('result.failed')}</div>
            </div>
            <div className="rounded-xl bg-rose-500/10 p-3 text-center">
              <div className="text-lg font-bold text-rose-700 dark:text-rose-500">{counts.criticalFailed}</div>
              <div className="text-[10px] uppercase tracking-wide text-ink-text-soft dark:text-navy-300">{t('result.critical')}</div>
            </div>
            <div className="rounded-xl bg-slate-500/10 p-3 text-center">
              <div className="text-lg font-bold text-slate-500 dark:text-slate-300">{counts.na}</div>
              <div className="text-[10px] uppercase tracking-wide text-ink-text-soft dark:text-navy-300">{t('result.na')}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Multi-AI verification & adjudication */}
      <VerificationSection doc={doc} photos={photos} onRetry={() => void onRetry()} retryBusy={busy} />

      {/* How the score is calculated — rule-by-rule, real numbers */}
      <details className="mt-4 rounded-2xl border border-line bg-white/60 px-5 py-4 dark:border-white/10 dark:bg-navy-900/60">
        <summary className="cursor-pointer text-sm font-semibold text-ink-text dark:text-slate-100">
          {t('result.scoreHow', { score })} <span className="font-normal text-slate-400">{t('result.scoreHowSub')}</span>
        </summary>
        {doc.compliance_breakdown ? (
          <div className="mt-3">
            <p className="rounded-xl bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-700 dark:bg-navy-950 dark:text-slate-300">
              {doc.compliance_breakdown.formula}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
              <div className="rounded-lg bg-emerald-500/10 px-3 py-2">
                <div className="font-bold text-emerald-600 dark:text-emerald-400">+{doc.compliance_breakdown.passed_points}</div>
                <div className="text-slate-500 dark:text-navy-300">{t('result.calcPassed', { n: doc.compliance_breakdown.passed })}</div>
              </div>
              <div className="rounded-lg bg-amber-500/10 px-3 py-2">
                <div className="font-bold text-amber-600 dark:text-amber-400">+{doc.compliance_breakdown.review_points}</div>
                <div className="text-slate-500 dark:text-navy-300">{t('result.calcReview', { n: doc.compliance_breakdown.review })}</div>
              </div>
              <div className="rounded-lg bg-rose-500/10 px-3 py-2">
                <div className="font-bold text-rose-600 dark:text-rose-400">−{doc.compliance_breakdown.fail_penalty}</div>
                <div className="text-slate-500 dark:text-navy-300">{t('result.calcFailed', { n: doc.compliance_breakdown.failed + doc.compliance_breakdown.critical_failed })}</div>
              </div>
              <div className="rounded-lg bg-slate-500/10 px-3 py-2">
                <div className="font-bold text-slate-600 dark:text-slate-300">÷ {doc.compliance_breakdown.applicable}</div>
                <div className="text-slate-500 dark:text-navy-300">{t('result.calcApplicable')}{doc.compliance_breakdown.na_excluded > 0 ? ` ${t('result.calcNaExcluded', { n: doc.compliance_breakdown.na_excluded })}` : ''}</div>
              </div>
              <div className="rounded-lg bg-slate-500/10 px-3 py-2">
                <div className="font-bold text-slate-600 dark:text-slate-300">{doc.compliance_breakdown.raw_score} → {doc.compliance_breakdown.final_score}</div>
                <div className="text-slate-500 dark:text-navy-300">{t('result.calcRaw')}{doc.compliance_breakdown.clamped ? ` ${t('result.calcClamped')}` : ''}</div>
              </div>
              <div className="rounded-lg bg-brand-500/10 px-3 py-2">
                <div className="font-bold text-brand-600 dark:text-brand-400">{doc.compliance_breakdown.band}</div>
                <div className="text-slate-500 dark:text-navy-300">{t('result.calcBand')}</div>
              </div>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              {t('result.calcExplainer')}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-slate-400">
            {t('result.formulaFallback', { p: counts.passed, r: counts.review, f: counts.failed, c: counts.criticalFailed, n: counts.na })}
          </p>
        )}
      </details>

      {/* Compliance breakdown */}
      <section className="mt-6 rounded-2xl border border-line bg-white/60 p-5 dark:border-white/10 dark:bg-navy-900/60">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">
          {t('result.bdTitle')}
        </h2>
        <p className="mb-4 text-xs text-slate-400">{t('result.bdSub')}</p>
        <div className="mb-1 flex h-3 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-navy-800">
          <div className="bg-emerald-500" style={{ width: `${(counts.passed / Math.max(1, findings.length)) * 100}%` }} />
          <div className="bg-amber-500" style={{ width: `${(counts.review / Math.max(1, findings.length)) * 100}%` }} />
          <div className="bg-rose-500" style={{ width: `${((counts.failed + counts.criticalFailed) / Math.max(1, findings.length)) * 100}%` }} />
        </div>
        <ul className="mt-4 space-y-2">
          {findings.map((f) => (
              <li key={f.rule_id} className="flex items-start justify-between gap-3 rounded-xl border border-line px-3 py-2.5 dark:border-white/10">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <ToneBadge tone={findingTone(f)}>{findingText(f.status)}</ToneBadge>
                  <span className="truncate text-sm font-medium text-ink-text dark:text-slate-100">{f.label}</span>
                </div>
                {f.detected_value && (
                  <p className="mt-1 truncate text-xs text-slate-500 dark:text-navy-300">{f.detected_value}</p>
                )}
                {f.explanation && f.explanation !== f.detected_value && (
                  <p className="mt-0.5 text-xs text-ink-text-soft dark:text-navy-400">{f.explanation}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Product info + sources */}
      <section className="mt-6 rounded-2xl border border-line bg-white/60 p-5 dark:border-white/10 dark:bg-navy-900/60">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">
          {t('result.prodInfo')}
        </h2>
        <p className="mb-4 text-xs text-slate-400">{t('result.prodInfoSub')}</p>
        <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {details.map((r) => {
            const conf = doc.field_confidence?.[r.key]
            const ev = doc.field_evidence?.[r.key]
            return (
              <div key={r.key} className="border-b border-line/70 pb-2 last:border-0 dark:border-white/5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-text-soft dark:text-navy-300">{r.label}</span>
                  <span
                    className={cn(
                      'text-[10px] font-semibold',
                      conf === 'high' ? 'text-emerald-500' : conf === 'medium' ? 'text-amber-500' : 'text-slate-400',
                    )}
                  >
                    {conf ?? 'low'}
                  </span>
                </div>
                <p className="mt-0.5 text-sm font-medium text-ink-text dark:text-slate-100">{r.value}</p>
                {ev?.text && ev.text !== r.value && (
                  <p className="mt-0.5 truncate text-[11px] text-slate-400" title={ev.text}>
                    source: photo {ev.image} — {ev.text}
                  </p>
                )}
              </div>
            )
          })}
          {details.length === 0 && <p className="text-sm text-slate-400">{t('result.noFields')}</p>}
        </div>
      </section>

      {/* Price & quantity */}
      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-white/60 p-4 dark:border-white/10 dark:bg-navy-900/60">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">{t('result.mrp')}</p>
          <p className="mt-1 text-lg font-bold text-ink-text dark:text-white">{doc.ocr_fields?.mrp || '—'}</p>
        </div>
        <div className="rounded-2xl border border-line bg-white/60 p-4 dark:border-white/10 dark:bg-navy-900/60">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">{t('result.netQty')}</p>
          <p className="mt-1 text-lg font-bold text-ink-text dark:text-white">{doc.ocr_fields?.net_quantity || '—'}</p>
        </div>
        <div className="rounded-2xl border border-line bg-white/60 p-4 dark:border-white/10 dark:bg-navy-900/60">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">{t('result.batchDates')}</p>
          <p className="mt-1 text-sm font-semibold text-ink-text dark:text-slate-100">
            {doc.ocr_fields?.batch_no || '—'} · {doc.ocr_fields?.mfg_date || '—'} · {doc.ocr_fields?.expiry_date || '—'}
          </p>
        </div>
      </section>

      {/* Change detection */}
      <section className="mt-6 rounded-2xl border border-line bg-white/60 p-5 dark:border-white/10 dark:bg-navy-900/60">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">
            {t('result.changeTitle')} {doc.match_confidence ? `· ${doc.match_confidence.replace('_', ' ')}` : ''}
          </h2>
          {(doc.changes ?? []).length > 0 && (
            <Button
              variant={verified ? 'outline' : 'primary'}
              size="sm"
              loading={verifying}
              icon={verified ? <CheckCircle2 className="h-4 w-4" /> : <ClipboardCheck className="h-4 w-4" />}
              // eslint-disable-next-line @typescript-eslint/no-misused-promises
              onClick={() => void onVerify()}
              disabled={verified}
            >
              {verified ? t('result.verified') : t('result.verify')}
            </Button>
          )}
        </div>
        {doc.match_confidence ? (
          <p className="mt-1 text-xs text-slate-400">
            {t('result.prevScan')} <button className="text-brand-500 underline" onClick={() => doc.previous_scan_id && navigate(`/scan-result/${doc.previous_scan_id}`)}>{t('result.prevScanLink')}</button> {t('result.prevScanSuffix')}
          </p>
        ) : (
          <p className="mt-1 text-xs text-slate-400">{t('result.noPrev')}</p>
        )}
        {(doc.changes ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-ink-text-soft dark:text-navy-300">{t('result.noChanges')}</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {(doc.changes ?? []).map((c) => (
              <li key={c.field} className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2.5 text-sm dark:border-white/10">
                <GitCompareArrows className="h-4 w-4 text-brand-500" />
                <span className="font-medium text-ink-text dark:text-slate-100">{c.label}</span>
                <span className="text-xs text-slate-400">{c.previous || '—'}</span>
                <span className="text-slate-300 dark:text-navy-600">→</span>
                <span className="text-xs font-medium text-ink-text dark:text-slate-200">{c.current || 'removed'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Conflicts */}
      {(doc.conflicts ?? []).length > 0 && (
        <section className="mt-6 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">{t('result.conflicts')}</h2>
          <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-300/80">
            {t('result.conflictsMsg')}
          </p>
          <ul className="mt-3 space-y-2">
            {(doc.conflicts ?? []).map((c, i) => (
              <li key={`${c.field}-${i}`} className="text-sm">
                <span className="font-medium text-ink-text dark:text-slate-100">{c.label}: </span>
                {c.values.map((v) => `photo ${v.image}: ${v.value}`).join('  ·  ')}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Attention flags */}
      {findings.filter((f) => f.status !== 'compliant' && f.status !== 'na').length > 0 && (
        <section className="mt-6 rounded-2xl border border-line bg-white/60 p-5 dark:border-white/10 dark:bg-navy-900/60">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">{t('result.attention')}</h2>
          <div className="space-y-2">
            {findings
              .filter((f) => f.status !== 'compliant' && f.status !== 'na')
              .map((f) => (
                <div key={f.rule_id} className="flex items-start gap-2 text-sm">
                  {f.status === 'needs_review' ? (
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  ) : (
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                  )}
                  <span className="text-ink-text dark:text-slate-200">
                    <span className="font-medium">{f.label}:</span> {f.explanation ?? f.status}
                    {f.hint ? <span className="block text-xs text-slate-400">{t('result.hintPrefix')} {f.hint}</span> : null}
                  </span>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* OCR confidence */}
      <section className="mt-6 rounded-2xl border border-line bg-white/60 p-5 dark:border-white/10 dark:bg-navy-900/60">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">{t('result.ocrConf')}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-lg bg-white px-3 py-1.5 shadow-sm dark:bg-navy-950">
            provider <span className="font-semibold text-ink-text dark:text-white">{doc.ocr_provider ?? 'unknown'}</span>
          </span>
          {doc.ocr_engines && doc.ocr_engines.length > 0 && (
            <span className="rounded-lg bg-white px-3 py-1.5 shadow-sm dark:bg-navy-950">
              engines <span className="font-semibold text-ink-text dark:text-white">{doc.ocr_engines.join(' + ')}</span>
            </span>
          )}
          <span className="rounded-lg bg-white px-3 py-1.5 shadow-sm dark:bg-navy-950">
            {t('result.confidence')}{' '}
            <span className="font-semibold text-ink-text dark:text-white">
              {doc.ocr_confidence != null ? `${Math.round(doc.ocr_confidence * 100)}%` : '—'}
            </span>
          </span>
          <span className="text-xs text-slate-400">{t('result.rawChars', { n: String(doc.ocr_text ?? '').length })}</span>
        </div>
      </section>

      {/* Unclear / low-confidence text */}
      {doc.unclear_text && doc.unclear_text.length > 0 && (
        <section className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-50/60 p-5 dark:border-amber-500/20 dark:bg-amber-950/20">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">{t('result.unclearTitle')}</h2>
          <p className="mt-1 text-xs text-amber-600/70 dark:text-amber-400/60">
            {t('result.unclearMsg')}
          </p>
          <ul className="mt-3 space-y-1.5 text-sm text-ink-text dark:text-slate-200">
            {doc.unclear_text.map((line, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                <span className="font-mono text-xs">{line}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Assistant */}
      <section className="mt-6 rounded-2xl border border-brand-500/30 bg-gradient-to-br from-brand-500/10 to-transparent p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-500" />
          <h2 className="text-sm font-semibold text-ink-text dark:text-slate-100">{t('result.briefing')}</h2>
        </div>
        <p className="mt-3 text-sm text-ink-text dark:text-slate-200">{doc.briefing?.summary ?? doc.summary}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">{t('result.keyPoints')}</p>
            <ul className="mt-2 space-y-1.5 text-sm text-ink-text dark:text-slate-200">
              {(doc.briefing?.key_points ?? []).map((k, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                  {k}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">{t('result.recommendations')}</p>
            <ul className="mt-2 space-y-1.5 text-sm text-ink-text dark:text-slate-200">
              {(doc.briefing?.recommendations ?? []).map((r, i) => (
                <li key={i} className="flex gap-2">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                  {r}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Evidence / photos */}
      {photos.length > 0 && (
        <section className="mt-6 rounded-2xl border border-line bg-white/60 p-5 dark:border-white/10 dark:bg-navy-900/60">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">
            {t('result.evidence')} ({photos.length})
          </h2>
          <p className="mb-4 text-xs text-slate-400">{t('result.evidenceSub')}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((url, i) =>
              url ? (
                <a key={i} href={url} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-xl border border-line dark:border-white/10">
                  <img src={url} alt={`${t('result.evidenceAlt')} ${i + 1}`} className="h-36 w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                </a>
              ) : null,
            )}
          </div>
        </section>
      )}

      {/* Raw text */}
      {doc.ocr_text && (
        <details className="mt-6 rounded-2xl border border-line bg-white/60 p-5 dark:border-white/10 dark:bg-navy-900/60">
          <summary className="cursor-pointer text-sm font-semibold text-ink-text dark:text-slate-100">
            {t('result.rawText')}
          </summary>
          <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-navy-950 dark:text-slate-400">
            {doc.ocr_text}
          </pre>
        </details>
      )}

      {/* Remarks */}
      <section className="mt-6 rounded-2xl border border-line bg-white/60 p-5 dark:border-white/10 dark:bg-navy-900/60">
        <div className="flex items-center gap-2">
          <MessageSquareText className="h-4 w-4 text-ink-text-soft dark:text-navy-300" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">{t('result.remarks')}</h2>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <textarea
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-accent-500 dark:border-white/15 dark:bg-navy-950 dark:text-slate-100"
            rows={3}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder={t('result.remarksPh')}
          />
          <Button variant="outline" size="sm" className="sm:self-start" loading={savingRemarks} onClick={() => void onSaveRemarks()}>
            {t('result.remarksSave')}
          </Button>
        </div>
      </section>

      {/* Recommendation + disclaimer */}
      <section className="mt-6 rounded-2xl border border-line bg-white/60 p-5 dark:border-white/10 dark:bg-navy-900/60">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-ink-text-soft dark:text-navy-300" />
          <p className="text-xs leading-relaxed text-slate-500 dark:text-navy-300">
            {t('result.disclaimer')}
          </p>
        </div>
      </section>
    </div>
  )
}