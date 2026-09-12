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
import { COLLECTIONS } from './db'
import type {
  AIIinsight,
  DetectedLabel,
  DetectedSummary,
  ExtractedDeclarations,
  ExtractedField,
  InspectorAssistant,
  OcrBlock,
  OcrExtract,
  RuleCheck,
  ScanEngine,
  ScanRow,
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
}

/** Wire shape expected by the Cloud Function (each image wrapped as {data}). */
interface ScanAnalysisRequest extends ScanAnalysisMeta {
  images: { data: string }[]
}

export interface RawAnalysis {
  product_name?: string
  brand?: string
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
    product_name: out.result.product_name ?? meta.product_name ?? 'Unknown',
    brand: out.result.brand ?? '',
    manufacturer: meta.manufacturer ?? out.result.brand ?? '',
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
  try {
    const urls = await uploadScanImages(files)
    const patch: Record<string, unknown> = {
      image_urls: urls,
      image_url: urls[0] ?? '',
      updated_at: new Date().toISOString(),
    }
    await updateDoc(doc(db, COLLECTIONS.SCANS, scanId), patch)
    return urls
  } catch {
    return []
  }
}

/**
 * Run the AI inspection over label photos.
 *
 * Priority: server `scanAnalysis` Cloud Function → Google Gemini AI →
 * on-device free OCR engine → staff-review queue. Persistence is
 * best-effort everywhere, so a result row is always returned and the user
 * never hits a hard analysis error.
 */
export async function runScanAnalysis(input: ScanAnalysisInput): Promise<{ scan: ScanRow; pending: boolean }> {
  const fn = httpsCallable<ScanAnalysisRequest, ScanAnalysisOutput>(functions, 'scanAnalysis')
  let out: ScanAnalysisOutput
  try {
    const res = await fn({
      images: (input.images ?? []).map((src) => ({ data: src })),
      lang: input.lang ?? 'en',
      product_name: input.product_name,
      manufacturer: input.manufacturer,
      barcode: input.barcode,
    })
    out = res.data
    if (!out?.ok || !out.scan_id) throw new Error('Empty AI response from server.')
    return { scan: buildScanRow(out.scan_id, out, input.lang ?? 'en', input), pending: false }
  } catch (_fnErr) {
    // 1) Google Gemini AI analysis (high-accuracy vision extraction + rules).
    try {
      const geminiScan = await runGeminiScan({
        images: input.images,
        hiResImages: input.hiResImages,
        lang: input.lang ?? 'en',
        product_name: input.product_name,
        manufacturer: input.manufacturer,
        barcode: input.barcode,
        positions: input.positions,
      })
      return { scan: geminiScan, pending: false }
    } catch (_geminiErr) {
      // 2) Free on-device analysis (Tesseract) before falling back to manual review.
      try {
    const localScan = await runLocalScan({
      images: input.images,
      hiResImages: input.hiResImages,
      lang: input.lang ?? 'en',
      product_name: input.product_name,
      manufacturer: input.manufacturer,
      barcode: input.barcode,
      positions: input.positions,
    })
    return { scan: localScan, pending: false }
  } catch (_localErr) {
      // Local OCR failed. Both the server and on-device paths are
      // unavailable right now — always queue the photo for staff review so
      // the scan is never lost and the user never hits a dead-end.
      const product = input.product_name?.trim() || 'Label scan'
      let scanId = `local-pending-${Date.now()}`
      try {
        scanId = await createScan({
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
        })
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
      }
      saveLocalScan(pending)
      return { scan: pending, pending: true }
    }
  }
  }
}