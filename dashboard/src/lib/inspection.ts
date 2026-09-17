/**
 * MISA-style inspection client — talks to the Express backend
 * (/api/inspections) the same way products/claims do, and resolves the
 * private storage photo paths into renderable URLs via getDownloadURL.
 */

import { accessToken, currentUid, supabase } from './supabase'
import { fetchWithTimeout } from './net'
import { CONFIG } from './config'

export type InspectionCategory = 'edible' | 'non_edible' | null
export type InspectionStatus = 'compliant' | 'needs_review' | 'violation' | 'critical'
export type FindingStatus = 'compliant' | 'needs_review' | 'failed' | 'critical_failed' | 'na'
export type OcrConfidence = 'high' | 'medium' | 'low'

export interface Finding {
  rule_id: string
  label: string
  field: string
  requirement: string
  status: FindingStatus
  detected_value: string | null
  explanation: string | null
  hint: string | null
}

export interface Change {
  field: string
  label: string
  previous: string
  current: string
  kind: 'added' | 'removed' | 'changed' | 'same'
}

export interface Briefing {
  purpose: string
  summary: string
  key_points: string[]
  recommendations: string[]
  assistant_status: 'demo' | 'ok' | 'skipped'
  provider: string
}

/* ------------------------------------------------------------------ */
/* Multi-AI verification & adjudication (mirrors backend types)        */
/* ------------------------------------------------------------------ */

export type AdjudicationStatus = 'VERIFIED' | 'NEEDS_REVIEW' | 'CONFLICT' | 'NOT_DETECTED' | 'LOW_CONFIDENCE'

export interface ReportFieldVote {
  report: string
  provider: string
  value: string | null
  normalized: string | null
  confidence: number | null
}

export interface AdjudicatedField {
  key: string
  label: string
  final_value: string | null
  status: AdjudicationStatus
  confidence: number
  supporting_reports: string[]
  conflicting_reports: string[]
  votes: ReportFieldVote[]
  similarity: number | null
  evidence_text: string | null
  evidence_bbox: number[] | null
  evidence_image: number | null
  verification_method: string
  reasoning: string
  decimal_conflict: boolean
}

export interface VerificationReportInfo {
  name: string
  provider: string
  ok: boolean
  engines: string[]
  confidence: number | null
  error?: string | null
}

export interface VerificationCounts {
  verified: number
  needs_review: number
  conflict: number
  low_confidence: number
  not_detected: number
  resolved: number
  disagreements: number
  total: number
}

/** Rule-by-rule score math (computed server-side from the findings). */
export interface ScoreBreakdown {
  applicable: number
  na_excluded: number
  passed: number
  review: number
  failed: number
  critical_failed: number
  passed_points: number
  review_points: number
  fail_penalty: number
  raw_score: number
  final_score: number
  clamped: boolean
  formula: string
  band: string
}

export interface VerificationSummary {
  single_source: boolean
  single_source_note: string | null
  trust_score: number
  reports: VerificationReportInfo[]
  fields: AdjudicatedField[]
  counts: VerificationCounts
  adjudicated_at: string
}

/** The inspection document as returned by the backend / Firestore. */
export interface InspectionDoc {
  id: string
  user_id: string
  product_name: string
  brand: string
  manufacturer: string
  category: InspectionCategory
  barcode: string
  notes: string
  remarks: string
  photo_paths: string[]
  photo_path?: string
  status: InspectionStatus
  ocr_status: 'pending' | 'processing' | 'done' | 'failed'
  ocr_error?: string | null
  ocr_text?: string
  ocr_language?: string
  ocr_provider?: string
  ocr_confidence?: number | null
  ocr_regions?: unknown[]
  ocr_fields?: Record<string, string | null>
  ocr_engines?: string[]
  unclear_text?: string[]
  verification?: VerificationSummary | null
  field_sources?: Record<string, Array<{ image: number; text: string; confidence?: number | null; bbox?: number[] | null }>>
  field_confidence?: Record<string, OcrConfidence>
  field_evidence?: Record<string, { image: number; text: string; confidence?: number | null; bbox?: number[] | null }>
  conflicts?: Array<{ field: string; label: string; values: Array<{ image: number; value: string }> }>
  compliance_findings?: Finding[]
  compliance_score?: number | null
  compliance_breakdown?: ScoreBreakdown | null
  previous_scan_id?: string | null
  match_confidence?: 'same_product' | 'same_barcode' | null
  changes?: Change[]
  changes_verified?: boolean
  briefing?: Briefing
  overall_score?: number
  verdict?: string
  risk_score?: number
  summary?: string
  analyzed_at?: string | null
  created_at: string
  updated_at?: string
  engine?: string
}

export interface CreateInspectionInput {
  photos: Array<{ data: string; name?: string }>
  category?: string
  lang?: string
  state?: string
  product_name?: string
  brand?: string
  manufacturer?: string
  barcode?: string
  notes?: string
  hints?: Record<string, string>
}

export interface CreateInspectionResponse {
  ok: boolean
  scan_id: string
  pending: boolean
  result?: unknown
  error?: string | null
}

async function authedFetch(path: string, init: RequestInit = {}, timeoutMs = 90_000): Promise<Response> {
  const uid = await currentUid()
  let token = await accessToken(true)
  if (!uid || !token) throw new Error('Not signed in for inspections')
  const base = CONFIG.AUDITX_API_URL.replace(/\/+$/, '')
  const send = (t: string) => fetchWithTimeout(`${base}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${t}`,
      ...(init.headers ?? {}),
    },
    body: init.body,
  }, timeoutMs)
  let res = await send(token)
  if (res.status === 401) {
    // Token rejected — force one session refresh and retry once. If the
    // backend still rejects, the session belongs to another project or is
    // dead: sign out so the user gets a clean login screen, not a loop.
    token = await accessToken(true)
    if (token) {
      res = await send(token)
    }
    if (res.status === 401) {
      await supabase.auth.signOut().catch(() => {})
      throw new Error('Session expired — you have been signed out. Please sign in again.')
    }
  }
  return res
}

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string }
    if (data?.error) return data.error
  } catch {
    /* not JSON */
  }
  return `Request failed (${res.status})`
}

/** Create an inspection with photos and run the inline analysis. */
export async function createInspection(input: CreateInspectionInput): Promise<CreateInspectionResponse> {
  // Photo upload + multi-engine OCR can take a few minutes on slow networks.
  const res = await authedFetch('/api/inspections', { method: 'POST', body: JSON.stringify(input) }, 240_000)
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as CreateInspectionResponse
}

/** Retry the analysis for an existing scan (same stored photos). */
export async function retryAnalysis(scanId: string): Promise<CreateInspectionResponse> {
  const res = await authedFetch('/api/inspections/analyze', { method: 'POST', body: JSON.stringify({ scan_id: scanId }) }, 240_000)
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as CreateInspectionResponse
}

/** Mark the changes between this scan and the previous one as verified. */
export async function verifyChanges(scanId: string, verified: boolean): Promise<void> {
  const res = await authedFetch(`/api/inspections/${encodeURIComponent(scanId)}/verify`, {
    method: 'POST',
    body: JSON.stringify({ verified }),
  })
  if (!res.ok) throw new Error(await readError(res))
}

/** Save inspector remarks (also persisted to `notes` for the legacy surfaces). */
export async function saveRemarks(scanId: string, remarks: string): Promise<void> {
  const res = await authedFetch(`/api/inspections/${encodeURIComponent(scanId)}/remarks`, {
    method: 'PUT',
    body: JSON.stringify({ remarks }),
  })
  if (!res.ok) throw new Error(await readError(res))
}

/** Fetch one inspection (owner or staff). */
export async function getInspection(scanId: string): Promise<InspectionDoc> {
  const res = await authedFetch(`/api/inspections/${encodeURIComponent(scanId)}`)
  if (!res.ok) throw new Error(await readError(res))
  const data = (await res.json()) as { doc?: { id?: string } }
  return (data.doc as unknown as InspectionDoc) ?? (data as unknown as InspectionDoc)
}

/* ------------------------------------------------------------------ */
/* Photo URL resolution                                                */
/* ------------------------------------------------------------------ */

const urlCache = new Map<string, Promise<string>>()

/**
 * Resolve a storage path (e.g. `scans/<uid>/…jpg`, legacy or new) to a
 * renderable URL via the public Supabase `scans` bucket.
 * Passes http(s) URLs and data: URLs through untouched. Rules (owner or
 * staff) gate the underlying read; results are cached per path.
 */
export function photoUrl(pathOrUrl: string | null | undefined): Promise<string> | null {
  const v = pathOrUrl
  if (!v) return null
  // Data URLs (thumbnails) and remote URLs pass through untouched.
  if (/^data:image\//i.test(v) || /^https?:\/\//i.test(v)) return Promise.resolve(v)
  const hit = urlCache.get(v)
  if (hit) return hit
  const key = v.replace(/^\/+/, '').replace(/^scans\//, '')
  try {
    const url = supabase.storage.from('scans').getPublicUrl(key).data.publicUrl
    const p = Promise.resolve(url)
    urlCache.set(v, p)
    return p
  } catch (e) {
    urlCache.delete(v)
    return Promise.reject(e)
  }
}

/** Resolve a list of paths/URLs in order; failures become null. */
export async function resolvePhotoUrls(paths: Array<string | null | undefined>): Promise<Array<string | null>> {
  const out: Array<string | null> = []
  for (const p of paths ?? []) {
    const u = photoUrl(p)
    if (!u) {
      out.push(null)
      continue
    }
    try {
      out.push(await u)
    } catch {
      out.push(null)
    }
  }
  return out
}
