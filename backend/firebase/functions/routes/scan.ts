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
import { buildExtractionPrompt, extractJson, norm, parseRaw, SUPPORTED_LANGS, type ParsedRaw, type SanitizedExtractions } from '../compliance/extraction.js'
import { runComplianceEngine } from '../compliance/engine.js'
import { detectContext } from '../compliance/context.js'
import { ALLOWED_CATEGORIES } from '../compliance/data.js'
import type { EngineInputs } from '../compliance/types.js'
import { dataUrlToInline, DEFAULT_GEMINI_MODEL, geminiGenerateContent, type GemPart } from '../lib/gemini.js'

const router = Router()

/** Build the Gemini vision prompt (same as compliance/extraction.ts buildExtractionPrompt) */
function buildVisionPrompt(lang: string): string {
  const langName = SUPPORTED_LANGS[lang] ?? 'English'
  return `You are a precise label transcription engine for Indian packaged commodities.
You receive multiple photographs of THE SAME product package. EACH photograph is labeled with its position (front, back, side, other).

YOUR JOB: Read the text on the label and extract specific fields. You are a transcription machine, NOT a compliance judge.

=== CRITICAL RULES ===
1. ONLY extract text ACTUALLY VISIBLE AND LEGIBLE on the labels.
2. NEVER reconstruct, guess, infer, or hallucinate ANY value. If you are unsure, return null.
3. Use the EXACT VERBATIM text as printed — preserve digits, units, symbols, abbreviations.
4. If a field is completely absent from ALL photos -> value: null, confidence: "low".
5. If a field IS printed but blurry/cut off/illegible -> value: null, add key to "uncertain", confidence: "low".
6. The label language is ${langName}. Read text in this language AND in English (many labels are bilingual).
7. "category" must be one of: ${ALLOWED_CATEGORIES.join(', ')}.

=== FIELD-SPECIFIC EXTRACTION RULES ===

MRP (Maximum Retail Price):
- Common printed patterns: "MRP Rs.249", "MRP ₹249.00", "M.R.P.: Rs 249/-", "Maximum Retail Price Rs.249 incl. of all taxes", "MRP Rs 249 (inclusive of all taxes)"
- Include the FULL printed line (price + "incl. of all taxes" if present).
- If ONLY one price is visible, extract it. If MULTIPLE prices are visible (e.g., MRP + "offer price"), put the CLEAR retail MRP as value and note the others in uncertain.
- NEVER return a value like "MRP" or "Rs" alone — always include the numeric amount.

Net Quantity / Net Weight:
- Common patterns: "Net Qty: 500 g", "Net Wt. 250g", "Net Weight: 1 kg", "Net Contents: 100 ml", "6 x 200ml"
- Include the numeric value AND the unit exactly as printed.
- For multipacks, include the full expression: "6 x 200 ml" (not just "1200 ml").

Manufacturer / Packer / Importer:
- Common patterns: "Manufactured by: ITC Limited", "Packed by: XYZ Foods Pvt. Ltd.", "Marketed by: ABC Corp"
- Include the FULL company name as printed (preserve uppercase, "Pvt. Ltd.", "Limited", etc.).
- The address is a SEPARATE field — do not merge it with the company name.

Address:
- Common patterns: "Regd. Office: 123 Industrial Area, Delhi - 110001", "Factory: Plot 5, MIDC, Pune 411018"
- Include the COMPLETE address including PIN code.
- The address often follows the manufacturer/packer name on the next line.

Country of Origin:
- Common patterns: "Country of Origin: India", "Made in India", "Product of India"
- Extract the country name ONLY.

Dates (Manufacturing / Best Before / Expiry):
- Common patterns: "Mfg.Dt:08/2025", "Mfg. Date: 08/2025", "PKD: AUG 2025", "Mfg Month & Year: 08/2025", "Best Before: 12 months from manufacture", "Expiry: 01/2026"
- For mfg_date: extract the date string EXACTLY as printed.
- For best_before: extract the full line (duration or date).
- If both mfg_date and best_before are on the same line, put the manufacturing date in mfg_date and the best-before in best_before.

Consumer Care:
- Common patterns: "Consumer Care: 1800-123-4567", "Customer Care: care@company.com", "Helpline: 1800 102 3040"
- Include the FULL contact information (phone, email, web address).

Lot / Batch Number:
- Common patterns: "Lot No: AB123", "Batch: 2025-08-01A", "B.No: 12345"
- Include the exact code as printed.

FSSAI License (food items only):
- Must be EXACTLY 14 digits starting with 1 or 2. Example: 10019011002543
- If you see a 14-digit number that does NOT start with 1 or 2, it is NOT an FSSAI license.
- Do NOT confuse batch codes, timestamps, or other numbers with FSSAI license.

Veg / Non-Veg (food items only):
- Green dot/brown dot symbol. Return "veg" or "nonveg" or null.

Nutrition Info / Ingredients / Allergens (food items only):
- Extract the FULL verbatim text from the nutrition table / ingredient list / allergen declaration.
- These are often multi-line. Include ALL lines.

=== OUTPUT FORMAT ===
Respond ONLY with valid JSON. No markdown, no code fences, no commentary before or after.

{
  "product_name": "exact product name as printed or null",
  "brand": "brand name as printed or null",
  "category": "one of: ALLOWED_CATEGORIES",
  "ocr": {"text": "all visible text combined from all photos", "languages": ["en"]},
  "ocr_blocks": [
    {"position": "front", "text": "text from photo 0", "languages": ["en"]},
    {"position": "back", "text": "text from photo 1", "languages": ["en"]}
  ],
  "labels": [{"label":"label name","label_text":"brief description"}],
  "extractions": {
    "commodity_name": {"value":"exact text or null","confidence":"high|medium|low","source_image":0},
    "mrp": {"value":"full MRP line with amount or null","confidence":"high|medium|low","source_image":0},
    "net_quantity": {"value":"exact qty with unit or null","confidence":"high|medium|low","source_image":0},
    "unit_sale_price": {"value":"exact USP or null","confidence":"high|medium|low","source_image":null},
    "manufacturer": {"value":"company name only or null","confidence":"high|medium|low","source_image":null},
    "packer": {"value":"company name only or null","confidence":"high|medium|low","source_image":null},
    "importer": {"value":"company name only or null","confidence":"high|medium|low","source_image":null},
    "address": {"value":"full address with PIN or null","confidence":"high|medium|low","source_image":null},
    "country_of_origin": {"value":"country name only or null","confidence":"high|medium|low","source_image":null},
    "mfg_date": {"value":"exact date string or null","confidence":"high|medium|low","source_image":null},
    "best_before": {"value":"exact best-before line or null","confidence":"high|medium|low","source_image":null},
    "consumer_care": {"value":"full contact info or null","confidence":"high|medium|low","source_image":null},
    "lot_no": {"value":"exact batch/lot code or null","confidence":"high|medium|low","source_image":null},
    "fssai_license": {"value":"14-digit FSSAI number or null","confidence":"high|medium|low","source_image":null},
    "veg_nonveg": {"value":"veg|nonveg or null","confidence":"high|medium|low","source_image":null},
    "nutrition_info": {"value":"verbatim nutrition table or null","confidence":"high|medium|low","source_image":null},
    "ingredients": {"value":"verbatim ingredient list or null","confidence":"high|medium|low","source_image":null},
    "allergens": {"value":"verbatim allergen text or null","confidence":"high|medium|low","source_image":null}
  },
  "uncertain": ["field keys where text was printed but illegible"],
  "language_note": "short note about label languages"
}
`
}

/** Call Gemini Vision, parse the raw JSON extraction, and return EngineInputs-ready data. */
async function geminiVisionOcr(
  images: Array<string | { data?: string }>,
  lang: string,
): Promise<ParsedRaw> {
  const prompt = buildVisionPrompt(lang)
  const parts: GemPart[] = [{ text: prompt }]
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
    const parsed = await geminiVisionOcr(images as Array<string | { data?: string }>, lang)
    const { ex, fields, ocrText, ocrLangs, ocrBlocks, uncertain, labels, category: detectedCategory, barcode: parsedBarcode, productName, brand } = parsed

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
      product_name: ex.commodity_name ?? productName ?? 'Unknown',
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
      extraction_status: Object.values(ex).some((v) => v) ? 'ok' : 'failed',
    }

    // 5️⃣ Persist to Firestore (best-effort)
    let scanId: string = `scan-${Date.now()}`
    try {
      const db = admin.firestore()
      const scanRef = db.collection('scans').doc()
      scanId = scanRef.id
      await scanRef.set({
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
        risk_score: result.risk_score,
        status: 'analyzed',
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        location_name: location_name ?? '',
        manual_result: null,
        notes: '',
        created_at: new Date().toISOString(),
      })
      await db.collection('notifications').add({
        user_id: (req as any).uid, type: 'scan', title: 'Analysis completed',
        body: `${result.product_name} scored ${result.overall_score}/100 — ${result.verdict}.`,
        link: '/scan-history', read: false, read_at: null, data: { scan_id: scanRef.id },
        created_at: new Date().toISOString(),
      })
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