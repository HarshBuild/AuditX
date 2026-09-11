import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { AlertTriangle, Bot, CheckCircle2, Download, FileText, Languages, Loader2, MessageSquareText, MinusCircle, Send, Tag, XCircle, Clock, Hash, Eye } from 'lucide-react'
import AnalyticsCard from '../dashboard/AnalyticsCard'
import Button from '../ui/Button'
import { ToneBadge } from '../ui/Badge'
import { useToast } from '../ui/Toast'
import { translate, SUPPORTED_LANGUAGES } from '../../i18n/report'
import { downloadInspectionPdf } from '../../lib/pdf'
import { localAssistantAnswer } from '../../lib/localAssistant'
import { askGroqAssistant } from '../../lib/groqAssistant'
import { CONFIG } from '../../lib/config'
import { functions } from '../../lib/firebase'
import { riskBand, riskTone } from '../../lib/risk'
import { formatDateTime } from '../../utils/format'
import type { DetectedSummary, EvidenceLink, ExtractedDeclarations, RuleCheck, ScanContext, ScanRow, StatusCounts } from '../../lib/types2'

function RuleStatusBadge({ status }: { status: string }) {
  const tone =
    status === 'PASS' ? 'emerald'
    : status === 'WARNING' || status === 'NOT_DETECTED' ? 'amber'
    : status === 'FAIL' ? 'rose'
    : status === 'REQUIRES_PHYSICAL_INSPECTION' ? 'cyan'
    : 'slate'
  return <ToneBadge tone={tone as 'emerald' | 'amber' | 'rose' | 'cyan' | 'slate'}>{status}</ToneBadge>
}

const VERIF_TONE: Record<string, 'emerald' | 'amber' | 'rose' | 'cyan' | 'slate'> = {
  IMAGE_VERIFIABLE: 'emerald',
  DATABASE: 'cyan',
  PHYSICAL_INSPECTION: 'amber',
  NOT_VERIFIABLE: 'slate',
}

function VerificationBadge({ vt, className }: { vt?: string; className?: string }) {
  if (!vt) return null
  return (
    <ToneBadge tone={VERIF_TONE[vt] ?? 'slate'} className={className}>
      {vt.replace(/_/g, ' ').toLowerCase()}
    </ToneBadge>
  )
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

const TONE_TEXT: Record<string, string> = {
  emerald: 'text-emerald-500 dark:text-emerald-400',
  amber: 'text-amber-500 dark:text-amber-400',
  rose: 'text-rose-500 dark:text-rose-400',
  cyan: 'text-cyan-500 dark:text-cyan-400',
  slate: 'text-slate-400 dark:text-slate-500',
}

function SummaryChip({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: 'emerald' | 'amber' | 'rose' | 'cyan' | 'slate' }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/40">
      <span className={TONE_TEXT[tone]}>{icon}</span>
      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</span>
      <span className={`ml-auto text-sm font-extrabold ${TONE_TEXT[tone]}`}>{value}</span>
    </div>
  )
}

function ComplianceSummary({ d, counts }: { d: DetectedSummary | undefined; counts?: StatusCounts }) {
  const c = counts
  if (!d && !c) return null
  const chips = c
    ? [
        { icon: <CheckCircle2 className="h-4 w-4" />, label: 'Passed', value: c.passed, tone: 'emerald' as const },
        { icon: <XCircle className="h-4 w-4" />, label: 'Failed', value: c.failed, tone: 'rose' as const },
        { icon: <AlertTriangle className="h-4 w-4" />, label: 'Warnings', value: c.warnings, tone: 'amber' as const },
        { icon: <Eye className="h-4 w-4" />, label: 'Not detected', value: c.not_detected, tone: 'amber' as const },
        { icon: <MinusCircle className="h-4 w-4" />, label: 'Not verifiable', value: c.not_verifiable, tone: 'slate' as const },
        { icon: <AlertTriangle className="h-4 w-4" />, label: 'Phys. inspection', value: c.requires_physical_inspection, tone: 'cyan' as const },
        { icon: <AlertTriangle className="h-4 w-4" />, label: 'Uncertain', value: c.uncertain, tone: 'amber' as const },
      ]
    : d
      ? [
          { icon: <CheckCircle2 className="h-4 w-4" />, label: 'Passed', value: d.passed, tone: 'emerald' as const },
          { icon: <XCircle className="h-4 w-4" />, label: 'Failed', value: d.failed, tone: 'rose' as const },
          { icon: <AlertTriangle className="h-4 w-4" />, label: 'Warnings', value: d.warnings, tone: 'amber' as const },
          { icon: <MinusCircle className="h-4 w-4" />, label: 'Not verifiable', value: d.not_verifiable, tone: 'slate' as const },
          { icon: <XCircle className="h-4 w-4" />, label: 'Missing', value: d.missing, tone: 'rose' as const },
          { icon: <AlertTriangle className="h-4 w-4" />, label: 'Uncertain', value: d.uncertain, tone: 'amber' as const },
        ]
      : []
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
      {chips.map((c, i) => (
        <SummaryChip key={i} icon={c.icon} label={c.label} value={c.value} tone={c.tone} />
      ))}
    </div>
  )
}

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

function ConfidenceBar({ confidence }: { confidence: string | null }) {
  const pct = confidence ? CONF_PCT[confidence] ?? 0 : 0
  if (!confidence) return null
  return (
    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
      <div
        className={`h-full rounded-full ${CONF_BAR[confidence]}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function GridDeclarations({ ex, uncertain, fields }: { ex: ExtractedDeclarations | null | undefined; uncertain: string[]; fields?: Record<string, { value: string | null; confidence: 'high' | 'medium' | 'low' | null; source_image: number | null }> }) {
  if (!ex && uncertain.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-400">No extracted declarations for this scan.</p>
  }
  if (!ex) return <p className="py-6 text-center text-sm text-slate-400">No extracted declarations for this scan.</p>
  const detectedCount = DECLARATION_LABELS.filter((d) => {
    const value = ex[d.key] as string | null | undefined
    const isUncertain = uncertain.includes(d.key)
    return value || isUncertain
  }).length
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span className="font-semibold">{detectedCount}/{DECLARATION_LABELS.length} declarations read off the label</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> read</span>
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> verify</span>
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> missing</span>
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {DECLARATION_LABELS.map((d) => {
        const value = ex[d.key] as string | null | undefined
        const isUncertain = uncertain.includes(d.key)
        const missing = !value && !isUncertain
        const fieldData = fields?.[d.key]
        const confidence = fieldData?.confidence ?? null
        const sourceImg = fieldData?.source_image ?? null
        const needsReview = confidence === 'low' || isUncertain
        return (
          <div key={d.key} className={`rounded-xl border p-3 ${needsReview ? 'border-amber-200 bg-amber-50/50 dark:border-amber-500/20 dark:bg-amber-500/5' : missing ? 'border-rose-200 bg-rose-50/50 dark:border-rose-500/20 dark:bg-rose-500/5' : 'border-slate-100 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-950/40'}`}>
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{d.label}</p>
              <div className="flex items-center gap-1">
                {confidence && (
                  <span className={`text-[10px] font-bold ${confidence === 'high' ? 'text-emerald-500' : confidence === 'medium' ? 'text-amber-500' : 'text-rose-500'}`}>
                    {confidence === 'high' ? 'HIGH' : confidence === 'medium' ? 'MED' : 'LOW'}
                  </span>
                )}
                {sourceImg != null && (
                  <span className="text-[10px] text-slate-400">Img {sourceImg + 1}</span>
                )}
              </div>
            </div>
            {value ? (
              <p className={`mt-1 text-sm font-medium ${needsReview ? 'text-amber-700 dark:text-amber-300' : 'text-slate-700 dark:text-slate-200'}`}>{value}</p>
            ) : isUncertain ? (
              <p className="mt-1 text-sm font-semibold text-amber-600 dark:text-amber-400">Uncertain — verify manually</p>
            ) : (
              <p className="mt-1 text-sm font-semibold text-rose-500 dark:text-rose-400">Not detected</p>
            )}
            <ConfidenceBar confidence={confidence} />
            {needsReview && value && (
              <p className="mt-1 flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                <Eye className="h-3 w-3" /> REQUIRES HUMAN VERIFICATION
              </p>
            )}
          </div>
        )
      })}
      </div>
    </div>
  )
}

function RuleCard({ r }: { r: RuleCheck }) {
  const border =
    r.status === 'FAIL' ? 'border-rose-200 bg-rose-50/60 dark:border-rose-500/20'
    : r.status === 'WARNING' || r.status === 'NOT_DETECTED' ? 'border-amber-200 bg-amber-50/60 dark:border-amber-500/20'
    : r.status === 'REQUIRES_PHYSICAL_INSPECTION' ? 'border-cyan-200 bg-cyan-50/40 dark:border-cyan-500/20'
    : 'border-slate-100 bg-slate-50/60 dark:border-slate-800'
  const desc = r.requirement || r.statement || r.field
  const shown = r.detected_value !== undefined ? r.detected_value : r.extracted_text
  const why = r.reason || r.issue
  return (
    <div className={`rounded-xl border p-3 dark:bg-slate-950/40 ${border}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          <span className="font-mono text-brand-600 dark:text-brand-400">{r.rule_id}</span> · {r.field}
        </p>
        <RuleStatusBadge status={r.status} />
      </div>
      {desc && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{desc}</p>}
      {shown != null && shown !== '' && <p className="mt-1.5 text-xs italic text-slate-600 dark:text-slate-300">“{shown}”</p>}
      {why && (
        <p className={`mt-1 text-xs font-medium ${r.status === 'FAIL' || r.status === 'WARNING' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>
          {why}
        </p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <VerificationBadge vt={r.verification_type} />
        {r.status === 'FAIL' && (
          <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400">
            <Eye className="h-3 w-3" /> REQUIRES HUMAN VERIFICATION
          </span>
        )}
      </div>
    </div>
  )
}

function EvidenceChain({ chain }: { chain?: EvidenceLink[] }) {
  if (!chain || chain.length === 0) return null
  return (
    <AnalyticsCard title="Evidence Chain" subtitle="Image → OCR → field → rule → status">
      <div className="space-y-2">
        {chain.map((e, i) => (
          <div key={i} className="rounded-lg border border-slate-100 bg-slate-50/60 p-2.5 dark:border-slate-800 dark:bg-slate-950/40">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                <span className="font-mono text-brand-600 dark:text-brand-400">{e.rule_id}</span> · {e.requirement}
              </p>
              <div className="flex items-center gap-1.5">
                {e.source_image != null && (
                  <span className="text-[10px] text-slate-400">Img {e.source_image + 1}</span>
                )}
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

const SCORE_TONE_BG: Record<string, { track: string; stroke: string; text: string; badge: 'emerald' | 'amber' | 'rose' }> = {
  high: { track: 'text-emerald-200', stroke: 'text-emerald-500', text: 'text-emerald-500', badge: 'emerald' },
  mid: { track: 'text-amber-200', stroke: 'text-amber-500', text: 'text-amber-500', badge: 'amber' },
  low: { track: 'text-rose-200', stroke: 'text-rose-500', text: 'text-rose-500', badge: 'rose' },
}

/** Big score gauge + verdict banner at the top of the report. */
function ScoreHero({ scan }: { scan: ScanRow }) {
  const score = Math.max(0, Math.min(100, scan.overall_score ?? 0))
  const risk = scan.risk_score ?? 100 - score
  const band = riskBand(risk)
  const c = scan.counts ?? {
    passed: 0, failed: 0, warnings: 0, not_detected: 0,
    not_verifiable: 0, requires_physical_inspection: 0, not_applicable: 0, uncertain: 0,
  }
  const tone = score >= 80 ? SCORE_TONE_BG.high : score >= 50 ? SCORE_TONE_BG.mid : SCORE_TONE_BG.low
  const R = 56
  const CIRC = 2 * Math.PI * R
  const frac = score / 100
  const failed = c.failed ?? 0
  const warnings = (c.warnings ?? 0) + (c.not_detected ?? 0) + (c.uncertain ?? 0)
  const label = scan.labels ?? []
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="grid grid-cols-1 gap-0 lg:grid-cols-[auto_1fr_auto]">
        {/* Score ring */}
        <div className="flex items-center justify-center gap-5 p-6 lg:border-r lg:border-slate-100 lg:dark:border-slate-800">
          <div className="relative h-36 w-36">
            <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
              <circle cx="64" cy="64" r={R} fill="none" strokeWidth="11" className={`stroke-current ${tone.track}`} />
              <circle
                cx="64" cy="64" r={R} fill="none" strokeWidth="11"
                strokeLinecap="round" strokeDasharray={`${CIRC}`} strokeDashoffset={`${CIRC * (1 - frac)}`}
                className={`stroke-current ${tone.stroke}`}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-3xl font-extrabold ${tone.text}`}>{score}</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">/ 100</span>
            </div>
          </div>
          <div className="flex flex-col items-start gap-1.5">
            <ToneBadge tone={tone.badge}>{scan.verdict ?? (score >= 80 ? 'COMPLIANT' : score >= 50 ? 'PARTIALLY COMPLIANT' : 'NON-COMPLIANT')}</ToneBadge>
            <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              Risk: <ToneBadge tone={riskTone(band)}>{band}</ToneBadge>
            </span>
            <span className="text-xs text-slate-400">Compliance score</span>
          </div>
        </div>

        {/* Product + summary */}
        <div className="flex flex-col gap-3 p-6">
          <div>
            <h2 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">{scan.product_name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              {scan.manufacturer && <span className="font-semibold text-slate-600 dark:text-slate-300">{scan.manufacturer}</span>}
              {scan.barcode && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-slate-800">EAN {scan.barcode}</span>}
              {label.length > 0 && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] dark:bg-slate-800">{label.length} label(s)</span>}
            </div>
          </div>
          {scan.summary && (
            <p className="max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">{scan.summary}</p>
          )}
          <div className="mt-auto flex flex-wrap items-center gap-4 pt-2">
            <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <CheckCircle2 className={`h-4 w-4 ${tone.text}`} /> <b className="text-slate-700 dark:text-slate-200">{c.passed ?? 0}</b> passed
            </span>
            <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <XCircle className="h-4 w-4 text-rose-500" /> <b className="text-slate-700 dark:text-slate-200">{failed}</b> failed
            </span>
            <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <AlertTriangle className="h-4 w-4 text-amber-500" /> <b className="text-slate-700 dark:text-slate-200">{warnings}</b> need review
            </span>
          </div>
        </div>

        {/* Key declarations snapshot */}
        <div className="grid grid-cols-2 gap-2 border-t border-slate-200/80 p-6 sm:grid-cols-3 lg:w-80 lg:border-l lg:border-t-0 dark:border-slate-800">
          <SnapshotItem
            label="MRP"
            value={(scan.extractions?.mrp ?? '').replace(/^mrp\.?\s*/i, '') || '—'}
            ok={Boolean(scan.extractions?.mrp)}
          />
          <SnapshotItem
            label="Net qty"
            value={(scan.extractions?.net_quantity ?? '').replace(/^net\s*(?:wt\.?|weight|qty\.?|quantity)?\s*[:.]?\s*/i, '') || '—'}
            ok={Boolean(scan.extractions?.net_quantity)}
          />
          <SnapshotItem
            label="Mfg"
            value={scan.extractions?.mfg_date ?? '—'}
            ok={Boolean(scan.extractions?.mfg_date)}
          />
          <SnapshotItem
            label="Best before"
            value={scan.extractions?.best_before ?? '—'}
            ok={Boolean(scan.extractions?.best_before)}
          />
          <SnapshotItem
            label="Mr / Packer"
            value={scan.extractions?.manufacturer ?? scan.extractions?.packer ?? '—'}
            ok={Boolean(scan.extractions?.manufacturer || scan.extractions?.packer)}
          />
          <SnapshotItem
            label="Customer care"
            value={scan.extractions?.consumer_care ?? '—'}
            ok={Boolean(scan.extractions?.consumer_care)}
          />
        </div>
      </div>
    </div>
  )
}

function SnapshotItem({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-2.5 dark:border-slate-800 dark:bg-slate-950/40">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 truncate text-xs font-semibold ${ok ? 'text-slate-700 dark:text-slate-200' : 'text-slate-300 dark:text-slate-500'}`} title={value}>
        {value}
      </p>
    </div>
  )
}

export default function InspectionReport({ scan }: { scan: ScanRow }) {
  const { toast } = useToast()
  const [lang, setLang] = useState('en')
  const [exporting, setExporting] = useState(false)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)
  const [answerLocal, setAnswerLocal] = useState(false)
  const [answerGroq, setAnswerGroq] = useState(false)

  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key)
  const risk = scan.risk_score ?? 100 - scan.overall_score
  const band = riskBand(risk)
  const hasLowConfidence = (scan.rules ?? []).some((r) => r.status === 'FAIL')
  const ocrBlocks = scan.ocr_blocks ?? []

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
    setAnswerLocal(false)
    setAnswerGroq(false)
    try {
      if (CONFIG.GROQ_API_KEY) {
        const groq = await askGroqAssistant(scan, q, lang)
        if (groq) {
          setAnswer(groq)
          setAnswerGroq(true)
          return
        }
      }
      const fn = httpsCallable<{ scanId: string; question: string; lang: string }, { answer: string }>(
        functions,
        'complianceAssistant',
      )
      const res = await fn({ scanId: scan.id, question: q, lang })
      setAnswer(res.data.answer)
    } catch (e) {
      const fallback = localAssistantAnswer(scan, q)
      if (fallback) {
        setAnswer(fallback)
        setAnswerLocal(true)
      } else {
        toast('error', 'Assistant unavailable', (e as Error).message ?? 'Cloud Functions may not be deployed yet.')
      }
    } finally {
      setAsking(false)
    }
  }

  const score2 = Math.max(0, Math.min(100, scan.overall_score ?? 0))
  const failCount = (scan.rules ?? []).filter((r) => r.status === 'FAIL').length
  const warnCount = (scan.rules ?? []).filter((r) => r.status === 'WARNING').length
  const failRules = (scan.rules ?? []).filter((r) => r.status === 'FAIL').slice(0, 4)

  const verdictColor = score2 >= 80 ? 'emerald' : score2 >= 50 ? 'amber' : 'rose'
  const verdictBg = { emerald: 'bg-emerald-50 dark:bg-emerald-500/10', amber: 'bg-amber-50 dark:bg-amber-500/10', rose: 'bg-rose-50 dark:bg-rose-500/10' }[verdictColor]
  const verdictBorder = { emerald: 'border-emerald-200 dark:border-emerald-500/20', amber: 'border-amber-200 dark:border-amber-500/20', rose: 'border-rose-200 dark:border-rose-500/20' }[verdictColor]
  const verdictText = { emerald: 'text-emerald-800 dark:text-emerald-300', amber: 'text-amber-800 dark:text-amber-300', rose: 'text-rose-800 dark:text-rose-300' }[verdictColor]
  const verdictHeading = score2 >= 80 ? 'This product is compliant' : score2 >= 50 ? 'This product partially meets Legal Metrology requirements' : 'This product does NOT meet Legal Metrology requirements'
  const verdictBody = failCount === 0 && warnCount === 0
    ? 'All mandatory label declarations are present and correctly displayed. No corrective action is needed.'
    : `${failCount > 0 ? `${failCount} mandatory declaration${failCount > 1 ? 's are' : ' is'} missing or incorrect.` : ''}${warnCount > 0 ? ` ${warnCount} field${warnCount > 1 ? 's need' : ' needs'} a closer look.` : ''} Scan the rules table below for details.`

  return (
    <div className={`space-y-4`}>
      {/* Inspection metadata header */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/80 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <Hash className="h-3.5 w-3.5" /> <span className="font-mono font-semibold">{scan.id.slice(0, 12)}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <Clock className="h-3.5 w-3.5" /> <span className="font-medium">{formatDateTime(scan.created_at)}</span>
        </div>
        {scan.language && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <Languages className="h-3.5 w-3.5" /> <span className="font-semibold uppercase">{scan.language}</span>
          </div>
        )}
        {hasLowConfidence && (
          <span className="ml-auto flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
            <Eye className="h-3 w-3" /> HUMAN REVIEW RECOMMENDED
          </span>
        )}
      </div>

      {/* Score hero + verdict banner */}
      <ScoreHero scan={scan} />

      {/* At-a-glance verdict explanation */}
      <div className={`rounded-2xl border ${verdictBorder} ${verdictBg} p-4`}>
        <p className={`text-sm font-bold ${verdictText}`}>{verdictHeading}</p>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{verdictBody}</p>
        {failRules.length > 0 && (
          <ul className="mt-2 space-y-1">
            {failRules.map((r, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
                {r.detected_value ? <span><b>{r.rule_id}</b>: found "{r.detected_value}" but expected something different</span> : <span><b>{r.rule_id}</b>: {r.reason || 'missing from the label'}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Language + export bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
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
          <span className="text-xs text-slate-400">{t('ocr_languages')}</span>
        </div>
        <Button variant="secondary" icon={exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} onClick={() => void exportPdf()} disabled={exporting}>
          {exporting ? t('downloading') : t('export_pdf')}
        </Button>
      </div>

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
            {scan.language_note && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                <span className="font-bold">{t('language_note')}: </span>
                {scan.language_note}
              </div>
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
              <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm leading-relaxed text-slate-600 dark:bg-slate-950/50 dark:text-slate-300">
                {answerGroq && <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-bold text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300">GROQ AI</span>}
                {answerLocal && <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">LOCAL</span>}
                {answer}
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

      {/* Compliance summary */}
      <ComplianceSummary d={scan.detected} counts={scan.counts} />

      {/* Context badges */}
      <ContextBadges ctx={scan.context} />

      {/* Extracted declarations */}
      <AnalyticsCard title="Extracted Declarations" subtitle="Values read off the label">
        <GridDeclarations ex={scan.extractions} uncertain={scan.uncertain ?? []} fields={scan.extraction_fields} />
      </AnalyticsCard>

      {/* Rule checks */}
      <AnalyticsCard title={t('rule_checks')} subtitle="Legal Metrology · Packaged Commodities Rules 2011">
        {(scan.rules ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">{t('no_rules')}</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {(scan.rules ?? []).map((r, i) => (
              <RuleCard key={i} r={r} />
            ))}
          </div>
        )}
      </AnalyticsCard>

      {/* Evidence chain */}
      <EvidenceChain chain={scan.evidence_chain} />

      {/* OCR blocks per image */}
      {ocrBlocks.length > 0 && (
        <AnalyticsCard title="OCR Transcription" subtitle="Per-image text read by the vision model">
          <div className="space-y-3">
            {ocrBlocks.map((block, i) => (
              <details key={i} className="group">
                <summary className="cursor-pointer select-none text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400">
                  Image {i + 1} — {block.position} ({block.text.length} chars)
                  {block.languages.length > 0 && (
                    <span className="ml-2 text-slate-400">[{block.languages.join(', ')}]</span>
                  )}
                </summary>
                <p className="mt-2 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-500 dark:bg-slate-950/50 dark:text-slate-400">
                  {block.text}
                </p>
              </details>
            ))}
          </div>
        </AnalyticsCard>
      )}

      {/* Multi-label detection */}
      <AnalyticsCard title={t('labels_detected')} subtitle="Multi-label detection">
        {(scan.labels ?? []).length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">{t('no_labels')}</p>
        ) : (
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
        )}
        {(scan.ocr?.languages ?? []).length > 0 && (
          <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
            <FileText className="h-3.5 w-3.5" /> {t('ocr_languages')}:{' '}
            {(scan.ocr?.languages ?? []).map((l) => (
              <span key={l} className="rounded-full bg-brand-50 px-2 py-0.5 font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">{l}</span>
            ))}
          </p>
        )}
        {scan.ocr?.text && (
          <details className="group mt-3">
            <summary className="cursor-pointer select-none text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400">
              {t('extracted_text')} ({scan.ocr.text.length} chars)
            </summary>
            <p className="mt-2 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-500 dark:bg-slate-950/50 dark:text-slate-400">
              {scan.ocr.text}
            </p>
          </details>
        )}
      </AnalyticsCard>
    </div>
  )
}