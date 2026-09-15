/*
 * AuditX v3.0 — AI inspection pipeline client.
 *
 * Wraps the AI inspection pipeline, which combines several label photos
 * (front / back / sides) into ONE inspection:
 *   - server-side `scanAnalysis` Cloud Function (Gemini vision)
 *   - Google Gemini AI fallback (vision extraction + compliance rules)
 *   - on-device free OCR (Tesseract) fallback
 *   - multi-language OCR
 *   - multi-label detection
 *   - 10-rule Rule 6 checklist
 *   - AI assistant summary + suggested next inspection steps
 *
 * Images are downscaled to data URLs client-side so the analysis does not
 * depend on Firebase Storage being provisioned. Uploads are attempted
 * best-effort afterwards to persist the photos on the scan document.
 */

import { httpsCallable } from 'firebase/functions'
import { updateDoc, doc } from 'firebase/firestore'
import { functions, auth, db } from './firebase'
import { uploadScanImages } from './storage'
import { createScan } from './services'
import { saveLocalScan } from './localStore'
import { runLocalScan } from './localEngine'
import { runGeminiScan } from './geminiScan'
import { runVisionOcr, fastOcrIsUsable, type FastOcrField, type FastOcrResultRule, type FastOcrVerdict, type RegionImage } from './visionOcr'
import { matches } from './compliance/adaptiveClient'
import { PerfRun } from './perf'
import { COLLECTIONS } from './db'
import type {
  AIIinsight,
  DetectedLabel,
  DetectedSummary,
  ExtractedDeclarations,
  ExtractedField,
  FieldVerification,
  InspectorAssistant,
  OcrBlock,
  OcrExtract,
  RuleCheck,
  ScanEngine,
  ScanRow,
  TrustBreakdown,
} from './types2'
import type { PanelPrior } from './textract/types'

export const MAX_SCAN_IMAGES = 6

/* ------------------------------------------------------------------ */
/* Image helpers                                                       */
/* ------------------------------------------------------------------ */

/** Analysis input cap — raised from 1024 to keep small legal-metrology text legible. */
export const MAX_DIM = 2048

/** Hi-res variant used by the accuracy path — keep as close to the original as possible. */
export const MAX_DIM_HI = 4096

export interface ImageQuality {
  blurry: boolean
  dark: boolean
  warnings: string[]
}

/** Blur / low-light assessment from an already-decoded bitmap. */
function assessQualityBitmap(bitmap: ImageBitmap): ImageQuality {
  const warnings: string[] = []
  let blurry = false
  let dark = false
  const sampleW = Math.min(128, bitmap.width)
  const sampleH = Math.min(128, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = sampleW
  canvas.height = sampleH
  const ctx = canvas.getContext('2d')
  if (!ctx) { return { blurry, dark, warnings } }
  ctx.drawImage(bitmap, 0, 0, sampleW, sampleH)
  const data = ctx.getImageData(0, 0, sampleW, sampleH).data

  let totalLum = 0
  const n = sampleW * sampleH
  for (let i = 0; i < data.length; i += 4) {
    totalLum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }
  const meanLum = totalLum / n
  if (meanLum < 40) { dark = true; warnings.push('Image is too dark — retake in better lighting.') }

  let edgeSum = 0
  let edgeCount = 0
  for (let y = 1; y < sampleH - 1; y++) {
    for (let x = 1; x < sampleW - 1; x++) {
      const idx = (y * sampleW + x) * 4
      const l = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
      const r = 0.299 * data[idx + 4] + 0.587 * data[idx + 5] + 0.114 * data[idx + 6]
      const b = 0.299 * data[idx + sampleW * 4] + 0.587 * data[idx + sampleW * 4 + 1] + 0.114 * data[idx + sampleW * 4 + 2]
      const gx = Math.abs(l - r)
      const gy = Math.abs(l - b)
      edgeSum += gx + gy
      edgeCount++
    }
  }
  const edgeEnergy = edgeCount > 0 ? edgeSum / edgeCount : 0
  if (edgeEnergy < 6) { blurry = true; warnings.push('Image may be blurry — hold the camera steady and retry.') }
  return { blurry, dark, warnings }
}

/** Assess image quality via canvas analysis — blur and low-light detection. */
export async function assessImageQuality(file: File): Promise<ImageQuality> {
  try {
    const bitmap = await createImageBitmap(file)
    try {
      return assessQualityBitmap(bitmap)
    } finally {
      bitmap.close()
    }
  } catch {
    // Image quality assessment is best-effort; never block the pipeline.
    return { blurry: false, dark: false, warnings: [] }
  }
}

/** Draw a bitmap downscaled to ≤ maxDim and return a compressed JPEG data URL. */
function drawScaled(bitmap: ImageBitmap, maxDim: number): string {
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable in this browser.')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bitmap, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', 0.8)
}

export interface PreparedImage {
  dataUrl: string
  hiResUrl: string
  quality: ImageQuality
}

/**
 * Prepare a photo for analysis with a SINGLE image decode: createImageBitmap
 * once, then build the downscaled + hi-res data URLs and the quality estimate
 * from that one bitmap. This is roughly 3× cheaper than the previous path
 * (which re-decoded the file three times) — noticeably faster on phone photos.
 * Falls back to the individual helpers where ImageBitmap is unavailable.
 */
export async function prepareImageFile(file: File): Promise<PreparedImage> {
  try {
    const bitmap = await createImageBitmap(file)
    try {
      return {
        dataUrl: drawScaled(bitmap, MAX_DIM),
        hiResUrl: drawScaled(bitmap, MAX_DIM_HI),
        quality: assessQualityBitmap(bitmap),
      }
    } finally {
      bitmap.close()
    }
  } catch {
    const dataUrl = await fileToDataUrl(file)
    const hiResUrl = await fileToDataUrl(file, MAX_DIM_HI)
    const quality = await assessImageQuality(file)
    return { dataUrl, hiResUrl, quality }
  }
}

/** Read a File, downscale it to ≤ maxDim px and return a compressed JPEG data URL. */
export function fileToDataUrl(file: File, maxDim = MAX_DIM): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read image file.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Unsupported or corrupted image file.'))
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas unavailable in this browser.'))
          return
        }
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.8))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

/**
 * Decode a data URL (or in-memory File) into an ImageBitmap without any
 * downscaling, so the accuracy path can read the ORIGINAL pixels.
 */
export function loadImageBitmap(dataUrl: string): Promise<ImageBitmap> {
  return fetch(dataUrl)
    .then((r) => r.blob())
    .then((b) => createImageBitmap(b))
}

/* ------------------------------------------------------------------ */
/* Types mirroring the Cloud Function contract                         */
/* ------------------------------------------------------------------ */

export interface ScanAnalysisMeta {
  product_name?: string
  manufacturer?: string
  barcode?: string
  lang?: string
  positions?: PanelPrior[] // label panel per photo (used by the on-device path)
}

export interface ScanAnalysisInput extends ScanAnalysisMeta {
  images: string[] // data URLs
  hiResImages?: string[] // near-original data URLs for the accuracy path
  /** Inspection category hint ("edible" | "non_edible") for the compliance engine. */
  category?: string
}

/** Wire shape expected by the Cloud Function (each image wrapped as {data}). */
interface ScanAnalysisRequest extends ScanAnalysisMeta {
  images: { data: string }[]
  ocr_text?: string // Google Cloud Vision transcript (best-effort reference)
  perImageBlocks?: Array<{ image_id?: string; blocks: Array<{ text: string; confidence: number; region: [number, number, number, number] }> }>
}

export interface RawAnalysis {
  product_name?: string
  brand?: string
  manufacturer?: string
  category?: string
  verdict?: string
  summary?: string
  overall_score?: number
  language_note?: string
  rules?: RuleCheck[]
  labels?: DetectedLabel[]
  ocr?: OcrExtract
  ocr_blocks?: OcrBlock[]
  extractions?: ExtractedDeclarations
  extraction_fields?: Record<string, ExtractedField>
  assistant?: InspectorAssistant
  detected?: DetectedSummary
  uncertain?: string[]
  /** Adaptive evidence layer — verification + trust score from the server path. */
  verification?: Record<string, FieldVerification>
  trust_score?: number
  trust_breakdown?: TrustBreakdown
  processing?: { initial_ocr_ms: number; verification_ms: number; total_ms: number }
  uncertain_regions?: number
}

export interface ScanAnalysisOutput {
  ok: boolean
  scan_id: string
  result: RawAnalysis & { overall_score: number; risk_score: number; ai_insights: AIIinsight[] }
}

/* ------------------------------------------------------------------ */
/* Scan lifecycle                                                      */
/* ------------------------------------------------------------------ */

function insightsFrom(rules: RuleCheck[]): AIIinsight[] {
  return (rules ?? [])
    .filter((r) => r?.status === 'FAIL' || r?.status === 'WARNING')
    .map((r) => ({ rule_id: r.rule_id ?? '', field: r.field ?? '', status: r.status, issue: r.issue ?? '' }))
}

function buildScanRow(scanId: string, out: ScanAnalysisOutput, lang: string, meta: ScanAnalysisMeta, engine: ScanEngine = 'cloud_function'): ScanRow {
  const score = Math.max(0, Math.min(100, out.result.overall_score))
  const uid = auth.currentUser?.uid ?? null
  return {
    id: scanId,
    created_at: new Date().toISOString(),
    user_id: uid,
    engine,
    product_name: out.result.product_name ?? meta.product_name ?? '',
    brand: out.result.brand ?? '',
    manufacturer: out.result.manufacturer ?? meta.manufacturer ?? out.result.brand ?? '',
    category: typeof out.result.category === 'string' ? out.result.category : 'General',
    barcode: meta.barcode ?? '',
    overall_score: score,
    verdict: out.result.verdict ?? (score >= 80 ? 'COMPLIANT' : score >= 50 ? 'PARTIALLY_COMPLIANT' : 'NON_COMPLIANT'),
    summary: out.result.summary ?? '',
    image_url: '',
    rules: out.result.rules ?? [],
    risk_score: out.result.risk_score ?? 100 - score,
    status: 'analyzed',
    ocr_text: out.result.ocr?.text ?? '',
    ai_insights: out.result.ai_insights ?? insightsFrom(out.result.rules ?? []),
    image_urls: [],
    labels: out.result.labels ?? [],
    ocr: out.result.ocr ?? { text: '', languages: [] },
    ocr_blocks: out.result.ocr_blocks ?? [],
    assistant: out.result.assistant ?? { summary: '', suggestions: [] },
    language_note: out.result.language_note ?? '',
    extractions: out.result.extractions,
    extraction_fields: out.result.extraction_fields,
    detected: out.result.detected,
    uncertain: out.result.uncertain,
    verification: out.result.verification,
    trust_score: out.result.trust_score,
    trust_breakdown: out.result.trust_breakdown,
    processing: out.result.processing,
    uncertain_regions: out.result.uncertain_regions,
    missed_regions: (out.result as any)?.missed_regions ?? null,
    manual_result: null,
    notes: '',
    latitude: null,
    longitude: null,
    location_name: '',
    language: lang,
  }
}

/**
 * Persist label photos on an analyzed scan (best-effort — fails gracefully when
 * Firebase Storage is not provisioned yet).
 */
export async function attachScanPhotos(scanId: string, files: File[]): Promise<string[]> {
  if (files.length === 0) return []
  const perf = new PerfRun('upload')
  try {
    const urls = await perf.timed('upload-images', () => uploadScanImages(files))
    const patch: Record<string, unknown> = {
      image_urls: urls,
      image_url: urls[0] ?? '',
      updated_at: new Date().toISOString(),
    }
    await perf.timed('db-save-photo-urls', () => updateDoc(doc(db, COLLECTIONS.SCANS, scanId), patch))
    perf.summary()
    return urls
  } catch (err) {
    console.error('attachScanPhotos failed', err)
    return []
  }
}

/* ------------------------------------------------------------------ */
/* Fast deterministic result — built straight from the OCR extraction  */
/* ------------------------------------------------------------------ */

const PY_TO_STATUS: Record<string, RuleCheck['status']> = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  REVIEW: 'NOT_VERIFIABLE',
  NA: 'NOT_APPLICABLE',
}

interface FastOcrPayload {
  text: string
  blocks: Array<{ text: string; confidence: number | null }>
  regions?: RegionImage[]
  fields: Record<string, FastOcrField>
  rules: FastOcrResultRule[]
  result: FastOcrVerdict
  lang: string
  meta: ScanAnalysisMeta
  processingTime?: number
  missedRegions?: { checked: number; found: number }
}

function toFastRules(rules: FastOcrResultRule[]): RuleCheck[] {
  return (rules ?? []).map((r) => ({
    rule_id: r.rule_id ?? '',
    field: r.field ?? r.rule_id ?? '',
    status: (PY_TO_STATUS[r.status] ?? 'NOT_VERIFIABLE') as RuleCheck['status'],
    detected_value: r.detected_value ?? null,
    reason: r.reason ?? '',
    requirement: r.regulation ?? r.reason ?? '',
    verification_type: 'IMAGE_VERIFIABLE',
    weight: r.weight ?? 1,
  }))
}

async function buildFastScanRow(p: FastOcrPayload): Promise<ScanRow> {
  const rules = toFastRules(p.rules)
  const verdict = p.result.verdict ?? (p.result.score >= 80 ? 'COMPLIANT' : p.result.score >= 50 ? 'PARTIALLY_COMPLIANT' : 'NON_COMPLIANT')
  const risk = p.result.risk ?? (p.result.score >= 80 ? 'Low' : p.result.score >= 50 ? 'Medium' : 'High')
  const riskScore = { Low: 100 - p.result.score, Medium: 50, High: 30, Critical: 10 }[risk] ?? 100 - p.result.score

  const extractions: ExtractedDeclarations = {}
  const extraction_fields: Record<string, ExtractedField> = {}
  const verification: Record<string, FieldVerification> = {}
  let productName = ''

  // Trace each value back to the OCR block that produced it. Per-image regions
  // (when the service returns them) give a real source image + bounding box;
  // otherwise we fall back to the flat block list with text + confidence only.
  type FastBlock = { image: number; text: string; confidence: number | null; region: [number, number, number, number] | null }
  const regionBlocks: FastBlock[] = (p.regions ?? []).flatMap((im, i) =>
    (im.blocks ?? []).map((b) => ({ image: i, text: b.text, confidence: b.confidence, region: b.region ?? null })),
  )
  const flatBlocks: FastBlock[] = (p.blocks ?? []).map((b) => ({ image: 0, text: b.text, confidence: b.confidence, region: null }))
  const allBlocks: FastBlock[] = regionBlocks.length ? regionBlocks : flatBlocks

  for (const [k, f] of Object.entries(p.fields ?? {})) {
    if (!f || f.value == null) continue
    if (k === 'commodity_name') productName = f.value
    extractions[k as keyof ExtractedDeclarations] = f.value

    const value = String(f.value)
    const hit = allBlocks.find((b) => matches(value, b.text))
    const blockConf = hit?.confidence ?? null
    // Verified ONLY when the backend's high-confidence field is corroborated by
    // a real OCR block read at >=95%. Otherwise it stays medium/review — no
    // "Verified" badge without traceable evidence (#6/#7).
    const isVerified = f.confidence === 'high' && (blockConf ?? 0) >= 0.95
    const confScore = isVerified ? 0.92 : f.confidence === 'high' ? 0.9 : f.confidence === 'medium' ? 0.6 : 0.3
    const status: ExtractedField['status'] = isVerified
      ? 'VERIFIED'
      : f.confidence === 'low'
        ? 'NEEDS_REVIEW'
        : 'MEDIUM_CONFIDENCE'

    extraction_fields[k] = {
      value,
      confidence: f.confidence,
      source_image: hit ? hit.image : null,
      status,
      confidence_score: confScore,
      conflict: false,
      votes: 1,
    }
    verification[k] = {
      verified: isVerified,
      needsVerification: !isVerified,
      via: 'direct',
      confidence_score: confScore,
      ocrConfidence: blockConf,
      before: value,
      after: value,
      evidence: hit
        ? [{ source_image: hit.image, region: hit.region, region_text: hit.text, pass: 'initial_ocr', ocr_conf: hit.confidence ?? 0, value }]
        : [],
    }
  }

  const ocrBlocks: OcrBlock[] = (p.blocks ?? []).map((b, i) => ({
    position: i === 0 ? 'front' : i === 1 ? 'back' : 'side',
    text: b.text,
    languages: [p.lang],
  }))

  // Honest trust estimate from measured per-field confidence. Fields without a
  // traceable OCR block stay at their (lower) medium/review score, so an
  // uncertain extraction cannot yield a confident-looking trust number.
  const fieldScores = Object.values(extraction_fields).map((f) => f.confidence_score ?? 0)
  const trust_score = fieldScores.length ? Math.round((fieldScores.reduce((a, b) => a + b, 0) / fieldScores.length) * 100) : 0
  const processing = { initial_ocr_ms: p.processingTime ?? 0, verification_ms: 0, total_ms: p.processingTime ?? 0 }

  const counts = p.result.counts ?? { passed: 0, failed: 0, review: 0, na: 0 }
  const statusCounts = {
    passed: counts.passed,
    failed: counts.failed,
    warnings: counts.review,
    not_detected: counts.review,
    not_verifiable: counts.review,
    requires_physical_inspection: 0,
    not_applicable: counts.na,
    uncertain: counts.review,
  }
  const detected: DetectedSummary = {
    passed: counts.passed,
    failed: counts.failed,
    warnings: counts.review,
    not_verifiable: counts.review,
    not_applicable: counts.na,
    missing: counts.review,
    uncertain: counts.review,
  }
  const aiInsights: AIIinsight[] = rules
    .filter((r) => r.status === 'FAIL' || r.status === 'WARNING' || r.status === 'NOT_VERIFIABLE')
    .map((r) => ({ rule_id: r.rule_id, field: r.field, status: r.status, issue: r.reason ?? '' }))

  const uid = auth.currentUser?.uid ?? null
  const scanId = `fast-${Date.now()}`
  const summary = p.result.summary ?? `${p.result.score}/100 — ${verdict} (risk ${risk}).`
  const assistant: InspectorAssistant = { summary, suggestions: [] }

  const row: ScanRow = {
    id: scanId,
    created_at: new Date().toISOString(),
    user_id: uid,
    engine: 'fast',
    product_name: productName || p.meta.product_name || '',
    brand: (p.fields.manufacturer?.value as string) ?? p.meta.product_name ?? '',
    manufacturer: (p.fields.manufacturer?.value as string) ?? p.meta.manufacturer ?? '',
    category: 'General',
    barcode: p.meta.barcode ?? '',
    overall_score: p.result.score,
    verdict,
    summary,
image_url: '',
      rules,
      risk_score: riskScore,
      status: 'analyzed',
      ocr_text: p.text,
      ai_insights: aiInsights,
      image_urls: [],
      labels: [],
      ocr: { text: p.text, languages: [p.lang] },
      ocr_blocks: ocrBlocks,
      assistant,
      language_note: 'Analyzed with the fast OCR engine (deterministic extraction + compliance rules).',
      extractions,
      extraction_fields,
      verification,
      trust_score,
      processing,
      uncertain_regions: 0,
      missed_regions: p.missedRegions,
      detected,
    counts: statusCounts,
    context: {
      package_type: 'General',
      origin: 'Unknown',
      is_food: false,
      sold_by: 'unknown',
      reason: 'Fast deterministic OCR analysis.',
    },
    uncertain: [],
    manual_result: null,
    notes: '',
    latitude: null,
    longitude: null,
    location_name: '',
    language: p.lang,
  }

  // Persist best-effort; never block returning the result.
  try {
    const realId = await createScan({
      product_name: row.product_name,
      brand: row.brand,
      manufacturer: row.manufacturer,
      category: row.category,
      overall_score: row.overall_score,
      verdict: row.verdict,
      summary: row.summary,
      rules,
      barcode: row.barcode,
      ocr_text: p.text,
      ai_insights: aiInsights,
      risk_score: riskScore,
      status: 'analyzed',
      language: p.lang,
    })
    row.id = realId
    row.engine = 'fast'
  } catch {
    /* local-only fallback below */
  }
  saveLocalScan(row)
  return row
}

/**
 * Run the AI inspection over label photos.
 *
 * Priority: FAST deterministic OCR result (PaddleOCR, parallel) → server
 * `scanAnalysis` Cloud Function (Gemini vision) → on-device free OCR engine
 * → staff-review queue. The fast path returns as soon as the required fields
 * are present and confident (skipping the expensive Gemini call); Gemini is
 * only used when the fast result is low-confidence or missing key fields.
 *
 * Persistence is best-effort everywhere, so a result row is always returned
 * and the user never hits a hard analysis error.
 *
 * `onStage` (optional) reports the REAL pipeline milestone at the seam where
 * it happens so the UI can show an honest step tracker — never an estimate:
 *   2 extracting → 3 analyzing → 4 aggregating the final result.
 */
export async function runScanAnalysis(
  input: ScanAnalysisInput,
  onStage?: (stage: number) => void,
  perf?: PerfRun,
): Promise<{ scan: ScanRow; pending: boolean }> {
  const pf = perf ?? new PerfRun('analysis')
  // Fast OCR (backend-only) — parallel, cached, no heavy preprocessing.
  onStage?.(2)
  const ocrHint = await pf
    .timed('ocr', async () => {
      try {
        return await runVisionOcr(input.images, input.lang ?? 'en', input.category)
      } catch {
        return null
      }
    })

  // FAST PATH: if the deterministic extraction already produced a valid,
  // confident result, return it immediately — skip Gemini entirely.
  if (ocrHint && fastOcrIsUsable(ocrHint)) {
    try {
      const scan = await pf.timed('fast-build', () =>
        buildFastScanRow({
          text: ocrHint.text,
          blocks: ocrHint.blocks,
          regions: ocrHint.regions,
          fields: ocrHint.fields!,
          rules: ocrHint.rules!,
          result: ocrHint.result!,
          lang: input.lang ?? 'en',
          meta: input,
          processingTime: ocrHint.processing_time_ms,
          missedRegions: ocrHint.image_regions
            ? { checked: ocrHint.image_regions.missed_regions_checked, found: ocrHint.image_regions.missed_found }
            : undefined,
        }),
      )
      onStage?.(3)
      onStage?.(4)
      perf?.segment('start', 'result', 'analyze-total')
      return { scan, pending: false }
    } catch {
      // Fast build failed — fall through to the full AI path below.
    }
  }

  const fn = httpsCallable<ScanAnalysisRequest, ScanAnalysisOutput>(functions, 'scanAnalysis')
  let out: ScanAnalysisOutput
  try {
    const res = await pf.timed('ai-analyze', () =>
      fn({
        images: (input.images ?? []).map((src) => ({ data: src })),
        lang: input.lang ?? 'en',
        product_name: input.product_name,
        manufacturer: input.manufacturer,
        barcode: input.barcode,
        ocr_text: ocrHint?.text,
        perImageBlocks: ocrHint?.regions ?? [],
      }),
    )
    out = res.data
    if (!out?.ok || !out.scan_id) throw new Error('Empty AI response from server.')
    onStage?.(3)
    onStage?.(4)
    return { scan: buildScanRow(out.scan_id, out, input.lang ?? 'en', input), pending: false }
  } catch (_fnErr) {
    // 1) Google Gemini AI analysis (high-accuracy vision extraction + rules).
    try {
      onStage?.(2)
      const geminiScan = await runGeminiScan({
        images: input.images,
        hiResImages: input.hiResImages,
        lang: input.lang ?? 'en',
        product_name: input.product_name,
        manufacturer: input.manufacturer,
        barcode: input.barcode,
        positions: input.positions,
        ocrHint: ocrHint?.text,
        ocrBlocks: (ocrHint?.regions ?? []).map((im) => ({ blocks: im.blocks ?? [] })),
        qualityScores: (ocrHint?.image_quality ?? []).map((q) => q.score),
        ocrInitialMs: ocrHint?.processing_time_ms ?? 0,
        ocrMissedRegions: ocrHint?.image_regions
          ? { checked: ocrHint.image_regions.missed_regions_checked, found: ocrHint.image_regions.missed_found }
          : undefined,
      }, pf)
      onStage?.(3)
      onStage?.(4)
      return { scan: geminiScan, pending: false }
    } catch (_geminiErr) {
      // 2) Free on-device analysis (Tesseract) before falling back to manual review.
      try {
        onStage?.(2)
    const localScan = await runLocalScan({
      images: input.images,
      hiResImages: input.hiResImages,
      lang: input.lang ?? 'en',
      product_name: input.product_name,
      manufacturer: input.manufacturer,
      barcode: input.barcode,
      positions: input.positions,
      ocrBlocks: (ocrHint?.regions ?? []).map((im) => ({ blocks: im.blocks ?? [] })),
      qualityScores: (ocrHint?.image_quality ?? []).map((q) => q.score),
      ocrInitialMs: ocrHint?.processing_time_ms ?? 0,
      ocrMissedRegions: ocrHint?.image_regions
        ? { checked: ocrHint.image_regions.missed_regions_checked, found: ocrHint.image_regions.missed_found }
        : undefined,
    }, pf)
    onStage?.(3)
    onStage?.(4)
    return { scan: localScan, pending: false }
  } catch (_localErr) {
      // Local OCR failed. Both the server and on-device paths are
      // unavailable right now — always queue the photo for staff review so
      // the scan is never lost and the user never hits a dead-end.
      onStage?.(3)
      onStage?.(4)
      const product = input.product_name?.trim() || 'Label scan'
      let scanId = `local-pending-${Date.now()}`
      try {
        scanId = await pf.timed('db-save', () => createScan({
          product_name: product,
          brand: '',
          manufacturer: input.manufacturer ?? '',
          category: 'General',
          overall_score: 0,
          verdict: 'PENDING',
          summary: 'Photo uploaded. AI analysis is queued — an inspector can review it now.',
          rules: [],
          status: 'pending_review',
          image_url: '',
          language: input.lang ?? 'en',
        }))
      } catch {
        // Local-only queue — the UI shows the row regardless.
      }
      const uid = auth.currentUser?.uid ?? null
      const pending: ScanRow = {
        id: scanId,
        created_at: new Date().toISOString(),
        user_id: uid,
        product_name: product,
        brand: '',
        manufacturer: input.manufacturer ?? '',
        category: 'General',
        barcode: input.barcode ?? '',
        overall_score: 0,
        verdict: 'PENDING',
        summary: 'Photo uploaded. AI analysis is queued — an inspector can review it now.',
        image_url: '',
        rules: [],
        risk_score: 0,
        status: 'pending_review',
        ocr_text: '',
        ai_insights: [],
        image_urls: [],
        labels: [],
        ocr: { text: '', languages: [] },
        assistant: { summary: '', suggestions: [] },
        language_note: input.lang && input.lang !== 'en' ? `Report language: ${input.lang}` : '',
        manual_result: null,
        notes: '',
        latitude: null,
        longitude: null,
        location_name: '',
        language: input.lang ?? 'en',
        engine: 'queued',
        ocr_blocks: [],
        extractions: undefined,
        extraction_fields: {},
        detected: undefined,
        uncertain: [],
        verification: {},
        trust_score: 0,
        trust_breakdown: {} as TrustBreakdown,
        processing: { initial_ocr_ms: 0, verification_ms: 0, total_ms: 0 },
        uncertain_regions: 0,
        missed_regions: null,
      }
      saveLocalScan(pending)
      return { scan: pending, pending: true }
    }
  }
  }
}