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

import { uploadPhoto } from '../../supabase-admin.js'
import type { OcrConfidence, OcrProviderResult, PerImageExtract, PhotoInput, InspectorHints, InspectionCategory } from './types.js'
import { runMultipass, type MultipassOutcome } from './multipass.js'
import { geminiVisionOCR } from './gemini-ocr.js'
import { openRouterVisionOCR } from './openrouter-ocr.js'

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
 * Save one photo to `scans/{uid}/{ts}-{n}.{ext}` (Supabase Storage bucket
 * `scans`, public read). Returns the storage path.
 */
export async function savePhoto(uid: string, index: number, dataUrl: string): Promise<string> {
  const { mime, buffer } = decodeDataUrl(dataUrl)
  if (buffer.length === 0) throw new Error('Photo data is empty.')
  if (buffer.length > 10 * 1024 * 1024) throw new Error('Photo must be 10 MB or smaller.')

  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
  const path = `scans/${uid}/${Date.now()}-${index}.${ext}`
  await uploadPhoto(path, buffer, mime)
  return path
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
  // Real OCR only — no fabricated fallback. Throws honestly when unreadable.
  if (!(await pythonReachable())) {
    throw new Error('Python OCR sidecar unreachable.')
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
      throw new Error(`Python OCR failed: ${(e2 as Error)?.message ?? e2}`)
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
/* Multi-report runner (Report 1/2/3 in parallel)                     */
/* ------------------------------------------------------------------ */

export type ReportName = 'report_1' | 'report_2' | 'report_3'

export interface ReportOutcome {
  name: ReportName
  provider: 'paddle' | 'gemini' | 'openrouter'
  ok: boolean
  result: OcrProviderResult | null
  error: string | null
  latencyMs: number
}

export type ProviderSelection = 'paddle' | 'gemini' | 'openrouter' | 'all'

/**
 * Which reports to run. 'all' (default) runs every available report in
 * parallel for adjudication. An explicit provider runs only that report
 * (single-source). NOTE: 'mock'/demo mode was removed — fabricated label
 * data is never returned; failures are honest errors.
 */
export function resolveProvider(name?: string): ProviderSelection {
  const n = (name ?? process.env.OCR_PROVIDER ?? 'all').trim().toLowerCase()
  if (n === 'paddle') return 'paddle'
  if (n === 'gemini') return 'gemini'
  if (n === 'openrouter') return 'openrouter'
  if (n === 'mock') {
    console.warn('⚠️ OCR_PROVIDER=mock is retired (no fabricated data) — running all available real reports.')
  }
  return 'all'
}

async function runOneReport(
  name: ReportName,
  provider: ReportOutcome['provider'],
  fn: () => Promise<OcrProviderResult>,
): Promise<ReportOutcome> {
  const t0 = Date.now()
  try {
    const result = await fn()
    return { name, provider, ok: true, result, error: null, latencyMs: Date.now() - t0 }
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    console.warn(`⚠️ ${name} (${provider}) failed:`, msg)
    return { name, provider, ok: false, result: null, error: msg, latencyMs: Date.now() - t0 }
  }
}

/**
 * Run up to 3 independent OCR reports concurrently:
 *   Report 1 = PaddleOCR Python sidecar (multipass + Vision + Gemini verify)
 *   Report 2 = Gemini Vision direct
 *   Report 3 = OpenRouter Vision direct
 * Reports whose backend is not configured are skipped (not faked).
 * NEVER throws for missing reports; callers adjudicate what succeeded.
 */
export async function runVerificationReports(input: ProviderInput): Promise<ReportOutcome[]> {
  const selection = resolveProvider()
  const jobs: Array<Promise<ReportOutcome> | null> = [
    selection === 'all' || selection === 'paddle'
      ? runOneReport('report_1', 'paddle', () => paddleProvider(input))
      : null,
    selection === 'all' || selection === 'gemini'
      ? (process.env.GEMINI_API_KEY
        ? runOneReport('report_2', 'gemini', () => geminiVisionOCR(input.photos, input.lang, input.category))
        : Promise.resolve<ReportOutcome>({
          name: 'report_2', provider: 'gemini', ok: false, result: null,
          error: 'GEMINI_API_KEY is not set.', latencyMs: 0,
        }))
      : null,
    selection === 'all' || selection === 'openrouter'
      ? (process.env.OPENROUTER_API_KEY
        ? runOneReport('report_3', 'openrouter', () => openRouterVisionOCR(input.photos, input.lang, input.category))
        : Promise.resolve<ReportOutcome>({
          name: 'report_3', provider: 'openrouter', ok: false, result: null,
          error: 'OPENROUTER_API_KEY is not set.', latencyMs: 0,
        }))
      : null,
  ]
  let outcomes = await Promise.all(jobs.filter((j): j is Promise<ReportOutcome> => j !== null))

  // Fallback: the selected report(s) all failed — auto-try every OTHER
  // available report before giving up. A set OCR_PROVIDER is a preference,
  // never a dead end.
  if (outcomes.every((o) => !o.ok) && selection !== 'all') {
    const tried = new Set(outcomes.map((o) => o.provider))
    console.warn(`⚠️ selected provider '${selection}' failed — auto-trying remaining reports.`)
    const fallbackJobs: Array<Promise<ReportOutcome>> = []
    if (!tried.has('paddle')) {
      fallbackJobs.push(runOneReport('report_1', 'paddle', () => paddleProvider(input)))
    }
    if (!tried.has('gemini') && process.env.GEMINI_API_KEY) {
      fallbackJobs.push(runOneReport('report_2', 'gemini', () => geminiVisionOCR(input.photos, input.lang, input.category)))
    }
    if (!tried.has('openrouter') && process.env.OPENROUTER_API_KEY) {
      fallbackJobs.push(runOneReport('report_3', 'openrouter', () => openRouterVisionOCR(input.photos, input.lang, input.category)))
    }
    if (fallbackJobs.length > 0) {
      const fallbackOutcomes = await Promise.all(fallbackJobs)
      outcomes = [...outcomes, ...fallbackOutcomes]
    }
  }

  const okCount = outcomes.filter((o) => o.ok).length
  console.log(`🔍 verification reports: ${outcomes.map((o) => `${o.name}=${o.provider}:${o.ok ? 'ok' : 'fail'}`).join(', ')}`)
  if (okCount === 0) {
    const reasons = outcomes.map((o) => `${o.provider}: ${o.error ?? 'failed'}`).join('; ')
    throw new Error(
      `The label could not be read (${reasons}). ` +
      'Checklist for the operator: (1) Report 1 needs the Python OCR service live and PYTHON_OCR_URL set on the backend; ' +
      '(2) Report 2 needs GEMINI_API_KEY set; (3) Report 3 needs OPENROUTER_API_KEY set. ' +
      'Retake the photo with better lighting and retry — no fabricated data is ever returned.',
    )
  }
  return outcomes
}