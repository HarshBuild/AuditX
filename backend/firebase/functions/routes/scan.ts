/**
 * Scan route — converts the Firebase callable scanAnalysis into a REST endpoint.
 *
 * Flow:
 *   1. Verify Firebase ID token (middleware already attached)
 *   2. Receive images (data URLs), optional product_name, manufacturer, barcode, lang, category
 *   3. Send to Gemini Vision for OCR + structured extraction (compliance/extraction.ts parseRaw)
 *   4. Detect package context (compliance/context.ts detectContext)
 *   5. Run deterministic Legal Metrology compliance engine (compliance/engine.ts runComplianceEngine)
 *   6. Persist scan to Firestore
 *   7. Return result JSON
 *
 * NOTE: This re-implements the essential scan flow using the existing Node.js compliance modules.
 * The browser-only textract pipeline (region detection, Tesseract detect, crops) runs in the
 * frontend dashboard; the backend uses the proven Gemini + compliance engine path.
 */

import { Router, Request, Response, NextFunction } from 'express'
import admin from 'firebase-admin'
import { buildExtractionPrompt, buildTranscriptPrompt, extractJson, norm, parseRaw, rawTranscriptText, type ParsedRaw, type SanitizedExtractions } from '../compliance/extraction.js'
import { runAdaptiveVerification, normalizeRegions, fetchOcrEvidence, type AdaptiveVerification } from '../compliance/adaptiveOcr.js'
import { runComplianceEngine } from '../compliance/engine.js'
import { detectContext } from '../compliance/context.js'
import { ALLOWED_CATEGORIES } from '../compliance/data.js'
import type { EngineInputs } from '../compliance/types.js'
import { dataUrlToInline, DEFAULT_GEMINI_MODEL, geminiGenerateContent, type GemPart } from '../lib/gemini.js'

const router = Router()

/** Two-pass Gemini vision pipeline:
 *  1. Raw verbatim transcription (buildTranscriptPrompt) → per-image blocks + combined text.
 *  2. Structured field extraction (buildExtractionPrompt), feeding the verbatim
 *     transcript (and optional GCV hint) back as a reference.
 * Returns EngineInputs-ready parsed data.
 */
async function geminiVisionOcr(
  images: Array<string | { data?: string }>,
  lang: string,
  ocrTextHint?: string,
): Promise<ParsedRaw> {
  const imageParts: GemPart[] = []
  for (const img0 of images) {
    // Accept either a raw data URL/base64 string or { data, mime } objects
    const img: string = typeof img0 === 'string' ? img0 : String(img0?.data ?? '')
    if (!img) continue
    let url = img
    if (!url.startsWith('data:')) url = `data:image/jpeg;base64,${url}`
    imageParts.push(dataUrlToInline(url))
  }
  if (imageParts.length === 0) throw new Error('No valid image data provided')

  const call = async (parts: GemPart[]): Promise<any> => {
    const model = process.env.GEMINI_VISION_MODEL ?? DEFAULT_GEMINI_MODEL
    const text = await geminiGenerateContent({
      model,
      system: 'You are a machine. Output strict JSON only, no commentary.',
      parts,
      temperature: 0,
      maxOutputTokens: 4096,
    })
    if (!text) throw new Error('Empty Gemini vision response')
    return extractJson(text)
  }

  // Call Gemini with one automatic retry on transport/parse failure
  const callWithRetry = async (parts: GemPart[]): Promise<any> => {
    try {
      return await call(parts)
    } catch {
      try {
        return await call(parts)
      } catch {
        return null
      }
    }
  }

  // Pass 1 — raw verbatim transcription.
  const transcriptRaw = await callWithRetry([{ text: buildTranscriptPrompt() }, ...imageParts])

  // Pass 2 — structured extraction with the verbatim transcript as reference.
  const extractionParts: GemPart[] = [{ text: buildExtractionPrompt(lang) }]
  const references: string[] = []
  // Optional Google Cloud Vision transcript — a second reference for small,
  // dense text. The photographs remain the PRIMARY source.
  if (ocrTextHint && ocrTextHint.trim()) {
    references.push(`REFERENCE TRANSCRIPT (Google Cloud Vision OCR — may contain noise):\n${ocrTextHint.trim().slice(0, 12000)}`)
  }
  const transcriptText = rawTranscriptText(transcriptRaw)
  if (transcriptText) {
    references.push(`REFERENCE TRANSCRIPT (LLM vision transcript — verbatim text visible in the photos):\n${transcriptText.slice(0, 20000)}`)
  }
  if (references.length > 0) {
    extractionParts.push({
      text: `${references.join('\n\n')}\n\nUse the photographs as the primary source. Only transcribe text that is actually visible and legible in the photos — do not copy OCR noise verbatim.`,
    })
  }
  extractionParts.push(...imageParts)

  let raw: any = await callWithRetry(extractionParts)

  // Fallback: parseRaw tolerates empty extractions — engine will mark fields missing
  if (!raw || typeof raw !== 'object') {
    raw = { ocr: { text: '', languages: [] } }
  }

  return parseRaw(raw as Record<string, unknown>, { barcode: null, product_name: null, category: null })
}

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      images,
      lang = 'en',
      product_name,
      manufacturer,
      barcode,
      latitude,
      longitude,
      location_name,
      category,
      ocr_text,
    } = req.body ?? {}

    if (!images || !Array.isArray(images) || images.length === 0) {
      res.status(400).json({ ok: false, error: 'No images provided.' })
      return
    }
    if (images.length > 6) {
      res.status(400).json({ ok: false, error: 'At most 6 photos per inspection.' })
      return
    }

    // 1️⃣ Gemini Vision OCR + structured extraction (parseRaw normalizes fields/ex)
    const parsed = await geminiVisionOcr(images as Array<string | { data?: string }>, lang, typeof ocr_text === 'string' ? ocr_text : undefined)
    const { ex, fields, ocrText, ocrLangs, ocrBlocks, uncertain, labels, category: detectedCategory, barcode: parsedBarcode, productName, brand, conflicts, quality, status: extractionStatus } = parsed

    // 1b. ADAPTIVE EVIDENCE-BASED OCR — targeted verification of uncertain
    // regions only (never a full re-scan) + deterministic trust score.
    // Runs on the pre-null snapshot so conflicting fields still get evidence.
    let adaptive: AdaptiveVerification | null = null
    let ocrEvidenceMs = 0
    const toDataUrl = (img: string | { data?: string }): string => {
      if (typeof img === 'string') return img
      const d = img?.data ?? ''
      return d.startsWith('data:') ? d : `data:image/jpeg;base64,${d}`
    }
    try {
      let blocksByImage = normalizeRegions((req.body as any)?.perImageBlocks)
      let qualityScores: number[] | undefined
      let missedRegions: { checked: number; found: number } | undefined
      if (blocksByImage.length === 0) {
        // No blocks forwarded — fetch them from the Python microservice once.
        const ev = await fetchOcrEvidence(images.map(toDataUrl), lang)
        blocksByImage = ev.blocksByImage
        qualityScores = ev.qualityScores
        missedRegions = ev.missedRegions
        ocrEvidenceMs = ev.ms
      }
      if (blocksByImage.length > 0) {
        adaptive = await runAdaptiveVerification({
          images: (images as Array<string | { data?: string }>).map(toDataUrl).filter(Boolean),
          blocksByImage,
          fields: { ...fields },
          uncertain: [...uncertain],
          extractionsConflicts: conflicts,
          lang,
          qualityScores,
          ocrInitialMs: ocrEvidenceMs,
          missedRegions,
        })
      }
    } catch (evErr) {
      console.warn('⚠️ Adaptive verification skipped:', (evErr as Error)?.message ?? evErr)
    }

    // Conflicting fields (different photos show different values) are never trusted:
    // null their value deterministically and mark them uncertain so the engine flags them.
    for (const c of conflicts) {
      if (fields[c.field]) {
        fields[c.field] = { ...fields[c.field], value: null }
      }
      if (!uncertain.includes(c.field)) uncertain.push(c.field)
    }
    // Merge adaptive-flagged fields into the engine's uncertain set (honest flags).
    if (adaptive && adaptive.uncertain.length > 0) {
      for (const key of adaptive.uncertain) if (!uncertain.includes(key)) uncertain.push(key)
    }

    // 2️⃣ Build deterministic EngineInputs and detect package context
    const engineInputs: EngineInputs = {
      ex,
      fields: fields as any,
      ocrText,
      ocrBlocks: ocrBlocks as any[],
      uncertain,
      barcode: barcode ?? parsedBarcode ?? null,
      languages: ocrLangs,
      labels: labels as any,
      userCategory: category ?? detectedCategory ?? null,
      userProductName: productName,
      productLabelText: [productName ?? '', category ?? '', brand ?? ''].join(' ') || undefined,
      isAdvertisement: false,
    }

    const ctxResult = detectContext(engineInputs)

    // 3️⃣ Run the deterministic Legal Metrology compliance engine
    const outcome = runComplianceEngine(engineInputs)

    // 4️⃣ Build result object (same shape as Firebase functions scanAnalysis).
    // Overlay adaptive verification (status/confidence evidence) onto fields.
    let extractionFields = { ...(fields as Record<string, any>) }
    if (adaptive) {
      const v = adaptive.verification
      extractionFields = Object.fromEntries(
        Object.entries(extractionFields).map(([k, f]) => {
          const fv = v[k]
          if (!fv) return [k, f]
          return [
            k,
            {
              ...f,
              status: f?.value == null ? (f?.status ?? 'NEEDS_REVIEW') : fv.verified && !fv.needsVerification ? 'VERIFIED' : 'NEEDS_REVIEW',
              confidence_score: typeof fv.confidence_score === 'number' ? Number(fv.confidence_score.toFixed(2)) : f?.confidence_score,
              evidence: fv.evidence?.map((e) => ({
                source_image: e.source_image,
                region: e.region,
                region_text: e.region_text,
                pass: e.pass,
                ocr_conf: e.ocr_conf,
                value: e.value,
              })),
            },
          ]
        }),
      )
    }

    const result = {
      product_name: ex.commodity_name ?? productName ?? '',
      brand: ex.manufacturer ?? brand ?? '',
      manufacturer: ex.manufacturer ?? '',
      barcode: engineInputs.barcode ?? '',
      category: ctxResult.package_type,
      overall_score: outcome.summary.overall_score,
      verdict: outcome.summary.verdict,
      summary: outcome.assistant.summary,
      rules: outcome.rules,
      labels: outcome.rules.map((r: any) => ({ ...r, verdict: outcome.summary.verdict, score: outcome.summary.overall_score })),
      ocr: { text: ocrText, languages: ocrLangs },
      ocr_blocks: ocrBlocks,
      extractions: ex,
      extraction_fields: extractionFields,
      assistant: outcome.assistant,
      language_note: parsed.languageNote +
        (adaptive
          ? ` Adaptive verification: ${Object.values(adaptive.verification).filter((v) => v.verified).length} field(s) verified, ${adaptive.uncertain.length} need attention.`
          : ''),
      risk_score: outcome.summary.risk_score,
      ai_insights: outcome.summary.ai_insights,
      detected: outcome.summary.detected,
      counts: outcome.summary.counts,
      context: {
        package_type: ctxResult.package_type,
        origin: ctxResult.origin,
        is_food: ctxResult.is_food,
        sold_by: ctxResult.sold_by,
        special_commodity: ctxResult.special_commodity,
        exemptions: ctxResult.applicable_exemptions,
        reason: ctxResult.reason,
      },
      evidence_chain: outcome.summary.evidence_chain,
      extraction_status: extractionStatus === 'conflict_detected' ? 'conflict' : extractionStatus,
      conflicts: adaptive?.conflicts ?? conflicts,
      quality,
      ...(adaptive
        ? {
            trust_score: adaptive.trust.score,
            trust_breakdown: adaptive.trust.breakdown,
            verification: adaptive.verification,
            uncertain_regions: adaptive.scanned_regions,
            missed_regions: adaptive.missed_regions,
            processing: {
              initial_ocr_ms: adaptive.processing.initial_ocr_ms,
              verification_ms: adaptive.processing.verification_ms,
              total_ms: adaptive.processing.total_ms,
            },
          }
        : {}),
    }

    // 5️⃣ Persist to Firestore (best-effort, single batched write)
    let scanId: string = `scan-${Date.now()}`
    try {
      const db = admin.firestore()
      const scanRef = db.collection('scans').doc()
      scanId = scanRef.id
      const notifRef = db.collection('notifications').doc()
      const batch = db.batch()
      const now = new Date().toISOString()
      batch.set(scanRef, {
        user_id: (req as any).uid,
        product_name: result.product_name,
        brand: result.brand,
        manufacturer: result.manufacturer,
        category: result.category,
        barcode: result.barcode,
        overall_score: result.overall_score,
        verdict: result.verdict,
        summary: result.summary,
        rules: result.rules,
        labels: result.labels,
        ocr: result.ocr,
        ocr_blocks: result.ocr_blocks,
        assistant: result.assistant,
        language_note: result.language_note,
        extractions: result.extractions,
        extraction_fields: result.extraction_fields,
        detected: result.detected,
        counts: result.counts,
        context: result.context,
        evidence_chain: result.evidence_chain,
        conflicts: result.conflicts,
        quality: result.quality,
        trust_score: result.trust_score ?? null,
        processing: result.processing ?? null,
        scanned_regions: result.uncertain_regions ?? 0,
        missed_regions: result.missed_regions ?? null,
        risk_score: result.risk_score,
        status: 'analyzed',
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        location_name: location_name ?? '',
        manual_result: null,
        notes: '',
        created_at: now,
      })
      batch.set(notifRef, {
        user_id: (req as any).uid, type: 'scan', title: 'Analysis completed',
        body: `${result.product_name || 'Product'} scored ${result.overall_score}/100 — ${result.verdict}.`,
        link: '/scan-history', read: false, read_at: null, data: { scan_id: scanRef.id },
        created_at: now,
      })
      await batch.commit()
    } catch (persistErr) {
      console.warn('⚠️ Firestore persist error (non-fatal):', (persistErr as Error).message)
    }

    res.json({ ok: true, scan_id: scanId, result })
  } catch (e: any) {
    console.error('⚠️ /api/scan error:', e?.message ?? e)
    res.status(500).json({ ok: false, error: e?.message ?? 'Scan failed.' })
  }
})

export default router