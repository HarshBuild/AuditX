/**
 * LLM interface — the ONLY place the model is allowed to act.
 * It transcribes and extracts verbatim label data. It NEVER decides
 * compliance; the engine (engine.ts) does that deterministically.
 *
 * If a value is not visible/legible the model MUST return null + mark the
 * key "uncertain" instead of guessing.
 */
import { ALLOWED_CATEGORIES } from './data'
import { EXTRACTION_KEYS, FOOD_CATEGORIES, type Extractions, type ExtractionStatus } from './types'

export const SUPPORTED_LANGS: Record<string, string> = {
  en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', bn: 'Bengali', mr: 'Marathi',
  gu: 'Gujarati', pa: 'Punjabi', kn: 'Kannada', ml: 'Malayalam',
}

export function buildExtractionPrompt(_lang: string): string {
  return `You are a precise label transcription engine for Indian packaged commodities.
You receive multiple photographs of the SAME product package. EACH photograph is labeled with its position (front, back, side, other).

CRITICAL HONESTY RULES:
- You are a transcription machine, NOT a compliance judge. Never decide compliance, never judge the package.
- ONLY extract text that is ACTUALLY VISIBLE AND LEGIBLE on the labels.
- If a field is completely absent from all photos -> value: null.
- If a field IS printed but blurry/cut off/illegible -> value: null AND add the field key to "uncertain".
- NEVER reconstruct, guess, infer, or hallucinate ANY value. Use the EXACT VERBATIM text as printed.
- For MRP: include the full printed string exactly as shown (e.g. "MRP Rs.249.00 incl. of all taxes"). If MULTIPLE prices are visible, put each in "uncertain" and value:null.
- For addresses: include the complete address verbatim with commas, PIN, etc.
- For dates: include the full date string exactly as printed (e.g. "Mfg. Date: 08/2025").
- For net quantity: reproduce the exact text including unit.
- "category" must be one of: ${ALLOWED_CATEGORIES.join(', ')}.

FOR EACH extracted field, you MUST include:
- value: the EXACT verbatim text as printed (null if absent/illegible)
- confidence: "high" (clear, unambiguous), "medium" (partially legible), or "low" (barely readable, verify manually)
- source_image: 0-based index of the photo where you found this value (0=first photo, 1=second, etc.)

"ocr_blocks": For each photo, provide its transcribed text separately, labeled by position.
"ocr.text": Combine all visible text from all photos into one transcription. Preserve line breaks, numbers, units, ₹ symbols.

For food/beverage items, also extract:
- fssai_license: the 14-digit FSSAI licence number if visible.
- veg_nonveg: "veg" (green dot) / "nonveg" (brown dot) / null.
- nutrition_info: verbatim nutrition-table text if a table is present (else null).
- ingredients: the FULL verbatim ingredient list if present (else null).
- allergens: verbatim allergen declaration text if present (else null).

"uncertain": List field keys where text was printed but could not be read confidently.

Respond ONLY with valid JSON. No markdown, no code fences, no commentary.
{
  "product_name": "exact as printed or null",
  "brand": "exact as printed or null",
  "category": "one allowed category",
  "ocr": {"text": "combined transcription", "languages": ["en"]},
  "ocr_blocks": [
    {"position": "front", "text": "text from first photo", "languages": ["en"]},
    {"position": "back", "text": "text from second photo", "languages": ["en"]}
  ],
  "labels": [{"label":"product label name","label_text":"brief description"}],
  "extractions": {
    "commodity_name": {"value":"null or exact text","confidence":"high|medium|low","source_image":0},
    "mrp": {"value":"null or full MRP string","confidence":"high|medium|low","source_image":0},
    "net_quantity": {"value":"null or exact string","confidence":"high|medium|low","source_image":0},
    "unit_sale_price": {"value":"null or exact string","confidence":"high|medium|low","source_image":null},
    "manufacturer": {"value":"null or exact name","confidence":"high|medium|low","source_image":1},
    "packer": {"value":"null or exact name","confidence":"high|medium|low","source_image":null},
    "importer": {"value":"null or exact name","confidence":"high|medium|low","source_image":null},
    "address": {"value":"null or full verbatim address","confidence":"high|medium|low","source_image":1},
    "country_of_origin": {"value":"null or exact line","confidence":"high|medium|low","source_image":null},
    "mfg_date": {"value":"null or exact date string","confidence":"high|medium|low","source_image":null},
    "best_before": {"value":"null or exact line","confidence":"high|medium|low","source_image":null},
    "consumer_care": {"value":"null or exact contact info","confidence":"high|medium|low","source_image":null},
    "lot_no": {"value":"null or exact batch/lot code","confidence":"high|medium|low","source_image":null},
    "fssai_license": {"value":"null or 14-digit FSSAI number","confidence":"high|medium|low","source_image":null},
    "veg_nonveg": {"value":"null or veg/nonveg","confidence":"high|medium|low","source_image":null},
    "nutrition_info": {"value":"null or verbatim table text","confidence":"high|medium|low","source_image":null},
    "ingredients": {"value":"null or verbatim list","confidence":"high|medium|low","source_image":null},
    "allergens": {"value":"null or verbatim text","confidence":"high|medium|low","source_image":null}
  },
  "uncertain": ["list of field keys where value was printed but illegible"],
  "language_note": "short sentence about label languages"
}`
}

/* ------------------------------------------------------------------ */
/* JSON parsing + normalization helpers                                 */
/* ------------------------------------------------------------------ */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/)
    return m ? JSON.parse(m[0]) : null
  }
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
  if (typeof raw === 'string') return { value: norm(raw), confidence: 'medium', source_image: null }
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    return {
      value: norm(o.value),
      confidence: o.confidence === 'high' || o.confidence === 'medium' || o.confidence === 'low' ? o.confidence : 'medium',
      source_image: typeof o.source_image === 'number' ? o.source_image : null,
    }
  }
  return { value: norm(raw), confidence: 'medium', source_image: null }
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
  return {
    fields, ex,
    ocrText, ocrLangs, ocrBlocks, uncertain, labels,
    category,
    barcode: norm(user.barcode ?? raw.barcode),
    productName: norm(raw.product_name) ?? user.product_name ?? null,
    brand: norm(raw.brand),
    languageNote: norm(raw.language_note) ?? '',
  }
}

export function isFoodCategory(cat: string): boolean {
  return FOOD_CATEGORIES.includes(cat)
}

export type { ExtractionStatus }