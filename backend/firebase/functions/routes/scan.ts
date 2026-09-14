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
import { buildExtractionPrompt, extractJson, norm, parseRaw, type ParsedRaw, type SanitizedExtractions } from '../compliance/extraction.js'
import { runComplianceEngine } from '../compliance/engine.js'
import { detectContext } from '../compliance/context.js'
import { ALLOWED_CATEGORIES } from '../compliance/data.js'
import type { EngineInputs } from '../compliance/types.js'
import { dataUrlToInline, DEFAULT_GEMINI_MODEL, geminiGenerateContent, type GemPart } from '../lib/gemini.js'

const router = Router()

/** Call Gemini Vision, parse the raw JSON extraction, and return EngineInputs-ready data. */
async function geminiVisionOcr(
  images: Array<string | { data?: string }>,
  lang: string,
  ocrTextHint?: string,
): Promise<ParsedRaw> {
  const prompt = buildExtractionPrompt(lang)
  const parts: GemPart[] = [{ text: prompt }]
  // Optional Google Cloud Vision transcript — a second reference for small,
  // dense text. The photographs remain the PRIMARY source.
  if (ocrTextHint && ocrTextHint.trim()) {
    parts.push({
      text: `REFERENCE TRANSCRIPT (Google Cloud Vision OCR — may contain noise):\n${ocrTextHint.trim().slice(0, 30000)}\n\nUse the photographs as the primary source. Only transcribe text that is actually visible and legible in the photos — do not copy OCR noise verbatim.`,
    })
  }
  for (const img0 of images) {
    // Accept either a raw data URL/base64 string or { data, mime } objects
    const img: string = typeof img0 === 'string' ? img0 : String(img0?.data ?? '')
    if (!img) continue
    let url = img
    if (!url.startsWith('data:')) url = `data:image/jpeg;base64,${url}`
    parts.push(dataUrlToInline(url))
  }
  if (parts.length <= 1) throw new Error('No valid image data provided')

  const call = async (): Promise<any> => {
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
  let raw: any = null
  try {
    raw = await call()
  } catch {
    try {
      raw = await call()
    } catch {
      raw = null
    }
  }

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

    // Conflicting fields (different photos show different values) are never trusted:
    // null their value deterministically and mark them uncertain so the engine flags them.
    for (const c of conflicts) {
      if (fields[c.field]) {
        fields[c.field] = { ...fields[c.field], value: null }
      }
      if (!uncertain.includes(c.field)) uncertain.push(c.field)
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

    // 4️⃣ Build result object (same shape as Firebase functions scanAnalysis)
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
      extraction_fields: fields,
      assistant: outcome.assistant,
      language_note: parsed.languageNote,
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
      conflicts,
      quality,
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