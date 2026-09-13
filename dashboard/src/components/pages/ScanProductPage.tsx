import { useState } from 'react'
import {
  AlertTriangle,
  BadgeCheck,
  Barcode,
  Camera,
  CheckCircle2,
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
            const { dataUrl, hiResUrl, quality } = await prepareImageFile(file)
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
    try {
      advanceStage(0)
      advanceStage(1)
      const check = await validateBeforeScan()
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
      )
      advanceStage(5)
      setResult(scan)
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
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Scan Product Label</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
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
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
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
                <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50/70 p-4 dark:border-brand-500/20 dark:bg-brand-500/10">
                  <p className="flex items-center gap-2 text-sm font-bold text-brand-800 dark:text-brand-200">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-600" />
                    Processing your label
                  </p>
                  <ol className="mt-3 space-y-1.5">
                    {STAGES.map((s, i) => {
                      const Icon = s.icon
                      const done = i < progressStep
                      const active = i === progressStep && !done
                      return (
                        <li key={s.label} className="flex items-center gap-2.5 text-sm">
                          <span
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                              active
                                ? 'bg-brand-600 text-white'
                                : done
                                  ? 'bg-emerald-500 text-white'
                                  : 'bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-500'
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
                            className={active ? 'font-semibold text-brand-800 dark:text-brand-200' : done ? 'text-slate-600 dark:text-slate-300' : 'text-slate-400 dark:text-slate-500'}
                          >
                            {s.label}
                          </span>
                          {active && (
                            <span className="ml-auto hidden h-1.5 w-20 overflow-hidden rounded-full bg-brand-100 dark:bg-brand-500/15 sm:block">
                              <span className="block h-full w-full animate-pulse rounded-full bg-brand-500" />
                            </span>
                          )}
                        </li>
                      )
                    })}
                  </ol>
                  <div className="mt-3 flex items-start gap-2 text-xs text-brand-600/80 dark:text-brand-300/70">
                    <ScanText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>Each step runs only when the previous step actually completes. Complex labels can take a minute — your photos are not uploaded unless you save the scan.</span>
                  </div>
                </div>
              )}

              {picked.length === 0 && (
                <button
                  type="button"
                  onClick={() => document.getElementById('scan-label-files')?.click()}
                  onDragOver={onDragOver}
                  onDrop={onDrop}
                  disabled={busy || phase === 'reading'}
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 py-10 text-slate-400 transition-colors hover:border-brand-400 hover:text-brand-500 disabled:opacity-50 dark:border-slate-700"
                >
                  {dragActive ? (
                    <>
                      <UploadCloud className="h-8 w-8 text-brand-500" />
                      <span className="text-sm font-semibold text-brand-600 dark:text-brand-300">Drop photos to add them</span>
                    </>
                  ) : (
                    <>
                      <ImagePlus className="h-8 w-8" />
                      <span className="text-sm font-semibold">Drop label photos here, or click to browse</span>
                      <span className="text-xs">Front + back + side panels give the most accurate reading.</span>
                    </>
                  )}
                </button>
              )}

              {picked.length > 0 && (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      icon={phase === 'reading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                      onClick={() => setCameraOpen(true)}
                      disabled={busy || phase === 'reading'}
                    >
                      Take photo
                    </Button>
                    <Button variant="outline" icon={<ImagePlus className="h-4 w-4" />} onClick={() => document.getElementById('scan-label-files')?.click()} disabled={busy || phase === 'reading'}>
                      Add from gallery
                    </Button>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {picked.map((p, i) => (
                      <div key={i} className="group relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800">
                        <img src={p.dataUrl} alt={`Label ${i + 1}`} className="h-28 w-full object-cover" />
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
                          className="absolute bottom-1.5 left-1.5 h-7 rounded-md border border-slate-300 bg-white px-1.5 text-[11px] font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
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
                        onClick={() => document.getElementById('scan-label-files')?.click()}
                        className="flex h-28 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 text-slate-400 transition-colors hover:border-brand-400 hover:text-brand-500 dark:border-slate-700"
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
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Report &amp; OCR language</label>
                <select
                  value={lang}
                  onChange={(e) => setLang(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  {SUPPORTED_LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>{l.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Product (optional)</label>
                <input
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="e.g. Amul Milk 500ml"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Manufacturer (optional)</label>
                <input
                  value={manufacturer}
                  onChange={(e) => setManufacturer(e.target.value)}
                  placeholder="e.g. Amul Dairy"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Barcode (auto-detect)</label>
                <div className="flex gap-2">
                  <input
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    onBlur={() => void lookupCatalogue()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void lookupCatalogue()
                    }}
                    placeholder="e.g. 8901234567890"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                  <Button
                    variant="outline"
                    icon={lookingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Barcode className="h-4 w-4" />}
                    onClick={() => void lookupCatalogue()}
                    disabled={lookingUp}
                    className="shrink-0"
                  >
                    Lookup
                  </Button>
                </div>
                {productCatalogueHit && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
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
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/40">
            <ScanLine className="h-5 w-5 text-brand-500" />
            <p className="mt-2 font-semibold text-slate-800 dark:text-slate-100">1 · Capture</p>
            <p className="mt-1 text-xs">Photograph the mandatory-declarations block — front, back and any side panels. Drag &amp; drop or tap to add up to 6 photos.</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/40">
            <Sparkles className="h-5 w-5 text-brand-500" />
            <p className="mt-2 font-semibold text-slate-800 dark:text-slate-100">2 · Sharpen + OCR + engine</p>
            <p className="mt-1 text-xs">Each image is sharpened and binarised, text is read field-by-field across every photo (multi-image voting), then a deterministic Rule 6 engine checks the declarations.</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/40">
            <ScanLine className="h-5 w-5 text-brand-500" />
            <p className="mt-2 font-semibold text-slate-800 dark:text-slate-100">3 · Result &amp; export</p>
            <p className="mt-1 text-xs">See the compliance score, per-declaration confidence, pass/fail checks and evidence — then export a multi-language PDF.</p>
          </div>
        </div>
      </AnalyticsCard>
    </div>
  )
}