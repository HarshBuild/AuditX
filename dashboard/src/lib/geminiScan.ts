/**
 * Gemini-powered scan — browser-side AI analysis fallback.
 *
 * Runs when the server `scanAnalysis` Cloud Function is unavailable:
 *   1. Google Gemini Vision transcribes every label photo into verbatim
 *      extractions (multi-language OCR, exactly like the server path).
 *   2. The same deterministic Legal Metrology compliance engine used by the
 *      server evaluates the declarations (rules, verdict, score, risk).
 *   3. The scan is persisted best-effort, exactly like the on-device path.
 *
 * This is the high-accuracy replacement for the Tesseract on-device fallback.
 */
import { updateDoc, doc } from 'firebase/firestore'
import { buildExtractionPrompt, parseRaw } from './compliance/extraction'
import { runComplianceEngine, type ComplianceOutcome } from './compliance/engine'
import type { ExtractedField as EngineField, Extractions } from './compliance/types'
import { createScan } from './services'
import { saveLocalScan } from './localStore'
import { db, auth } from './firebase'
import { PerfRun, tim, timSync } from './perf'
import { COLLECTIONS } from './db'
import { CONFIG } from './config'
import { dataUrlToInline, extractJson, geminiApiKey, geminiGenerateContent, type GemPart } from './gemini'
import type { LocalScanInput } from './localEngine'
import type {
  AIIinsight,
  DetectedLabel,
  DetectedSummary,
  InspectorAssistant,
  RuleCheck,
  ScanContext,
  ScanRow,
  StatusCounts,
} from './types2'

/* ------------------------------------------------------------------ */
/* Rule/insight mapping (same shapes as the on-device path)            */
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
 * Run a Gemini-powered inspection and persist it as an analyzed scan.
 * Throws when Gemini is unreachable so callers can fall back to the
 * on-device Tesseract engine.
 */
export async function runGeminiScan(input: LocalScanInput, perf?: PerfRun): Promise<ScanRow> {
  const lang = input.lang ?? 'en'
  if (!geminiApiKey()) throw new Error('Gemini API key is not configured.')

  const prompt = buildExtractionPrompt(lang)
  const parts: GemPart[] = [{ text: prompt }]
  // Optional Google Cloud Vision transcript — a reference for small/dense
  // text. The photographs remain the PRIMARY source; OCR noise must be ignored.
  if (input.ocrHint?.trim()) {
    parts.push({
      text: `REFERENCE TRANSCRIPT (Google Cloud Vision OCR — may contain noise):\n${input.ocrHint.trim().slice(0, 30000)}\n\nUse the photographs as the primary source. Only transcribe text that is actually visible and legible in the photos — do not copy OCR noise verbatim.`,
    })
  }
  for (const img of input.images) {
    if (!img) continue
    let url = img
    if (!url.startsWith('data:')) url = `data:image/jpeg;base64,${url}`
    parts.push(dataUrlToInline(url))
  }
  if (parts.length <= 1) throw new Error('No valid image data provided.')

  const rawText = await geminiGenerateContent({
    model: CONFIG.GEMINI_VISION_MODEL,
    system: 'You are a machine. Output strict JSON only, no commentary.',
    parts,
    temperature: 0,
    maxOutputTokens: 4096,
  })
  const raw = rawText ? extractJson(rawText) : null
  if (!raw || typeof raw !== 'object') {
    throw new Error('Gemini did not return structured extraction data.')
  }

  const parsed = parseRaw(raw as Record<string, unknown>, {
    barcode: input.barcode ?? null,
    product_name: input.product_name?.trim() ?? null,
    category: null,
  })

  // Conflicting fields (different photos showed different values) are never
  // trusted: null their value so the engine treats them as missing+uncertain.
  for (const c of parsed.conflicts) {
    if (parsed.fields[c.field]) {
      parsed.fields[c.field] = { ...parsed.fields[c.field], value: null }
    }
    if (!parsed.uncertain.includes(c.field)) parsed.uncertain.push(c.field)
  }

  const qualityNote =
    parsed.conflicts.length > 0
      ? ` Conflicting values detected for: ${parsed.conflicts.map((c) => c.field).join(', ')} (needs manual verification).`
      : parsed.quality?.needs_manual_verification
        ? ` Low-confidence reading — verify manually.`
        : ''

  const engineFields = parsed.fields as Record<string, EngineField>
  const outcome = timSync(perf, 'validation', () =>
    runComplianceEngine({
      ex: parsed.ex,
      fields: engineFields,
      ocrText: parsed.ocrText,
      ocrBlocks: parsed.ocrBlocks,
      uncertain: parsed.uncertain,
      barcode: parsed.barcode ?? input.barcode ?? null,
      languages: parsed.ocrLangs,
      labels: parsed.labels,
      userCategory: null,
      userProductName: parsed.productName ?? input.product_name?.trim() ?? null,
      productLabelText: `${parsed.ex.commodity_name ?? ''} ${input.product_name ?? ''}`.trim() || undefined,
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

  const productName = parsed.ex.commodity_name ?? input.product_name ?? ''
  const brand = parsed.brand ?? ''

  const exForStore: Record<string, string> = {}
  for (const [k, v] of Object.entries(parsed.ex)) if (v != null) exForStore[k] = v

  const storedFields: NonNullable<ScanRow['extraction_fields']> = {}
  for (const [k, f] of Object.entries(parsed.fields)) {
    if (f.value == null) continue
    storedFields[k] = {
      value: f.value,
      confidence: f.confidence ?? 'low',
      source_image: f.source_image,
      status: 'VERIFIED',
      confidence_score: f.confidence === 'high' ? 0.9 : f.confidence === 'medium' ? 0.6 : 0.3,
      conflict: false,
      votes: 1,
      evidence: [],
    }
  }

  let scanId = `gemini-${Date.now()}`
  let persisted = false
  try {
    await tim(perf, 'db-save', async () => {
    scanId = await createScan({
      product_name: productName,
      brand,
      manufacturer: parsed.ex.manufacturer ?? input.manufacturer ?? '',
      category: ctx.is_food ? 'Food' : 'General',
      overall_score: summary.overall_score,
      verdict: summary.verdict,
      summary: assistant.summary,
      rules,
      barcode: parsed.barcode ?? input.barcode ?? '',
      ocr_text: parsed.ocrText,
      ai_insights: insightsFrom(rules),
      risk_score: summary.risk_score,
      status: 'analyzed',
      language: lang,
    })

    await updateDoc(doc(db, COLLECTIONS.SCANS, scanId), {
labels: parsed.labels.map((l) => ({ ...l, verdict: 'VERIFIED' as DetectedLabel['verdict'], score: 0.8 })) as DetectedLabel[],
      ocr: { text: parsed.ocrText, languages: parsed.ocrLangs },
      ocr_blocks: parsed.ocrBlocks,
      assistant,
      language_note: 'Analyzed with Google Gemini AI (vision extraction + compliance rules).' + qualityNote,
      extractions: exForStore as ScanRow['extractions'],
      extraction_fields: storedFields,
      uncertain: parsed.uncertain,
      detected: detectedFrom(outcome),
      counts,
      context,
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
  const scan: ScanRow = {
    id: scanId,
    created_at: new Date().toISOString(),
    user_id: uid,
    product_name: productName,
    brand,
    manufacturer: parsed.ex.manufacturer ?? input.manufacturer ?? '',
    category: ctx.is_food ? 'Food' : 'General',
    barcode: parsed.barcode ?? input.barcode ?? '',
    overall_score: summary.overall_score,
    verdict: summary.verdict,
    summary: assistant.summary,
    image_url: '',
    rules,
    risk_score: summary.risk_score,
    status: 'analyzed',
    ocr_text: parsed.ocrText,
    ai_insights: insightsFrom(rules),
    image_urls: [],
    labels: parsed.labels.map((l) => ({ ...l, verdict: 'VERIFIED' as DetectedLabel['verdict'], score: 0.8 })) as DetectedLabel[],
    ocr: { text: parsed.ocrText, languages: parsed.ocrLangs },
    ocr_blocks: parsed.ocrBlocks,
    assistant,
    language_note: (persisted
      ? 'Analyzed with Google Gemini AI (vision extraction + compliance rules).'
      : 'Analyzed with Google Gemini AI — saved locally only (cloud write failed).') + qualityNote,
    extractions: exForStore as ScanRow['extractions'],
    extraction_fields: storedFields,
    detected: detectedFrom(outcome),
    counts,
    context,
    evidence_chain: summary.evidence_chain.map((e) => ({
      rule_id: e.rule_id,
      requirement: e.requirement,
      status: e.status as RuleCheck['status'],
      detected_value: e.detected_value,
      source_image: e.source_image,
      ocr_text: e.ocr_text ?? '',
    })),
    uncertain: parsed.uncertain,
    manual_result: null,
    notes: '',
    latitude: null,
    longitude: null,
    location_name: '',
    language: lang,
    engine: 'gemini' as ScanRow['engine'],
  }
  saveLocalScan(scan)
  return scan
}

export type { Extractions }
export type { EngineField }