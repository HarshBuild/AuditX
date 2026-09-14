/**
 * On-device analysis fallback — free, no API key, no server.
 *
 * v2: runs the staged Textract pipeline (quality gate → text-region
 * detection → crop-from-original → per-region multi-pass OCR → field
 * consensus with per-field evidence → barcode cross-check), then feeds the
 * deterministic Legal Metrology compliance engine.
 *
 * Everything stays on-device and dependency-free:
 *   Tesseract.js (OCR + layout) - Tesseract/DBNet   canvas - OpenCV
 *   BarcodeDetector            - pyzbar             the rules engine - Python rules
 */
import { createWorker, PSM } from 'tesseract.js'
import { updateDoc, doc } from 'firebase/firestore'
import { runComplianceEngine, type ComplianceOutcome } from './compliance/engine'
import type { ExtractedField as EngineField, Extractions } from './compliance/types'
import { createScan } from './services'
import { saveLocalScan } from './localStore'
import { db, auth } from './firebase'
import { PerfRun, tim, timSync } from './perf'
import { COLLECTIONS } from './db'
import type {
  AIIinsight,
  DetectedSummary,
  InspectorAssistant,
  RuleCheck,
  ScanContext,
  ScanRow,
  StatusCounts,
} from './types2'
import { brandFromManufacturer, type KeyOfExtractions } from './textract/fields'
import { type TexField, type PanelPrior } from './textract/types'
import { runPipeline, type PipelineOutput } from './textract/pipeline'
import { evidenceThumb } from './textract/image'
import { clientsideVerify, type BlocksImage } from './compliance/adaptiveClient'

export interface LocalScanInput {
  images: string[] // data URLs
  hiResImages?: string[] // near-original data URLs (accuracy path)
  lang?: string
  product_name?: string
  manufacturer?: string
  barcode?: string
  positions?: PanelPrior[] // label panel per photo (order follows images)
  ocrHint?: string // Google Cloud Vision transcript (best-effort reference)
  ocrBlocks?: BlocksImage[] // fast-OCR blocks with bounding boxes (adaptive evidence)
  qualityScores?: number[]
  ocrInitialMs?: number
}

const TESS_LANGS: Record<string, string> = {
  en: 'eng', hi: 'hin', ta: 'tam', te: 'tel', bn: 'ben', mr: 'mar',
  gu: 'guj', pa: 'pan', kn: 'kan', ml: 'mal',
}

/* ------------------------------------------------------------------ */
/* Field mapping                                                       */
/* ------------------------------------------------------------------ */

/** Trim TexField down to the compliance engine's field shape. */
function toEngineFields(tfs: Record<string, TexField>): Record<string, EngineField> {
  const out: Record<string, EngineField> = {}
  for (const [k, f] of Object.entries(tfs)) {
    out[k] = { value: f.value, confidence: f.legacyConfidence, source_image: f.source_image }
  }
  return out
}

/** Persist/session shape: ExtractedField (+status/evidence extras). */
async function toStoredFields(tfs: Record<string, TexField>): Promise<Record<string, NonNullable<ScanRow['extraction_fields']>[string]>> {
  const out: Record<string, NonNullable<ScanRow['extraction_fields']>[string]> = {}
  for (const [k, f] of Object.entries(tfs)) {
    if (f.value == null) continue
    const evidence = []
    for (const e of f.evidence) {
      const thumb = e.crop ? await evidenceThumb(e.crop) : null
      evidence.push({ ...e, crop: thumb })
    }
    out[k] = {
      value: f.value,
      confidence: f.legacyConfidence,
      source_image: f.source_image,
      status: f.status,
      confidence_score: f.confidence,
      conflict: f.conflict,
      votes: f.votes,
      evidence,
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Scan persistence                                                    */
/* ------------------------------------------------------------------ */

function toRuleCheck(r: { rule_id: string; requirement: string; status: string; detected_value: string | null; reason: string; evidence: { source_image: number | null; ocr_text: string | null } }): RuleCheck {
  return {
    rule_id: r.rule_id,
    field: r.rule_id,
    requirement: r.requirement,
    status: r.status as RuleCheck['status'],
    detected_value: r.detected_value,
    reason: r.reason,
    evidence: { source_image: r.evidence.source_image, ocr_text: r.evidence.ocr_text ?? '' },
    verification_type: 'IMAGE_VERIFIABLE',
    weight: 1,
  }
}

function insightsFrom(rules: RuleCheck[]): AIIinsight[] {
  return rules
    .filter((r) => r.status === 'FAIL' || r.status === 'WARNING')
    .map((r) => ({ rule_id: r.rule_id, field: r.field ?? r.rule_id, status: r.status, issue: r.reason ?? '' }))
}

function detectedFrom(out: ComplianceOutcome): DetectedSummary {
  const c = out.summary.counts
  return {
    passed: c.passed,
    failed: c.failed,
    warnings: c.warnings,
    not_verifiable: c.not_verifiable,
    not_applicable: c.not_applicable,
    missing: c.not_detected,
    uncertain: c.uncertain,
  }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Run a fully on-device inspection and persist it as an analyzed scan.
 * Throws when no readable text could be OCR'd (so the UI can ask for a retake).
 */
export async function runLocalScan(input: LocalScanInput, perf?: PerfRun): Promise<ScanRow> {
  const lang = input.lang ?? 'en'
  const tessLangs = Array.from(new Set(['eng', TESS_LANGS[lang] ?? 'eng']))

  const worker = await createWorker(tessLangs)
  let output!: PipelineOutput
  const analyze = async () => {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO, // full layout analysis for multi-section labels
      preserve_interword_spaces: '1',
    })
    output = await runPipeline(worker, {
      images: input.images,
      hiResImages: input.hiResImages,
      lang,
      productName: input.product_name,
      barcode: input.barcode ?? null,
      positions: input.positions,
    })
  }
  try {
    await tim(perf, 'ai-analyze', analyze)
  } finally {
    await worker.terminate()
  }

  const { ex, fields: texFields, uncertain } = output.extraction
  const engineFields = toEngineFields(texFields)
  const storedFields = await toStoredFields(texFields)
  const ocrText = output.ocrText
  const ocrBlocks = output.ocrBlocks

  const outcome = timSync(perf, 'validation', () =>
    runComplianceEngine({
      ex,
      fields: engineFields,
      ocrText,
      ocrBlocks,
      uncertain,
      barcode: output.resolvedBarcode ?? input.barcode ?? null,
      languages: tessLangs,
      labels: [],
      userCategory: null,
      userProductName: input.product_name?.trim() ?? null,
      productLabelText: `${ex.commodity_name ?? ''} ${input.product_name ?? ''}`.trim() || undefined,
    }),
  )

  const ctx = outcome.context
  const context: ScanContext = {
    package_type: ctx.package_type,
    origin: ctx.origin,
    is_food: ctx.is_food,
    sold_by: ctx.sold_by,
    special_commodity: ctx.special_commodity,
    exemptions: ctx.applicable_exemptions,
    reason: ctx.reason,
  }

  const rules = outcome.rules.map(toRuleCheck)
  const summary = outcome.summary
  const assistant: InspectorAssistant = {
    summary: outcome.assistant.summary,
    suggestions: outcome.assistant.suggestions,
  }
  const counts: StatusCounts = {
    passed: summary.counts.passed,
    failed: summary.counts.failed,
    warnings: summary.counts.warnings,
    not_detected: summary.counts.not_detected,
    not_verifiable: summary.counts.not_verifiable,
    requires_physical_inspection: summary.counts.requires_physical_inspection,
    not_applicable: summary.counts.not_applicable,
    uncertain: summary.counts.uncertain,
  }

  const productName = ex.commodity_name ?? input.product_name ?? 'Unknown'
  const exForStore: Record<string, string> = {}
  for (const [k, v] of Object.entries(ex)) if (v != null) exForStore[k] = v

  const barcodeCheck = output.barcodeCheck

  // Adaptive evidence layer: verify extracted fields against the fast-OCR
  // blocks (honest flags + cross-image agreement + trust score). Best-effort.
  const adaptive = clientsideVerify(
    texFields as unknown as Record<string, { value: string | null; confidence?: string | null }>,
    uncertain,
    input.ocrBlocks ?? [],
    input.qualityScores,
    input.ocrInitialMs,
  )
  if (adaptive) {
    for (const key of adaptive.uncertain) if (!uncertain.includes(key)) uncertain.push(key)
    for (const [k, f] of Object.entries(storedFields)) {
      const fv = adaptive.verification[k]
      if (!fv) continue
      if (f.value != null && fv.verified && !fv.needsVerification) {
        storedFields[k] = { ...f, status: 'VERIFIED', confidence_score: Math.max(f.confidence_score ?? 0, fv.confidence_score), evidence: f.evidence }
      } else if (f.conflict || uncertain.includes(k)) {
        storedFields[k] = { ...f, status: 'NEEDS_REVIEW', confidence_score: f.confidence_score ?? fv.confidence_score, evidence: f.evidence }
      }
    }
  }

  // Persistence is best-effort: the scan must always render, even when the
  // Cloud Function claims are missing or Firestore rules deny the write.
  let scanId = `local-${Date.now()}`
  let persisted = false
  try {
    await tim(perf, 'db-save', async () => {
    scanId = await createScan({
      product_name: productName,
      brand: brandFromManufacturer(ex.manufacturer ?? ''),
      manufacturer: ex.manufacturer ?? input.manufacturer ?? '',
      category: ctx.is_food ? 'Food' : 'General',
      overall_score: summary.overall_score,
      verdict: summary.verdict,
      summary: assistant.summary,
      rules,
      barcode: output.resolvedBarcode ?? input.barcode ?? '',
      ocr_text: ocrText,
      ai_insights: insightsFrom(rules),
      risk_score: summary.risk_score,
      status: 'analyzed',
      language: lang,
    })

    await updateDoc(doc(db, COLLECTIONS.SCANS, scanId), {
      labels: [],
      ocr: { text: ocrText, languages: tessLangs },
      ocr_blocks: ocrBlocks,
      assistant,
      language_note: 'Analyzed on-device with the free OCR engine (no server, no API key).',
      extractions: exForStore as ScanRow['extractions'],
      extraction_fields: storedFields,
      uncertain,
      detected: detectedFrom(outcome),
      counts,
      context,
      barcode_check: {
        detected: barcodeCheck.detected,
        from_ocr: barcodeCheck.fromOcr,
        agree: barcodeCheck.agree,
        needs_review: barcodeCheck.needsReview,
      },
      pipeline_version: output.version,
      verification: adaptive?.verification ?? null,
      trust_score: adaptive?.trust.score ?? null,
      trust_breakdown: adaptive?.trust.breakdown ?? null,
      processing: adaptive?.processing ?? null,
      uncertain_regions: adaptive?.scanned_regions ?? 0,
      evidence_chain: summary.evidence_chain.map((e) => ({
        rule_id: e.rule_id,
        requirement: e.requirement,
        status: e.status,
        detected_value: e.detected_value,
        source_image: e.source_image,
        ocr_text: e.ocr_text ?? '',
      })),
      updated_at: new Date().toISOString(),
    })
    })
    persisted = true
  } catch {
    // Local-only result — do not surface the write failure to the user.
  }

  const uid = auth.currentUser?.uid ?? null
  const localScan: ScanRow = {
    id: scanId,
    created_at: new Date().toISOString(),
    user_id: uid,
    product_name: productName,
    brand: brandFromManufacturer(ex.manufacturer ?? ''),
    manufacturer: ex.manufacturer ?? input.manufacturer ?? '',
    category: ctx.is_food ? 'Food' : 'General',
    barcode: output.resolvedBarcode ?? input.barcode ?? '',
    overall_score: summary.overall_score,
    verdict: summary.verdict,
    summary: assistant.summary,
    image_url: '',
    rules,
    risk_score: summary.risk_score,
    status: 'analyzed',
    ocr_text: ocrText,
    ai_insights: insightsFrom(rules),
    image_urls: [],
    labels: [],
    ocr: { text: ocrText, languages: tessLangs },
    ocr_blocks: ocrBlocks,
    assistant,
    language_note: persisted
      ? 'Analyzed on-device with the free OCR engine (no server, no API key).'
      : 'Analyzed on-device with the free OCR engine — saved locally only (cloud write failed).',
    extractions: exForStore as ScanRow['extractions'],
    extraction_fields: storedFields,
    detected: detectedFrom(outcome),
    counts,
    context,
    barcode_check: {
      detected: barcodeCheck.detected,
      from_ocr: barcodeCheck.fromOcr,
      agree: barcodeCheck.agree,
      needs_review: barcodeCheck.needsReview,
    },
    verification: adaptive?.verification,
    trust_score: adaptive?.trust.score,
    trust_breakdown: adaptive?.trust.breakdown,
    processing: adaptive?.processing,
    uncertain_regions: adaptive?.scanned_regions ?? 0,
    evidence_chain: summary.evidence_chain.map((e) => ({
      rule_id: e.rule_id,
      requirement: e.requirement,
      status: e.status as RuleCheck['status'],
      detected_value: e.detected_value,
      source_image: e.source_image,
      ocr_text: e.ocr_text ?? '',
    })),
    uncertain,
    manual_result: null,
    notes: '',
    latitude: null,
    longitude: null,
    location_name: '',
    language: lang,
    engine: 'local' as ScanRow['engine'],
  }
  saveLocalScan(localScan)
  return localScan
}

export type { KeyOfExtractions }
export type { Extractions }