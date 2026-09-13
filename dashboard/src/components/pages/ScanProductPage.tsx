import { useState } from 'react'
import {
  AlertTriangle,
  BadgeCheck,
  Barcode,
  Camera,
  CheckCircle2,
  ChevronDown,
  FileInput,
  FileOutput,
  FileSearch,
  ImagePlus,
  Loader2,
  RefreshCw,
  ScanLine,
  ScanSearch,
  ScanText,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react'
import AnalyticsCard from '../dashboard/AnalyticsCard'
import Button from '../ui/Button'
import CameraCapture from '../ui/CameraCapture'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../lib/auth'
import { PerfRun, fmtMs } from '../../lib/perf'
import { prepareImageFile, loadImageBitmap, runScanAnalysis, attachScanPhotos, MAX_SCAN_IMAGES, type ImageQuality } from '../../lib/scan'
import { detectBarcodeFromFile } from '../../lib/barcode'
import { findProductByBarcode } from '../../lib/db'
import { lookupBarcodeExternal } from '../../lib/services'
import { SUPPORTED_LANGUAGES } from '../../i18n/report'
import { displayProductName } from '../../lib/textnorm'
import InspectionReport from '../inspection/InspectionReport'
import type { ScanRow } from '../../lib/types2'
import type { PanelPrior } from '../../lib/textract/types'

interface PickedImage {
  file: File
  dataUrl: string
  hiResUrl: string
  position: string
  quality?: ImageQuality
}

const POSITIONS = ['front', 'back', 'side', 'other'] as const

/** Compact field styling shared by every input/select on the capture form. */
const fieldCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-shadow focus:outline-none focus:ring-2 focus:ring-accent-500 dark:border-white/15 dark:bg-navy-950 dark:text-slate-100 dark:placeholder:text-slate-500'

export default function ScanProductPage() {
  const { toast } = useToast()
  const { profile } = useAuth()
  const [picked, setPicked] = useState<PickedImage[]>([])
  const [lang, setLang] = useState('en')
  const [productName, setProductName] = useState('')
  const [manufacturer, setManufacturer] = useState('')
  const [barcode, setBarcode] = useState('')
  const [busy, setBusy] = useState(false)
  const [lookingUp, setLookingUp] = useState(false)
  const [productCatalogueHit, setProductCatalogueHit] = useState<string | null>(null)
  const [externalProduct, setExternalProduct] = useState<{ name: string; brand: string; manufacturer: string } | null>(null)
  const [phase, setPhase] = useState<'idle' | 'reading' | 'analyzing'>('idle')
  const [result, setResult] = useState<{ scan: ScanRow; pending: boolean } | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [failKind, setFailKind] = useState<'no-text' | 'other' | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [progressStep, setProgressStep] = useState(0)
  const noTextHint = failKind === 'no-text'

  /**
   * Real processing milestones. Stages advance ONLY when the corresponding
   * pipeline seam is reached — never on a fake countdown or percentage.
   */
  const STAGES = [
    { label: 'Input received', icon: FileInput },
    { label: 'Validating input', icon: ShieldCheck },
    { label: 'Extracting text', icon: FileSearch },
    { label: 'Analyzing data', icon: ScanSearch },
    { label: 'Validating result', icon: BadgeCheck },
    { label: 'Preparing final report', icon: FileOutput },
  ] as const

  const advanceStage = (s: number) => setProgressStep((p) => Math.max(p, s))

  const addFiles = async (files: File[]) => {
    if (!files || files.length === 0) return
    const imageFiles = files.filter((f) => f.type.startsWith('image/'))
    if (imageFiles.length === 0) {
      toast('error', 'Invalid file', 'Please choose JPG, PNG or WEBP images.')
      return
    }
    const space = MAX_SCAN_IMAGES - picked.length
    if (space <= 0) {
      toast('error', 'Limit reached', `You can analyze up to ${MAX_SCAN_IMAGES} photos per inspection.`)
      return
    }
    const slots = imageFiles.slice(0, space)
    setPhase('reading')
    try {
const prepared = await Promise.all(
          slots.map(async (file, i) => {
            const t0 = performance.now()
            const { dataUrl, hiResUrl, quality } = await prepareImageFile(file)
            console.info(`[perf] preprocess · image ${i + 1}/${slots.length} ${fmtMs(performance.now() - t0)} (${file.name})`)
            return { file, dataUrl, hiResUrl, position: i === 0 ? 'front' : i === 1 ? 'back' : 'side', quality }
          }),
        )
      const qualityWarnings = prepared.flatMap((p) => p.quality?.warnings ?? [])
      if (qualityWarnings.length > 0) {
        toast('info', 'Image quality warning', qualityWarnings[0])
      }
      setPicked((prev) => [...prev, ...prepared])
      // Auto-detect barcode from the newest photo and lookup the catalogue.
      if (prepared.length > 0 && !barcode.trim()) {
        const hit = await detectBarcodeFromFile(prepared[0].file)
        if (hit) {
          setBarcode((prev) => prev || hit.rawValue)
          if (hit.status && hit.status !== 'OK') {
            toast(hit.status === 'CONFLICT' ? 'error' : 'info', 'Barcode review',
              hit.status === 'CONFLICT'
                ? 'Multiple different barcodes were decoded — verify before saving.'
                : 'Barcode decoded but the checksum failed — it may be damaged or misread.')
          } else if (hit.checksumValid) {
            toast('success', 'Barcode validated', `${hit.format.replace('_', ' ').toUpperCase()} ${hit.rawValue}`)
          }
        }
      }
    } catch (e) {
      toast('error', 'Image error', (e as Error).message)
    } finally {
      setPhase('idle')
    }
  }

  const handleGallery = (list: FileList | null) => void addFiles(list ? Array.from(list) : [])

/** Programmatic click on the hidden <input type="file"> — used by every upload action. */
const openGallery = () => document.getElementById('scan-label-files')?.click()

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragActive(true)
  }
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
    handleGallery(e.dataTransfer.files)
  }

  const removeAt = (i: number) => setPicked((prev) => prev.filter((_, idx) => idx !== i))

  const lookupCatalogue = async (barcodeValue?: string) => {
    const code = (barcodeValue ?? barcode).trim()
    if (!code) return
    setLookingUp(true)
    setExternalProduct(null)
    try {
      const product = await findProductByBarcode(code)
      if (product) {
        setProductCatalogueHit(product.name)
        if (!productName.trim()) setProductName(product.name)
        if (!manufacturer.trim()) setManufacturer(product.manufacturer)
        toast('success', 'Found in catalogue', `"${product.name}" by ${product.manufacturer || 'unknown'} (MRP ${product.mrp || '—'}).`)
      } else {
        setProductCatalogueHit(null)
        const ext = await lookupBarcodeExternal(code)
        if (ext) {
          setExternalProduct(ext)
          if (!productName.trim()) setProductName(ext.name)
          if (!manufacturer.trim()) setManufacturer(ext.manufacturer)
          toast('info', 'Found in Open Food Facts', `"${ext.name}" by ${ext.brand || ext.manufacturer || 'unknown'}.`)
        } else {
          toast('info', 'Not in catalogue', 'No product registered for this barcode yet.')
        }
      }
    } catch (e) {
      toast('error', 'Lookup failed', (e as Error).message)
    } finally {
      setLookingUp(false)
    }
  }

  const setPosition = (i: number, pos: string) =>
    setPicked((prev) => prev.map((p, idx) => (idx === i ? { ...p, position: pos } : p)))

  /**
   * Pre-scan input validation. Runs BEFORE any AI/OCR work — analysis never
   * starts on invalid input. Friendly, concrete messages only.
   */
  const validateBeforeScan = async (): Promise<{ ok: boolean; message?: string }> => {
    if (picked.length === 0) {
      return { ok: false, message: 'Add at least one label photo to continue.' }
    }
    if (productName.trim().length > 120) {
      return { ok: false, message: 'Product name looks too long — shorten it to 120 characters or less.' }
    }
    if (manufacturer.trim().length > 100) {
      return { ok: false, message: 'Manufacturer name looks too long — shorten it to 100 characters or less.' }
    }
    for (const p of picked) {
      if (!p.file.type.startsWith('image/')) {
        return { ok: false, message: 'One of the selected files is not a supported image.' }
      }
      if (!p.dataUrl || !p.hiResUrl) {
        return { ok: false, message: 'One of the photos failed to load — remove it and add it again.' }
      }
      // Corrupt / non-decodable photo guard: confirm the hi-res copy still
      // decodes to a real bitmap before handing it to the AI pipeline.
      try {
        const bitmap = await loadImageBitmap(p.hiResUrl)
        bitmap.close()
      } catch {
        return { ok: false, message: 'One of the photos could not be read — it may be corrupted. Remove it and try again.' }
      }
    }
    return { ok: true }
  }

  const analyze = async () => {
    if (busy) return
    if (picked.length === 0) {
      toast('error', 'No photos', 'Add at least one label photo to analyze.')
      return
    }
    setBusy(true)
    setPhase('analyzing')
    setResult(null)
    setAnalyzeError(null)
    setFailKind(null)
    setProgressStep(0)
    const perf = new PerfRun('scan')
    perf.mark('start')
    try {
      advanceStage(0)
      advanceStage(1)
      const check = await perf.timed('input-validation', () => validateBeforeScan())
      if (!check.ok) {
        setAnalyzeError(check.message ?? 'Your input could not be used.')
        setFailKind('other')
        toast('error', 'Check your input', check.message)
        return
      }
      advanceStage(2)
      const scan = await runScanAnalysis(
        {
          images: picked.map((p) => p.dataUrl),
          hiResImages: picked.map((p) => p.hiResUrl),
          lang,
          product_name: productName.trim() || undefined,
          manufacturer: manufacturer.trim() || undefined,
          barcode: barcode.trim() || undefined,
          positions: picked.map((p) => p.position as PanelPrior),
        },
        advanceStage,
        perf,
      )
      advanceStage(5)
      setResult(scan)
      perf.mark('result')
      perf.segment('start', 'result', 'analyze-total')
      perf.summary()
      // Best-effort photo persistence (Storage may not be provisioned yet).
      void attachScanPhotos(scan.scan.id, picked.map((p) => p.file)).then((n) => {
        if (n.length > 0 && scan.scan.image_urls) {
          setResult((prev) =>
            prev ? { ...prev, scan: { ...prev.scan, image_urls: n, image_url: n[0] ?? '' } } : prev,
          )
        }
      })
      if (scan.pending) {
        toast('info', 'Analysis queued', 'AI is unavailable right now — scan saved for staff review.')
      } else if (scan.scan.language_note?.includes('Gemini')) {
        toast('success', 'Analyzed with AI', `Google Gemini read the label and scored "${displayProductName(scan.scan.product_name)}" ${scan.scan.overall_score}/100.`)
      } else if (scan.scan.language_note?.includes('on-device')) {
        toast('success', 'Analyzed locally', `Free OCR engine scored "${displayProductName(scan.scan.product_name)}" ${scan.scan.overall_score}/100 — no server needed.`)
      } else {
        toast('success', 'Analysis complete', `"${displayProductName(scan.scan.product_name)}" scored ${scan.scan.overall_score}/100.`)
      }
    } catch (e) {
      const raw = (e as Error)?.message || ''
      if (/no readable text/i.test(raw)) {
        setAnalyzeError('No readable label text could be found in these photos.')
        setFailKind('no-text')
        toast('error', 'No readable text', 'Retake the label with steady hands and even light, then retry.')
      } else {
        setAnalyzeError('Your scan couldn\'t be completed. The label photos were kept so you can try again.')
        setFailKind('other')
        toast('error', 'Scan failed', 'Your scan couldn\'t be completed. Check your connection and try again.')
      }
    } finally {
      setBusy(false)
      setPhase('idle')
    }
  }

  /** Back to the capture form, keeping the photos and fields already entered. */
  const editInput = () => {
    setResult(null)
    setAnalyzeError(null)
    setFailKind(null)
  }

  const reset = () => {
    setPicked([])
    setResult(null)
    setAnalyzeError(null)
    setFailKind(null)
    setProductName('')
    setManufacturer('')
    setBarcode('')
    setProductCatalogueHit(null)
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-2">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-brand-700 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-300">
          <Sparkles className="h-3 w-3" />
          AI-Powered Inspection
        </span>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-100">Scan Product Label</h1>
        <p className="mt-0.5 max-w-2xl text-[13px] leading-snug text-slate-500 sm:mt-1 sm:text-sm dark:text-slate-400">
          Photograph the label front, back and sides — the AI combines every photo into one multi-language inspection.
        </p>
      </div>

      {analyzeError && !result && (
        <AnalyticsCard title="Analysis failed — your photos were kept">
          <div className="flex flex-col gap-3">
            <div className={`flex items-start gap-3 rounded-xl border p-4 ${noTextHint ? 'border-brand-200 bg-brand-50/60 dark:border-brand-500/20 dark:bg-brand-500/5' : 'border-rose-200 bg-rose-50/60 dark:border-rose-500/20 dark:bg-rose-500/5'}`}>
              <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${noTextHint ? 'text-brand-500' : 'text-rose-500'}`} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{analyzeError}</p>
                {noTextHint && (
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Retake the label: hold the camera steady, fill the frame with the declarations block, and make sure the light is even. Then retry.
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} onClick={() => void analyze()} disabled={busy || picked.length === 0}>
                Retry analysis
              </Button>
              <Button variant="outline" icon={<Camera className="h-4 w-4" />} onClick={() => setCameraOpen(true)} disabled={busy}>
                Retake label photo
              </Button>
              <Button variant="outline" onClick={reset}>Clear photos</Button>
            </div>
          </div>
        </AnalyticsCard>
      )}

      {!result && (
        <AnalyticsCard title="Label capture" subtitle={`Up to ${MAX_SCAN_IMAGES} photos · JPG, PNG or WEBP`}>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Photo grid */}
            <div
              className={`relative lg:col-span-2 ${dragActive ? 'rounded-xl outline-2 outline-dashed outline-brand-400' : ''}`}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            >
              <input
                type="file"
                accept="image/*"
                multiple
                id="scan-label-files"
                className="hidden"
                onChange={(e) => {
                  handleGallery(e.target.files)
                  e.target.value = ''
                }}
              />
              <CameraCapture open={cameraOpen} onCapture={(r) => void addFiles([r.file])} onClose={() => setCameraOpen(false)} />

              {phase === 'analyzing' && (
                <div className="mb-4 overflow-hidden rounded-2xl border border-brand-200/80 bg-gradient-to-br from-brand-50/80 via-white to-indigo-50/60 shadow-glow-sm dark:border-brand-500/20 dark:from-navy-900 dark:via-navy-950 dark:to-[#121b33]">
                  <div className="relative px-4 pt-4 sm:px-5 sm:pt-5">
                    <div className="flex items-center gap-3">
                      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center">
                        <span aria-hidden="true" className="absolute inset-0 animate-pulse-glow rounded-full bg-brand-500/25" />
                        <span
                          aria-hidden="true"
                          className="absolute inset-0 animate-spin rounded-full border-2 border-brand-500 border-b-transparent"
                        />
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-md">
                          <ScanSearch className="h-4 w-4" />
                        </span>
                      </span>
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                          Processing your label
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          AI is reading and scoring your photos — step {Math.min(progressStep + 1, STAGES.length)} of {STAGES.length}
                        </p>
                      </div>
                      <span className="ml-auto shrink-0 rounded-full bg-white/80 px-2.5 py-1 text-xs font-bold text-brand-700 ring-1 ring-brand-200 dark:bg-navy-900/80 dark:text-brand-300 dark:ring-brand-500/25">
                        {Math.round((Math.min(progressStep + 1, STAGES.length) / STAGES.length) * 100)}%
                      </span>
                    </div>

                    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/80 ring-1 ring-brand-200/60 dark:bg-navy-900 dark:ring-brand-500/15">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-accent-500 via-brand-500 to-brand-600 shadow-[0_0_10px_rgb(59_130_246/0.8)] transition-[width] duration-500 ease-out"
                        style={{ width: `${Math.round((Math.min(progressStep + 1, STAGES.length) / STAGES.length) * 100)}%` }}
                      />
                    </div>

                    <ol className="mt-4 space-y-1.5">
                      {STAGES.map((s, i) => {
                        const Icon = s.icon
                        const done = i < progressStep
                        const active = i === progressStep && !done
                        return (
                          <li key={s.label} className="flex items-center gap-2.5 text-sm">
                            <span
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-all duration-300 ${
                                active
                                  ? 'bg-gradient-to-br from-accent-500 to-brand-600 text-white shadow-glow-sm'
                                  : done
                                    ? 'bg-emerald-500 text-white'
                                    : 'bg-slate-200/80 text-slate-400 dark:bg-navy-900 dark:text-slate-500'
                              }`}
                            >
                              {active ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : done ? (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              ) : (
                                <Icon className="h-3.5 w-3.5" />
                              )}
                            </span>
                            <span
                              className={active ? 'font-semibold text-slate-900 dark:text-slate-100' : done ? 'text-slate-600 dark:text-slate-300' : 'text-slate-400 dark:text-slate-500'}
                            >
                              {s.label}
                            </span>
                            {active && (
                              <span className="ml-auto hidden h-1.5 w-24 overflow-hidden rounded-full bg-brand-100 dark:bg-brand-500/15 sm:block">
                                <span className="block h-full w-1/2 animate-scan-line-progress rounded-full bg-gradient-to-r from-transparent via-accent-400 to-brand-500" />
                              </span>
                            )}
                          </li>
                        )
                      })}
                    </ol>
                    <div className="mt-4 flex items-start gap-2 rounded-xl bg-white/70 p-3 text-xs text-slate-600 dark:bg-navy-900/70 dark:text-slate-400">
                      <ScanText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-400" />
                      <span>
                        Each step runs only when the previous step actually completes. Complex labels can take a minute — your photos are not uploaded unless you save the scan.
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {picked.length === 0 && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      size="lg"
                      icon={<Camera className="h-5 w-5" />}
                      onClick={() => setCameraOpen(true)}
                      disabled={busy || phase === 'reading'}
                      className="h-11 w-full"
                    >
                      Take Photo
                    </Button>
                    <Button
                      size="lg"
                      variant="outline"
                      icon={<ImagePlus className="h-5 w-5" />}
                      onClick={openGallery}
                      disabled={busy || phase === 'reading'}
                      className="h-11 w-full"
                    >
                      Upload Image
                    </Button>
                  </div>
                  <button
                    type="button"
                    onClick={openGallery}
                    onDragOver={onDragOver}
                    onDrop={onDrop}
                    disabled={busy || phase === 'reading'}
                    className="group relative mt-3 flex w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/70 px-6 py-8 text-slate-400 transition-all duration-200 hover:border-brand-400 hover:bg-brand-50/40 hover:text-brand-500 disabled:opacity-50 dark:border-white/15 dark:bg-navy-900/40 dark:hover:border-brand-500/50 dark:hover:bg-brand-500/[0.05]"
                  >
                    {dragActive && (
                      <span aria-hidden="true" className="pointer-events-none absolute inset-0 animate-pulse-glow rounded-2xl ring-2 ring-accent-400/70" />
                    )}
                    {dragActive ? (
                      <>
                        <UploadCloud className="h-7 w-7 animate-float text-brand-500" />
                        <span className="text-[13px] font-bold text-brand-700 dark:text-brand-300">Drop photos to add them</span>
                      </>
                    ) : (
                      <>
                        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 via-brand-600 to-brand-700 text-white shadow-glow transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:scale-105">
                          <ScanLine className="h-6 w-6" />
                        </span>
                        <span className="text-sm font-bold text-slate-800 group-hover:text-brand-700 dark:text-slate-100 dark:group-hover:text-brand-300">
                          Or drag &amp; drop label photos here
                        </span>
                        <span className="max-w-sm text-[11px] text-slate-400">
                          Front + back + side panels give the most accurate reading. JPG, PNG or WEBP · up to {MAX_SCAN_IMAGES} photos.
                        </span>
                      </>
                    )}
                  </button>
                </>
              )}

              {picked.length > 0 && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      icon={phase === 'reading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                      onClick={() => setCameraOpen(true)}
                      disabled={busy || phase === 'reading'}
                      className="h-10 w-full"
                    >
                      Take photo
                    </Button>
                    <Button variant="outline" icon={<ImagePlus className="h-4 w-4" />} onClick={openGallery} disabled={busy || phase === 'reading'} className="h-10 w-full">
                      Add from gallery
                    </Button>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
                    {picked.map((p, i) => (
                      <div key={i} className="group relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-white/10">
                        <img src={p.dataUrl} alt={`Label ${i + 1}`} className="h-24 w-full object-cover sm:h-28" />
                        {p.quality && (p.quality.blurry || p.quality.dark) && (
                          <div className="absolute left-1.5 top-1.5 rounded-md bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-bold text-white">
                            {p.quality.blurry ? 'BLUR' : 'DARK'}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => removeAt(i)}
                          aria-label={`Remove photo ${i + 1}`}
                          className="absolute right-1.5 top-1.5 rounded-full bg-slate-900/70 p-1 text-white opacity-100 transition-opacity group-hover:opacity-100 sm:opacity-0"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                        <select
                          value={p.position}
                          onChange={(e) => setPosition(i, e.target.value)}
                          aria-label={`Position for photo ${i + 1}`}
                          className="absolute bottom-1.5 left-1.5 h-7 rounded-md border border-slate-300 bg-white px-1.5 text-[11px] font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-white/15 dark:bg-navy-900 dark:text-slate-200"
                        >
                          {POSITIONS.map((pos) => (
                            <option key={pos} value={pos}>{pos.toUpperCase()}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                    {picked.length < MAX_SCAN_IMAGES && (
                      <button
                        type="button"
                        onClick={openGallery}
                        className="flex h-24 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/50 text-slate-400 transition-all duration-200 hover:border-brand-400 hover:bg-brand-50/40 hover:shadow-glow-sm hover:text-brand-500 dark:border-white/15 dark:bg-navy-900/40 dark:hover:border-brand-500/50 sm:h-28"
                      >
                        <ImagePlus className="h-5 w-5" />
                        <span className="text-xs font-semibold">Add more</span>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Analysis options */}
            <div className="space-y-3 sm:space-y-4">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Report &amp; OCR language</label>
                <select
                  value={lang}
                  onChange={(e) => setLang(e.target.value)}
                  className={fieldCls}
                >
                  {SUPPORTED_LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>{l.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Product (optional)</label>
                <input
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="e.g. Amul Milk 500ml"
                  className={fieldCls}
                />
              </div>
              <details className="group rounded-xl border border-slate-200/80 px-3 py-1.5 dark:border-white/10">
                <summary className="flex cursor-pointer select-none items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Additional details
                  <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
                </summary>
                <div className="mt-2">
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Manufacturer (optional)</label>
                  <input
                    value={manufacturer}
                    onChange={(e) => setManufacturer(e.target.value)}
                    placeholder="e.g. Amul Dairy"
                    className={fieldCls}
                  />
                </div>
              </details>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Barcode (auto-detect)</label>
                <div className="flex gap-1.5">
                  <input
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    onBlur={() => void lookupCatalogue()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void lookupCatalogue()
                    }}
                    placeholder="e.g. 8901234567890"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-accent-500 dark:border-white/15 dark:bg-navy-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                  <Button
                    variant="outline"
                    icon={lookingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Barcode className="h-4 w-4" />}
                    onClick={() => void lookupCatalogue()}
                    disabled={lookingUp}
                    className="h-9 shrink-0"
                  >
                    <span className="hidden min-[380px]:inline">Lookup</span>
                    <span className="min-[380px]:hidden">Go</span>
                  </Button>
                </div>
                {productCatalogueHit && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    Catalogue match: {productCatalogueHit}
                  </p>
                )}
                {externalProduct && !productCatalogueHit && (
                  <div className="mt-1.5 rounded-lg border border-sky-200 bg-sky-50/70 px-2.5 py-1.5 text-xs text-sky-800 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300">
                    <span className="font-bold">Open Food Facts:</span> {externalProduct.name} by {externalProduct.brand || externalProduct.manufacturer || 'unknown'}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2 pt-1">
                <Button
                  icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  onClick={() => void analyze()}
                  disabled={busy || picked.length === 0}
                  className="w-full"
                >
                  {busy ? 'Analyzing label…' : 'Analyze label'}
                </Button>
                {picked.length > 0 && (
                  <Button variant="outline" onClick={reset} disabled={busy} className="w-full">
                    Clear
                  </Button>
                )}
                <p className="text-center text-xs text-slate-400">
                  {profile ? `Signed in as ${profile.name || profile.email}` : ''}
                </p>
              </div>
            </div>
          </div>
        </AnalyticsCard>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-4">
          {result.pending ? (
            <AnalyticsCard title="Scan queued for review">
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <CheckCircle2 className="h-10 w-10 text-brand-500" />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Analysis is queued — an inspector will review this label shortly.
                </p>
                <p className="text-sm text-slate-400">
                  Analysis is temporarily unavailable — your scan is safely queued and an inspector will review the label.
                </p>
              </div>
            </AnalyticsCard>
          ) : (
            <InspectionReport scan={result.scan} onScanAnother={reset} onEditInput={editInput} onRegenerate={() => void analyze()} />
          )}
        </div>
      )}

      <AnalyticsCard title="How it works" subtitle="Front + back + sides = one inspection">
        <div className="grid grid-cols-1 gap-3 text-sm text-slate-500 dark:text-slate-400 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-navy-950/40">
            <ScanLine className="h-5 w-5 text-brand-500" />
            <p className="mt-2 font-semibold text-slate-800 dark:text-slate-100">1 · Capture</p>
            <p className="mt-1 text-xs">Photograph the mandatory-declarations block — front, back and any side panels. Drag &amp; drop or tap to add up to 6 photos.</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-navy-950/40">
            <Sparkles className="h-5 w-5 text-brand-500" />
            <p className="mt-2 font-semibold text-slate-800 dark:text-slate-100">2 · Sharpen + OCR + engine</p>
            <p className="mt-1 text-xs">Each image is sharpened and binarised, text is read field-by-field across every photo (multi-image voting), then a deterministic Rule 6 engine checks the declarations.</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-navy-950/40">
            <ScanLine className="h-5 w-5 text-brand-500" />
            <p className="mt-2 font-semibold text-slate-800 dark:text-slate-100">3 · Result &amp; export</p>
            <p className="mt-1 text-xs">See the compliance score, per-declaration confidence, pass/fail checks and evidence — then export a multi-language PDF.</p>
          </div>
        </div>
      </AnalyticsCard>
    </div>
  )
}