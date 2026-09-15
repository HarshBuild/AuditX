import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
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
  type Finding,
  type InspectionDoc,
} from '../../lib/inspection'
import { downloadInspectionReport } from '../../lib/pdf'
import { formatDateTime, cn } from '../../utils/format'

const statusTone = (s: InspectionDoc['status']) =>
  s === 'compliant' ? 'emerald' : s === 'needs_review' ? 'amber' : s === 'violation' ? 'rose' : 'rose'

const findingTone = (f: Finding) =>
  f.status === 'compliant' ? 'emerald' : f.status === 'na' ? 'slate' : f.status === 'needs_review' ? 'amber' : 'rose'

function ScoreRing({ score, status }: { score: number; status: InspectionDoc['status'] }) {
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
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{status}</div>
      </div>
    </div>
  )
}

interface DetailRow {
  key: string
  label: string
  value: string
}

export default function ScanResultPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()

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
    const rows: Array<[string, string]> = [
      ['commodity_name', 'Product name'],
      ['brand', 'Brand'],
      ['manufacturer', 'Manufacturer / packer / importer'],
      ['net_quantity', 'Net quantity'],
      ['mrp', 'MRP'],
      ['batch_no', 'Batch / lot number'],
      ['mfg_date', 'Manufacturing date'],
      ['expiry_date', 'Expiry / best-before date'],
      ['ingredients_text', 'Ingredients'],
      ['allergen_info', 'Allergen information'],
      ['required_declarations', 'Required declarations'],
      ['warnings', 'Warnings'],
      ['certification_details', 'Certification / standard marking'],
      ['country_of_origin', 'Country of origin'],
      ['storage_conditions', 'Storage conditions'],
      ['customer_care_details', 'Customer care'],
      ['contact_info', 'Contact information'],
      ['imported_manufacturer_detail', 'Importer detail'],
    ]
    return rows
      .map(([key, label]) => ({ key, label, value: f[key] ?? '' }))
      .filter((r) => r.value)
  }, [doc])

  const onRetry = async () => {
    if (!id) return
    setBusy(true)
    try {
      const res = await retryAnalysis(id)
      if (!res.ok) throw new Error(res.error ?? 'Retry failed.')
      toast('info', 'Analysis running', 'Refreshing the report in a moment…')
      await load()
    } catch (e) {
      toast('error', 'Retry failed', (e as Error).message)
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
      toast('success', 'Changes verified', 'The label-change review has been marked as verified.')
    } catch (e) {
      toast('error', 'Could not verify', (e as Error).message)
    } finally {
      setVerifying(false)
    }
  }

  const onSaveRemarks = async () => {
    if (!id) return
    setSavingRemarks(true)
    try {
      await saveRemarks(id, remarks)
      toast('success', 'Remarks saved', '')
    } catch (e) {
      toast('error', 'Could not save remarks', (e as Error).message)
    } finally {
      setSavingRemarks(false)
    }
  }

  const onDownloadPdf = async () => {
    if (!doc) return
    try {
      await downloadInspectionReport(doc)
      toast('success', 'Report downloaded', '')
    } catch (e) {
      toast('error', 'Could not generate PDF', (e as Error).message)
    }
  }

  /* ------------------------------------------------------------ screens */
  if (loading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-500" />
          <p className="mt-3 text-sm text-ink-text-soft dark:text-navy-300">Loading the inspection…</p>
        </div>
      </div>
    )
  }

  if (notFound || !doc) {
    return (
      <div className="grid min-h-[60vh] place-items-center px-4">
        <div className="max-w-sm text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-rose-500" />
          <h1 className="mt-4 text-lg font-bold text-ink-text dark:text-white">Inspection not found</h1>
          <p className="mt-1 text-sm text-ink-text-soft dark:text-navy-300">
            This inspection may no longer exist or you do not have access to it.
          </p>
          <Button className="mt-5" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/scan-history')}>
            Back to history
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
          {failed ? 'The analysis could not read this label' : 'Analyzing the label…'}
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-text-soft dark:text-navy-300">
          {failed
            ? (doc.ocr_error ?? 'An unexpected error stopped the analysis.')
            : 'Reading the photos and checking the label against the applicable declarations. This usually takes a few seconds.'}
        </p>
        <p className="mt-3 text-xs text-slate-400">
          Scanned <span className="font-medium text-slate-500 dark:text-navy-300">{formatDateTime(doc.created_at)}</span>
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          {failed && (
            <Button loading={busy} icon={<RefreshCw className="h-4 w-4" />} onClick={() => void onRetry()}>
              Retry analysis
            </Button>
          )}
          <Button variant="outline" icon={<ScanLine className="h-4 w-4" />} onClick={() => navigate('/scan-product')}>
            New scan
          </Button>
        </div>
      </div>
    )
  }

  /* ------------------------------------------------------------ ready  */
  const score = doc.compliance_score ?? doc.overall_score ?? 0
  const status = doc.status
  const verified = doc.changes_verified ?? false

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate(-1)}>
            Back
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-ink-text dark:text-white">
                {doc.product_name || 'Product label inspection'}
              </h1>
              <ToneBadge tone={statusTone(status)}>{status}</ToneBadge>
            </div>
            <p className="text-xs text-ink-text-soft dark:text-navy-300">
              {formatDateTime(doc.analyzed_at ?? doc.created_at)} · {doc.ocr_language ?? 'en'} · engine {doc.ocr_provider ?? 'unknown'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {doc.photo_paths && doc.photo_paths.length > 0 && (
            <Button variant="outline" size="sm" icon={<FileText className="h-4 w-4" />} onClick={() => void onDownloadPdf()}>
              PDF
            </Button>
          )}
          <Button variant="outline" size="sm" icon={<ScanLine className="h-4 w-4" />} onClick={() => navigate('/scan-product')}>
            New scan
          </Button>
        </div>
      </div>

      {/* Hero + score */}
      <section className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <div className="flex flex-col items-center justify-center rounded-2xl border border-line bg-white/60 p-4 dark:border-white/10 dark:bg-navy-900/60">
          <ScoreRing score={score} status={status} />
          <p className="mt-3 text-center text-xs text-ink-text-soft dark:text-navy-300">
            {doc.product_name
              ? `${findings.length ? `${findings.length} checks · ` : ''}${doc.category === 'non_edible' ? 'non-edible' : 'edible'}`
              : 'Label inspection'}
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-white/60 p-5 dark:border-white/10 dark:bg-navy-900/60">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">Summary</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-text dark:text-slate-100">
            {doc.summary ?? 'The report is ready.'}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-xl bg-emerald-500/10 p-3 text-center">
              <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{counts.passed}</div>
              <div className="text-[10px] uppercase tracking-wide text-ink-text-soft dark:text-navy-300">Passed</div>
            </div>
            <div className="rounded-xl bg-amber-500/10 p-3 text-center">
              <div className="text-lg font-bold text-amber-600 dark:text-amber-400">{counts.review}</div>
              <div className="text-[10px] uppercase tracking-wide text-ink-text-soft dark:text-navy-300">Review</div>
            </div>
            <div className="rounded-xl bg-rose-500/10 p-3 text-center">
              <div className="text-lg font-bold text-rose-600 dark:text-rose-400">{counts.failed}</div>
              <div className="text-[10px] uppercase tracking-wide text-ink-text-soft dark:text-navy-300">Failed</div>
            </div>
            <div className="rounded-xl bg-rose-500/10 p-3 text-center">
              <div className="text-lg font-bold text-rose-700 dark:text-rose-500">{counts.criticalFailed}</div>
              <div className="text-[10px] uppercase tracking-wide text-ink-text-soft dark:text-navy-300">Critical</div>
            </div>
            <div className="rounded-xl bg-slate-500/10 p-3 text-center">
              <div className="text-lg font-bold text-slate-500 dark:text-slate-300">{counts.na}</div>
              <div className="text-[10px] uppercase tracking-wide text-ink-text-soft dark:text-navy-300">N/A</div>
            </div>
          </div>
        </div>
      </section>

      {/* Compliance breakdown */}
      <section className="mt-6 rounded-2xl border border-line bg-white/60 p-5 dark:border-white/10 dark:bg-navy-900/60">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">
          Compliance breakdown
        </h2>
        <p className="mb-4 text-xs text-slate-400">Applicable checks run deterministically on the extracted label text.</p>
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
                  <ToneBadge tone={findingTone(f)}>{f.status === 'critical_failed' ? 'critical' : f.status}</ToneBadge>
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
          Product information
        </h2>
        <p className="mb-4 text-xs text-slate-400">Each value traces back to the photo and OCR block that produced it.</p>
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
          {details.length === 0 && <p className="text-sm text-slate-400">No label fields could be read confidently.</p>}
        </div>
      </section>

      {/* Price & quantity */}
      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-white/60 p-4 dark:border-white/10 dark:bg-navy-900/60">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">MRP</p>
          <p className="mt-1 text-lg font-bold text-ink-text dark:text-white">{doc.ocr_fields?.mrp || '—'}</p>
        </div>
        <div className="rounded-2xl border border-line bg-white/60 p-4 dark:border-white/10 dark:bg-navy-900/60">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">Net quantity</p>
          <p className="mt-1 text-lg font-bold text-ink-text dark:text-white">{doc.ocr_fields?.net_quantity || '—'}</p>
        </div>
        <div className="rounded-2xl border border-line bg-white/60 p-4 dark:border-white/10 dark:bg-navy-900/60">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">Batch / mfg / expiry</p>
          <p className="mt-1 text-sm font-semibold text-ink-text dark:text-slate-100">
            {doc.ocr_fields?.batch_no || '—'} · {doc.ocr_fields?.mfg_date || '—'} · {doc.ocr_fields?.expiry_date || '—'}
          </p>
        </div>
      </section>

      {/* Change detection */}
      <section className="mt-6 rounded-2xl border border-line bg-white/60 p-5 dark:border-white/10 dark:bg-navy-900/60">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">
            Change detection {doc.match_confidence ? `· ${doc.match_confidence.replace('_', ' ')}` : ''}
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
              {verified ? 'Verified' : 'Mark as verified'}
            </Button>
          )}
        </div>
        {doc.match_confidence ? (
          <p className="mt-1 text-xs text-slate-400">
            Compared against <button className="text-brand-500 underline" onClick={() => doc.previous_scan_id && navigate(`/scan-result/${doc.previous_scan_id}`)}>the previous scan</button> of the same product.
          </p>
        ) : (
          <p className="mt-1 text-xs text-slate-400">No previous scan of this product was found — this is the baseline reading.</p>
        )}
        {(doc.changes ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-ink-text-soft dark:text-navy-300">No label declarations changed since the previous scan.</p>
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
          <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">Conflicting readings</h2>
          <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-300/80">
            Different photos showed different values. Both are kept for human review — nothing was overwritten.
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
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">Attention needed</h2>
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
                    {f.hint ? <span className="block text-xs text-slate-400">Hint: {f.hint}</span> : null}
                  </span>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* OCR confidence */}
      <section className="mt-6 rounded-2xl border border-line bg-white/60 p-5 dark:border-white/10 dark:bg-navy-900/60">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">OCR confidence</h2>
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
            confidence{' '}
            <span className="font-semibold text-ink-text dark:text-white">
              {doc.ocr_confidence != null ? `${Math.round(doc.ocr_confidence * 100)}%` : '—'}
            </span>
          </span>
          <span className="rounded-lg bg-white px-3 py-1.5 shadow-sm dark:bg-navy-950">
            demo provider{' '}
            <span className={cn('font-semibold', doc.briefing?.assistant_status === 'demo' ? 'text-amber-500' : 'text-emerald-500')}>
              {doc.briefing?.assistant_status === 'demo' ? 'yes' : 'no'}
            </span>
          </span>
          <span className="text-xs text-slate-400">Raw transcript: {String(doc.ocr_text ?? '').length} chars</span>
        </div>
      </section>

      {/* Unclear / low-confidence text */}
      {doc.unclear_text && doc.unclear_text.length > 0 && (
        <section className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-50/60 p-5 dark:border-amber-500/20 dark:bg-amber-950/20">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Low-confidence / unclear text</h2>
          <p className="mt-1 text-xs text-amber-600/70 dark:text-amber-400/60">
            These lines were detected by only one engine or had conflicting readings.
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
          <h2 className="text-sm font-semibold text-ink-text dark:text-slate-100">Assistant briefing</h2>
        </div>
        <p className="mt-3 text-sm text-ink-text dark:text-slate-200">{doc.briefing?.summary ?? doc.summary}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">Key points</p>
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
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">Recommendations</p>
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
            Evidence photos ({photos.length})
          </h2>
          <p className="mb-4 text-xs text-slate-400">Original label photos used for this inspection.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((url, i) =>
              url ? (
                <a key={i} href={url} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-xl border border-line dark:border-white/10">
                  <img src={url} alt={`Evidence ${i + 1}`} className="h-36 w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
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
            Raw extracted text
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
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">Inspector remarks</h2>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <textarea
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-accent-500 dark:border-white/15 dark:bg-navy-950 dark:text-slate-100"
            rows={3}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Add a note for the inspector / audit trail…"
          />
          <Button variant="outline" size="sm" className="sm:self-start" loading={savingRemarks} onClick={() => void onSaveRemarks()}>
            Save
          </Button>
        </div>
      </section>

      {/* Recommendation + disclaimer */}
      <section className="mt-6 rounded-2xl border border-line bg-white/60 p-5 dark:border-white/10 dark:bg-navy-900/60">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-ink-text-soft dark:text-navy-300" />
          <p className="text-xs leading-relaxed text-slate-500 dark:text-navy-300">
            This report is generated from the text visible on the photographs. It is an automated, deterministic summary of the
            label — not a legal certification. Verify anything relied upon against the physical product before acting.
            {doc.briefing?.assistant_status === 'demo' && ' The OCR provider ran in demo mode: values echo the details typed at capture time.'}
          </p>
        </div>
      </section>
    </div>
  )
}