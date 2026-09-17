/**
 * Inspections route — MISA-style scan flow.
 *
 *   POST     /api/inspections            create inspection + inline analysis (never throws)
 *   POST     /api/inspections/analyze    retry analysis for an existing scan
 *   POST     /api/inspections/:id/verify mark changes as verified
 *   PUT      /api/inspections/:id/remarks save inspector remarks
 *   GET      /api/inspections/:id        fetch one inspection
 *
 * Documents live in the shared `scans` collection (owner + staff protected by
 * the security rules). Photos are uploaded admin-side to `scans/{uid}/…` and
 * referenced by storage path.
 */

import { Router, Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import { createScanDoc, getScanDoc, updateScanDoc } from '../supabase-admin.js'
import { analyzeInspection } from '../lib/inspection/analyze.js'
import type { AnalysisResult, InspectionCategory, InspectionStatus, OcrStatus } from '../lib/inspection/types.js'

const router = Router()

const MAX_PHOTOS = 5

interface PhotoPayload {
  data?: string
  path?: string
  name?: string
}

interface CreateBody {
  photos: PhotoPayload[]
  category?: string | null
  lang?: string
  state?: string
  product_name?: string
  brand?: string
  manufacturer?: string
  barcode?: string
  notes?: string
  hints?: Record<string, string>
}

function normalizeCategory(v: unknown): InspectionCategory {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  if (s === 'edible' || s === 'food') return 'edible'
  if (s === 'non_edible' || s === 'non-edible' || s === 'nonedible') return 'non_edible'
  return null
}

function errorMessage(e: unknown): string {
  const m = (e as Error)?.message
  return typeof m === 'string' && m.trim() ? m.trim().slice(0, 300) : 'Analysis failed.'
}

/** Firestore-safe value replacer (no undefined). */
function safe(v: unknown): unknown {
  return v === undefined ? null : v
}

/** Recursively make any value Firestore-writable (undefined/NaN/±Infinity → null). */
function sanitizeForFirestore(value: unknown): unknown {
  if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) return null
  if (Array.isArray(value)) return value.map(sanitizeForFirestore)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const s = sanitizeForFirestore(v)
      if (s !== undefined) out[k] = s
    }
    return out
  }
  return value
}

function buildDoc(
  uid: string,
  body: CreateBody,
  ids: { scanId: string; now: string },
  analysis?: AnalysisResult,
): Record<string, unknown> {
  const { scanId, now } = ids
  const hints = body.hints ?? {}
  const category = normalizeCategory(body.category ?? hints.category)
  const productName = analysis?.product_name ?? hints.product_name ?? body.product_name ?? ''
  const status: InspectionStatus = analysis?.status ?? 'needs_review'
  const ocrStatus: OcrStatus = analysis?.ocr_status ?? 'pending'

  const doc: Record<string, unknown> = {
    user_id: uid,
    product_name: productName,
    brand: analysis?.brand ?? hints.brand ?? body.brand ?? '',
    manufacturer: analysis?.manufacturer ?? hints.manufacturer ?? body.manufacturer ?? '',
    category: category ?? null,
    barcode: analysis?.barcode ?? hints.barcode ?? body.barcode ?? '',
    scan_state: body.state ?? '',
    notes: body.notes ?? '',
    remarks: '',
    photo_path: '',
    photo_paths: [],
    status,
    ocr_status: ocrStatus,
    ocr_error: null,
    ocr_text: analysis?.ocr_text ?? '',
    ocr_language: analysis?.ocr_language ?? (body.lang ?? 'en'),
    ocr_provider: analysis?.ocr_provider ?? null,
    ocr_confidence: analysis?.ocr_confidence ?? null,
    ocr_regions: [],
    ocr_fields: analysis?.ocr_fields ?? {},
    ocr_engines: analysis?.ocr_engines ?? [],
    unclear_text: analysis?.unclear_text ?? [],
    verification: analysis?.verification ?? null,
    field_sources: analysis?.field_sources ?? {},
    field_confidence: analysis?.field_confidence ?? {},
    field_evidence: analysis?.field_evidence ?? {},
    conflicts: analysis?.conflicts ?? [],
    compliance_findings: analysis?.compliance_findings ?? [],
    compliance_score: analysis?.compliance_score ?? null,
    compliance_breakdown: analysis?.compliance_breakdown ?? null,
    previous_scan_id: analysis?.previous_scan_id ?? null,
    match_confidence: analysis?.match_confidence ?? null,
    changes: analysis?.changes ?? [],
    changes_verified: false,
    briefing: analysis?.briefing
      ? { ...analysis.briefing, provider: analysis.briefing.provider }
      : {
          purpose: '',
          summary: '',
          key_points: [],
          recommendations: [],
          assistant_status: 'skipped',
          provider: '',
        },
    analyzed_at: analysis?.analyzed_at ?? null,
    created_at: now,
    updated_at: now,
    engine: 'misa',
    // Legacy mirrors so older dashboard surfaces keep rendering.
    overall_score: analysis?.compliance_score ?? 0,
    verdict: analysis?.compliance_display.verdict ?? (status === 'needs_review' ? 'PENDING' : 'COMPLIANT'),
    risk_score: analysis ? Math.max(0, 100 - analysis.compliance_score) : 0,
    summary: analysis?.summary ?? '',
    image_url: '',
    image_urls: [],
    id: scanId,
  }
  return doc
}

function toPhotoPayload(raw: unknown): PhotoPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as PhotoPayload
  if (typeof p.data === 'string' && p.data.trim()) return { data: p.data.trim(), name: p.name }
  if (typeof p.path === 'string' && p.path.trim()) return { path: p.path.trim(), name: p.name }
  return null
}

function toCreateBody(req: Request): CreateBody {
  const b = (req.body ?? {}) as CreateBody
  const photos: PhotoPayload[] = Array.isArray(b.photos)
    ? b.photos.map(toPhotoPayload).filter((p): p is PhotoPayload => p !== null)
    : []
  return {
    photos,
    category: typeof b.category === 'string' ? b.category : b.category,
    lang: typeof b.lang === 'string' ? b.lang : 'en',
    state: typeof b.state === 'string' ? b.state.trim().slice(0, 64) : undefined,
    product_name: typeof b.product_name === 'string' ? b.product_name : undefined,
    brand: typeof b.brand === 'string' ? b.brand : undefined,
    manufacturer: typeof b.manufacturer === 'string' ? b.manufacturer : undefined,
    barcode: typeof b.barcode === 'string' ? b.barcode : undefined,
    notes: typeof b.notes === 'string' ? b.notes : undefined,
    hints: typeof b.hints === 'object' && b.hints ? b.hints : undefined,
  }
}

/** Finalize a scan document with the full analysis outcome. */
async function finalizeScan(scanId: string, result: AnalysisResult, savedPaths: string[]): Promise<void> {
  const now = new Date().toISOString()
  const current = await getScanDoc(scanId).catch(() => null)
  const existing = current as Record<string, unknown> | null
  const paths = savedPaths.length > 0 ? savedPaths : ((existing?.photo_paths as string[] | undefined) ?? [])
  const patch: Record<string, unknown> = {
    product_name: safe(result.product_name),
    brand: safe(result.brand),
    manufacturer: safe(result.manufacturer),
    category: safe(result.category),
    barcode: safe(result.barcode),
    status: result.status,
    ocr_status: result.ocr_status,
    ocr_error: null,
    ocr_text: safe(result.ocr_text),
    ocr_language: result.ocr_language,
    ocr_provider: result.ocr_provider,
    ocr_confidence: safe(result.ocr_confidence),
    ocr_regions: result.ocr_regions,
    ocr_fields: result.ocr_fields,
    ocr_engines: result.ocr_engines ?? [],
    unclear_text: result.unclear_text ?? [],
    verification: result.verification ?? null,
    field_sources: result.field_sources,
    field_confidence: result.field_confidence,
    field_evidence: result.field_evidence,
    conflicts: result.conflicts,
    compliance_findings: result.compliance_findings,
    compliance_score: safe(result.compliance_score),
    compliance_breakdown: result.compliance_breakdown ?? null,
    previous_scan_id: safe(result.previous_scan_id),
    match_confidence: safe(result.match_confidence),
    changes: result.changes,
    changes_verified: false,
    briefing: result.briefing,
    analyzed_at: result.analyzed_at,
    overall_score: safe(result.compliance_score),
    verdict: result.compliance_display.verdict,
    risk_score: Math.max(0, 100 - result.compliance_score),
    summary: safe(result.summary),
    photo_paths: Array.isArray(paths) ? paths : [],
    photo_path: Array.isArray(paths) && paths.length > 0 ? paths[0] : '',
    image_urls: Array.isArray(paths) ? paths : [],
    image_url: Array.isArray(paths) && paths.length > 0 ? paths[0] : '',
    updated_at: now,
  }
  await updateScanDoc(scanId, sanitizeForFirestore(patch) as Record<string, unknown>)
}

router.post('/', async (req: Request, res: Response): Promise<void> => {
  const uid = (req as any).uid as string
  const body = toCreateBody(req)
  const now = new Date().toISOString()

  if (body.photos.length === 0) {
    res.status(400).json({ ok: false, error: 'Add at least one label photo.' })
    return
  }
  if (body.photos.length > MAX_PHOTOS) {
    res.status(400).json({ ok: false, error: `At most ${MAX_PHOTOS} photos per inspection.` })
    return
  }

  // Create the scan document FIRST (status needs_review / ocr pending).
  const scanId = randomUUID()
  const initial = sanitizeForFirestore(buildDoc(uid, body, { scanId, now })) as Record<string, unknown>
  let analysis: AnalysisResult | null = null
  let savedPaths: string[] = []
  let ocrError: string | null = null

  try {
    await createScanDoc({ ...initial, id: scanId })
  } catch (e) {
    console.error('⚠️ inspection create-persist failed:', (e as Error)?.message ?? e)
    res.status(500).json({ ok: false, error: 'Could not create the inspection. Please try again.' })
    return
  }

  // Inline analysis — NEVER throws to the caller; failures surface as a
  // pending/failed document the dashboard can retry.
  try {
    const outcome = await analyzeInspection({
      uid,
      photos: body.photos.map((p) => ({ data: p.data, path: p.path })),
      category: normalizeCategory(body.category ?? body.hints?.category),
      lang: body.lang ?? 'en',
      hints: body.hints ?? {
        product_name: body.product_name,
        brand: body.brand,
        manufacturer: body.manufacturer,
        barcode: body.barcode,
      },
    })
    analysis = outcome.result
    savedPaths = outcome.savedPaths
    await finalizeScan(scanId, outcome.result, savedPaths)
  } catch (e) {
    ocrError = errorMessage(e)
    console.warn('⚠️ inspection analysis failed (kept pending):', ocrError)
    try {
      await updateScanDoc(scanId, { ocr_status: 'failed', ocr_error: ocrError, status: 'needs_review', updated_at: new Date().toISOString() })
    } catch (ue) {
      console.warn('⚠️ failed to flag inspection as failed:', (ue as Error)?.message ?? ue)
    }
  }

  res.json({ ok: true, scan_id: scanId, pending: !analysis, result: analysis, error: ocrError })
})

router.post('/analyze', async (req: Request, res: Response): Promise<void> => {
  const uid = (req as any).uid as string
  const scanId = typeof (req.body as any)?.scan_id === 'string' ? (req.body as any).scan_id : ''
  if (!scanId) {
    res.status(400).json({ ok: false, error: 'scan_id is required.' })
    return
  }

  const existing = await getScanDoc(scanId).catch(() => null)
  if (!existing) {
    res.status(404).json({ ok: false, error: 'Inspection not found.' })
    return
  }
  const data = existing as Record<string, unknown>
  if (data.user_id !== uid) {
    res.status(403).json({ ok: false, error: 'You can only retry your own inspections.' })
    return
  }

  const paths: string[] = Array.isArray(data.photo_paths)
    ? data.photo_paths.filter((p): p is string => typeof p === 'string')
    : []
  if (paths.length === 0) {
    res.status(400).json({ ok: false, error: 'This inspection has no stored photos to re-analyse.' })
    return
  }

  let analysis: AnalysisResult | null = null
  try {
    const outcome = await analyzeInspection({
      uid,
      photos: paths.map((path) => ({ path })),
      category: normalizeCategory(data.category),
      lang: typeof data.ocr_language === 'string' ? data.ocr_language : 'en',
      hints: {
        product_name: typeof data.product_name === 'string' ? data.product_name : undefined,
        brand: typeof data.brand === 'string' ? data.brand : undefined,
        manufacturer: typeof data.manufacturer === 'string' ? data.manufacturer : undefined,
        barcode: typeof data.barcode === 'string' ? data.barcode : undefined,
      },
      previousScanId: scanId,
    })
    analysis = outcome.result
    await finalizeScan(scanId, outcome.result, [])
  } catch (e) {
    const msg = errorMessage(e)
    await updateScanDoc(scanId, { ocr_status: 'failed', ocr_error: msg, status: 'needs_review', updated_at: new Date().toISOString() }).catch(() => undefined)
    res.json({ ok: true, scan_id: scanId, pending: true, result: null, error: msg })
    return
  }

  res.json({ ok: true, scan_id: scanId, pending: false, result: analysis })
})

router.post('/:id/verify', async (req: Request, res: Response): Promise<void> => {
  const uid = (req as any).uid as string
  const id = req.params.id
  const verified = (req.body as any)?.verified !== false

  const existing = await getScanDoc(id).catch(() => null)
  if (!existing) {
    res.status(404).json({ ok: false, error: 'Inspection not found.' })
    return
  }
  const data = existing as Record<string, unknown>
  if (data.user_id !== uid && !['inspector', 'admin', 'super_admin'].includes((req as any).role ?? '')) {
    res.status(403).json({ ok: false, error: 'Not allowed to verify this inspection.' })
    return
  }

  await updateScanDoc(id, {
    changes_verified: verified,
    updated_at: new Date().toISOString(),
  })
  res.json({ ok: true, changes_verified: Boolean(verified) })
})

router.put('/:id/remarks', async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id
  const remarks = String((req.body as any)?.remarks ?? '').slice(0, 2000)

  const existing = await getScanDoc(id).catch(() => null)
  if (!existing) {
    res.status(404).json({ ok: false, error: 'Inspection not found.' })
    return
  }
  const data = existing as Record<string, unknown>
  if (data.user_id !== (req as any).uid && !['inspector', 'admin', 'super_admin'].includes((req as any).role ?? '')) {
    res.status(403).json({ ok: false, error: 'Not allowed to add remarks.' })
    return
  }

  await updateScanDoc(id, {
    remarks,
    notes: remarks,
    updated_at: new Date().toISOString(),
  })
  res.json({ ok: true, remarks })
})

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id
  const existing = await getScanDoc(id).catch(() => null)
  if (!existing) {
    res.status(404).json({ ok: false, error: 'Inspection not found.' })
    return
  }
  const data = existing as Record<string, unknown>
  const result: AnalysisResult | null =
    data.ocr_status === 'done' && data.compliance_findings ? (data as unknown as AnalysisResult) : null
  res.json({ ok: true, scan_id: id, result, doc: { id, ...data } })
})

export default router