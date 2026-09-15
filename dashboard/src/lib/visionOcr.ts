/**
 * AuditX v3.0 — Google Cloud Vision OCR client (backend-only).
 *
 * Text extraction runs on the AuditX Express API (Render), where the Google
 * Cloud service-account secret lives. The browser never holds the key — it
 * only sends the image data URL + its Firebase ID token. The extracted text
 * is then fed into the existing AI analysis pipeline as a reference
 * transcript, so small/dense label text is read more reliably.
 *
 * The call is best-effort: any failure returns null so the scan can fall back
 * to the normal analysis without blocking the user.
 */

import { auth } from './firebase'
import { CONFIG } from './config'
import { fetchWithTimeout } from './net'

const MAX_IMAGES = 6

export interface FastOcrField {
  value: string | null
  confidence: 'high' | 'medium' | 'low'
  source?: string | null
}

export interface FastOcrResultRule {
  rule_id: string
  field: string
  status: 'PASS' | 'FAIL' | 'REVIEW' | 'NA'
  reason: string
  detected_value?: string | null
  regulation?: string
  verification_type?: string
  weight?: number
}

export interface FastOcrVerdict {
  score: number
  verdict: string
  risk: string
  summary: string
  counts: { passed: number; failed: number; review: number; na: number }
}

export interface VisionOcrBlock {
  text: string
  confidence: number | null
}

export interface FieldSource {
  image?: number
  text?: string
  confidence?: number | null
  bbox?: [number, number, number, number] | null
}

export interface FieldConflict {
  field: string
  label: string
  values: Array<{ image: number; value: string }>
}

export interface RegionBlock {
  text: string
  confidence: number
  region: [number, number, number, number]
  region_id?: string
}

export interface RegionImage {
  image_id?: string
  blocks: RegionBlock[]
  /** Missed-text-region detection (#9): counts reported by the OCR service. */
  text_regions_detected?: number
  lines_extracted?: number
  missed_regions_checked?: number
}

export interface ImageQualityScore {
  score: number
  verdict?: string
  message?: string
}

export interface ImageRegionsSummary {
  text_regions_detected: number
  lines_extracted: number
  missed_regions_checked: number
  missed_found: number
  missed_regions: Array<{ image_id: string; region: [number, number, number, number] }>
}

export interface VisionOcrResult {
  provider: 'google_vision' | 'paddleocr'
  text: string
  blocks: VisionOcrBlock[]
  languages: string[]
  /** Fast deterministic extraction (PaddleOCR path only) — lets the caller
   *  return an immediate valid result instead of waiting for Gemini OCR. */
  fields?: Record<string, FastOcrField>
  rules?: FastOcrResultRule[]
  result?: FastOcrVerdict
  processing_time_ms?: number
  /** Adaptive evidence layer: per-image OCR blocks with bounding boxes. */
  regions?: RegionImage[]
  image_quality?: ImageQualityScore[]
  /** Missed-text-region detection summary (#9). */
  image_regions?: ImageRegionsSummary
  /** Misa-style multi-image merge metadata (PaddleOCR path). */
  field_sources?: Record<string, number>
  field_confidence?: Record<string, string | null>
  field_evidence?: Record<string, FieldSource>
  conflicts?: FieldConflict[]
  category?: string | null
}

/**
 * Run OCR on up to 6 photos. Primary provider is the PaddleOCR microservice
 * (parallel, fast path); Google Cloud Vision is the backend fallback.
 * Returns null on any failure (credentials missing, backend offline, empty
 * text) — callers should treat null as "no OCR hint available".
 */
export async function runVisionOcr(images: string[], lang = 'en', category?: string | null): Promise<VisionOcrResult | null> {
  if (!images || images.length === 0) return null
  const user = auth.currentUser
  if (!user) return null
  const base = CONFIG.AUDITX_API_URL.replace(/\/+$/, '')
  const token = await user.getIdToken(true).catch(() => null)
  if (!token) return null

  let res: Response
  try {
    res = await fetchWithTimeout(`${base}/api/ocr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ images: images.slice(0, MAX_IMAGES), language: lang, fast: true, category }),
    }, 45000)
  } catch {
    return null
  }
  if (!res.ok) return null

  let data: {
    ok?: boolean
    text?: string
    blocks?: VisionOcrResult['blocks']
    languages?: string[]
    fields?: Record<string, FastOcrField>
    rules?: FastOcrResultRule[]
    result?: FastOcrVerdict
    processing_time_ms?: number
    regions?: RegionImage[]
    image_quality?: ImageQualityScore[]
    image_regions?: ImageRegionsSummary
    field_sources?: Record<string, number>
    field_confidence?: Record<string, string | null>
    field_evidence?: Record<string, FieldSource>
    conflicts?: FieldConflict[]
  }
  try {
    data = (await res.json()) as typeof data
  } catch {
    return null
  }
  const text = String(data.text ?? '').trim()
  if (!data.ok || !text) return null
  return {
    provider: (data.result ? 'paddleocr' : 'google_vision') as VisionOcrResult['provider'],
    text,
    blocks: Array.isArray(data.blocks) ? data.blocks : [],
    languages: Array.isArray(data.languages) && data.languages.length > 0 ? data.languages : ['en'],
    fields: data.fields,
    rules: data.rules,
    result: data.result,
    processing_time_ms: data.processing_time_ms,
    regions: Array.isArray(data.regions) ? data.regions : [],
    image_quality: Array.isArray(data.image_quality) ? data.image_quality : [],
    image_regions: data.image_regions,
    field_sources: data.field_sources,
    field_confidence: data.field_confidence,
    field_evidence: data.field_evidence,
    conflicts: Array.isArray(data.conflicts) ? data.conflicts : [],
    category,
  }
}

/**
 * Decide whether the fast deterministic OCR result is good enough to return
 * immediately (skipping the expensive Gemini vision call). Safe gate: most
 * core fields must be present with real extracted values.
 */
export function fastOcrIsUsable(ocr: VisionOcrResult | null): boolean {
  if (!ocr || !ocr.fields || !ocr.result || !ocr.rules) return false
  if (ocr.text.trim().length < 100) return false
  const CORE = ['mrp', 'net_quantity', 'manufacturer', 'packer', 'address', 'mfg_date', 'best_before', 'consumer_care', 'commodity_name', 'country_of_origin']
  let found = 0
  for (const key of CORE) {
    const f = ocr.fields[key]
    if (f && f.value && (f.confidence === 'high' || f.confidence === 'medium')) found++
  }
  if (found < 4) return false
  if (ocr.result.score < 50) return false
  return true
}