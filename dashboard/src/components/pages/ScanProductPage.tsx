import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Apple,
  Aperture,
  Barcode,
  Camera,
  Check,
  ChevronLeft,
  ImagePlus,
  Loader2,
  Package,
  ScanLine,
  Sparkles,
  TriangleAlert,
  UploadCloud,
  X,
} from 'lucide-react'
import Button from '../ui/Button'
import CameraCapture from '../ui/CameraCapture'
import { useToast } from '../ui/Toast'
import {
  MAX_PHOTOS,
  preparePhoto,
  type PhotoWarning,
  type PreparedPhoto,
} from '../../lib/scanImage'
import { createInspection } from '../../lib/inspection'
import { useLanguage } from '../../i18n/LanguageContext'
import { STATES } from '../../lib/geo'
import type { DictKey } from '../../i18n/en'

type CategoryChoice = 'edible' | 'non_edible' | 'unknown'

const WARN_KEYS: Record<PhotoWarning, DictKey> = {
  dark: 'scan.warnDark',
  blurry: 'scan.warnBlurry',
  lowres: 'scan.warnLowres',
}

const fieldCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-shadow focus:outline-none focus:ring-2 focus:ring-accent-500 dark:border-white/15 dark:bg-navy-950 dark:text-slate-100 dark:placeholder:text-slate-500'

export default function ScanProductPage() {
  const { toast } = useToast()
  const { t, lang: uiLang } = useLanguage()
  const navigate = useNavigate()

  const [category, setCategory] = useState<CategoryChoice>('unknown')
  const [photos, setPhotos] = useState<PreparedPhoto[]>([])
  const [cameraOpen, setCameraOpen] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [preparing, setPreparing] = useState(false)

  const [productName, setProductName] = useState('')
  const [brand, setBrand] = useState('')
  const [manufacturer, setManufacturer] = useState('')
  const [barcode, setBarcode] = useState('')
  const [notes, setNotes] = useState('')
  const [lang, setLang] = useState('en')
  const [scanState, setScanState] = useState('')

  const [submitting, setSubmitting] = useState(false)
  // Separate inputs: `capture` forces the camera on Android (no gallery
  // chooser), so Gallery must use an input WITHOUT capture, while the
  // device-camera fallback needs one WITH capture="environment".
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const deviceCameraInputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback(
    async (files: File[]) => {
      const imageFiles = (files ?? []).filter((f) => f.type.startsWith('image/'))
      if (imageFiles.length === 0) {
        toast('error', t('scan.invalidFile'), t('scan.invalidFileMsg'))
        return
      }
      const space = MAX_PHOTOS - photos.length
      if (space <= 0) {
        toast('error', t('scan.limitReached'), t('scan.limitMsg', { count: MAX_PHOTOS }))
        return
      }
      const slots = imageFiles.slice(0, space)
      setPreparing(true)
      try {
        const prepared = await Promise.all(slots.map((file) => preparePhoto(file)))
        const warnings = prepared.flatMap((p) => p.quality.warnings)
        if (warnings.length > 0) {
          toast('info', t('scan.photoQuality'), t(WARN_KEYS[warnings[0]]))
        }
        setPhotos((prev) => [...prev, ...prepared])
      } catch (e) {
        toast('error', t('scan.unreadable'), (e as Error).message)
      } finally {
        setPreparing(false)
      }
    },
    [photos.length, toast, t],
  )

  const onCapture = (r: { file: File; dataUrl: string }) => {
    void addFiles([r.file])
    setCameraOpen(false)
  }

  const onGalleryFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    void addFiles(Array.from(e.target.files ?? []))
    e.target.value = ''
  }

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index))
  }

  const categoryCards: Array<{ value: CategoryChoice; title: string; desc: string; icon: typeof Package }> = [
    { value: 'edible', title: t('scan.catEdible'), desc: t('scan.catEdibleDesc'), icon: Apple },
    { value: 'non_edible', title: t('scan.catNonEdible'), desc: t('scan.catNonEdibleDesc'), icon: Package },
    { value: 'unknown', title: t('scan.catUnknown'), desc: t('scan.catUnknownDesc'), icon: TriangleAlert },
  ]

  const submit = async () => {
    if (photos.length === 0) {
      toast('error', t('scan.noPhotos'), t('scan.noPhotosMsg'))
      return
    }
    setSubmitting(true)
    try {
      const res = await createInspection({
        photos: photos.map((p, i) => ({ data: p.dataUrl, name: p.file.name || `photo-${i + 1}.jpg` })),
        category: category === 'unknown' ? undefined : category,
        lang,
        state: scanState.trim() || undefined,
        product_name: productName.trim() || undefined,
        brand: brand.trim() || undefined,
        manufacturer: manufacturer.trim() || undefined,
        barcode: barcode.trim() || undefined,
        notes: notes.trim() || undefined,
        hints: {
          ...(productName.trim() ? { product_name: productName.trim() } : {}),
          ...(brand.trim() ? { brand: brand.trim() } : {}),
          ...(manufacturer.trim() ? { manufacturer: manufacturer.trim() } : {}),
          ...(barcode.trim() ? { barcode: barcode.trim() } : {}),
        },
      })
      if (!res.ok) throw new Error(res.error ?? t('scan.failed'))
      navigate(`/scan-result/${res.scan_id}`)
    } catch (e) {
      toast('error', t('scan.failed'), (e as Error).message)
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
      <div className="mb-6 flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-500/15 text-brand-500">
          <ScanLine className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-ink-text dark:text-white">{t('scan.title')}</h1>
          <p className="text-sm text-ink-text-soft dark:text-navy-300">
            {t('scan.subtitle', { count: MAX_PHOTOS })}
          </p>
        </div>
      </div>

      {/* 1 — Category */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">
          {t('scan.categoryQ')}
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {categoryCards.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setCategory(c.value)}
              className={`rounded-xl border p-3 text-left transition-all ${
                category === c.value
                  ? 'border-brand-500 bg-brand-500/10 ring-2 ring-brand-500/40'
                  : 'border-line bg-white/60 hover:border-line-strong dark:border-white/10 dark:bg-navy-900/60 dark:hover:border-white/25'
              }`}
            >
              <c.icon className={`h-5 w-5 ${category === c.value ? 'text-brand-500' : 'text-ink-text-soft dark:text-navy-300'}`} />
              <div className="mt-2 text-sm font-semibold text-ink-text dark:text-slate-100">{c.title}</div>
              <div className="text-xs text-ink-text-soft dark:text-navy-400">{c.desc}</div>
            </button>
          ))}
        </div>
      </section>

      {/* 2 — Photos */}
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">
            {t('scan.photos')} <span className="text-brand-500">{photos.length}/{MAX_PHOTOS}</span>
          </h2>
          {photos.length > 0 && category === 'unknown' && (
            <span className="text-xs text-slate-400">{t('scan.photoHint')}</span>
          )}
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragActive(true)
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragActive(false)
            void addFiles(Array.from(e.dataTransfer.files))
          }}
          className={`relative rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
            dragActive
              ? 'border-brand-500 bg-brand-500/10'
              : 'border-line bg-white/50 dark:border-white/10 dark:bg-navy-900/40'
          }`}
        >
          {photos.length === 0 ? (
            <div className="py-6">
              <UploadCloud className="mx-auto h-10 w-10 text-ink-text-soft dark:text-navy-400" />
              <p className="mt-3 text-sm text-ink-text-soft dark:text-navy-300">
                {t('scan.dropzone')}
              </p>
              <div className="mt-4 flex items-center justify-center gap-3">
                <Button icon={<Camera className="h-4 w-4" />} onClick={() => setCameraOpen(true)}>
                  {t('scan.camera')}
                </Button>
                <Button variant="outline" icon={<ImagePlus className="h-4 w-4" />} onClick={() => galleryInputRef.current?.click()}>
                  {t('scan.gallery')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {photos.map((p, i) => (
                <div key={`${p.dataUrl.slice(0, 24)}-${i}`} className="relative overflow-hidden rounded-xl border border-line dark:border-white/10">
                  <img src={p.dataUrl} alt={`${t('scan.photoN', { n: i + 1 })}`} className="h-24 w-full object-cover" />
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-ink-text-soft dark:text-navy-300">
                      {i === 0 ? t('scan.photoFront') : i === 1 ? t('scan.photoBack') : t('scan.photoN', { n: i + 1 })}
                    </span>
                    {p.quality.warnings.length > 0 ? (
                      <TriangleAlert className="h-3.5 w-3.5 text-amber-500" />
                    ) : (
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-slate-900/70 text-white hover:bg-slate-900"
                    aria-label={t('scan.removePhoto')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  disabled={preparing}
                  className="grid h-full min-h-[7.5rem] place-items-center rounded-xl border border-dashed border-line text-ink-text-soft transition-colors hover:border-brand-500 hover:text-brand-500 disabled:opacity-50 dark:border-white/15 dark:text-navy-300"
                >
                  {preparing ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
                </button>
              )}
            </div>
          )}
          {/* Gallery input: NO capture attribute so mobile shows the
              Photos/Files chooser instead of jumping to the camera. */}
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={onGalleryFiles}
          />
          {/* Device-camera fallback: forces the native camera app (used when
              the in-app camera is blocked or unavailable on mobile). */}
          <input
            ref={deviceCameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onGalleryFiles}
          />
        </div>

        {photos.some((p) => p.quality.warnings.length > 0) && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {t('scan.qualityNote')}
            </span>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="outline"
            icon={<Camera className="h-4 w-4" />}
            onClick={() => setCameraOpen(true)}
          >
            {t('scan.openCamera')}
          </Button>
          <Button
            variant="outline"
            icon={<Aperture className="h-4 w-4" />}
            onClick={() => deviceCameraInputRef.current?.click()}
          >
            {t('scan.deviceCamera')}
          </Button>
        </div>
      </section>

      {/* 3 — Product details */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">
          {t('scan.details')} <span className="font-normal text-slate-400">{t('scan.detailsOptional')}</span>
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-text-soft dark:text-navy-300">{t('scan.productName')}</span>
            <input className={fieldCls} value={productName} onChange={(e) => setProductName(e.target.value)} placeholder={t('scan.productNamePh')} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-text-soft dark:text-navy-300">{t('scan.brand')}</span>
            <input className={fieldCls} value={brand} onChange={(e) => setBrand(e.target.value)} placeholder={t('scan.brandPh')} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-text-soft dark:text-navy-300">{t('scan.manufacturer')}</span>
            <input className={fieldCls} value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} placeholder={t('scan.manufacturerPh')} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-text-soft dark:text-navy-300">{t('scan.barcode')}</span>
            <div className="relative">
              <Barcode className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-text-soft dark:text-navy-400" />
              <input className={`${fieldCls} pl-9`} value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="e.g. 8901…" />
            </div>
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-ink-text-soft dark:text-navy-300">{t('scan.notes')}</span>
            <textarea className={fieldCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('scan.notesPh')} />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-ink-text-soft dark:text-navy-300">{t('scan.language')}</span>
            <select className={fieldCls} value={lang} onChange={(e) => setLang(e.target.value)}>
              <option value="en">English</option>
              <option value="hi">Hindi</option>
              <option value="ta">Tamil</option>
              <option value="te">Telugu</option>
              <option value="bn">Bengali</option>
              <option value="ml">Malayalam</option>
              <option value="mr">Marathi</option>
              <option value="gu">Gujarati</option>
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-ink-text-soft dark:text-navy-300">{t('scan.state')}</span>
            <select className={fieldCls} value={scanState} onChange={(e) => setScanState(e.target.value)}>
              <option value="">{t('scan.stateAuto')}</option>
              {STATES.map((s) => (
                <option key={s.en} value={s.en}>
                  {uiLang === 'hi' ? s.hi : s.en}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {/* 4 — Submit */}
      <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-3 border-t border-line bg-white/90 px-4 py-4 backdrop-blur dark:border-white/10 dark:bg-navy-950/90 sm:mx-0 sm:rounded-xl sm:border sm:px-5">
        <div className="text-xs text-ink-text-soft dark:text-navy-300">
          {photos.length === 0
            ? t('scan.addPhotoFirst')
            : `${t('scan.photosReady', { count: photos.length })}${category !== 'unknown' ? ` · ${category === 'edible' ? t('scan.catEdible') : t('scan.catNonEdible')}` : ''}`}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" icon={<ChevronLeft className="h-4 w-4" />} onClick={() => navigate(-1)}>
            {t('scan.back')}
          </Button>
          <Button loading={submitting} onClick={() => void submit()} icon={<Sparkles className="h-4 w-4" />}>
            {submitting ? t('scan.analyzing') : t('scan.start')}
          </Button>
        </div>
      </div>

      <CameraCapture open={cameraOpen} onCapture={onCapture} onClose={() => setCameraOpen(false)} />
    </div>
  )
}