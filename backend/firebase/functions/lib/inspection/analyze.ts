/**
 * Analysis orchestrator — the server-side heart of the MISA flow.
 *
 *   photos → save (private storage) → provider OCR → Node merge (guard rails)
 *         → deterministic compliance → change detection → assistant briefing
 *         → persisted fields → AnalysisResult.
 *
 * The analysis NEVER throws for the caller-visible flow: a failure is turned
 * into an `ocr_status: 'failed'` result so the dashboard can always show the
 * pending screen with a Retry action.
 */

import { downloadPhoto, listUserScans } from '../../supabase-admin.js'
import type {
  AnalysisInput,
  AnalysisResult,
  Change,
  FieldSource,
  MergedFields,
  OcrConfidence,
  PerImageExtract,
} from './types.js'
import { cleanClaim, mergeResults, truncateValue } from './merge.js'
import { runCompliance } from './compliance.js'
import { buildBriefing } from './assistant.js'
import { decodeDataUrl, runVerificationReports, savePhoto } from './ocr.js'
import { adjudicateReports } from './adjudicate.js'
import { compareScans, findPreviousScan } from './change.js'

export interface AnalyzeOutcome {
  savedPaths: string[]
  result: AnalysisResult
}

/** Average per-image OCR confidence (0..1). */
function averageConfidence(perImages: PerImageExtract[]): number {
  if (perImages.length === 0) return 0
  const sum = perImages.reduce((acc, pi) => acc + (pi.confidence ?? 0), 0)
  return Math.round((sum / perImages.length) * 100) / 100
}

/** Materialize photo inputs into data URLs + storage paths (Supabase Storage). */
async function materializePhotos(uid: string, photos: AnalysisInput['photos']): Promise<{ paths: string[]; dataUrls: string[] }> {
  const paths: string[] = []
  const dataUrls: string[] = []

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i]
    if (photo.data) {
      dataUrls.push(photo.data)
      try {
        paths.push(await savePhoto(uid, i, photo.data))
        continue
      } catch (e) {
        console.warn('⚠️ photo save failed (analysis continues in-memory):', (e as Error)?.message ?? e)
        continue
      }
    }
    if (photo.path) {
      try {
        const bufFile = await downloadPhoto(photo.path)
        paths.push(photo.path)
        dataUrls.push(`data:image/jpeg;base64,${bufFile.toString('base64')}`)
      } catch (e) {
        throw new Error(`Storage is unavailable to read the photo: ${(e as Error)?.message ?? e}. Add the photo again as a fresh capture.`)
      }
      continue
    }
    throw new Error('Each photo must carry either `data` (data URL) or `path` (storage path).')
  }
  return { paths, dataUrls }
}

/** Load previous scans (latest-first) for change detection. */
async function recentScansForUser(uid: string, cap = 60): Promise<Array<{ id: string } & Record<string, unknown>>> {
  try {
    const rows = await listUserScans(uid, cap)
    return rows.map((d) => ({ id: String(d.id), ...d }))
  } catch (e) {
    console.warn('⚠️ recentScansForUser fell back:', (e as Error)?.message ?? e)
    return []
  }
}

/** Apply deterministic guard rails to merged fields. */
function guardRail(merged: MergedFields): MergedFields {
  const fields: Record<string, string> = {}
  for (const [k, v] of Object.entries(merged.fields)) {
    const cleaned = truncateValue(cleanClaim(v))
    if (cleaned) fields[k] = cleaned
  }
  // Mirror the same cleanup into the evidence text (best-effort).
  const field_evidence: Record<string, FieldSource> = {}
  for (const [k, src] of Object.entries(merged.field_evidence)) {
    field_evidence[k] = { ...src, text: cleanClaim(src.text) ?? src.text }
  }
  return { ...merged, fields, field_evidence }
}

export async function analyzeInspection(input: AnalysisInput): Promise<AnalyzeOutcome> {
  const lang = (input.lang ?? 'en').trim() || 'en'
  const category = input.category ?? null
  const hints = input.hints ?? {}

  const { paths, dataUrls } = await materializePhotos(input.uid, input.photos)

  // Multi-AI verification: up to 3 independent reports (PaddleOCR, Gemini
  // Vision, OpenRouter Vision) run in parallel, then ONE adjudicated result.
  // Throws honestly when no report can read the label — never dummy data.
  const providerPhotos = input.photos.map((p, i) => ({ ...p, data: dataUrls[i] ?? p.data }))
  const reportOutcomes = await runVerificationReports({ photos: providerPhotos, category, lang, hints })
  const { consensus: providerResult, verification } = adjudicateReports(reportOutcomes)
  const merged: MergedFields = guardRail(mergeResults(providerResult.perImages))

  const productName = merged.fields.commodity_name ?? hints.product_name ?? ''
  const barcode = (hints.barcode ?? input.hints?.barcode ?? '').trim()

  // Deterministic compliance.
  const compliance = runCompliance(merged, category, { productName: hints.product_name || undefined })

  // Change detection against the previous scan of the same product.
  const recent = await recentScansForUser(input.uid)
  const match = findPreviousScan(
    input.previousScanId ?? '',
    { product_name: hints.product_name ?? merged.fields.commodity_name, barcode: barcode || null },
    recent,
    merged,
  )
  let changes: Change[] = []
  if (match.previous) {
    changes = compareScans(match.previous, merged)
  } else {
    changes = compareScans(null, merged)
  }

  // Assistant briefing (rule-based).
  const briefing = buildBriefing(compliance, {
    provider: providerResult.provider,
    demo: providerResult.demo,
    categoryOutcome: category ?? (compliance.findings.length > 0 ? 'unknown — full rule set applied' : null),
  })

  const now = new Date().toISOString()
  const field_sources: Record<string, FieldSource[]> = {}
  for (const [k, ev] of Object.entries(merged.field_evidence)) {
    field_sources[k] = [ev]
  }
  const field_confidence: Record<string, OcrConfidence> = merged.field_confidence
  const ocr_fields: Record<string, string | null> = merged.fields

  const result: AnalysisResult = {
    product_name: productName,
    brand: merged.fields.brand ?? hints.brand ?? '',
    manufacturer: merged.fields.manufacturer ?? hints.manufacturer ?? '',
    category,
    barcode,
    ocr_text: merged.text,
    ocr_status: 'done',
    ocr_error: null,
    ocr_language: lang,
    ocr_provider: providerResult.provider,
    ocr_confidence: averageConfidence(providerResult.perImages),
    ocr_regions: merged.regions ?? [],
    ocr_fields,
    ocr_engines: providerResult.engines,
    unclear_text: providerResult.unclear,
    verification,
    field_sources,
    field_confidence,
    field_evidence: merged.field_evidence,
    conflicts: merged.conflicts,
    compliance_findings: compliance.findings,
    compliance_score: compliance.overall_score,
    compliance_breakdown: compliance.score_breakdown,
    compliance_status: compliance.status,
    compliance_display: {
      verdict: compliance.verdict,
      risk: compliance.risk,
      summary: compliance.summary,
      counts: compliance.counts,
    },
    previous_scan_id: match.previous?.id ?? null,
    match_confidence: match.confidence,
    changes,
    changes_verified: false,
    briefing,
    status: compliance.status,
    summary: compliance.summary,
    analyzed_at: now,
  }

  return { savedPaths: paths, result }
}

/** Re-run analysis for an existing scan whose photos are already stored. */
export async function analyzeExistingScan(uid: string, photos: string[]): Promise<AnalyzeOutcome> {
  return analyzeInspection({ uid, photos: photos.map((path) => ({ path })), category: null })
}

export { decodeDataUrl }