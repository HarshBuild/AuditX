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
import { buildExtractionPrompt, buildTranscriptPrompt, parseRaw, rawTranscriptText } from './compliance/extraction'
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
import { cropRegionFromOriginal } from './textract/image'
import { clientsideVerify, computeTrustFromVerification, type AdaptiveClientResult } from './compliance/adaptiveClient'
import type { FieldVerification } from './types2'
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
/* Targeted Gemini visual verification (#6)                            */
/* ------------------------------------------------------------------ */

/**
 * Crop ONLY the uncertain/critical label regions (never the whole image) and
 * ask Gemini vision to verify whether the visible text matches the OCR
 * reading — the spec's "verify the evidence, don't blindly replace OCR" rule.
 * Bounded to a small number of regions to keep API calls minimal. The model
 * is told to read the characters literally (0/O, 1/I/l, 5/S…) and to say
 * "unclear" instead of guessing.
 */
async function strengthenAdaptiveWithGemini(
  adaptive: AdaptiveClientResult,
  fields: Record<string, { value: string | null; confidence?: string | null }>,
  images: string[],
): Promise<AdaptiveClientResult> {
  if (!geminiApiKey()) return adaptive

  const picks: Array<{ key: string; entry: FieldVerification; imgIdx: number; region: [number, number, number, number] }> = []
  for (const [key, v] of Object.entries(adaptive.verification)) {
    if (!v.needsVerification) continue
    const ev = v.evidence.find((e) => e.region && e.source_image >= 0 && images[e.source_image])
    if (!ev?.region) continue
    picks.push({ key, entry: v, imgIdx: ev.source_image, region: ev.region })
    if (picks.length >= 2) break
  }
  if (picks.length === 0) return adaptive

  const updated = { ...adaptive.verification }
  const uncertain = new Set(adaptive.uncertain)
  let scanned = adaptive.scanned_regions

  await Promise.all(
    picks.map(async ({ key, entry, imgIdx, region }) => {
      try {
        const { url: cropUrl } = await cropRegionFromOriginal(
          images[imgIdx],
          { x0: region[0], y0: region[1], x1: region[0] + region[2], y1: region[1] + region[3] },
          0.06,
          2,
        )
        const candidate = String(fields[key]?.value ?? entry.before ?? '')
        const prompt = [
          'You are a label-verification machine. An OCR engine read:',
          `"${candidate}"`,
          `(field confidence ${Math.round((entry.ocrConfidence ?? 0) * 100)}%).`,
          'Read ONLY the text visible in this cropped region. Do not use background knowledge. Do not guess.',
          'Be careful with confusable characters: 0/O, 1/I/l, 2/Z, 5/S, 6/G, 8/B — pick exactly what is printed.',
          'Return strict JSON only: {"match": true|false|null, "value": "exact visible text or null", "confidence": 0.0-1.0, "evidence": "visual_match"|"visual_mismatch"|"unclear"}',
        ].join(' ')
        const res = await geminiGenerateContent({
          model: CONFIG.GEMINI_VISION_MODEL,
          system: 'You are a machine. Output strict JSON only, no commentary.',
          parts: [{ text: prompt }, dataUrlToInline(cropUrl)],
          temperature: 0,
          maxOutputTokens: 256,
        })
        const json = res ? extractJson(res) : null
        scanned += 1
        if (json && typeof json === 'object' && typeof json.match === 'boolean') {
          const match = json.match as boolean
          const readText = typeof json.value === 'string' && json.value.trim() ? String(json.value).trim() : null
          const ev = { source_image: imgIdx, region, region_text: readText ?? candidate, pass: 'visual' as const, ocr_conf: null, value: candidate }
          if (match && readText) {
            updated[key] = {
              ...entry,
              verified: true,
              needsVerification: false,
              via: 'targeted_re_scan',
              confidence_score: Math.max(entry.confidence_score, 0.9),
              ocrConfidence: entry.ocrConfidence,
              before: entry.before ?? candidate,
              after: readText,
              evidence: [...entry.evidence, ev],
            }
            uncertain.delete(key)
          } else {
            updated[key] = {
              ...entry,
              via: 'targeted_re_scan',
              after: readText ?? null,
              evidence: [...entry.evidence, ev],
            }
            uncertain.add(key)
          }
        }
      } catch {
        // keep the honest needs_verification flag (evidence-first)
      }
    }),
  )

  const keys = Object.keys(updated)
  const trust = computeTrustFromVerification(
    updated,
    keys,
    adaptive.trust.breakdown.image_quality,
    adaptive.trust.breakdown.cross_image_agreement,
  )
  return { ...adaptive, verification: updated, trust, uncertain: Array.from(uncertain), scanned_regions: scanned }
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

  const imageParts: GemPart[] = []
  for (const img of input.images) {
    if (!img) continue
    let url = img
    if (!url.startsWith('data:')) url = `data:image/jpeg;base64,${url}`
    imageParts.push(dataUrlToInline(url))
  }
  if (imageParts.length === 0) throw new Error('No valid image data provided.')

  const call = async (gemParts: GemPart[]): Promise<string | null> => {
    try {
      return await geminiGenerateContent({
        model: CONFIG.GEMINI_VISION_MODEL,
        system: 'You are a machine. Output strict JSON only, no commentary.',
        parts: gemParts,
        temperature: 0,
        maxOutputTokens: 4096,
      })
    } catch {
      return null
    }
  }

  // Pass 1 — raw verbatim transcription (per-image blocks + combined text).
  let transcriptRaw: unknown = null
  const transcriptText0 = await call([{ text: buildTranscriptPrompt() }, ...imageParts])
  if (transcriptText0) {
    try {
      transcriptRaw = extractJson(transcriptText0)
    } catch {
      transcriptRaw = null
    }
  }

  // Pass 2 — structured field extraction, feeding the verbatim transcript back
  // as a reference. The photographs remain the PRIMARY source of truth.
  const parts: GemPart[] = [{ text: buildExtractionPrompt(lang) }]
  const references: string[] = []
  // Optional Google Cloud Vision transcript — a reference for small/dense text.
  if (input.ocrHint?.trim()) {
    references.push(`REFERENCE TRANSCRIPT (Google Cloud Vision OCR — may contain noise):\n${input.ocrHint.trim().slice(0, 12000)}`)
  }
  const transcriptText = rawTranscriptText(transcriptRaw)
  if (transcriptText) {
    references.push(`REFERENCE TRANSCRIPT (LLM vision transcript — verbatim text visible in the photos):\n${transcriptText.slice(0, 20000)}`)
  }
  if (references.length > 0) {
    parts.push({
      text: `${references.join('\n\n')}\n\nUse the photographs as the primary source. Only transcribe text that is actually visible and legible in the photos — do not copy OCR noise verbatim.`,
    })
  }
  parts.push(...imageParts)

  const rawText = await call(parts)
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

  // Adaptive evidence layer — verify Gemini values against the fast-OCR
  // blocks (honest flags + cross-image agreement + trust score). Best-effort:
  // runs only when the fast OCR pass forwarded per-image blocks.
  const adaptiveBase = clientsideVerify(
    parsed.fields as unknown as Record<string, { value: string | null; confidence?: string | null }>,
    [...parsed.uncertain],
    input.ocrBlocks ?? [],
    input.qualityScores,
    input.ocrInitialMs,
    { verifyCritical: true, missedRegions: input.ocrMissedRegions },
  )
  // Targeted Gemini visual verification: crop ONLY the uncertain/critical
  // regions and confirm the visible text (spec #6) — bounded to ≤2 regions.
  const adaptive = adaptiveBase ? await strengthenAdaptiveWithGemini(adaptiveBase, parsed.fields as unknown as Record<string, { value: string | null; confidence?: string | null }>, input.images ?? []) : null
  if (adaptive) {
    for (const key of adaptive.uncertain) if (!parsed.uncertain.includes(key)) parsed.uncertain.push(key)
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
    const fv = adaptive?.verification[k]
    storedFields[k] = {
      value: f.value,
      confidence: f.confidence ?? 'low',
      source_image: f.source_image,
      status: fv
        ? fv.verified && !fv.needsVerification
          ? 'VERIFIED'
          : 'NEEDS_REVIEW'
        // No independent OCR cross-check was available (fast OCR returned no
        // blocks) — never claim VERIFIED from the model's self-report alone.
        : 'NEEDS_REVIEW',
      confidence_score: fv ? fv.confidence_score : f.confidence === 'high' ? 0.9 : f.confidence === 'medium' ? 0.6 : 0.3,
      conflict: false,
      votes: 1,
      evidence: (fv?.evidence ?? []).map((e) => ({
        source_image: e.source_image,
        bbox: e.region ? { x0: e.region[0], y0: e.region[1], x1: e.region[2], y1: e.region[3] } : null,
        region_text: e.region_text,
        pass: e.pass,
        ocr_conf: e.ocr_conf ?? 0,
        value: e.value,
        crop: null,
      })),
      verification: fv ? (fv.verified && !fv.needsVerification ? 'verified' : 'needs_verification') : undefined,
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
      verification: adaptive?.verification ?? null,
      trust_score: adaptive?.trust.score ?? null,
      trust_breakdown: adaptive?.trust.breakdown ?? null,
processing: adaptive?.processing ?? null,
      uncertain_regions: adaptive?.scanned_regions ?? 0,
      missed_regions: adaptive?.missed_regions ?? input.ocrMissedRegions ?? null,
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
    verification: adaptive?.verification,
    trust_score: adaptive?.trust.score,
    trust_breakdown: adaptive?.trust.breakdown,
    processing: adaptive?.processing,
    uncertain_regions: adaptive?.scanned_regions ?? 0,
    missed_regions: adaptive?.missed_regions ?? input.ocrMissedRegions ?? null,
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