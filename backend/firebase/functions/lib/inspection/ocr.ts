/**
 * OCR providers for the inspection pipeline.
 *
 * Each provider turns the inspection's photos + typed hints into per-photo
 * independent extractions; the Node merge layer (lib/inspection/merge.ts) is
 * the single authoritative combination step.
 *
 *   * `mock`   — demo/development provider. Echoes the inspector's typed
 *                details as high-confidence fields and fabricates a small
 *                realistic label so the whole flow can be exercised without
 *                the Python OCR service running.
 *   * `paddle` — real provider. Sends the photos to the Python OCR
 *                microservice (PYTHON_OCR_URL) and maps its merged
 *                extraction back onto our field vocabulary.
 */

import { randomUUID } from 'node:crypto'
import admin from 'firebase-admin'
import type { OcrConfidence, OcrProviderResult, PerImageExtract, PhotoInput, InspectorHints, InspectionCategory } from './types.js'
import { runMultipass, type MultipassOutcome } from './multipass.js'
import { geminiVisionOCR } from './gemini-ocr.js'

export interface ProviderInput {
  photos: PhotoInput[]
  category: InspectionCategory
  lang: string
  hints?: InspectorHints
}

const PYTHON_OCR_URL = process.env.PYTHON_OCR_URL || 'http://localhost:8100'
const PY_FIELD_MAP: Record<string, string> = {
  commodity_name: 'commodity_name',
  brand: 'brand',
  manufacturer: 'manufacturer',
  net_quantity: 'net_quantity',
  mrp: 'mrp',
  lot_no: 'batch_no',
  batch_no: 'batch_no',
  mfg_date: 'mfg_date',
  expiry_date: 'expiry_date',
  best_before: 'best_before_date',
  best_before_date: 'best_before_date',
  ingredients_text: 'ingredients_text',
  allergen_info: 'allergen_info',
  required_declarations: 'required_declarations',
  warnings: 'warnings',
  certification_details: 'certification_details',
  contact_info: 'contact_info',
  imported_manufacturer_detail: 'imported_manufacturer_detail',
  country_of_origin: 'country_of_origin',
  storage_conditions: 'storage_conditions',
  customer_care_details: 'customer_care_details',
  consumer_care: 'customer_care_details',
  address: 'contact_info',
  fssai_license: 'required_declarations',
}

/* ------------------------------------------------------------------ */
/* Storage helpers                                                     */
/* ------------------------------------------------------------------ */

export function decodeDataUrl(dataUrl: string): { mime: string; buffer: Buffer } {
  const comma = dataUrl.indexOf(',')
  const meta = comma >= 0 ? dataUrl.slice(0, comma) : ''
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  const mime = /^data:([^;,]+)/.exec(meta)?.[1] ?? 'image/jpeg'
  return { mime, buffer: Buffer.from(b64, 'base64') }
}

/**
 * Save one photo to `scans/{uid}/{ts}-{n}.{ext}` and write a download token so
 * the browser can render it via getDownloadURL. Returns the storage path.
 */
export async function savePhoto(uid: string, index: number, dataUrl: string): Promise<string> {
  const { mime, buffer } = decodeDataUrl(dataUrl)
  if (buffer.length === 0) throw new Error('Photo data is empty.')
  if (buffer.length > 10 * 1024 * 1024) throw new Error('Photo must be 10 MB or smaller.')

  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
  const path = `scans/${uid}/${Date.now()}-${index}.${ext}`
  const file = admin.storage().bucket().file(path)
  const token = randomUUID()

  await file.save(buffer, {
    contentType: mime,
    metadata: {
      contentType: mime,
      cacheControl: 'public, max-age=86400',
      metadata: { firebaseStorageDownloadTokens: token },
    },
  })
  // Belt-and-suspenders: ensure the download token is actually persisted.
  try {
    const [meta] = await file.getMetadata()
    if (!meta.metadata?.firebaseStorageDownloadTokens) {
      await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } })
    }
  } catch {
    /* best-effort */
  }
  return path
}

/* ------------------------------------------------------------------ */
/* mock provider                                                       */
/* ------------------------------------------------------------------ */

function hintField(hints: InspectorHints, key: keyof InspectorHints): { value: string | null; confidence: OcrConfidence } {
  const v = hints?.[key]
  if (v && String(v).trim()) return { value: String(v).trim(), confidence: 'high' }
  return { value: null, confidence: 'low' }
}

function mockPerImage(idx: number, hints: InspectorHints, category: InspectionCategory, lang: string): PerImageExtract {
  const name = hintField(hints, 'product_name')
  const brand = hintField(hints, 'brand')
  const manufacturer = hintField(hints, 'manufacturer')

  const fields: Record<string, string | null> = {
    commodity_name: name.value ?? 'Essential Nut Mix (demo label)',
    brand: brand.value ?? 'Demo Brand',
    manufacturer: manufacturer.value ?? 'Demo Foods Pvt. Ltd., Bengaluru, Karnataka',
    net_quantity: '200 g',
    mrp: '₹120',
    batch_no: 'B4281',
    mfg_date: dateOffset(-120),
    expiry_date: dateOffset(180),
    best_before_date: null,
    ingredients_text: 'Peanuts, cashew, almonds, edible vegetable oil, salt, sugar, milk solids.',
    allergen_info: 'Contains: peanuts and other nuts, milk solids. May contain traces of soy.',
    required_declarations: 'FSSAI Lic. No. 10012023001234',
    warnings: null,
    certification_details: null,
    contact_info: 'Demo Foods Pvt. Ltd., 43 MG Road, Bengaluru, Karnataka 560001',
    imported_manufacturer_detail: null,
    country_of_origin: 'Made in India',
    storage_conditions: 'Store in a cool, dry place. Keep away from direct sunlight.',
    customer_care_details: 'Customer care: 1800-123-4567',
  }

  // Deterministic demo divergences so the result page has something to show
  // for each status band without real OCR.
  const demo = idx + 1
  if (demo >= 2 && !name.value) fields.commodity_name = 'Almond & Raisin Mix (demo label)'
  if (demo >= 3) fields.expiry_date = null // forces an expiry needs_review
  if (demo >= 4) fields.mrp = null // forces an MRP failure
  if (demo >= 5) fields.batch_no = null

  const confidenceFor = (k: string): OcrConfidence =>
    k === 'commodity_name' && fields.commodity_name !== null ? 'high' : 'medium'

  const regions = Object.entries(fields)
    .filter(([, v]) => v)
    .map(([k, v], i) => ({ text: `${k}: ${v}`, bbox: [10, 40 + i * 18, 400, 16] as number[] | null, conf: 0.9 }))

  return {
    index: idx,
    text:
      `Demo label (photo ${idx + 1}) — provider echoes typed details.\n` +
      Object.entries(fields)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n'),
    language: lang,
    confidence: 0.9,
    fields,
    field_confidence: Object.fromEntries(Object.keys(fields).map((k) => [k, confidenceFor(k)])),
    field_evidence: Object.fromEntries(
      Object.entries(fields)
        .filter(([, v]) => v)
        .map(([k, v]) => [k, { text: `${k}: ${v}`, confidence: 0.9, bbox: [10, 40, 400, 16] }]),
    ),
    regions,
  }
}

export function mockProvider(input: ProviderInput): OcrProviderResult {
  const count = input.photos.length || 1
  const base = mockPerImage(0, input.hints ?? {}, input.category, input.lang)
  const perImages: PerImageExtract[] = [base]
  for (let i = 1; i < count; i++) {
    const pi = mockPerImage(i, input.hints ?? {}, input.category, input.lang)
    perImages.push(pi)
  }
  return { provider: 'mock', demo: true, perImages, engines: ['mock'], unclear: [] }
}

/* ------------------------------------------------------------------ */
/* Python sidecar reachability (fast pre-check)                      */
/* ------------------------------------------------------------------ */

/** Probe the Python OCR sidecar with a short timeout — never block the scan. */
async function pythonReachable(timeoutMs = 6000): Promise<boolean> {
  try {
    const res = await fetch(`${PYTHON_OCR_URL}/health`, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/* paddle provider (real OCR microservice)                             */
/* ------------------------------------------------------------------ */

async function callPythonService(photos: PhotoInput[], lang: string, category: InspectionCategory): Promise<any> {
  const images = photos
    .map((p) => p.data)
    .filter((d): d is string => typeof d === 'string' && !!d)
  if (images.length === 0) throw new Error('No image data provided for OCR.')

  const res = await fetch(`${PYTHON_OCR_URL}/ocr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images, lang: lang || 'en', fast: true, category: category ?? undefined }),
    signal: AbortSignal.timeout(90_000),
  })
  if (!res.ok) throw new Error(`Python OCR service returned ${res.status}.`)
  const data = await res.json()
  if (!data?.ok || (!data.ocr_text && (!data.fields || Object.keys(data.fields).length === 0))) {
    throw new Error('Python OCR service returned no readable text.')
  }
  return data
}

export async function paddleProvider(input: ProviderInput): Promise<OcrProviderResult> {
  // Fast pre-check: if the Python sidecar is unreachable, skip the two slow
  // 90s OCR calls entirely and go straight to Gemini (real OCR, no waiting).
  if (!(await pythonReachable())) {
    console.warn('⚠️ Python OCR sidecar unreachable (fast check) — using Gemini Vision directly.')
    if (process.env.GEMINI_API_KEY) {
      try {
        return await geminiVisionOCR(input.photos, input.lang, input.category)
      } catch (e3) {
        console.warn('⚠️ Gemini OCR failed, falling back to MOCK provider:', (e3 as Error)?.message ?? e3)
      }
    }
    return mockProvider(input)
  }
  try {
    const outcome: MultipassOutcome = await runMultipass(input.photos, input.lang, input.category)
    return {
      provider: outcome.engines.join('+'),
      demo: false,
      perImages: outcome.perImages,
      engines: outcome.engines,
      unclear: outcome.unclearLines,
    }
  } catch (e) {
    console.warn('⚠️ Multipass failed, falling back to raw Paddle:', (e as Error)?.message ?? e)
    try {
      // Degrade to the legacy single-pass behaviour
      const data = await callPythonService(input.photos, input.lang, input.category)
      const mapped: Record<string, string | null> = {}
      const rawFields = (data.fields ?? {}) as Record<string, { value?: unknown; confidence?: unknown }>
      for (const [pyKey, f] of Object.entries(rawFields)) {
        const ourKey = PY_FIELD_MAP[pyKey] ?? pyKey
        const v = f?.value
        const s = v == null ? '' : String(v).trim()
        if (s) mapped[ourKey] = s
      }
      const perImages: PerImageExtract[] = [{
        index: 0,
        text: String(data.ocr_text ?? ''),
        language: input.lang || 'en',
        confidence: typeof data.ocr_confidence === 'number' ? data.ocr_confidence : 0.75,
        fields: mapped,
        field_confidence: Object.fromEntries(
          Object.entries(rawFields).map(([k, f]) => [PY_FIELD_MAP[k] ?? k, confFromRaw(f?.confidence)]),
        ),
        field_evidence: Object.fromEntries(
          Object.entries(mapped)
            .filter(([, v]) => v)
            .map(([k, v]) => [k, { text: String(v), confidence: null, bbox: null }]),
        ),
        regions: [],
      }]
      return { provider: 'paddle', demo: false, perImages, engines: ['paddle'], unclear: [] }
    } catch (e2) {
      console.warn('⚠️ Python OCR service unreachable, trying Gemini Vision:', (e2 as Error)?.message ?? e2)
      // If Gemini key is configured, do REAL OCR via Gemini (no Python needed).
      if (process.env.GEMINI_API_KEY) {
        try {
          const geminiRes = await geminiVisionOCR(input.photos, input.lang, input.category)
          return geminiRes
        } catch (e3) {
          console.warn('⚠️ Gemini OCR failed, falling back to MOCK provider:', (e3 as Error)?.message ?? e3)
        }
      }
      // Final fallback: mock provider so inspection never hard-fails
      return mockProvider(input)
    }
  }
}

function confFromRaw(raw: unknown): OcrConfidence {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw >= 0.85) return 'high'
    if (raw >= 0.6) return 'medium'
    return 'low'
  }
  const v = String(raw ?? '').toLowerCase().trim()
  if (v === 'high' || v === 'high.0' || v === '1') return 'high'
  if (v === 'low' || v === 'low.0' || v === '0') return 'low'
  return 'medium'
}

/* ------------------------------------------------------------------ */
/* Provider resolution                                                 */
/* ------------------------------------------------------------------ */

export function resolveProvider(name?: string): 'gemini' | 'paddle' | 'mock' {
  const n = (name ?? process.env.OCR_PROVIDER ?? 'mock').trim().toLowerCase()
  if (n === 'paddle') return 'paddle'
  if (n === 'gemini') return 'gemini'
  // Default when no provider chosen: prefer real OCR via Gemini if a key exists.
  if ((n === 'mock' || n === '') && process.env.GEMINI_API_KEY && process.env.OCR_PROVIDER === undefined) {
    return 'gemini'
  }
  return 'mock'
}

export async function runProvider(input: ProviderInput): Promise<OcrProviderResult> {
  const provider = resolveProvider()
  if (provider === 'gemini') {
    // Gemini provider: real OCR directly; never falls back to mock when key exists.
    if (!process.env.GEMINI_API_KEY) {
      console.warn('⚠️ OCR_PROVIDER=gemini but no GEMINI_API_KEY — falling back to mock.')
      return mockProvider(input)
    }
    try {
      return await geminiVisionOCR(input.photos, input.lang, input.category)
    } catch (e) {
      console.warn('⚠️ Gemini OCR failed, falling back to MOCK provider:', (e as Error)?.message ?? e)
      return mockProvider(input)
    }
  }
  return provider === 'paddle' ? paddleProvider(input) : mockProvider(input)
}

function dateOffset(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}