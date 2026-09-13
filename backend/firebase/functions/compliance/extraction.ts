/**
 * LLM interface — the ONLY place the model is allowed to act.
 * It transcribes and extracts verbatim label data. It NEVER decides
 * compliance; the engine (engine.ts) does that deterministically.
 *
 * If a value is not visible/legible the model MUST return null + mark the
 * key "uncertain" instead of guessing.
 */
import { ALLOWED_CATEGORIES } from './data.js'
import { EXTRACTION_KEYS, FOOD_CATEGORIES, type Extractions, type ExtractionStatus } from './types.js'

export const SUPPORTED_LANGS: Record<string, string> = {
  en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', bn: 'Bengali', mr: 'Marathi',
  gu: 'Gujarati', pa: 'Punjabi', kn: 'Kannada', ml: 'Malayalam',
}

export function buildExtractionPrompt(lang: string): string {
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
  "category": "one of: ${ALLOWED_CATEGORIES.join(', ')}",
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
}`
}

/* ------------------------------------------------------------------ */
/* JSON parsing + normalization helpers                                 */
/* ------------------------------------------------------------------ */

/** Replace unescaped control characters inside JSON string literals. */
export function jsonStringSafe(text: string): string {
  let out = ''
  let inStr = false
  let esc = false
  for (const ch of text) {
    if (inStr) {
      if (esc) {
        out += ch
        esc = false
        continue
      }
      if (ch === '\\') {
        out += ch
        esc = true
        continue
      }
      if (ch === '"') {
        inStr = false
        out += ch
        continue
      }
      if (ch === '\n' || ch === '\r' || ch === '\t') {
        out += ch === '\n' ? '\\n' : ch === '\t' ? '\\t' : '\\r'
        continue
      }
      out += ch
      continue
    }
    if (ch === '"') inStr = true
    out += ch
  }
  return out
}

export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  for (const candidate of [cleaned, jsonStringSafe(cleaned)]) {
    try {
      return JSON.parse(candidate)
    } catch {
      /* try the next candidate */
    }
  }
  const m = cleaned.match(/\{[\s\S]*\}/)
  if (m) {
    try {
      return JSON.parse(jsonStringSafe(m[0]))
    } catch {
      return null
    }
  }
  return null
}

/** Repair double-encoded UTF-8 (Ã© → é, â€™ → ’) and stray transport escapes. */
function repairArtifacts(s: string): string {
  if (!s) return s
  let t = s
    .replace(/\\n/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\r/g, '')
    .replace(/\\(["'\\/])/g, '$1')
  t = t.replace(/[\u00AD\u200B\u200E\u200F\u2060\u2066-\u2069\uFEFF]/g, '')
  if (/[\u0080-\u00FF]/.test(t)) {
    const bytes = Array.from(t, (ch) => ch.charCodeAt(0))
    const out: string[] = []
    let i = 0
    while (i < bytes.length) {
      const b0 = bytes[i]
      let cp = -1
      let len = 1
      if (b0 >= 0xc2 && b0 <= 0xdf && i + 1 < bytes.length) {
        const b1 = bytes[i + 1]
        if (b1 >= 0x80 && b1 <= 0xbf) {
          cp = ((b0 & 0x1f) << 6) | (b1 & 0x3f)
          len = 2
        }
      } else if (b0 >= 0xe0 && b0 <= 0xef && i + 2 < bytes.length) {
        const b1 = bytes[i + 1]
        const b2 = bytes[i + 2]
        if (b1 >= 0x80 && b1 <= 0xbf && b2 >= 0x80 && b2 <= 0xbf) {
          cp = ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f)
          len = 3
        }
      }
      if (cp >= 0) {
        if (!(cp < 0x20 || (cp >= 0x7f && cp <= 0x9f))) out.push(String.fromCodePoint(cp))
        i += len
        continue
      }
      out.push(String.fromCharCode(b0))
      i += 1
    }
    t = out.join('')
  }
  return t.replace(/\s+/g, ' ').trim()
}

/**
 * A clean structured VALUE — the field text that feeds the engine and is shown
 * in the result UI. Never raw OCR blob, never mojibake. Raw OCR text is the
 * only thing kept verbatim as evidence.
 */
export function cleanStructured(raw: string | null): string | null {
  if (raw === null || raw === undefined) return null
  const s = repairArtifacts(String(raw))
  return s === '' ? null : s
}

/**
 * Product-name guard: a real product name is ONE short line. Whole OCR
 * paragraphs are the #1 garbled-name source, so they are rejected at the
 * source (the UI then shows "Product name not clearly detected").
 */
export function looksLikeOcrBlob(v: string | null): boolean {
  if (!v) return false
  if (/\r|\n/.test(v)) return true
  if (v.split(/\s+/).filter(Boolean).length > 18) return true
  return false
}

export function norm(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  if (s === '' || /^(null|n\/a|none|not detected|n\/d|unknown|-{1,})$/.test(s.toLowerCase())) return null
  return s
}

export interface NormField {
  value: string | null
  confidence: 'high' | 'medium' | 'low'
  source_image: number | null
}

/** Normalize an extraction field — accepts {value,confidence,source_image} or plain string/null. */
export function normField(raw: unknown): NormField {
  if (raw === null || raw === undefined) return { value: null, confidence: 'low', source_image: null }
  if (typeof raw === 'string') return { value: cleanStructured(raw), confidence: 'medium', source_image: null }
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    const rawValue = typeof o.value === 'string' ? o.value : o.value === null || o.value === undefined ? null : String(o.value)
    let value = cleanStructured(rawValue)
    // A product name is one short line — reject OCR paragraphs/blobs here.
    if (value !== null && looksLikeOcrBlob(value)) value = null
    return {
      value,
      confidence: o.confidence === 'high' || o.confidence === 'medium' || o.confidence === 'low' ? o.confidence : 'medium',
      source_image: typeof o.source_image === 'number' ? o.source_image : null,
    }
  }
  return { value: cleanStructured(raw == null ? null : String(raw)), confidence: 'medium', source_image: null }
}

export interface SanitizedExtractions {
  fields: Record<string, NormField>
  ex: Extractions
}

/** Extract extractions from raw AI JSON — handles both old and new formats. */
export function sanitizeExtractions(value: unknown): SanitizedExtractions {
  const fields: Record<string, NormField> = {}
  const ex: Extractions = {
    commodity_name: null, mrp: null, net_quantity: null, unit_sale_price: null,
    manufacturer: null, packer: null, importer: null, address: null,
    country_of_origin: null, mfg_date: null, best_before: null, consumer_care: null,
    lot_no: null, fssai_license: null, veg_nonveg: null, nutrition_info: null,
    ingredients: null, allergens: null,
  }
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>
    for (const key of EXTRACTION_KEYS) {
      fields[key] = normField(src[key])
      ex[key] = fields[key].value
    }
  } else {
    for (const key of EXTRACTION_KEYS) fields[key] = { value: null, confidence: 'low', source_image: null }
  }
  return { fields, ex }
}

/* ------------------------------------------------------------------ */
/* Raw -> EngineInputs                                                 */
/* ------------------------------------------------------------------ */
export interface ParsedRaw {
  fields: Record<string, NormField>
  ex: Extractions
  ocrText: string
  ocrLangs: string[]
  ocrBlocks: Array<{ position: string; text: string; languages: string[] }>
  uncertain: string[]
  labels: Array<{ label: string; label_text: string }>
  category: string
  barcode: string | null
  productName: string | null
  brand: string | null
  languageNote: string
}

export function parseRaw(
  raw: Record<string, unknown>,
  user: { barcode?: string | null; product_name?: string | null; category?: string | null },
): ParsedRaw {
  const { fields, ex } = sanitizeExtractions(raw.extractions)
  const rawOcr = raw.ocr && typeof raw.ocr === 'object' ? (raw.ocr as Record<string, unknown>) : null
  const ocrText = norm(rawOcr?.text) ?? ''
  const ocrLangs = Array.isArray(rawOcr?.languages)
    ? (rawOcr!.languages as unknown[]).map((l) => String(l).trim()).filter(Boolean)
    : []
  const ocrBlocks = Array.isArray(raw.ocr_blocks)
    ? (raw.ocr_blocks as unknown[])
        .filter((b): b is Record<string, unknown> => Boolean(b) && typeof b === 'object')
        .map((b) => ({
          position: String(b.position ?? 'unknown'),
          text: String(b.text ?? ''),
          languages: Array.isArray(b.languages) ? (b.languages as unknown[]).map((l) => String(l).trim()).filter(Boolean) : [],
        }))
    : []
  const uncertain = Array.isArray(raw.uncertain) ? raw.uncertain.map((l) => String(l).trim()).filter(Boolean) : []
  const labels = Array.isArray(raw.labels)
    ? raw.labels
        .filter((l): l is Record<string, unknown> => Boolean(l) && typeof l === 'object')
        .map((l) => ({ label: norm(l.label) ?? 'Label', label_text: norm(l.label_text) ?? '' }))
    : []
  const categoryRaw = norm(raw.category) ?? user.category
  const category = categoryRaw && ALLOWED_CATEGORIES.includes(categoryRaw) ? categoryRaw : 'Other'
  const rawProductName = cleanStructured(norm(raw.product_name)) ?? cleanStructured(user.product_name ?? null)
  const productName = rawProductName && !looksLikeOcrBlob(rawProductName) ? rawProductName : null
  return {
    fields, ex,
    ocrText, ocrLangs, ocrBlocks, uncertain, labels,
    category,
    barcode: norm(user.barcode ?? raw.barcode),
    productName,
    brand: cleanStructured(norm(raw.brand)),
    languageNote: cleanStructured(norm(raw.language_note)) ?? '',
  }
}

export function isFoodCategory(cat: string): boolean {
  return FOOD_CATEGORIES.includes(cat)
}

export type { ExtractionStatus }