import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import {
  AlertTriangle,
  Barcode,
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  ExternalLink,
  Eye,
  FileQuestion,
  FileText,
  Hash,
  HelpCircle,
  Info,
  Languages,
  Loader2,
  MessageSquareText,
  MinusCircle,
  Package,
  Send,
  ShoppingBag,
  Tag,
  XCircle,
} from 'lucide-react'
import AnalyticsCard from '../dashboard/AnalyticsCard'
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
import type { EvidenceLink, ExtractedDeclarations, RuleCheck, ScanContext, ScanRow, StatusCounts } from '../../lib/types2'

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

/** Turn a long assistant reply into short, readable sentence bullets. */
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
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/40">
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

const SCORE_TONE_BG: Record<string, { track: string; stroke: string; text: string; badge: 'emerald' | 'amber' | 'rose' }> = {
  high: { track: 'text-emerald-200', stroke: 'text-emerald-500', text: 'text-emerald-500', badge: 'emerald' },
  mid: { track: 'text-amber-200', stroke: 'text-amber-500', text: 'text-amber-500', badge: 'amber' },
  low: { track: 'text-rose-200', stroke: 'text-rose-500', text: 'text-rose-500', badge: 'rose' },
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
    <div className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/40">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${text}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-lg font-extrabold leading-tight text-slate-900 dark:text-slate-100">{value}</p>
        <p className="text-[11px] font-semibold text-slate-400">{label}</p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 1 · Result header + compliance score hero                            */
/* ------------------------------------------------------------------ */

function ScoreHero({ scan, counts }: { scan: ScanRow; counts: StatusCounts }) {
  const score = Math.max(0, Math.min(100, scan.overall_score ?? 0))
  const risk = scan.risk_score ?? 100 - score
  const band = riskBand(risk)
  const tone = score >= 80 ? SCORE_TONE_BG.high : score >= 50 ? SCORE_TONE_BG.mid : SCORE_TONE_BG.low
  const R = 56
  const CIRC = 2 * Math.PI * R
  const frac = score / 100
  const verdict = scan.verdict ?? (score >= 80 ? 'COMPLIANT' : score >= 50 ? 'PARTIALLY_COMPLIANT' : 'NON-COMPLIANT')
  const needReview = (counts.warnings ?? 0) + (counts.not_detected ?? 0) + (counts.uncertain ?? 0)

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="grid grid-cols-1 gap-0 lg:grid-cols-[auto_1fr_auto]">
        {/* Score ring */}
        <div className="p-6 lg:border-r lg:border-slate-100 lg:dark:border-slate-800">
          <p className="mb-4 text-[11px] font-extrabold uppercase tracking-widest text-slate-400">Compliance Score</p>
          <div className="flex flex-wrap items-center gap-5">
          <div className="relative h-24 w-24 shrink-0 sm:h-36 sm:w-36">
            <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
              <circle cx="64" cy="64" r={R} fill="none" strokeWidth="11" className={`stroke-current ${tone.track}`} />
              <circle
                cx="64" cy="64" r={R} fill="none" strokeWidth="11"
                strokeLinecap="round" strokeDasharray={`${CIRC}`} strokeDashoffset={`${CIRC * (1 - frac)}`}
                className={`stroke-current ${tone.stroke}`}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-4xl font-extrabold leading-none ${tone.text}`}>{score}</span>
              <span className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">/ 100</span>
            </div>
          </div>
          <div className="flex flex-col items-start gap-1.5">
            <span className={`text-xs font-extrabold uppercase tracking-wider ${tone.text}`}>{band} risk</span>
            <span className={`text-2xl font-extrabold uppercase tracking-tight break-words ${tone.text}`}>{verdict}</span>
            <ToneBadge tone={tone.badge}>{score >= 80 ? 'Compliant' : score >= 50 ? 'Partially compliant' : 'Non-compliant'}</ToneBadge>
          </div>
          </div>
        </div>

        {/* Product + summary counts */}
        <div className="flex flex-col gap-3 p-6">
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              <ShoppingBag className="h-3.5 w-3.5" /> Product inspected
            </div>
            <h2 className="mt-1 break-words text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">{scan.product_name || 'Unnamed product'}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              {scan.manufacturer && <span className="min-w-0 max-w-full break-words font-semibold text-slate-600 dark:text-slate-300">{scan.manufacturer}</span>}
              {scan.barcode && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-slate-800">EAN {scan.barcode}</span>}
              {(scan.labels?.length ?? 0) > 0 && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] dark:bg-slate-800">{scan.labels?.length} label(s)</span>}
            </div>
          </div>
          {scan.summary && (
            <p className="max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">{scan.summary}</p>
          )}
          <div className="mt-auto grid grid-cols-2 gap-2 pt-2 sm:grid-cols-4">
            <MetricChip icon={<CheckCircle2 className="h-4 w-4" />} label="Passed" value={counts.passed ?? 0} tone="emerald" />
            <MetricChip icon={<XCircle className="h-4 w-4" />} label="Failed" value={counts.failed ?? 0} tone="rose" />
            <MetricChip icon={<AlertTriangle className="h-4 w-4" />} label="Needs review" value={needReview} tone="amber" />
            <MetricChip icon={<HelpCircle className="h-4 w-4" />} label="Uncertain" value={counts.uncertain ?? 0} tone="slate" />
          </div>
        </div>

        {/* Key declarations snapshot */}
        <div className="grid grid-cols-2 gap-2 border-t border-slate-200/80 p-6 lg:w-80 lg:border-l lg:border-t-0 dark:border-slate-800">
          <SnapshotItem label="MRP" value={(scan.extractions?.mrp ?? '').replace(/^mrp\.?\s*/i, '')} ok={Boolean(scan.extractions?.mrp)} />
          <SnapshotItem label="Net qty" value={(scan.extractions?.net_quantity ?? '').replace(/^net\s*(?:wt\.?|weight|qty\.?|quantity)?\s*[:.]?\s*/i, '')} ok={Boolean(scan.extractions?.net_quantity)} />
          <SnapshotItem label="Mfg" value={scan.extractions?.mfg_date} ok={Boolean(scan.extractions?.mfg_date)} />
          <SnapshotItem label="Best before" value={scan.extractions?.best_before} ok={Boolean(scan.extractions?.best_before)} />
          <SnapshotItem label="Mr / Packer" value={scan.extractions?.manufacturer ?? scan.extractions?.packer} ok={Boolean(scan.extractions?.manufacturer || scan.extractions?.packer)} />
          <SnapshotItem label="Customer care" value={scan.extractions?.consumer_care} ok={Boolean(scan.extractions?.consumer_care)} />
        </div>
      </div>
    </div>
  )
}

function SnapshotItem({ label, value, ok }: { label: string; value: string | null | undefined; ok: boolean }) {
  const shown = value?.trim() || ''
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-2.5 dark:border-slate-800 dark:bg-slate-950/40">
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
  const value = (raw ?? '').toString().trim()
  const conf = (scan.extraction_fields?.[key]?.confidence as FieldConf | undefined) ?? null
  const source = scan.extraction_fields?.[key]?.status
  const isMissing = !value && source === 'MISSING'
  const isUncertain = !value && ((scan.uncertain ?? []).includes(key) || source === 'NEEDS_REVIEW' || source === 'INVALID')
  if (!value) {
    if (isUncertain || isMissing) return { value: '', confidence: null, state: 'verify' }
    return { value: '', confidence: null, state: 'miss' }
  }
  if (conf === 'low') return { value, confidence: conf, state: 'verify' }
  return { value, confidence: conf, state: 'ok' }
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
        <div key={it.label} className="flex flex-col items-start gap-1.5 rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 py-3 dark:border-slate-800 dark:bg-slate-950/40">
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
  const desc = r.reason || r.issue || (r.detected_value ? `Detected: "${r.detected_value}"` : 'Missing from the label.')
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
          <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{r.requirement || r.statement || r.field}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Actual finding</p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{desc}</p>
          {r.detected_value != null && r.detected_value !== '' && (
            <p className="mt-1 rounded-lg bg-white/70 px-2 py-1 text-xs italic text-slate-500 dark:bg-slate-900/70 dark:text-slate-400">“{r.detected_value}”</p>
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
                <span className="italic break-words">“{r.evidence.ocr_text.slice(0, 120)}…”</span>
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
  const summary = (scan.assistant?.summary || scan.summary || '').trim()
  const fallback = failCount > 0
    ? `${failCount} mandatory declaration${failCount > 1 ? 's appear' : ' appears'} to be missing or incorrect.${needVerify > 0 ? ` ${needVerify} field${needVerify > 1 ? 's require' : ' requires'} additional human verification.` : ''}`
    : 'All mandatory declarations appear to be present.'
  const shown = summary || fallback
  const expandable = summary.length > 220
  return (
    <div className="rounded-2xl border border-brand-200/70 bg-gradient-to-br from-brand-50/80 via-white to-white p-5 dark:border-brand-500/20 dark:from-brand-500/10 dark:via-slate-900 dark:to-slate-900">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
          <Bot className="h-5 w-5" />
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
          <p className="mt-3 rounded-xl bg-white/70 px-3.5 py-3 text-sm leading-relaxed text-slate-700 dark:bg-slate-900/60 dark:text-slate-200">{shown}</p>
        </details>
      ) : (
        <p className="mt-4 text-base font-semibold leading-relaxed text-slate-800 dark:text-slate-100">{shown}</p>
      )}
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <MetricChip icon={<XCircle className="h-4 w-4" />} label="Mandatory issues" value={failCount} tone="rose" />
        <MetricChip icon={<Eye className="h-4 w-4" />} label="Needs verification" value={needVerify} tone="amber" />
        <MetricChip icon={<AlertTriangle className="h-4 w-4" />} label="Physical inspection" value={physical} tone="cyan" />
      </div>
      <p className="mt-4 flex items-start gap-1.5 rounded-xl bg-white/70 px-3 py-2 text-xs text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
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
      <div className={`flex items-start gap-4 rounded-2xl border border-slate-200/80 p-4 dark:border-slate-800 ${bg}`}>
        <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${textCol} bg-white shadow-sm dark:bg-slate-900`}>{icon}</span>
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
              className={`overflow-hidden rounded-xl border ${i === imageIndex ? 'border-amber-400 ring-2 ring-amber-300/60' : 'border-slate-200 dark:border-slate-800'}`}
            >
              <img src={u} alt={`Product photo ${i + 1}`} className="h-44 w-full object-contain bg-slate-50 dark:bg-slate-950" />
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

const DECLARATION_LABELS: { key: keyof ExtractedDeclarations; label: string }[] = [
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
]

const CONF_PCT: Record<string, number> = { high: 100, medium: 68, low: 38 }
const CONF_BAR: Record<string, string> = {
  high: 'bg-emerald-500',
  medium: 'bg-amber-500',
  low: 'bg-rose-500',
}

function DeclarationsList({ scan }: { scan: ScanRow }) {
  const ex = scan.extractions
  const uncertain = scan.uncertain ?? []
  if (!ex && uncertain.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-400">No extracted declarations for this scan.</p>
  }
  const detectedCount = DECLARATION_LABELS.filter((d) => {
    const value = ex?.[d.key] as string | null | undefined
    return value || uncertain.includes(d.key)
  }).length

  const rows = DECLARATION_LABELS.map((d) => {
    const value = (ex?.[d.key] as string | null | undefined) ?? ''
    const conf = scan.extraction_fields?.[d.key] as { value?: string | null; confidence?: string | null; source_image?: number | null } | undefined
    const confidence = conf?.confidence ?? null
    const needsReview = confidence === 'low' || uncertain.includes(d.key)
    const missing = !value && !needsReview
    const sourceImg = conf?.source_image ?? null
    const status = missing ? 'miss' : needsReview ? 'verify' : 'ok'
    const icon =
      status === 'ok' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
      : status === 'verify' ? <AlertTriangle className="h-4 w-4 text-amber-500" />
      : <XCircle className="h-4 w-4 text-rose-400" />
    return { ...d, value: String(value).trim(), confidence, needsReview, missing, sourceImg, status, icon }
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
      <div className="overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-800">
        {rows.map((row, i) => (
          <details key={row.key} className={`group ${i > 0 ? 'border-t border-slate-100 dark:border-slate-800' : ''}`}>
            <summary className={`flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-2.5 ${row.status === 'miss' ? 'bg-rose-50/40 dark:bg-rose-500/5' : row.status === 'verify' ? 'bg-amber-50/30 dark:bg-amber-500/5' : 'bg-white dark:bg-slate-900'}`}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center">{row.icon}</span>
              <span className="w-28 shrink-0 text-sm font-semibold text-slate-700 dark:text-slate-200 sm:w-40">{row.label}</span>
              <span title={row.value} className={`min-w-0 flex-1 truncate text-sm ${row.status === 'miss' ? 'italic text-rose-400' : row.status === 'verify' ? 'italic text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300'}`}>
                {row.status === 'miss' ? 'Not detected' : row.status === 'verify' ? (row.value || 'Needs verification') : row.value}
              </span>
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
            <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/40">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Detected value</p>
                  <p className={`mt-0.5 text-sm ${row.status === 'miss' ? 'italic text-rose-500 dark:text-rose-400' : row.status === 'verify' ? 'text-amber-700 dark:text-amber-300' : 'text-slate-700 dark:text-slate-200'}`}>
                    {row.status === 'miss' ? 'Not detected — value missing' : row.value || 'Needs verification'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Status &amp; confidence</p>
                  <div className="mt-1 flex items-center gap-2">
                    <RuleStatusBadge status={row.status === 'miss' ? 'NOT_DETECTED' : row.status === 'verify' ? 'WARNING' : 'PASS'} />
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
                <p className="mt-3 rounded-lg bg-white/70 px-2.5 py-1.5 text-xs italic text-slate-500 dark:bg-slate-900/70 dark:text-slate-400">
                  Read from the label: “{row.value}”
                </p>
              )}
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 8 · Rule analysis (collapsible)                                     */
/* ------------------------------------------------------------------ */

function RuleRow({ r, onViewEvidence }: { r: RuleCheck; onViewEvidence: (sourceImage: number | null) => void }) {
  const desc = r.requirement || r.statement || r.field
  const shown = r.detected_value !== undefined ? r.detected_value : r.extracted_text
  const why = r.reason || r.issue
  const isProblem = r.status === 'FAIL' || r.status === 'WARNING' || r.status === 'NOT_DETECTED'
  const border = r.status === 'FAIL' ? 'border-rose-200 dark:border-rose-500/20'
    : r.status === 'WARNING' || r.status === 'NOT_DETECTED' ? 'border-amber-200 dark:border-amber-500/20'
    : 'border-slate-200/80 dark:border-slate-800'
  return (
    <details className={`group rounded-xl border bg-white dark:bg-slate-900 ${border}`}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2.5 px-4 py-2.5">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${isProblem ? 'bg-rose-50 text-rose-500 dark:bg-rose-500/10' : 'bg-emerald-50 text-emerald-500 dark:bg-emerald-500/10'}`}>
          {isProblem ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
        </span>
        <span className="font-mono text-xs font-bold text-brand-600 dark:text-brand-400">{r.rule_id}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{r.field || desc}</span>
        <span className="shrink-0"><RuleStatusBadge status={r.status} /></span>
        <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="grid grid-cols-1 gap-3 border-t border-slate-100 px-4 py-3 sm:grid-cols-2 dark:border-slate-800">
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
              <p className="mt-1.5 text-[11px] italic text-slate-400">“{r.evidence.ocr_text}”</p>
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
          <div key={i} className="rounded-lg border border-slate-100 bg-slate-50/60 p-2.5 dark:border-slate-800 dark:bg-slate-950/40">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="min-w-0 text-xs font-semibold text-slate-700 dark:text-slate-200">
                <span className="font-mono text-brand-600 dark:text-brand-400">{e.rule_id}</span> · {e.requirement}
              </p>
              <div className="flex shrink-0 items-center gap-1.5">
                {e.source_image != null && <span className="text-[10px] text-slate-400">Img {e.source_image + 1}</span>}
                <RuleStatusBadge status={e.status} />
              </div>
            </div>
            {e.detected_value && <p className="mt-1 text-xs italic text-slate-600 dark:text-slate-300">“{e.detected_value}”</p>}
            {e.ocr_text && <p className="mt-1 max-h-16 overflow-y-auto text-[11px] leading-relaxed text-slate-400">{e.ocr_text}</p>}
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

export default function InspectionReport({ scan, onScanAnother }: { scan: ScanRow; onScanAnother?: () => void }) {
  const { toast } = useToast()
  const [lang, setLang] = useState('en')
  const [exporting, setExporting] = useState(false)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)
  const [ruleFilter, setRuleFilter] = useState('ISSUES')
  const [evidenceIdx, setEvidenceIdx] = useState<number | null>(null)
  const [evidenceTitle, setEvidenceTitle] = useState('Evidence from product label')

  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key)
  const counts = resolveCounts(scan)
  const score = Math.max(0, Math.min(100, scan.overall_score ?? 0))
  const risk = scan.risk_score ?? 100 - score
  const band = riskBand(risk)
  const failCount = counts.failed ?? 0
  const hasLowConfidence = failCount > 0 || (scan.uncertain ?? []).length > 0
  const ocrBlocks = scan.ocr_blocks ?? []
  const failRules = (scan.rules ?? []).filter((r) => r.status === 'FAIL')
  const reviewRules = (scan.rules ?? []).filter((r) => r.status === 'WARNING' || r.status === 'NOT_DETECTED')
  const analysis = analysisLabel(scan.engine)

  const exportPdf = async () => {
    setExporting(true)
    try {
      const name = await downloadInspectionPdf(scan, lang)
      toast('success', 'PDF saved', name)
    } catch (e) {
      toast('error', 'PDF failed', (e as Error).message)
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
    } catch (e) {
      const fallback = localAssistantAnswer(scan, q)
      if (fallback) {
        setAnswer(fallback)
      } else {
        toast('error', 'Assistant unavailable', (e as Error).message ?? 'Cloud Functions may not be deployed yet.')
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

  const prodInfo: Array<{ label: string; value: string; confidence: FieldConf; state: 'ok' | 'verify' | 'miss'; node?: React.ReactNode }> = [
    { label: 'Product name', value: '', confidence: null, state: 'miss', node: <span className="font-semibold text-slate-800 dark:text-slate-100">{scan.product_name || 'Not detected'}</span> },
    { ...productFieldValue(scan, 'mrp'), label: 'MRP' },
    { ...productFieldValue(scan, 'net_quantity'), label: 'Net quantity' },
    {
      label: 'Manufacturer / Packer / Importer',
      value: scan.extractions?.manufacturer ?? scan.extractions?.packer ?? scan.extractions?.importer ?? '',
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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-2">
          <Languages className="h-4 w-4 text-brand-500" />
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            aria-label="Report language"
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
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
          {onScanAnother && (
            <Button variant="outline" icon={<ShoppingBag className="h-4 w-4" />} onClick={onScanAnother}>
              Scan Another Product
            </Button>
          )}
          <Button variant="primary" icon={exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} onClick={() => void exportPdf()} disabled={exporting}>
            {exporting ? t('downloading') : 'Download Report'}
          </Button>
        </div>
      </div>

      {/* Report header */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
                <Package className="h-4 w-4" />
              </span>
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
      <ScoreHero scan={scan} counts={counts} />

      {/* Product information */}
      <AnalyticsCard title="Product Information" subtitle="Values read off the package label">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {prodInfo.map((p) => (
            <div key={p.label} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{p.label}</p>
              {p.node ? (
                <div className="mt-1 text-sm">{p.node}</div>
              ) : p.state === 'ok' ? (
                <p className="mt-1 truncate text-sm font-semibold text-slate-700 dark:text-slate-200" title={p.value}>{p.value}</p>
              ) : p.state === 'verify' ? (
                <p className="mt-1 flex items-center gap-1 text-sm font-semibold text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" /> Needs verification
                </p>
              ) : (
                <p className="mt-1 text-sm font-semibold text-rose-400">Not detected</p>
              )}
              {p.confidence && p.state === 'ok' && (
                <span className={`mt-1 block h-1 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800`}>
                  <span className={`block h-full rounded-full ${CONF_BAR[p.confidence]}`} style={{ width: `${CONF_PCT[p.confidence]}%` }} />
                </span>
              )}
            </div>
          ))}
        </div>
      </AnalyticsCard>

      {/* Critical findings */}
      <AnalyticsCard
        title="Critical Findings"
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
                className="group overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50 text-left transition-colors hover:border-brand-400 dark:border-slate-800 dark:bg-slate-950/40"
              >
                <img src={u} alt={`Product photo ${i + 1}`} className="h-28 w-full object-contain mix-blend-multiply dark:mix-blend-screen" />
                <div className="flex items-center justify-between border-t border-slate-100 px-2.5 py-1.5 dark:border-slate-800">
                  <span className="text-[11px] font-bold text-slate-400">Image {i + 1}</span>
                  <Eye className="h-3.5 w-3.5 text-slate-300 group-hover:text-brand-500" />
                </div>
              </button>
            ))}
          </div>
        </AnalyticsCard>
      )}

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
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                      active
                        ? 'bg-brand-600 text-white shadow-sm'
                        : 'border border-slate-200 bg-white text-slate-500 hover:border-brand-300 hover:text-brand-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400 dark:hover:text-brand-400'
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
      <AnalyticsCard title="Extracted Declarations" subtitle="Declarations read off the label, with confidence">
        <DeclarationsList scan={scan} />
      </AnalyticsCard>

      {/* AI assistant */}
      <AnalyticsCard title={t('ai_assistant')} subtitle={t('suggest_next')}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/40">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">
                <Bot className="h-3.5 w-3.5" /> {t('assistant_summary')}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {scan.assistant?.summary || (scan.summary || '—')}
              </p>
            </div>
            {(scan.assistant?.suggestions ?? []).length > 0 && (
              <ul className="space-y-2">
                {(scan.assistant?.suggestions ?? []).map((s, i) => (
                  <li key={i} className="flex gap-2.5 rounded-lg bg-brand-50/70 px-3 py-2 text-sm text-slate-700 dark:bg-brand-500/10 dark:text-slate-300">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white">{i + 1}</span>
                    {s}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col rounded-xl border border-slate-200/80 p-4 dark:border-slate-800">
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
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <Button icon={asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} onClick={() => void ask()} disabled={asking}>
                {t('ask_button')}
              </Button>
            </div>
            {answer && (
              <div className="mt-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-950/50">
                {(() => {
                  const sentences = formatAnswer(answer)
                  return sentences.length > 1 ? (
                    <ul className="space-y-2">
                      {sentences.map((s, i) => (
                        <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                          <span className="mt-1 flex h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{sentences[0]}</p>
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
              <li key={i} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  <Tag className="h-3.5 w-3.5 shrink-0 text-brand-500" /> <span className="truncate">{lb.label}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <ToneBadge tone={lb.score >= 80 ? 'emerald' : lb.score >= 50 ? 'amber' : 'rose'}>{lb.score}/100</ToneBadge>
                </span>
              </li>
            ))}
          </ul>
        </AnalyticsCard>
      )}

      {/* OCR transcription — collapsed at the very bottom */}
      {(ocrBlocks.length > 0 || scan.ocr?.text) && (
        <AnalyticsCard title="OCR Transcription" subtitle="Raw text read from the label — expand to inspect">
          {ocrBlocks.length > 0 && (
            <div className="space-y-2">
              {ocrBlocks.map((block, i) => (
                <details key={i} className="group">
                  <summary className="flex cursor-pointer select-none flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 py-2 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="min-w-0">Image {i + 1} — {block.position} ({block.text.length} chars)</span>
                    {block.languages.length > 0 && <span className="ml-1 shrink-0 text-slate-400">[{block.languages.join(', ')}]</span>}
                    <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="mt-2 break-words rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-500 dark:bg-slate-950/50 dark:text-slate-400">
                    {block.text}
                  </p>
                </details>
              ))}
            </div>
          )}
          {scan.ocr?.text && (
            <details className="group mt-2">
              <summary className="flex cursor-pointer select-none items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 py-2 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
                <Barcode className="h-3.5 w-3.5 text-slate-400" />
                {t('extracted_text')} ({scan.ocr.text.length} chars)
                <ChevronDown className="ml-auto h-3.5 w-3.5 text-slate-400 transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-2 break-words rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-500 dark:bg-slate-950/50 dark:text-slate-400">
                {scan.ocr.text}
              </p>
            </details>
          )}
        </AnalyticsCard>
      )}

      {/* Analysis footer */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-slate-200/80 bg-slate-50/60 px-4 py-2.5 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
        <span className="flex items-center gap-1.5 font-semibold text-slate-600 dark:text-slate-300">
          <Bot className="h-3.5 w-3.5 text-brand-500" /> Analysis
        </span>
        <span className="font-medium">{analysis}</span>
      </div>

      {/* Evidence modal */}
      <EvidenceModal scan={scan} imageIndex={evidenceIdx} title={evidenceTitle} onClose={() => setEvidenceIdx(null)} />
    </div>
  )
}