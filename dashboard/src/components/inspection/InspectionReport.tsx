import { useEffect, useReducer, useRef, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import {
  AlertTriangle,
  Barcode,
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FilePen,
  FileQuestion,
  FileText,
  Hash,
  HelpCircle,
  Info,
  Languages,
  ListChecks,
  Loader2,
  MessageSquareText,
  MinusCircle,
  Pencil,
  RefreshCw,
  ScanSearch,
  Send,
  Share2,
  ShieldCheck,
  ShoppingBag,
  Tag,
  Undo2,
  XCircle,
} from 'lucide-react'
import AnalyticsCard from '../dashboard/AnalyticsCard'
import { AuditXMark } from '../brand/AuditXMark'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { ToneBadge } from '../ui/Badge'
import { useToast } from '../ui/Toast'
import { translate, SUPPORTED_LANGUAGES } from '../../i18n/report'
import { downloadInspectionPdf } from '../../lib/pdf'
import { localAssistantAnswer } from '../../lib/localAssistant'
import { askGeminiAssistant } from '../../lib/geminiAssistant'
import { CONFIG } from '../../lib/config'
import { functions } from '../../lib/firebase'
import { riskBand, riskTone } from '../../lib/risk'
import { formatDateTime } from '../../utils/format'
import { displayProductName, displaySentence, displayText } from '../../lib/textnorm'
import type { EvidenceLink, ExtractedDeclarations, FieldVerification, RuleCheck, ScanContext, ScanRow, StatusCounts } from '../../lib/types2'
import { userCorrectField } from '../../lib/services'

/* ------------------------------------------------------------------ */
/* Animated stat counters                                              */
/* ------------------------------------------------------------------ */

/** Ease a number up to `value` on mount — disabled under reduced-motion. */
function useAnimatedNumber(value: number, duration = 700): number {
  const [display, setDisplay] = useState(0)
  const raf = useRef(0)
  useEffect(() => {
    if (value <= 0) {
      setDisplay(0)
      return
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value)
      return
    }
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(Math.round(eased * value))
      if (p < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [value, duration])
  return display
}

function AnimatedNumber({ value, className = '' }: { value: number; className?: string }) {
  const n = useAnimatedNumber(value)
  return <span className={className}>{n}</span>
}

/** Force a re-render after in-place prop mutations (e.g. user corrections). */
function useForceUpdate(): () => void {
  const [, tick] = useReducer((x: number) => x + 1, 0)
  return tick
}

/* ------------------------------------------------------------------ */
/* Small presentational helpers                                        */
/* ------------------------------------------------------------------ */

function RuleStatusBadge({ status }: { status: string }) {
  const tone =
    status === 'PASS' ? 'emerald'
    : status === 'WARNING' || status === 'NOT_DETECTED' ? 'amber'
    : status === 'FAIL' ? 'rose'
    : status === 'REQUIRES_PHYSICAL_INSPECTION' ? 'cyan'
    : 'slate'
  return <ToneBadge tone={tone as 'emerald' | 'amber' | 'rose' | 'cyan' | 'slate'}>{status}</ToneBadge>
}

/* Severity badge for key findings (critical → low). */
const SEV_STYLES: Record<FindingSeverity, string> = {
  critical: 'bg-rose-600 text-white',
  high: 'bg-rose-500 text-white',
  medium: 'bg-amber-500 text-white',
  low: 'bg-slate-400 text-white',
}

const SEV_LABELS: Record<FindingSeverity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

function SeverityBadge({ severity }: { severity: FindingSeverity }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${SEV_STYLES[severity]}`}>
      {SEV_LABELS[severity]}
    </span>
  )
}

/**
 * Turn a long assistant reply into short, readable sentence bullets.
 */
function formatAnswer(text: string): string[] {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return []
  if (trimmed.length < 260) return [trimmed]
  const parts = trimmed
    .split(/(?<=[.;])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.length > 1 ? parts : [trimmed]
}

const RULE_FILTERS: Array<{ key: string; label: string; match: (s: string) => boolean }> = [
  { key: 'ISSUES', label: 'Findings', match: (s) => s === 'FAIL' || s === 'WARNING' || s === 'NOT_DETECTED' },
  { key: 'FAIL', label: 'Failed', match: (s) => s === 'FAIL' },
  { key: 'WARNING', label: 'Warnings', match: (s) => s === 'WARNING' || s === 'NOT_DETECTED' },
  { key: 'PASS', label: 'Passed', match: (s) => s === 'PASS' },
  { key: 'NOT_VERIFIABLE', label: 'Not verifiable', match: (s) => s === 'NOT_VERIFIABLE' },
  { key: 'PHYS', label: 'Phys. inspection', match: (s) => s === 'REQUIRES_PHYSICAL_INSPECTION' },
  { key: 'NA', label: 'Not applicable', match: (s) => s === 'NOT_APPLICABLE' },
  { key: 'ALL', label: 'All', match: () => true },
]

/**
 * Analysis label — a simple, professional indicator derived from `scan.engine`
 * (which the scan pipeline records at runtime). No provider or implementation
 * details are surfaced on the result screen.
 */
const ANALYSIS_LABEL: Record<string, string> = {
  cloud_function: 'AI-Assisted Analysis',
  gemini: 'AI-Assisted Analysis',
  local: 'Analysis Complete',
  queued: 'Pending Review',
  unknown: 'Analysis Complete',
}

function analysisLabel(engine: ScanRow['engine'] | undefined): string {
  return ANALYSIS_LABEL[engine ?? 'unknown'] ?? ANALYSIS_LABEL.unknown
}

const ANALYSIS_PROVIDER: Record<string, string> = {
  cloud_function: 'AuditX cloud functions',
  gemini: 'Google Gemini (vision extraction)',
  local: 'On-device OCR (Tesseract)',
  queued: 'Queued — staff review',
  unknown: '',
}

function analysisProvider(engine: ScanRow['engine'] | undefined): string {
  return ANALYSIS_PROVIDER[engine ?? 'unknown'] ?? ''
}

function ContextBadges({ ctx }: { ctx?: ScanContext }) {
  if (!ctx) return null
  const bits: Array<{ label: string; tone: 'emerald' | 'amber' | 'rose' | 'cyan' | 'slate'; fmt?: string }> = [
    {
      label: 'Package type',
      tone: ctx.package_type === 'retail' ? 'emerald' : ctx.package_type === 'unknown' ? 'slate' : 'amber',
      fmt: ctx.package_type,
    },
    { label: 'Origin', tone: ctx.origin === 'indian' ? 'emerald' : ctx.origin === 'imported' ? 'cyan' : 'slate', fmt: ctx.origin },
    {
      label: 'Sold by',
      tone: ctx.sold_by === 'unknown' ? 'slate' : 'cyan',
      fmt: ctx.sold_by,
    },
  ]
  if (ctx.special_commodity) bits.push({ label: 'Special', tone: 'cyan', fmt: ctx.special_commodity })
  if (ctx.is_food) bits.push({ label: 'Food', tone: 'emerald' })
  if (ctx.exemptions && ctx.exemptions.length > 0) bits.push({ label: 'Exemptions', tone: 'amber', fmt: ctx.exemptions.join(', ') })
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 py-2 dark:border-white/[0.08] dark:bg-white/[0.03]">
      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Context</span>
      {bits.map((b, i) => (
        <span key={i} className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          {i > 0 && <span className="text-slate-300 dark:text-slate-600">·</span>}
          <ToneBadge tone={b.tone}>{b.label}</ToneBadge>
          {b.fmt && <span className="font-semibold text-slate-600 dark:text-slate-300">{b.fmt}</span>}
        </span>
      ))}
    </div>
  )
}

const RISK_TONE: Record<string, { track: string; stroke: string; text: string; badge: 'emerald' | 'amber' | 'rose' }> = {
  Low: { track: 'text-emerald-100', stroke: 'text-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', badge: 'emerald' },
  Medium: { track: 'text-amber-100', stroke: 'text-amber-500', text: 'text-amber-600 dark:text-amber-400', badge: 'amber' },
  High: { track: 'text-rose-100', stroke: 'text-rose-500', text: 'text-rose-600 dark:text-rose-400', badge: 'rose' },
  Critical: { track: 'text-rose-200', stroke: 'text-rose-600', text: 'text-rose-700 dark:text-rose-400', badge: 'rose' },
}

function MetricChip({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: 'emerald' | 'amber' | 'rose' | 'cyan' | 'slate' }) {
  const text = {
    emerald: 'text-emerald-500 dark:text-emerald-400',
    amber: 'text-amber-500 dark:text-amber-400',
    rose: 'text-rose-500 dark:text-rose-400',
    cyan: 'text-cyan-500 dark:text-cyan-400',
    slate: 'text-slate-400 dark:text-slate-500',
  }[tone]
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 py-2 dark:border-white/[0.05] dark:bg-white/[0.03]">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${text}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-lg font-extrabold leading-tight text-slate-900 tabular-nums dark:text-slate-100">
          <AnimatedNumber value={value} />
        </p>
        <p className="text-[11px] font-semibold text-slate-400">{label}</p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 1 · Result header + overall risk score hero                         */
/* ------------------------------------------------------------------ */

function ScoreHero({ scan, counts, sig }: { scan: ScanRow; counts: StatusCounts; sig: ResultSignals }) {
  const score = Math.max(0, Math.min(100, scan.overall_score ?? 0))
  const risk = Math.max(0, Math.min(100, scan.risk_score ?? 100 - score))
  const band = riskBand(risk)
  const tone = RISK_TONE[band] ?? RISK_TONE.Low
  const insufficient = sig.status === 'insufficient'
  const R = 56
  const CIRC = 2 * Math.PI * R
  const frac = insufficient ? 0 : risk / 100
  const verdict = scan.verdict ?? (score >= 80 ? 'COMPLIANT' : score >= 50 ? 'PARTIALLY_COMPLIANT' : 'NON-COMPLIANT')
  const needReview = (counts.warnings ?? 0) + (counts.not_detected ?? 0) + (counts.uncertain ?? 0)

  const scoreExplanation = insufficient
    ? sig.explanation
    : `This ${risk}/100 risk score is derived only from the mandatory-declaration checks that actually ran on your label photos. Deficiency = higher risk. Anything the engine could not read is marked "Unable to verify" — it is never counted as pass or fail.`

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white via-indigo-50/40 to-brand-50/60 shadow-card dark:border-white/[0.07] dark:from-navy-900 dark:via-navy-950 dark:to-[#111a31]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/2 bg-dots opacity-30 lg:block" />
      <div className="relative grid grid-cols-1 gap-0 lg:grid-cols-[auto_1fr_auto]">
        {/* Risk score ring */}
        <div className="p-6 lg:border-r lg:border-slate-200/70 lg:dark:border-white/10">
          <p className="mb-4 text-[11px] font-extrabold uppercase tracking-widest text-slate-400">Overall Risk Score</p>
          <div className="flex flex-wrap items-center gap-5">
          <div className="relative h-24 w-24 shrink-0 sm:h-32 sm:w-32">
            <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
              <circle cx="64" cy="64" r={R} fill="none" strokeWidth="11" className={`stroke-current ${tone.track}`} />
              <circle
                cx="64" cy="64" r={R} fill="none" strokeWidth="11"
                strokeLinecap="round" strokeDasharray={`${CIRC}`} strokeDashoffset={`${CIRC * (1 - frac)}`}
                className={`stroke-current ${tone.stroke} animate-gauge-fill`}
                style={{ '--gauge-offset-start': `${CIRC}`, '--gauge-offset-end': `${CIRC * (1 - frac)}` } as React.CSSProperties}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              {insufficient ? (
                <>
                  <span className="text-xl font-extrabold leading-none text-slate-400">—</span>
                  <span className="mt-1 max-w-[7rem] text-center text-[9px] font-bold uppercase leading-tight tracking-wide text-slate-400">Insufficient data</span>
                </>
              ) : (
                <>
                  <span className={`text-4xl font-extrabold leading-none tabular-nums ${tone.text}`}>
                    <AnimatedNumber value={risk} />
                  </span>
                  <span className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">risk / 100</span>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-col items-start gap-1.5">
            {insufficient ? (
              <>
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400">Cannot be scored</span>
                <ToneBadge tone="rose">Insufficient Data</ToneBadge>
              </>
            ) : (
              <>
                <span className={`text-lg font-extrabold uppercase tracking-tight ${tone.text}`}>{band} risk</span>
                <ToneBadge tone={tone.badge}>{verdict}</ToneBadge>
                <span className="text-[11px] text-slate-400">Compliance {score}/100</span>
              </>
            )}
          </div>
          </div>
          <p className="mt-4 max-w-xs text-xs leading-relaxed text-slate-500 dark:text-slate-400">{scoreExplanation}</p>
        </div>

        {/* Product + summary counts */}
        <div className="flex flex-col gap-3 p-6">
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              <ShoppingBag className="h-3.5 w-3.5" /> Product inspected
            </div>
            <h2 className="mt-1 break-words text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">{scan.product_name?.trim() ? displayProductName(scan.product_name) : 'Unnamed product'}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              {scan.manufacturer?.trim() && <span className="min-w-0 max-w-full break-words font-semibold text-slate-600 dark:text-slate-300">{displayText(scan.manufacturer)}</span>}
              {scan.barcode && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-slate-800">EAN {scan.barcode}</span>}
              {(scan.labels?.length ?? 0) > 0 && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] dark:bg-slate-800">{scan.labels?.length} label(s)</span>}
            </div>
          </div>
          {scan.summary?.trim() && (
            <p className="max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">{displaySentence(scan.summary)}</p>
          )}
          <div className="mt-auto grid grid-cols-2 gap-2 pt-2 sm:grid-cols-4">
            <MetricChip icon={<CheckCircle2 className="h-4 w-4" />} label="Passed" value={counts.passed ?? 0} tone="emerald" />
            <MetricChip icon={<XCircle className="h-4 w-4" />} label="Failed" value={counts.failed ?? 0} tone="rose" />
            <MetricChip icon={<AlertTriangle className="h-4 w-4" />} label="Needs review" value={needReview} tone="amber" />
            <MetricChip icon={<HelpCircle className="h-4 w-4" />} label="Uncertain" value={counts.uncertain ?? 0} tone="slate" />
          </div>
        </div>

        {/* Key declarations snapshot */}
        <div className="grid grid-cols-2 gap-2 border-t border-slate-200/80 p-6 lg:w-80 lg:border-l lg:border-t-0 lg:dark:border-white/10 dark:border-white/10">
          <SnapshotItem label="MRP" value={displayText((scan.extractions?.mrp ?? '').replace(/^mrp\.?\s*/i, ''))} ok={Boolean(scan.extractions?.mrp)} />
          <SnapshotItem label="Net qty" value={displayText((scan.extractions?.net_quantity ?? '').replace(/^net\s*(?:wt\.?|weight|qty\.?|quantity)?\s*[:.]?\s*/i, ''))} ok={Boolean(scan.extractions?.net_quantity)} />
          <SnapshotItem label="Mfg" value={displayText(scan.extractions?.mfg_date)} ok={Boolean(scan.extractions?.mfg_date)} />
          <SnapshotItem label="Best before" value={displayText(scan.extractions?.best_before)} ok={Boolean(scan.extractions?.best_before)} />
          <SnapshotItem label="Mr / Packer" value={displayText(scan.extractions?.manufacturer ?? scan.extractions?.packer)} ok={Boolean(scan.extractions?.manufacturer || scan.extractions?.packer)} />
          <SnapshotItem label="Customer care" value={displayText(scan.extractions?.consumer_care)} ok={Boolean(scan.extractions?.consumer_care)} />
        </div>
      </div>
    </div>
  )
}

function SnapshotItem({ label, value, ok }: { label: string; value: string | null | undefined; ok: boolean }) {
  const shown = value?.trim() || ''
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-2.5 dark:border-white/[0.08] dark:bg-white/[0.03]">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 truncate text-xs font-semibold ${ok ? 'text-slate-700 dark:text-slate-200' : 'text-slate-300 dark:text-slate-500'}`} title={shown}>
        {ok ? shown : 'Not detected'}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 2 · Product information                                             */
/* ------------------------------------------------------------------ */

type FieldConf = 'high' | 'medium' | 'low' | null

function productFieldValue(scan: ScanRow, key: keyof ExtractedDeclarations): { value: string; confidence: FieldConf; state: 'ok' | 'verify' | 'miss' } {
  const raw = scan.extractions?.[key]
  const rawValue = (raw ?? '').toString().trim()
  const conf = (scan.extraction_fields?.[key]?.confidence as FieldConf | undefined) ?? null
  const source = scan.extraction_fields?.[key]?.status
  const isMissing = !rawValue && source === 'MISSING'
  const isUncertain = !rawValue && ((scan.uncertain ?? []).includes(key) || source === 'NEEDS_REVIEW' || source === 'INVALID')
  if (!rawValue) {
    if (isUncertain || isMissing) return { value: '', confidence: null, state: 'verify' }
    return { value: '', confidence: null, state: 'miss' }
  }
  if (conf === 'low') return { value: displayText(rawValue), confidence: conf, state: 'verify' }
  return { value: displayText(rawValue), confidence: conf, state: 'ok' }
}

/* ------------------------------------------------------------------ */
/* 3 · Compliance overview                                             */
/* ------------------------------------------------------------------ */

function ComplianceOverview({ counts }: { counts: StatusCounts }) {
  const items: Array<{ label: string; value: number; tone: 'emerald' | 'amber' | 'rose' | 'cyan' | 'slate'; icon: React.ReactNode }> = [
    { label: 'Passed', value: counts.passed ?? 0, tone: 'emerald', icon: <CheckCircle2 className="h-4 w-4" /> },
    { label: 'Failed', value: counts.failed ?? 0, tone: 'rose', icon: <XCircle className="h-4 w-4" /> },
    { label: 'Needs review', value: (counts.warnings ?? 0) + (counts.not_detected ?? 0), tone: 'amber', icon: <AlertTriangle className="h-4 w-4" /> },
    { label: 'Uncertain', value: counts.uncertain ?? 0, tone: 'slate', icon: <HelpCircle className="h-4 w-4" /> },
    { label: 'Not detected', value: counts.not_detected ?? 0, tone: 'amber', icon: <FileQuestion className="h-4 w-4" /> },
    { label: 'Not verifiable', value: counts.not_verifiable ?? 0, tone: 'slate', icon: <MinusCircle className="h-4 w-4" /> },
    { label: 'Physical inspection', value: counts.requires_physical_inspection ?? 0, tone: 'cyan', icon: <Eye className="h-4 w-4" /> },
  ]
  const toneText = {
    emerald: 'bg-emerald-50 text-emerald-500 dark:bg-emerald-500/10',
    amber: 'bg-amber-50 text-amber-500 dark:bg-amber-500/10',
    rose: 'bg-rose-50 text-rose-500 dark:bg-rose-500/10',
    cyan: 'bg-cyan-50 text-cyan-500 dark:bg-cyan-500/10',
    slate: 'bg-slate-100 text-slate-400 dark:bg-slate-800',
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
      {items.map((it) => (
        <div key={it.label} className="flex flex-col items-start gap-1.5 rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 py-3 dark:border-white/[0.08] dark:bg-white/[0.03]">
          <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${toneText[it.tone]}`}>{it.icon}</span>
          <span className={`text-2xl font-extrabold leading-none text-slate-900 dark:text-slate-100`}>{it.value}</span>
          <span className="text-[11px] font-semibold leading-tight text-slate-400">{it.label}</span>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 4 · Detected violations                                             */
/* ------------------------------------------------------------------ */

function recommendationFor(r: RuleCheck): string {
  const field = r.field || 'mandatory declaration'
  return `Add the ${field.toLowerCase()} to the package label in the format prescribed by ${r.rule_id}. Re-verify against the physical package before action.`
}

function violationSeverity(r: RuleCheck): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (r.status === 'FAIL') return 'HIGH'
  if (r.status === 'WARNING' || r.status === 'NOT_DETECTED') return 'MEDIUM'
  return 'LOW'
}

function ViolationCard({
  r,
  onViewEvidence,
}: {
  r: RuleCheck
  onViewEvidence: (sourceImage: number | null) => void
}) {
  const severity = violationSeverity(r)
  const rawDesc = r.reason || r.issue || (r.detected_value ? `Detected: "${r.detected_value}"` : 'Missing from the label.')
  const desc = displaySentence(rawDesc)
  const sourceImg = r.evidence?.source_image ?? null
  const hasImg = typeof onViewEvidence === 'function' && sourceImg != null && sourceImg >= 0
  return (
    <details className="group rounded-xl border border-rose-200 bg-rose-50/50 dark:border-rose-500/20 dark:bg-rose-500/5">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
          <XCircle className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">{severity}</span>
            <span className="font-mono text-xs font-bold text-rose-700 dark:text-rose-300">{r.rule_id}</span>
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{r.field || 'Labelling obligation'}</span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{desc}</p>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="grid grid-cols-1 gap-3 border-t border-rose-200/70 px-4 py-3 sm:grid-cols-2 dark:border-rose-500/20">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Requirement</p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{displaySentence(r.requirement || r.statement || r.field)}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Actual finding</p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{desc}</p>
          {r.detected_value != null && r.detected_value !== '' && (
            <p className="mt-1 rounded-lg bg-white/70 px-2 py-1 text-xs italic text-slate-500 dark:bg-navy-900/70 dark:text-slate-400">“{displayText(r.detected_value)}”</p>
          )}
        </div>
        <div className="sm:col-span-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Recommendation</p>
          <p className="mt-0.5 flex items-start gap-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" /> {recommendationFor(r)}
          </p>
        </div>
        {(r.evidence?.ocr_text || hasImg) && (
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            {hasImg && (
              <Button size="sm" variant="outline" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => onViewEvidence(sourceImg)}>
                View evidence
              </Button>
            )}
            {r.evidence?.ocr_text && (
              <span className="text-[11px] text-slate-400">
                <span className="font-bold">Text read from the label: </span>
                <span className="italic break-words">“{displayText(r.evidence.ocr_text, 120)}”</span>
              </span>
            )}
          </div>
        )}
      </div>
    </details>
  )
}

/* ------------------------------------------------------------------ */
/* 5 · AI inspection summary                                            */
/* ------------------------------------------------------------------ */

function AiSummaryCard({ scan, counts, failCount }: { scan: ScanRow; counts: StatusCounts; failCount: number }) {
  const needVerify = (counts.warnings ?? 0) + (counts.not_detected ?? 0) + (counts.uncertain ?? 0)
  const physical = counts.requires_physical_inspection ?? 0
  const summary = displaySentence(scan.assistant?.summary || scan.summary) || ''
  const fallback = failCount > 0
    ? `${failCount} mandatory declaration${failCount > 1 ? 's appear' : ' appears'} to be missing or incorrect.${needVerify > 0 ? ` ${needVerify} field${needVerify > 1 ? 's require' : ' requires'} additional human verification.` : ''}`
    : 'All mandatory declarations appear to be present.'
  const shown = summary || fallback
  const expandable = summary.length > 220
  return (
    <div className="rounded-2xl border border-brand-200/70 bg-gradient-to-br from-brand-50/80 via-white to-white p-5 dark:border-brand-500/20 dark:from-brand-500/10 dark:via-slate-900 dark:to-slate-900">
      <div className="flex items-center gap-2">
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
          <span aria-hidden="true" className="absolute inset-0 animate-pulse-glow rounded-xl bg-brand-500/40" />
          <Bot className="relative h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-extrabold uppercase tracking-wide text-brand-700 dark:text-brand-300">AI Inspection Summary</p>
          <p className="text-[11px] text-slate-400">Generated from the scanned label</p>
        </div>
      </div>
      {expandable ? (
        <details className="group mt-4">
          <summary className="cursor-pointer list-none">
            <p className={`text-base font-semibold leading-relaxed text-slate-800 dark:text-slate-100 ${expandable ? 'line-clamp-3' : ''}`}>{shown}</p>
            <span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-brand-600 transition-colors group-open:text-brand-500 hover:text-brand-700 dark:text-brand-400">
              View Full Analysis
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            </span>
          </summary>
          <p className="mt-3 rounded-xl bg-white/70 px-3.5 py-3 text-sm leading-relaxed text-slate-700 dark:bg-navy-900/60 dark:text-slate-200">{shown}</p>
        </details>
      ) : (
        <p className="mt-4 text-base font-semibold leading-relaxed text-slate-800 dark:text-slate-100">{shown}</p>
      )}
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <MetricChip icon={<XCircle className="h-4 w-4" />} label="Mandatory issues" value={failCount} tone="rose" />
        <MetricChip icon={<Eye className="h-4 w-4" />} label="Needs verification" value={needVerify} tone="amber" />
        <MetricChip icon={<AlertTriangle className="h-4 w-4" />} label="Physical inspection" value={physical} tone="cyan" />
      </div>
      <p className="mt-4 flex items-start gap-1.5 rounded-xl bg-white/70 px-3 py-2 text-xs text-slate-500 dark:bg-navy-900/60 dark:text-slate-400">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" />
        AI result should be treated as an inspection aid and verified against the physical package.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 5b · Final assessment                                                 */
/* ------------------------------------------------------------------ */

function FinalAssessment({ scan, counts }: { scan: ScanRow; counts: StatusCounts }) {
  const failCount = counts.failed ?? 0
  const needVerify = (counts.warnings ?? 0) + (counts.not_detected ?? 0) + (counts.uncertain ?? 0)
  const verdict = (scan.verdict ?? '').toUpperCase()

  let text: string
  let icon: React.ReactNode
  let tone: 'emerald' | 'amber' | 'rose'

  if (verdict === 'COMPLIANT') {
    text = 'All evaluated declarations passed the configured compliance checks.'
    icon = <CheckCircle2 className="h-5 w-5" />
    tone = 'emerald'
  } else if (verdict === 'NON_COMPLIANT' || failCount > 0) {
    text = 'Based on the detected declarations and applicable Legal Metrology checks, this package requires further verification before being considered compliant.'
    icon = <XCircle className="h-5 w-5" />
    tone = 'rose'
  } else if (verdict === 'PARTIALLY_COMPLIANT' || needVerify > 0) {
    text = 'Some declarations require manual verification.'
    icon = <AlertTriangle className="h-5 w-5" />
    tone = 'amber'
  } else {
    text = 'This inspection is awaiting completion of the analysis.'
    icon = <HelpCircle className="h-5 w-5" />
    tone = 'amber'
  }

  const bg = { emerald: 'bg-emerald-50/60 dark:bg-emerald-500/5', amber: 'bg-amber-50/60 dark:bg-amber-500/5', rose: 'bg-rose-50/60 dark:bg-rose-500/5' }[tone]
  const textCol = { emerald: 'text-emerald-700 dark:text-emerald-300', amber: 'text-amber-700 dark:text-amber-300', rose: 'text-rose-700 dark:text-rose-300' }[tone]

  return (
    <AnalyticsCard title="Final Assessment" subtitle="Professional conclusion based on the compliance checks">
      <div className={`flex items-start gap-4 rounded-2xl border border-slate-200/80 p-4 dark:border-white/10 ${bg}`}>
        <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${textCol} bg-white shadow-sm dark:bg-navy-900`}>{icon}</span>
        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">{text}</p>
      </div>
    </AnalyticsCard>
  )
}

/* ------------------------------------------------------------------ */
/* 6 · Evidence gallery modal                                           */
/* ------------------------------------------------------------------ */

function EvidenceModal({ scan, imageIndex, title, onClose }: { scan: ScanRow; imageIndex: number | null; title: string; onClose: () => void }) {
  const urls = scan.image_urls ?? []
  const show = imageIndex !== null
  return (
    <Modal open={show} onClose={onClose} title={title} description="Photos captured during the inspection">
      {urls.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">No product photos were attached to this scan.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {urls.map((u, i) => (
            <div
              key={i}
              className={`overflow-hidden rounded-xl border ${i === imageIndex ? 'border-amber-400 ring-2 ring-amber-300/60' : 'border-slate-200 dark:border-white/10'}`}
            >
              <img src={u} alt={`Product photo ${i + 1}`} className="h-44 w-full object-contain bg-slate-50 mix-blend-multiply dark:bg-navy-950 dark:mix-blend-screen" />
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-[11px] font-bold text-slate-400">Image {i + 1}</span>
                {i === imageIndex && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                    <Eye className="h-3 w-3" /> EVIDENCE
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {scan.image_urls && scan.image_urls.length > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
          <ExternalLink className="h-3.5 w-3.5" /> Click the highlighted photo above — it was used to verify the related declaration.
        </p>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* 7 · Extracted declarations (status list)                            */
/* ------------------------------------------------------------------ */

const DECLARATION_LABELS: { key: string; label: string }[] = [
  { key: 'commodity_name', label: 'Generic name' },
  { key: 'mrp', label: 'MRP (incl. taxes)' },
  { key: 'net_quantity', label: 'Net quantity' },
  { key: 'unit_sale_price', label: 'Unit sale price (USP)' },
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'packer', label: 'Packer' },
  { key: 'importer', label: 'Importer' },
  { key: 'address', label: 'Address' },
  { key: 'country_of_origin', label: 'Country of origin' },
  { key: 'mfg_date', label: 'Manufacturing date' },
  { key: 'best_before', label: 'Best before / expiry' },
  { key: 'lot_no', label: 'Batch / lot no.' },
  { key: 'consumer_care', label: 'Consumer care' },
  { key: 'fssai_license', label: 'FSSAI licence no.' },
  { key: 'veg_nonveg', label: 'Veg / Non-veg' },
  { key: 'ingredients', label: 'Ingredients' },
  { key: 'allergens', label: 'Allergens' },
  { key: 'nutrition_info', label: 'Nutrition info' },
]

/**
 * Specification fields (max-utility small-print extraction). Deployed in
 * priority order so the most identifying details render first.
 */
const SPEC_FIELDS: { key: string; label: string }[] = [
  { key: 'model', label: 'Model / product code' },
  { key: 'serial_number', label: 'Serial number' },
  { key: 'material', label: 'Material' },
  { key: 'dimensions', label: 'Dimensions' },
  { key: 'capacity', label: 'Capacity' },
  { key: 'voltage', label: 'Voltage' },
  { key: 'power', label: 'Power' },
  { key: 'current', label: 'Current' },
  { key: 'frequency', label: 'Frequency' },
  { key: 'website', label: 'Website' },
  { key: 'email', label: 'Email' },
  { key: 'certifications', label: 'Certifications / marks' },
  { key: 'warnings', label: 'Warnings' },
  { key: 'instructions', label: 'Instructions' },
]

const CONF_PCT: Record<string, number> = { high: 100, medium: 68, low: 38 }
const CONF_BAR: Record<string, string> = {
  high: 'bg-emerald-500',
  medium: 'bg-amber-500',
  low: 'bg-rose-500',
}

/** Fine-grained confidence band (deterministic, matches the scan report labels). */
function bandFor(pct: number): { label: string; bar: string } {
  if (pct >= 90) return { label: 'High', bar: 'bg-emerald-500' }
  if (pct >= 75) return { label: 'Good', bar: 'bg-emerald-500' }
  if (pct >= 50) return { label: 'Medium', bar: 'bg-amber-500' }
  if (pct >= 25) return { label: 'Low', bar: 'bg-rose-500' }
  return { label: 'Not confident', bar: 'bg-rose-500' }
}

/** Adaptive evidence layer — per-field verification badge. */
function VerificationBadge({
  verified,
  pct,
  corrected,
}: {
  verified: boolean
  pct: number | null
  corrected?: boolean
}) {
  if (corrected) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
        <Pencil className="h-2.5 w-2.5" /> Corrected by you
      </span>
    )
  }
  if (verified) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
        <ShieldCheck className="h-2.5 w-2.5" /> {pct != null ? `Verified — ${Math.round(pct)}%` : 'Verified'}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
      <AlertTriangle className="h-2.5 w-2.5" /> {pct != null ? `Needs verification — ${Math.round(pct)}%` : 'Needs verification'}
    </span>
  )
}

function DeclarationsList({
  scan,
  onCorrect,
  onViewFieldEvidence,
}: {
  scan: ScanRow
  onCorrect: (key: string, label: string, current: string, currentVerification: FieldVerification | undefined) => void
  onViewFieldEvidence: (label: string, imageIndex: number, region: [number, number, number, number] | null) => void
}) {
  const ex = scan.extractions as Record<string, string | null | undefined> | undefined
  const uncertain = scan.uncertain ?? []
  const verification = scan.verification ?? {}
  if (!ex && uncertain.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-400">No extracted declarations for this scan.</p>
  }
  const detectedCount = DECLARATION_LABELS.filter((d) => {
    const value = ex?.[d.key]
    return value || uncertain.includes(d.key)
  }).length

  const rows = DECLARATION_LABELS.map((d) => {
    const rawValue = ex?.[d.key] ?? ''
    const conf = scan.extraction_fields?.[d.key] as { value?: string | null; confidence?: string | null; source_image?: number | null; status?: string | null } | undefined
    const confidence = conf?.confidence ?? null
    const fv = verification[d.key]
    const corrected = conf?.status === 'USER_CORRECTED'
    const needsReview = confidence === 'low' || uncertain.includes(d.key) || fv?.needsVerification === true
    const hasValue = String(rawValue ?? '').trim() !== ''
    const missing = !hasValue && !needsReview
    const sourceImg = conf?.source_image ?? null
    const status = missing ? 'miss' : needsReview ? 'verify' : 'ok'
    const icon =
      status === 'ok' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
      : status === 'verify' ? <AlertTriangle className="h-4 w-4 text-amber-500" />
      : <XCircle className="h-4 w-4 text-rose-400" />
    return { ...d, value: displayText(rawValue), confidence, needsReview, missing, sourceImg, status, icon, fv, corrected, verified: !needsReview && hasValue }
  })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span className="font-semibold">{detectedCount}/{DECLARATION_LABELS.length} declarations read off the label</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500" /> read</span>
          <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-amber-500" /> verify</span>
          <span className="flex items-center gap-1"><XCircle className="h-3 w-3 text-rose-400" /> missing</span>
        </span>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200/80 dark:border-white/10">
        {rows.map((row, i) => {
          const hasEvidence = Boolean(row.fv?.evidence?.some((e) => e.region || e.source_image != null)) && (scan.image_urls ?? []).length > 0
          const pct = row.fv?.confidence_score != null ? row.fv.confidence_score * 100 : null
          return (
            <details key={row.key} className={`group ${i > 0 ? 'border-t border-slate-100 dark:border-white/10' : ''}`}>
              <summary className={`flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-2.5 ${row.status === 'miss' ? 'bg-rose-50/40 dark:bg-rose-500/5' : row.status === 'verify' ? 'bg-amber-50/30 dark:bg-amber-500/5' : 'bg-white dark:bg-navy-900'}`}>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center">{row.icon}</span>
                <span className="w-28 shrink-0 text-sm font-semibold text-slate-700 dark:text-slate-200 sm:w-40">{row.label}</span>
                <span title={row.value} className={`min-w-0 flex-1 truncate text-sm ${row.status === 'miss' ? 'italic text-rose-400' : row.status === 'verify' ? 'italic text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300'}`}>
                  {row.status === 'miss' ? 'Not detected' : row.status === 'verify' ? (row.value || 'Unable to verify from photos') : row.value}
                </span>
                {row.corrected && (
                  <span className="hidden sm:inline"><VerificationBadge verified={false} pct={null} corrected /></span>
                )}
                {!row.corrected && row.fv && (
                  <span className="hidden sm:inline"><VerificationBadge verified={row.verified} pct={pct} /></span>
                )}
                {row.confidence && (
                  <span className={`hidden rounded-full px-2 py-0.5 text-[10px] font-bold sm:inline ${row.confidence === 'high' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' : row.confidence === 'medium' ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400' : 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400'}`}>
                    {row.confidence.toUpperCase()}
                  </span>
                )}
                {row.sourceImg != null && row.sourceImg >= 0 && (
                  <span className="hidden text-[11px] text-slate-400 sm:inline">Img {row.sourceImg + 1}</span>
                )}
                <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 dark:border-white/[0.08] dark:bg-white/[0.03]">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Detected value</p>
                    <p className={`mt-0.5 text-sm ${row.status === 'miss' ? 'italic text-rose-500 dark:text-rose-400' : row.status === 'verify' ? 'text-amber-700 dark:text-amber-300' : 'text-slate-700 dark:text-slate-200'}`}>
                      {row.status === 'miss' ? 'Not detected — value missing' : row.value || 'Unable to verify from photos'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Status &amp; confidence</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <RuleStatusBadge status={row.status === 'miss' ? 'NOT_DETECTED' : row.status === 'verify' ? 'WARNING' : 'PASS'} />
                      {row.fv && !row.corrected && <VerificationBadge verified={row.verified} pct={pct} />}
                      {row.corrected && <VerificationBadge verified={false} pct={null} corrected />}
                      {row.confidence && (
                        <span className="w-16">
                          <span className="flex items-center justify-between text-[10px] text-slate-400">
                            <span>{row.confidence}</span><span>{CONF_PCT[row.confidence]}%</span>
                          </span>
                          <span className="mt-0.5 block h-1 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                            <span className={`block h-full rounded-full ${CONF_BAR[row.confidence]}`} style={{ width: `${CONF_PCT[row.confidence]}%` }} />
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {row.value && (
                  <p className="mt-3 rounded-lg bg-white/70 px-2.5 py-1.5 text-xs italic text-slate-500 dark:bg-navy-900/70 dark:text-slate-400">
                    Read from the label: “{row.value}”
                  </p>
                )}
                {row.fv && row.fv.evidence && row.fv.evidence.length > 0 && (
                  <div className="mt-2 space-y-1 rounded-lg bg-white/70 px-2.5 py-2 dark:bg-navy-900/60">
                    <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      <ScanSearch className="h-3 w-3" /> Evidence
                    </p>
                    {row.fv.evidence.map((ev, j) => (
                      <p key={j} className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                        {ev.pass === 'targeted_re_scan' ? 'Re-scanned region' : 'OCR read'} · Image {(ev.source_image ?? 0) + 1}
                        {ev.ocr_conf != null ? ` · OCR ${Math.round(ev.ocr_conf * 100)}%` : ''} — “{displayText(ev.region_text, 60)}”
                      </p>
                    ))}
                  </div>
                )}
                {(hasEvidence || row.fv || !row.corrected) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {hasEvidence && (
                      <Button
                        size="sm"
                        variant="outline"
                        icon={<Eye className="h-3.5 w-3.5" />}
                        onClick={() => {
                          const ev = (row.fv?.evidence ?? []).find((e) => e.region) ?? row.fv?.evidence?.[0]
                          onViewFieldEvidence(row.label, ev?.source_image ?? (scan.image_urls ?? []).length - 1, ev?.region ?? null)
                        }}
                      >
                        View evidence
                      </Button>
                    )}
                    {row.value && !row.corrected && (
                      <Button
                        size="sm"
                        variant="outline"
                        icon={<Pencil className="h-3.5 w-3.5" />}
                        onClick={() => onCorrect(row.key, row.label, row.value, row.fv)}
                      >
                        Correct
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </details>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 7b · Trust score hero                                                */
/* ------------------------------------------------------------------ */

function TrustScoreCard({ scan }: { scan: ScanRow }) {
  const trust = scan.trust_score ?? null
  const breakdown = scan.trust_breakdown
  const verification = scan.verification ?? {}
  const entries = Object.values(verification)
  const verifiedCount = entries.filter((v) => v?.verified && !v?.needsVerification).length
  const needsCount = entries.filter((v) => v?.needsVerification).length

  if (trust == null) {
    return (
      <AnalyticsCard title="Trust Score" subtitle="How confident this extraction is">
        <div className="flex items-start gap-3 rounded-xl border border-slate-200/80 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-white/[0.03]">
          <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
          <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            This scan predates adaptive verification (targeted re-scan + confidence scoring), so a trust score was not generated for it.
          </p>
        </div>
      </AnalyticsCard>
    )
  }

  const R = 42
  const CIRC = 2 * Math.PI * R
  const frac = Math.max(0, Math.min(1, trust / 100))
  const tone =
    trust >= 85 ? { stroke: 'text-emerald-500', track: 'text-emerald-100', text: 'text-emerald-600 dark:text-emerald-400' }
    : trust >= 60 ? { stroke: 'text-amber-500', track: 'text-amber-100', text: 'text-amber-600 dark:text-amber-400' }
    : { stroke: 'text-rose-500', track: 'text-rose-100', text: 'text-rose-600 dark:text-rose-400' }

  const bars: Array<{ label: string; value: number }> = breakdown
    ? [
        { label: 'OCR confidence', value: breakdown.ocr_confidence },
        { label: 'Character verification', value: breakdown.character_verification },
        { label: 'Image quality', value: breakdown.image_quality },
        { label: 'Cross-image agreement', value: breakdown.cross_image_agreement },
        { label: 'Verification rate', value: breakdown.verification_rate },
      ]
    : []

  return (
    <AnalyticsCard title="Trust Score" subtitle="Measured extraction confidence — derived only from the OCR pass, quality and cross-photo agreement">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
        <div className="flex shrink-0 flex-col items-center gap-3">
          <div className="relative h-28 w-28">
            <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
              <circle cx="64" cy="64" r={R} fill="none" strokeWidth="12" className={`stroke-current ${tone.track}`} />
              <circle cx="64" cy="64" r={R} fill="none" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${CIRC}`} strokeDashoffset={`${CIRC * (1 - frac)}`} className={`stroke-current ${tone.stroke} animate-gauge-fill`} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <AnimatedNumber value={trust} className={`text-3xl font-extrabold leading-none tabular-nums ${tone.text}`} />
              <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">/ 100</span>
            </div>
          </div>
          <div className="flex gap-2">
            <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              <ShieldCheck className="h-2.5 w-2.5" /> {verifiedCount} verified
            </span>
            {needsCount > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                <AlertTriangle className="h-2.5 w-2.5" /> {needsCount} need verification
              </span>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="mb-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            The trust score combines five measured signals — it never guesses. “Needs verification” fields are honestly flagged and the targeted re-scan only ran on the regions that were uncertain.
          </p>
          {bars.length > 0 && (
            <div className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
              {bars.map((b) => (
                <div key={b.label}>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="font-semibold">{b.label}</span>
                    <span className="font-bold tabular-nums">{Math.max(0, Math.min(100, b.value))}%</span>
                  </div>
                  <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                    <span
                      className={`block h-full rounded-full ${b.value >= 85 ? 'bg-emerald-500' : b.value >= 60 ? 'bg-amber-500' : 'bg-rose-500'}`}
                      style={{ width: `${Math.max(0, Math.min(100, b.value))}%` }}
                    />
                  </span>
                </div>
              ))}
            </div>
          )}
          {scan.uncertain_regions != null && scan.uncertain_regions > 0 && (
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
              <ScanSearch className="h-3.5 w-3.5" /> {scan.uncertain_regions} region{scan.uncertain_regions === 1 ? '' : 's'} were re-scanned during verification.
            </p>
          )}
        </div>
      </div>
    </AnalyticsCard>
  )
}

/* ------------------------------------------------------------------ */
/* 7c · Needs-verification panel                                        */
/* ------------------------------------------------------------------ */

function NeedsVerificationPanel({
  scan,
  onCorrect,
  onViewFieldEvidence,
}: {
  scan: ScanRow
  onCorrect: (key: string, label: string, current: string, currentVerification: FieldVerification | undefined) => void
  onViewFieldEvidence: (label: string, imageIndex: number, region: [number, number, number, number] | null) => void
}) {
  const verification = scan.verification ?? {}
  const ex = scan.extractions as Record<string, string | null | undefined> | undefined
  const labelOf = (key: string) => DECLARATION_LABELS.find((d) => d.key === key)?.label ?? SPEC_FIELDS.find((s) => s.key === key)?.label ?? key.replace(/_/g, ' ')
  const items = Object.entries(verification)
    .filter(([, v]) => v?.needsVerification && v?.before != null)
    .map(([key, v]) => ({
      key,
      label: labelOf(key),
      value: (ex?.[key] as string | undefined) ?? v.before ?? '',
      pct: typeof v.confidence_score === 'number' ? Math.round(v.confidence_score * 100) : null,
      evidence: v?.evidence ?? [],
    }))
  const uncertOnly = (scan.uncertain ?? [])
    .filter((k) => !verification[k])
    .filter((k) => ex?.[k])
    .map((k) => ({ key: k, label: labelOf(k), value: String(ex?.[k] ?? ''), pct: null, evidence: [] }))
  const rows = [...items, ...uncertOnly].slice(0, 12)

  if (rows.length === 0) return null

  return (
    <AnalyticsCard title="Needs Verification" subtitle="Fields the extraction could not confirm — review them against the physical label">
      <div className="space-y-2">
        {rows.map((r) => {
          const hasEvidence = r.evidence.length > 0 && (scan.image_urls ?? []).length > 0
          return (
            <div key={r.key} className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/40 px-3.5 py-2.5 dark:border-amber-500/20 dark:bg-amber-500/5">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{r.label}</p>
                <p className="truncate text-xs text-amber-700 dark:text-amber-300">{r.value || 'Value not readable from the photos'}</p>
              </div>
              {r.pct != null && <span className="shrink-0 text-[11px] font-bold text-amber-600 dark:text-amber-400">{r.pct}%</span>}
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {hasEvidence && (
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<Eye className="h-3.5 w-3.5" />}
                    onClick={() => {
                      const ev = r.evidence.find((e) => e.region) ?? r.evidence[0]
                      onViewFieldEvidence(r.label, ev?.source_image ?? (scan.image_urls ?? []).length - 1, ev?.region ?? null)
                    }}
                  >
                    Evidence
                  </Button>
                )}
                {r.value && (
                  <Button size="sm" variant="outline" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => onCorrect(r.key, r.label, r.value, verification[r.key])}>
                    Correct
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </AnalyticsCard>
  )
}

/* ------------------------------------------------------------------ */
/* 7d · Per-field evidence modal (bbox overlay)                        */
/* ------------------------------------------------------------------ */

function FieldEvidenceModal({
  url,
  label,
  region,
  imageLabel,
  onClose,
}: {
  url: string
  label: string
  region: [number, number, number, number] | null
  imageLabel: string
  onClose: () => void
}) {
  // OCR regions were computed on a ≤2048px re-scaled copy of the photo, so the
  // highlight below is an approximation on the original-resolution image.
  const MAX_DIM = 2048
  const left = region ? Math.max(0, Math.min(100, (region[0] / MAX_DIM) * 100)) : 0
  const top = region ? Math.max(0, Math.min(100, (region[1] / MAX_DIM) * 100)) : 0
  const w = region ? Math.max(0, Math.min(100 - left, (region[2] / MAX_DIM) * 100)) : 0
  const h = region ? Math.max(0, Math.min(100 - top, (region[3] / MAX_DIM) * 100)) : 0
  return (
    <Modal open onClose={onClose} title={`Evidence — ${label}`} description={imageLabel}>
      <div className="relative inline-block max-w-full overflow-hidden rounded-xl border border-slate-200 dark:border-white/10">
        <img src={url} alt={label} className="block h-auto max-w-full bg-slate-50 object-contain mix-blend-multiply dark:bg-navy-950 dark:mix-blend-screen" />
        {region && (
          <div
            className="pointer-events-none absolute border-2 border-amber-400 ring-2 ring-amber-300/40"
            style={{ left: `${left}%`, top: `${top}%`, width: `${w}%`, height: `${h}%` }}
          />
        )}
      </div>
      {region ? (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-slate-400">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          The highlight shows the approximate region that was OCR&apos;d for this field. It is approximate because OCR ran on a re-scaled copy of the photo.
        </p>
      ) : (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
          <Info className="h-3.5 w-3.5 text-amber-500" /> No precise region was recorded for this field — the full image is shown as evidence.
        </p>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* 8 · Product details (model / specs / safety — per-field confidence) */
/* ------------------------------------------------------------------ */

function ProductDetails({ scan }: { scan: ScanRow }) {
  const ex = scan.extractions as Record<string, string | null | undefined> | undefined
  const fields = scan.extraction_fields ?? {}
  const rows = SPEC_FIELDS.map(({ key, label }) => {
    const value = displayText(ex?.[key] ?? '')
    const f = fields[key]
    const pct = typeof f?.confidence_score === 'number' ? Math.round(f.confidence_score * 100) : null
    const legacyPct = f?.confidence != null ? CONF_PCT[f.confidence] ?? null : null
    return { key, label, value, pct: pct ?? legacyPct, status: f?.status ?? null }
  }).filter((r) => r.value || r.status === 'NEEDS_REVIEW' || r.status === 'INVALID')

  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-400">No model / specification details detected on this label.</p>
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {rows.map((r) => {
        const verify = r.status === 'NEEDS_REVIEW' || r.status === 'INVALID' || (r.pct != null && r.pct < 50)
        const band = r.pct != null ? bandFor(r.pct) : null
        return (
          <div
            key={r.key}
            className={`rounded-xl border p-3 ${verify ? 'border-amber-200 bg-amber-50/40 dark:border-amber-500/20 dark:bg-amber-500/5' : 'border-slate-100 bg-slate-50/60 dark:border-white/[0.08] dark:bg-white/[0.03]'}`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{r.label}</p>
              {band && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400">
                  <span>{band.label}</span>
                  <span className="text-slate-300 dark:text-slate-600">·</span>
                  <span>{r.pct}%</span>
                </span>
              )}
            </div>
            {r.value ? (
              <p className={`mt-1 break-words text-sm font-semibold ${verify ? 'text-amber-700 dark:text-amber-300' : 'text-slate-700 dark:text-slate-200'}`} title={r.value}>
                {r.value}
              </p>
            ) : (
              <p className="mt-1 flex items-center gap-1 text-sm font-semibold text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" /> Needs verification
              </p>
            )}
            {band && (
              <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <span className={`block h-full rounded-full ${band.bar}`} style={{ width: `${r.pct}%` }} />
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 9 · Rule analysis (collapsible)                                     */
/* ------------------------------------------------------------------ */

function RuleRow({ r, onViewEvidence }: { r: RuleCheck; onViewEvidence: (sourceImage: number | null) => void }) {
  const desc = displaySentence(r.requirement || r.statement || r.field)
  const rawShown = r.detected_value !== undefined && r.detected_value !== null && r.detected_value !== '' ? r.detected_value : r.extracted_text
  const shown = rawShown != null && rawShown !== '' ? displayText(rawShown) : rawShown
  const why = displaySentence(r.reason || r.issue)
  const isProblem = r.status === 'FAIL' || r.status === 'WARNING' || r.status === 'NOT_DETECTED'
  const border = r.status === 'FAIL' ? 'border-rose-200 dark:border-rose-500/20'
    : r.status === 'WARNING' || r.status === 'NOT_DETECTED' ? 'border-amber-200 dark:border-amber-500/20'
    : 'border-slate-200/80 dark:border-white/10'
  return (
    <details className={`group rounded-xl border bg-white dark:bg-navy-900 ${border}`}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2.5 px-4 py-2.5">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${isProblem ? 'bg-rose-50 text-rose-500 dark:bg-rose-500/10' : 'bg-emerald-50 text-emerald-500 dark:bg-emerald-500/10'}`}>
          {isProblem ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
        </span>
        <span className="font-mono text-xs font-bold text-brand-600 dark:text-brand-400">{r.rule_id}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{displayText(r.field) || desc}</span>
        <span className="shrink-0"><RuleStatusBadge status={r.status} /></span>
        <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="grid grid-cols-1 gap-3 border-t border-slate-100 px-4 py-3 sm:grid-cols-2 dark:border-white/10">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Requirement</p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{desc}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Detected data</p>
          {shown != null && shown !== '' ? (
            <p className="mt-0.5 text-xs italic text-slate-600 dark:text-slate-300">“{shown}”</p>
          ) : (
            <p className="mt-0.5 text-xs italic text-rose-400">Nothing detected on the label.</p>
          )}
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Reason</p>
          <p className={`mt-0.5 text-xs leading-relaxed ${isProblem ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>{why || '—'}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Recommendation</p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{recommendationFor(r)}</p>
        </div>
        {(r.evidence?.ocr_text || r.evidence?.source_image != null) && (
          <div className="sm:col-span-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Evidence</p>
            {r.evidence?.source_image != null && r.evidence.source_image >= 0 && (
              <button
                onClick={() => onViewEvidence(r.evidence?.source_image ?? null)}
                className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-bold text-amber-700 transition-colors hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
              >
                <Eye className="h-3.5 w-3.5" /> View evidence · Image {r.evidence.source_image + 1}
              </button>
            )}
            {r.evidence?.ocr_text && (
              <p className="mt-1.5 text-[11px] italic text-slate-400">“{displayText(r.evidence.ocr_text)}”</p>
            )}
          </div>
        )}
      </div>
    </details>
  )
}

/* ------------------------------------------------------------------ */
/* 9 · Evidence chain                                                  */
/* ------------------------------------------------------------------ */

function EvidenceChain({ chain }: { chain?: EvidenceLink[] }) {
  if (!chain || chain.length === 0) return null
  return (
    <AnalyticsCard title="Evidence Chain" subtitle="How each finding was verified">
      <div className="space-y-2">
        {chain.map((e, i) => (
          <div key={i} className="rounded-lg border border-slate-100 bg-slate-50/60 p-2.5 dark:border-white/[0.08] dark:bg-white/[0.03]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="min-w-0 text-xs font-semibold text-slate-700 dark:text-slate-200">
                <span className="font-mono text-brand-600 dark:text-brand-400">{e.rule_id}</span> · {displaySentence(e.requirement)}
              </p>
              <div className="flex shrink-0 items-center gap-1.5">
                {e.source_image != null && <span className="text-[10px] text-slate-400">Img {e.source_image + 1}</span>}
                <RuleStatusBadge status={e.status} />
              </div>
            </div>
            {e.detected_value && <p className="mt-1 text-xs italic text-slate-600 dark:text-slate-300">“{displayText(e.detected_value)}”</p>}
            {e.ocr_text && <p className="mt-1 max-h-16 overflow-y-auto text-[11px] leading-relaxed text-slate-400">{displayText(e.ocr_text)}</p>}
          </div>
        ))}
      </div>
    </AnalyticsCard>
  )
}

/* ------------------------------------------------------------------ */
/* Main report                                                         */
/* ------------------------------------------------------------------ */

function resolveCounts(scan: ScanRow): StatusCounts {
  if (scan.counts) return scan.counts
  const rules = scan.rules ?? []
  return {
    passed: rules.filter((r) => r.status === 'PASS').length,
    failed: rules.filter((r) => r.status === 'FAIL').length,
    warnings: rules.filter((r) => r.status === 'WARNING' || r.status === 'NOT_DETECTED').length,
    not_detected: rules.filter((r) => r.status === 'NOT_DETECTED').length,
    not_verifiable: rules.filter((r) => r.status === 'NOT_VERIFIABLE').length,
    requires_physical_inspection: rules.filter((r) => r.status === 'REQUIRES_PHYSICAL_INSPECTION').length,
    not_applicable: rules.filter((r) => r.status === 'NOT_APPLICABLE').length,
    uncertain: scan.uncertain?.length ?? 0,
  }
}

/* ------------------------------------------------------------------ */
/* Qualitative result status                                           */
/* ------------------------------------------------------------------ */

export type ResultStatus = 'verified' | 'needs_review' | 'insufficient'

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low'

export interface ResultFinding {
  severity: FindingSeverity
  text: string
}

export interface ResultSignals {
  status: ResultStatus
  statusLabel: string
  cause: string
  findings: ResultFinding[]
  recs: string[]
  limitations: string[]
  explanation: string
}

/**
 * Derive an honest, qualitative result status and the supporting key
 * findings / recommendations / limitations — ALL from real scan signals
 * (rule outcomes, extraction coverage, OCR legibility, uncertain fields).
 * No pseudo-AI confidence percentages are invented anywhere here.
 */
function analyzeResultSignals(scan: ScanRow, counts: StatusCounts): ResultSignals {
  const name = scan.product_name?.trim() ? displayProductName(scan.product_name) : 'this product'
  const rules = scan.rules ?? []
  const failRules = rules.filter((r) => r.status === 'FAIL')
  const reviewRules = rules.filter((r) => r.status === 'WARNING' || r.status === 'NOT_DETECTED')
  const physRules = rules.filter((r) => r.status === 'REQUIRES_PHYSICAL_INSPECTION')
  const uncertain = (scan.uncertain ?? []).filter(Boolean)
  const extractions = scan.extractions ?? {}
  const extractionCount = Object.values(extractions).filter((v) => typeof v === 'string' && v.trim()).length
  const hasReading = Boolean(
    scan.ocr_text?.trim() ||
    scan.ocr?.text?.trim() ||
    extractionCount > 0 ||
    rules.length > 0,
  )
  const failCount = counts.failed ?? 0
  const reviewCount = (counts.warnings ?? 0) + (counts.not_detected ?? 0) + (counts.not_verifiable ?? 0)
  const physCount = counts.requires_physical_inspection ?? 0
  const barcodeReview = scan.barcode_check?.needs_review

  // 1) Insufficient data — nothing reliable came off the label.
  if (!hasReading) {
    return {
      status: 'insufficient',
      statusLabel: 'Insufficient Data',
      cause: 'We couldn\'t verify this result reliably — not enough readable information was extracted from the label photos.',
      findings: [{ severity: 'medium', text: 'Not enough readable label text was extracted to run the Legal Metrology checks.' }],
      recs: ['Retake the label with steady hands, even light and the declarations block in frame, then scan again.'],
      limitations: [
        'Extraction comes from the label photos only — small print is missed when lighting or focus is poor.',
        'Results are indicative, not a legal certificate.',
      ],
      explanation: `The photos of ${name} produced no reliable structured data, so there is nothing to verify. A retake with the mandatory-declarations block in sharp focus usually fixes this.`,
    }
  }

  const findings: ResultFinding[] = []
  for (const r of failRules) findings.push({ severity: 'critical', text: `${r.field || r.rule_id} — ${r.requirement || r.reason || 'mandatory declaration missing'}` })
  for (const r of reviewRules) findings.push(r.status === 'WARNING' ? { severity: 'medium', text: `Needs verification — ${r.field || r.rule_id}` } : { severity: 'medium', text: `Not detected — ${r.field || r.rule_id}` })
  if (uncertain.length > 0) findings.push({ severity: 'medium', text: `Not readable from the photos — ${uncertain.map((k) => k.replace(/_/g, ' ')).join('; ')}` })
  if (physCount > 0) findings.push({ severity: 'low', text: `Physical inspection required — ${physRules.map((r) => r.field || r.rule_id).join('; ')}` })
  if (barcodeReview) findings.push({ severity: 'medium', text: 'Barcode needs verification — the decoded value does not match the label reading.' })
  if (findings.length === 0 && extractionCount > 0) findings.push({ severity: 'low', text: 'All checked mandatory declarations were detected on the label.' })
  // Most important issue first (critical → high → medium → low).
  const rank = (s: FindingSeverity) => (s === 'critical' ? 4 : s === 'high' ? 3 : s === 'medium' ? 2 : 1)
  findings.sort((a, b) => rank(b.severity) - rank(a.severity))
  const findingsSlice = findings.slice(0, 6)

  const recs: string[] = []
  for (const r of [...failRules, ...reviewRules]) {
    const rec = recommendationFor(r)
    if (rec && !recs.includes(rec)) recs.push(rec)
  }
  if (physCount > 0) recs.push('Verify the physical package for anything that cannot be confirmed from photos (seals, dimensions, ink permanence).')
  if (uncertain.length > 0) recs.push('Re-read the low-confidence declarations on the physical label before acting on this report.')
  if (recs.length === 0) recs.push('No corrective action required from the photo-based checks.')
  const recsSlice = recs.slice(0, 4)

  const limitations = [
    'Extraction comes from the label photos only — small print is missed when lighting or focus is poor.',
    'Values flagged "not detected" or "needs review" should be verified on the physical label.',
  ]
  if (physCount > 0) limitations.push('Physical parameters (seals, dimensions, ink permanence) cannot be verified from photos.')
  if (barcodeReview) limitations.push('The barcode could not be confirmed from the image — verify it mechanically before relying on it.')
  limitations.push('Results are indicative, not a legal certificate — confirm with the inspecting authority for an official position.')

  let status: ResultStatus
  let statusLabel: string
  let cause: string
  if (failCount === 0 && reviewCount === 0 && physCount === 0) {
    status = 'verified'
    statusLabel = 'Verified'
    cause = `Every checked declaration was detected and consistent with the label — the result could be verified from the photos.`
  } else {
    status = 'needs_review'
    statusLabel = 'Needs Review'
    cause =
      failCount > 0
        ? `${failCount} mandatory declaration${failCount > 1 ? 's' : ''} ${failCount > 1 ? 'are' : 'is'} missing or incorrect on the label.`
        : `${reviewCount} item${reviewCount === 1 ? '' : 's'} could not be fully verified from the photos and need${reviewCount === 1 ? 's' : ''} a manual look.`
  }

  const explanation =
    scan.summary?.trim()
      ? displaySentence(scan.summary)
      : `${name} was checked against the Legal Metrology (Packaged Commodities) Rules 2011. ${cause} ${failCount === 0 && reviewCount === 0 ? 'No corrective action is indicated.' : 'Review the flagged items below.'}`

  return {
    status,
    statusLabel,
    cause,
    findings: findingsSlice,
    recs: recsSlice,
    limitations,
    explanation,
  }
}

const STATUS_STYLES: Record<ResultStatus, { wrap: string; icon: string; label: string }> = {
  verified: {
    wrap: 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/20 dark:bg-emerald-500/5',
    icon: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    label: 'text-emerald-700 dark:text-emerald-300',
  },
  needs_review: {
    wrap: 'border-amber-200 bg-amber-50/60 dark:border-amber-500/20 dark:bg-amber-500/5',
    icon: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    label: 'text-amber-700 dark:text-amber-300',
  },
  insufficient: {
    wrap: 'border-rose-200 bg-rose-50/60 dark:border-rose-500/20 dark:bg-rose-500/5',
    icon: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
    label: 'text-rose-700 dark:text-rose-300',
  },
}

function ResultSummary({
  sig,
  onTryAgain,
}: {
  sig: ResultSignals
  onTryAgain?: () => void
}) {
  const tone = STATUS_STYLES[sig.status]
  const StatusIcon = sig.status === 'verified' ? CheckCircle2 : sig.status === 'needs_review' ? AlertTriangle : FileQuestion
  return (
    <AnalyticsCard title="Result Summary" subtitle="Primary status, key findings and limits of this inspection">
      <div className="space-y-4">
        <div className={`flex flex-wrap items-start gap-3 rounded-xl border p-3.5 ${tone.wrap}`}>
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone.icon}`}>
            <StatusIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">Result status</p>
              <span className={`text-sm font-extrabold uppercase tracking-wide ${tone.label}`}>{sig.statusLabel}</span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-200">{sig.cause}</p>
          </div>
          {sig.status === 'insufficient' && onTryAgain && (
            <Button variant="outline" icon={<RefreshCw className="h-4 w-4" />} onClick={onTryAgain}>
              Try Again
            </Button>
          )}
        </div>

        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
            <ListChecks className="h-3.5 w-3.5" /> Key findings
          </p>
          <ul className="space-y-2">
            {sig.findings.map((f, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg border border-slate-100 bg-white/60 px-2.5 py-1.5 text-sm leading-relaxed text-slate-600 dark:border-white/10 dark:bg-navy-900/40 dark:text-slate-300">
                <SeverityBadge severity={f.severity} />
                <span className="min-w-0 flex-1">{f.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
            <RefreshCw className="h-3.5 w-3.5" /> Recommendations
          </p>
          <ul className="space-y-1.5">
            {sig.recs.map((r, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>

        <details className="group rounded-xl border border-slate-200/80 bg-slate-50/60 dark:border-white/[0.08] dark:bg-white/[0.03]">
          <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <Bot className="h-4 w-4 shrink-0 text-brand-500" /> AI explanation
            <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
          </summary>
          <p className="px-3 pb-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{sig.explanation}</p>
        </details>

        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
            <FileQuestion className="h-3.5 w-3.5" /> Limitations
          </p>
          <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            {sig.limitations.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      </div>
    </AnalyticsCard>
  )
}

export default function InspectionReport({
  scan,
  onScanAnother,
  onEditInput,
  onRegenerate,
}: {
  scan: ScanRow
  onScanAnother?: () => void
  onEditInput?: () => void
  onRegenerate?: () => void
}) {
  const { toast } = useToast()
  const [lang, setLang] = useState('en')
  const [exporting, setExporting] = useState(false)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)
  const [ruleFilter, setRuleFilter] = useState('ISSUES')
  const [evidenceIdx, setEvidenceIdx] = useState<number | null>(null)
  const [evidenceTitle, setEvidenceTitle] = useState('Evidence from product label')
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [fieldEvidence, setFieldEvidence] = useState<{ label: string; imageIndex: number; region: [number, number, number, number] | null } | null>(null)
  const [correcting, setCorrecting] = useState<{ key: string; label: string } | null>(null)
  const [correctValue, setCorrectValue] = useState('')
  const [savingCorrection, setSavingCorrection] = useState(false)
  const forceUpdate = useForceUpdate()

  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key)
  const counts = resolveCounts(scan)
  const score = Math.max(0, Math.min(100, scan.overall_score ?? 0))
  const risk = scan.risk_score ?? 100 - score
  const band = riskBand(risk)
  const failCount = counts.failed ?? 0
  const hasLowConfidence = failCount > 0 || (scan.uncertain ?? []).length > 0
  const ocrBlocks = scan.ocr_blocks ?? []
  const evidencePhotoSources = new Set<number>()
  for (const e of scan.evidence_chain ?? []) if (typeof e.source_image === 'number') evidencePhotoSources.add(e.source_image)
  for (const f of Object.values(scan.extraction_fields ?? {})) if (typeof f?.source_image === 'number') evidencePhotoSources.add(f.source_image)
  const photoCount = Math.max((scan.image_urls ?? []).length, evidencePhotoSources.size)
  const ocrChars = (scan.ocr?.text ?? '').length
  const failRules = (scan.rules ?? []).filter((r) => r.status === 'FAIL')
  const reviewRules = (scan.rules ?? []).filter((r) => r.status === 'WARNING' || r.status === 'NOT_DETECTED')
  const analysis = analysisLabel(scan.engine)
  const analysisProviderName = analysisProvider(scan.engine)
  const sig = analyzeResultSignals(scan, counts)

  const exportPdf = async () => {
    setExporting(true)
    try {
      const name = await downloadInspectionPdf(scan, lang)
      toast('success', 'PDF saved', name)
    } catch {
      toast('error', 'PDF failed', 'The report could not be exported right now. Try again.')
    } finally {
      setExporting(false)
    }
  }

  const ask = async () => {
    const q = question.trim()
    if (!q) return
    setAsking(true)
    setAnswer(null)
    try {
      if (CONFIG.GEMINI_API_KEY) {
        const gem = await askGeminiAssistant(scan, q, lang)
        if (gem) {
          setAnswer(gem)
          return
        }
      }
      const fn = httpsCallable<{ scanId: string; question: string; lang: string }, { answer: string }>(functions, 'complianceAssistant')
      const res = await fn({ scanId: scan.id, question: q, lang })
      setAnswer(res.data.answer)
    } catch {
      const fallback = localAssistantAnswer(scan, q)
      if (fallback) {
        setAnswer(fallback)
      } else {
        toast('error', 'Assistant unavailable', 'The assistant could not be reached right now. Try again in a moment.')
      }
    } finally {
      setAsking(false)
    }
  }

  const openEvidence = (sourceImage: number | null, label?: string) => {
    const idx = sourceImage != null && sourceImage >= 0 ? sourceImage : 0
    if (label) setEvidenceTitle(label)
    setEvidenceIdx(idx)
  }

  const openFieldEvidence = (label: string, imageIndex: number, region: [number, number, number, number] | null) => {
    setFieldEvidence({ label, imageIndex, region })
  }

  const openCorrection = (key: string, label: string, current: string) => {
    setCorrecting({ key, label })
    setCorrectValue(current)
  }

  /** User correction loop — persists via userCorrectField (evidence-first). */
  const saveCorrection = async () => {
    const v = correctValue.trim()
    if (!correcting || !v) return
    setSavingCorrection(true)
    try {
      await userCorrectField(scan.id, correcting.key, v)
      // Apply the correction locally so the report updates instantly.
      if (scan.extractions) {
        ;(scan.extractions as Record<string, string | null | undefined>)[correcting.key] = v
      }
      const efMap = scan.extraction_fields
      if (efMap && correcting) {
        const ef = efMap[correcting.key]
        if (ef) {
          efMap[correcting.key] = {
            ...ef,
            value: v,
            status: 'USER_CORRECTED',
            verification: 'user_corrected',
            confidence_score: 1,
            conflict: false,
            original_value: ef.value ?? ef.original_value ?? String(ef.value ?? ''),
          }
        } else {
          efMap[correcting.key] = {
            value: v,
            confidence: 'high',
            source_image: null,
            status: 'USER_CORRECTED',
            verification: 'user_corrected',
            confidence_score: 1,
            conflict: false,
          }
        }
      }
      toast('success', 'Field corrected', `${correcting.label} updated to “${v}”.`)
      setCorrecting(null)
      forceUpdate()
    } catch (e) {
      toast('error', 'Correction failed', (e as Error)?.message ?? 'Could not save your correction.')
    } finally {
      setSavingCorrection(false)
    }
  }

  /** Plain-text copy of the report — used by both Copy Result and Share. */
  const buildPlainText = () => {
    const line = '─'.repeat(28)
    const name = scan.product_name?.trim() ? displayProductName(scan.product_name) : 'Unnamed product'
    const lines = [
      'AuditX — Inspection Result',
      line,
      `Product: ${name}`,
      ...(scan.manufacturer?.trim() ? [`Manufacturer: ${displayText(scan.manufacturer)}`] : []),
      ...(scan.barcode ? [`Barcode: ${scan.barcode}`] : []),
      `Compliance score: ${score}/100 — ${verdictLabel}`,
      `Result status: ${sig.statusLabel} — ${sig.cause}`,
      '',
      'Key findings:',
      ...(sig.findings.length > 0 ? sig.findings.map((f) => `[${SEV_LABELS[f.severity]}] ${f.text}`) : ['No individual finding recorded.']),
      '',
      'Recommendations:',
      ...sig.recs,
      '',
      'The analysis is based on the label photos only and is indicative, not a legal certificate.',
    ]
    return lines.join('\n')
  }

  const copyResult = async () => {
    try {
      await navigator.clipboard.writeText(buildPlainText())
      toast('success', 'Result copied', 'The report text is on your clipboard.')
    } catch {
      toast('error', 'Copy failed', 'Your browser blocked clipboard access — use Download Report instead.')
    }
  }

  const shareResult = async () => {
    const text = buildPlainText()
    const title = `AuditX — ${scan.product_name?.trim() ? displayProductName(scan.product_name) : 'Inspection result'}`
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text })
        return
      } catch {
        // User cancelled or sharing unsupported — fall back to copy.
      }
    }
    void copyResult()
  }

  const copyField = async (label: string, value: string) => {
    const text = value?.trim()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(label)
      window.setTimeout(() => setCopiedField((cur) => (cur === label ? null : cur)), 1400)
      toast('success', 'Copied', `${label} copied to clipboard.`)
    } catch {
      toast('error', 'Copy failed', 'Your browser blocked clipboard access.')
    }
  }

  const prodInfo: Array<{ label: string; value: string; confidence: FieldConf; state: 'ok' | 'verify' | 'miss'; node?: React.ReactNode }> = [
    { label: 'Product name', value: '', confidence: null, state: 'miss', node: <span className="font-semibold text-slate-800 dark:text-slate-100">{scan.product_name?.trim() ? displayProductName(scan.product_name) : 'Not detected'}</span> },
    { ...productFieldValue(scan, 'mrp'), label: 'MRP' },
    { ...productFieldValue(scan, 'net_quantity'), label: 'Net quantity' },
    {
      label: 'Manufacturer / Packer / Importer',
      value: displayText(scan.extractions?.manufacturer ?? scan.extractions?.packer ?? scan.extractions?.importer ?? ''),
      confidence: null as FieldConf,
      state: (scan.extractions?.manufacturer || scan.extractions?.packer || scan.extractions?.importer) ? ('ok' as const) : ('miss' as const),
    },
    { ...productFieldValue(scan, 'mfg_date'), label: 'Manufacturing / Packing date' },
    { ...productFieldValue(scan, 'best_before'), label: 'Best before' },
    { ...productFieldValue(scan, 'consumer_care'), label: 'Customer care' },
    {
      label: 'EAN / Barcode',
      value: scan.barcode || '',
      confidence: null as FieldConf,
      state: scan.barcode ? ('ok' as const) : ('miss' as const),
    },
  ]

  const verdictTone = scan.verdict === 'COMPLIANT' ? 'emerald' : scan.verdict === 'PARTIALLY_COMPLIANT' ? 'amber' : score >= 80 ? 'emerald' : score >= 50 ? 'amber' : 'rose'
  const verdictLabel = scan.verdict || (score >= 80 ? 'COMPLIANT' : score >= 50 ? 'PARTIALLY COMPLIANT' : 'NON-COMPLIANT')

  return (
    <div className="animate-slide-in space-y-4">
      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/80 p-3 shadow-sm backdrop-blur dark:border-white/[0.07] dark:bg-navy-900/80">
        <div className="flex flex-wrap items-center gap-2">
          <Languages className="h-4 w-4 text-brand-500" />
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            aria-label="Report language"
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-accent-500 dark:border-white/15 dark:bg-navy-950 dark:text-slate-200"
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" icon={<Eye className="h-4 w-4" />} onClick={() => openEvidence(0, 'Evidence from product label')} disabled={(scan.image_urls ?? []).length === 0}>
            View Evidence
          </Button>
          {onEditInput && (
            <Button variant="outline" icon={<FilePen className="h-4 w-4" />} onClick={onEditInput}>
              Edit Input
            </Button>
          )}
          {onRegenerate && (
            <Button variant="outline" icon={<RefreshCw className="h-4 w-4" />} onClick={onRegenerate}>
              Regenerate
            </Button>
          )}
          {onScanAnother && (
            <Button variant="outline" icon={<ShoppingBag className="h-4 w-4" />} onClick={onScanAnother}>
              Scan Another Product
            </Button>
          )}
          <Button variant="outline" icon={<Copy className="h-4 w-4" />} onClick={() => void copyResult()}>
            Copy Result
          </Button>
          <Button variant="outline" icon={<Share2 className="h-4 w-4" />} onClick={() => void shareResult()}>
            Share
          </Button>
          <Button variant="primary" icon={exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} onClick={() => void exportPdf()} disabled={exporting}>
            {exporting ? t('downloading') : 'Download Report'}
          </Button>
        </div>
      </div>

      {/* Report header */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white to-brand-50/40 p-5 shadow-card sheen dark:border-white/[0.07] dark:from-navy-900 dark:to-[#101a31]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <AuditXMark size="sm" />
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-widest text-brand-600 dark:text-brand-400">AuditX</p>
                <h1 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Inspection Result</h1>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ToneBadge tone={verdictTone as 'emerald' | 'amber' | 'rose'} className="px-2.5 py-1 text-xs font-bold uppercase tracking-wide">{verdictLabel}</ToneBadge>
              {hasLowConfidence && (
                <ToneBadge tone="amber" className="px-2.5 py-1 text-xs font-bold uppercase tracking-wide">
                  <Eye className="h-3 w-3" /> Human review recommended
                </ToneBadge>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs text-slate-500 dark:text-slate-400 sm:grid-cols-2 lg:grid-cols-4">
            <span className="flex min-w-0 items-center gap-1.5">
              <Hash className="h-3.5 w-3.5 shrink-0 text-slate-400" /> <span className="truncate font-bold uppercase text-slate-400">Inspection ID</span>
              <span className="truncate font-mono font-semibold">{scan.id.slice(0, 12)}</span>
            </span>
            <span className="flex min-w-0 items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" /> <b className="shrink-0 font-bold uppercase text-slate-400">Date &amp; time</b>
              <span className="truncate font-semibold">{formatDateTime(scan.created_at)}</span>
            </span>
            <span className="flex min-w-0 items-center gap-1.5">
              <Languages className="h-3.5 w-3.5 shrink-0 text-slate-400" /> <b className="shrink-0 font-bold uppercase text-slate-400">Detected language</b>
              <span className="truncate font-semibold uppercase">{scan.language || 'en'}</span>
            </span>
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" /> <b className="shrink-0 font-bold uppercase text-slate-400">Analysis</b>
              <span className="truncate font-semibold">{analysis}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Compliance score + overall status */}
      <div className="animate-fade-up" style={{ animationDelay: '60ms' }}>
        <ScoreHero scan={scan} counts={counts} sig={sig} />
      </div>

      {/* Trust score — measured extraction confidence (adaptive evidence layer) */}
      <div className="animate-fade-up" style={{ animationDelay: '90ms' }}>
        <TrustScoreCard scan={scan} />
      </div>

      {/* Qualitative result status + key findings + recommendations */}
      <div className="animate-fade-up" style={{ animationDelay: '120ms' }}>
        <ResultSummary sig={sig} onTryAgain={onRegenerate} />
      </div>

      {/* Product information */}
      <div className="animate-fade-up space-y-4" style={{ animationDelay: '180ms' }}>
      <AnalyticsCard title="Detected Information" subtitle="Values read off the package label">
        <div className="stagger overflow-hidden rounded-xl border border-slate-200/80 dark:border-white/[0.08]">
          <div className="hidden items-center gap-3 bg-slate-50/80 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:grid sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_130px_120px_48px] dark:bg-white/[0.04] dark:text-slate-500">
            <span>Property</span>
            <span>Value</span>
            <span>Confidence</span>
            <span>Status</span>
            <span className="text-right">Copy</span>
          </div>
          {prodInfo.map((p) => {
            const copyValue = p.value || (p.label === 'Product name' ? String(scan.product_name ?? '') : '')
            return (
              <div
                key={p.label}
                className="grid grid-cols-1 gap-1.5 border-t border-slate-100 px-4 py-3 first:border-t-0 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_130px_120px_48px] sm:items-center sm:gap-3 sm:py-2.5 dark:border-white/[0.06]"
              >
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 sm:text-xs">{p.label}</p>
                <div className="min-w-0">
                  {p.node ? (
                    <div className="text-sm">{p.node}</div>
                  ) : p.state === 'ok' ? (
                    <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100" title={p.value}>{p.value}</p>
                  ) : p.state === 'verify' ? (
                    <p className="flex items-center gap-1 text-sm font-semibold text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Unable to verify
                    </p>
                  ) : (
                    <p className="text-sm font-semibold text-slate-400 dark:text-slate-500">Not detected</p>
                  )}
                </div>
                <div>
                  {p.confidence && p.state === 'ok' ? (
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                        <span className={`block h-full rounded-full ${CONF_BAR[p.confidence]}`} style={{ width: `${CONF_PCT[p.confidence]}%` }} />
                      </span>
                      <span className="text-xs font-semibold capitalize text-slate-500 dark:text-slate-400">{p.confidence}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400 dark:text-slate-500">—</span>
                  )}
                </div>
                <div>
                  <ToneBadge tone={p.state === 'ok' ? 'emerald' : p.state === 'verify' ? 'amber' : 'rose'}>
                    {p.state === 'ok' ? 'Detected' : p.state === 'verify' ? 'Unverified' : 'Missing'}
                  </ToneBadge>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void copyField(p.label, copyValue)}
                    aria-label={`Copy ${p.label}`}
                    className="rounded-md p-1.5 text-slate-400 transition-all hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-white/10 dark:hover:text-brand-300"
                  >
                    {copiedField === p.label ? (
                      <CheckCircle2 className="h-3.5 w-3.5 scale-110 text-emerald-500" aria-hidden="true" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </AnalyticsCard>

      {/* Product details — model / specs / safety small print */}
      <AnalyticsCard
        title="Product Details"
        subtitle="Model, specifications, electrical ratings, contact & safety text read from small print — per-field confidence"
      >
        <ProductDetails scan={scan} />
      </AnalyticsCard>

      {/* Risk factors + warnings */}
      <AnalyticsCard
        title="Risk Factors & Warnings"
        subtitle={failCount > 0 ? `Mandatory declarations that are missing or incorrect on the label` : 'No mandatory declaration failures detected'}
      >
        {failCount === 0 && reviewRules.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">No violations detected on this label.</p>
        ) : (
          <div className="space-y-2">
            {failRules.map((r, i) => (
              <ViolationCard key={`${r.rule_id}-${i}`} r={r} onViewEvidence={(src) => openEvidence(src, `Evidence — ${r.rule_id} · ${r.field}`)} />
            ))}
            {failCount === 0 && reviewRules.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                <b>No hard failures.</b> {reviewRules.length} declaration(s) need human verification — see the rule section below.
              </div>
            )}
          </div>
        )}
      </AnalyticsCard>

      {/* Compliance overview */}
      <AnalyticsCard title="Compliance Overview" subtitle="Status of every rule check in this inspection">
        <ComplianceOverview counts={counts} />
      </AnalyticsCard>

      {/* AI inspection summary */}
      <AiSummaryCard scan={scan} counts={counts} failCount={failCount} />

      {/* Evidence gallery */}
      {(scan.image_urls ?? []).length > 0 && (
        <AnalyticsCard title="Evidence" subtitle="Scanned Label Images">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {(scan.image_urls ?? []).map((u, i) => (
              <button
                key={i}
                onClick={() => openEvidence(i, 'Evidence from product label')}
                className="group overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50 text-left transition-colors hover:border-brand-400 dark:border-white/[0.08] dark:bg-white/[0.03]"
              >
                <img src={u} alt={`Product photo ${i + 1}`} className="h-28 w-full object-contain mix-blend-multiply dark:mix-blend-screen" />
                <div className="flex items-center justify-between border-t border-slate-100 px-2.5 py-1.5 dark:border-white/10">
                  <span className="text-[11px] font-bold text-slate-400">Image {i + 1}</span>
                  <Eye className="h-3.5 w-3.5 text-slate-300 group-hover:text-brand-500" />
                </div>
              </button>
            ))}
          </div>
        </AnalyticsCard>
      )}

      {/* Source & Evidence — where every finding came from */}
      <AnalyticsCard title="Source & Evidence" subtitle="Provenance of every value in this report">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-white/[0.08] dark:bg-white/[0.03]">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Analysis engine</p>
            <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{analysis}</p>
            {analysisProviderName && (
              <p className="mt-0.5 text-[10px] text-slate-400">{analysisProviderName}</p>
            )}
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-white/[0.08] dark:bg-white/[0.03]">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Photos analysed</p>
            <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{photoCount > 0 ? `${photoCount} image${photoCount === 1 ? '' : 's'}` : '—'}</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-white/[0.08] dark:bg-white/[0.03]">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">OCR source</p>
            <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
              {ocrBlocks.length > 0 || ocrChars > 0
                ? `${ocrBlocks.length} block${ocrBlocks.length === 1 ? '' : 's'}${ocrBlocks.length > 0 && ocrChars > 0 ? ' · ' : ''}${ocrChars > 0 ? `${ocrChars} chars` : ''}`
                : 'None captured'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-white/[0.08] dark:bg-white/[0.03]">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Rule checks run</p>
            <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{(scan.rules ?? []).length}</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-white/[0.08] dark:bg-white/[0.03]">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Evidence links</p>
            <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{(scan.evidence_chain ?? []).length}</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-white/[0.08] dark:bg-white/[0.03]">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Uncertain fields</p>
            <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{(scan.uncertain ?? []).length}</p>
          </div>
        </div>
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-500 dark:bg-navy-950/50 dark:text-slate-400">
          Every value in this report is drawn only from the {photoCount} photo{photoCount === 1 ? '' : 's'} captured and the text readable on the label.
          Declarations that could not be read are marked &quot;Unable to verify&quot; and are never counted as pass or fail.
        </p>
      </AnalyticsCard>

      {/* Rule analysis */}
      <AnalyticsCard title={t('rule_checks')} subtitle="Legal Metrology · Packaged Commodities Rules 2011">
        {(scan.rules ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">{t('no_rules')}</p>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              {RULE_FILTERS.map((f) => {
                const count = (scan.rules ?? []).filter((r) => f.match(r.status)).length
                if (f.key !== 'ALL' && count === 0) return null
                const active = ruleFilter === f.key
                return (
                  <button
                    key={f.key}
                    onClick={() => setRuleFilter(f.key)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
                      active
                        ? 'bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-glow-sm'
                        : 'border border-slate-200 bg-white text-slate-500 hover:border-brand-300 hover:text-brand-600 dark:border-white/10 dark:bg-navy-950 dark:text-slate-400 dark:hover:border-brand-500/40 dark:hover:text-brand-300'
                    }`}
                  >
                    {f.label} <span className="opacity-70">{count}</span>
                  </button>
                )
              })}
            </div>
            <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
              {(scan.rules ?? [])
                .filter((r) => RULE_FILTERS.find((f) => f.key === ruleFilter)?.match(r.status))
                .map((r, i) => (
                  <RuleRow key={`${r.rule_id}-${i}`} r={r} onViewEvidence={(src) => openEvidence(src, `Evidence — ${r.rule_id}`)} />
                ))}
            </div>
          </>
        )}
      </AnalyticsCard>

      {/* Final assessment */}
      <FinalAssessment scan={scan} counts={counts} />

      {/* Extracted declarations */}
      <AnalyticsCard title="Extracted Declarations & Verification" subtitle="Declarations read off the label, with verification status & evidence">
        <DeclarationsList
          scan={scan}
          onCorrect={openCorrection}
          onViewFieldEvidence={openFieldEvidence}
        />
      </AnalyticsCard>

      {/* Fields that could not be automatically verified */}
      <div className="animate-fade-up">
        <NeedsVerificationPanel
          scan={scan}
          onCorrect={openCorrection}
          onViewFieldEvidence={openFieldEvidence}
        />
      </div>

      {/* AI assistant */}
      <AnalyticsCard title={t('ai_assistant')} subtitle={t('suggest_next')}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 dark:border-white/[0.08] dark:bg-white/[0.03]">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">
                <Bot className="h-3.5 w-3.5" /> {t('assistant_summary')}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {displaySentence(scan.assistant?.summary || scan.summary || '—')}
              </p>
            </div>
            {(scan.assistant?.suggestions ?? []).length > 0 && (
              <ul className="space-y-2">
                {(scan.assistant?.suggestions ?? []).map((s, i) => (
                  <li key={i} className="flex gap-2.5 rounded-lg bg-brand-50/70 px-3 py-2 text-sm text-slate-700 dark:bg-brand-500/10 dark:text-slate-300">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white">{i + 1}</span>
                    {displaySentence(s)}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col rounded-xl border border-slate-200/80 p-4 dark:border-white/10">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
              <MessageSquareText className="h-3.5 w-3.5" /> {t('ask_assistant')}
            </p>
            <div className="mt-3 flex gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void ask()
                }}
                placeholder={t('ask_placeholder')}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-accent-500 dark:border-white/15 dark:bg-navy-950 dark:text-slate-100"
              />
              <Button icon={asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} onClick={() => void ask()} disabled={asking}>
                {t('ask_button')}
              </Button>
            </div>
            {answer && (
              <div className="mt-3 rounded-xl bg-slate-50 p-3 dark:bg-navy-950/50">
                {(() => {
                  const sentences = formatAnswer(answer)
                  return sentences.length > 1 ? (
                    <ul className="space-y-2">
                      {sentences.map((s, i) => (
                        <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                          <span className="mt-1 flex h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                          <span>{displaySentence(s)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{displaySentence(sentences[0])}</p>
                  )
                })()}
              </div>
            )}
            {!answer && (
              <div className="mt-auto pt-3 text-xs text-slate-400">
                Risk band: <ToneBadge tone={riskTone(band)}>{band}</ToneBadge>
              </div>
            )}
          </div>
        </div>
      </AnalyticsCard>

      {/* Context + evidence chain */}
      <ContextBadges ctx={scan.context} />
      <EvidenceChain chain={scan.evidence_chain} />

      {/* Multi-label detection */}
      {(scan.labels ?? []).length > 0 && (
        <AnalyticsCard title={t('labels_detected')} subtitle="Multi-label detection">
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(scan.labels ?? []).map((lb, i) => (
              <li key={i} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-white/[0.08] dark:bg-white/[0.03]">
                <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  <Tag className="h-3.5 w-3.5 shrink-0 text-brand-500" /> <span className="truncate">{displayText(lb.label)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <ToneBadge tone={lb.score >= 80 ? 'emerald' : lb.score >= 50 ? 'amber' : 'rose'}>{lb.score}/100</ToneBadge>
                </span>
              </li>
            ))}
          </ul>
        </AnalyticsCard>
      )}

      {/* Raw OCR — kept verbatim as source evidence, collapsed at the very bottom */}
      {(ocrBlocks.length > 0 || scan.ocr?.text) && (
        <AnalyticsCard title="Raw OCR / Extracted Text" subtitle="Source transcription read off the label — shown verbatim as evidence">
          {ocrBlocks.length > 0 && (
            <div className="space-y-2">
              {ocrBlocks.map((block, i) => (
                <details key={i} className="group">
                  <summary className="flex cursor-pointer select-none flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 py-2 text-xs font-semibold text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="min-w-0">Image {i + 1} — {block.position} ({block.text.length} chars)</span>
                    {block.languages.length > 0 && <span className="ml-1 shrink-0 text-slate-400">[{block.languages.join(', ')}]</span>}
                    <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="mt-2 break-words rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-500 dark:bg-navy-950/50 dark:text-slate-400">
                    {block.text}
                  </p>
                </details>
              ))}
            </div>
          )}
          {scan.ocr?.text && (
            <details className="group mt-2">
              <summary className="flex cursor-pointer select-none items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 py-2 text-xs font-semibold text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300">
                <Barcode className="h-3.5 w-3.5 text-slate-400" />
                {t('extracted_text')} ({scan.ocr.text.length} chars)
                <ChevronDown className="ml-auto h-3.5 w-3.5 text-slate-400 transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-2 break-words rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-500 dark:bg-navy-950/50 dark:text-slate-400">
                {scan.ocr.text}
              </p>
            </details>
          )}
        </AnalyticsCard>
      )}

      {/* Analysis footer */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-slate-200/80 bg-slate-50/60 px-4 py-2.5 text-xs text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-400">
        <span className="flex items-center gap-1.5 font-semibold text-slate-600 dark:text-slate-300">
          <Bot className="h-3.5 w-3.5 text-brand-500" /> Analysis
        </span>
        <span className="font-medium">{analysis}</span>
      </div>
      </div>

      {/* Evidence modal */}
      <EvidenceModal scan={scan} imageIndex={evidenceIdx} title={evidenceTitle} onClose={() => setEvidenceIdx(null)} />

      {/* Per-field evidence modal (bbox overlay) */}
      {fieldEvidence && (
        <FieldEvidenceModal
          url={(scan.image_urls ?? [])[fieldEvidence.imageIndex] ?? (scan.image_urls ?? [])[0]}
          label={fieldEvidence.label}
          region={fieldEvidence.region}
          imageLabel={`Image ${fieldEvidence.imageIndex + 1}`}
          onClose={() => setFieldEvidence(null)}
        />
      )}

      {/* User correction modal — evidence-first, never silently overwrites */}
      <Modal
        open={correcting !== null}
        onClose={() => setCorrecting(null)}
        title="Correct field value"
        description={correcting ? `Update the "${correcting.label}" reading. The original value stays recorded as evidence.` : undefined}
      >
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-400">Corrected value</span>
            <input
              value={correctValue}
              onChange={(e) => setCorrectValue(e.target.value)}
              autoFocus
              placeholder="Type the correct value as printed on the label"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-accent-500 dark:border-white/15 dark:bg-navy-950 dark:text-slate-100"
            />
          </label>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setCorrecting(null)}>Cancel</Button>
            <Button icon={savingCorrection ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} onClick={() => void saveCorrection()} disabled={savingCorrection || !correctValue.trim()}>
              Save correction
            </Button>
          </div>
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-400">
            <Undo2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            The AI reading is kept as the original value on the record — this correction is logged, not hidden.
          </p>
        </div>
      </Modal>
    </div>
  )
}