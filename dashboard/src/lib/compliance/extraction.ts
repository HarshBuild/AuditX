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

ADDITIONAL PRODUCT DETAILS — extract for EVERY product type (food and non-food):
EXAMINE SMALL PRINT SHARPLY. Appliance/garment/tool labels are the MOST important source for these.
- "model": model / product / article / item / style / catalog / stock / part number, EXACT code (e.g. "ABC-120").
- "serial_number": serial number/SN, EXACT code.
- "material": material / made of / fabric description (e.g. "100% Polyester").
- "dimensions": size with units (e.g. "12 x 8 x 4 mm") — keep the x/× separators.
- "capacity": capacity with unit (e.g. "1.5 L", "35 kg", "500 ml").
- "voltage": e.g. "230V", "100-240V AC".
- "power": e.g. "1200 W", "1.5 kW".
- "current": e.g. "1.2 A".
- "frequency": e.g. "50 Hz".
- "website": any website printed on the label (e.g. "www.example.com").
- "email": any e-mail printed on the label (e.g. "care@example.com").
- "certifications": certification marks/standards (ISI, BIS, CE, RoHS, ISO 9001, EN 60335, Energy Star...).
- "warnings": warning/caution/danger sentences or safety phrases ("Do not...", "Keep away from children", "Flammable").
- "instructions": how-to-use / directions-for-use / dosage / usage instructions text.
NEVER guess a code: transcribe EXACT verbatim characters (a misread "0" vs "O" is worse than null).

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
    "allergens": {"value":"null or verbatim text","confidence":"high|medium|low","source_image":null},
    "model": {"value":"null or EXACT model/product/article/item/style/catalog/stock/part code","confidence":"high|medium|low","source_image":null},
    "serial_number": {"value":"null or EXACT serial/SN code","confidence":"high|medium|low","source_image":null},
    "material": {"value":"null or material/made of description","confidence":"high|medium|low","source_image":null},
    "dimensions": {"value":"null or size with units (12 x 8 x 4 mm)","confidence":"high|medium|low","source_image":null},
    "capacity": {"value":"null or capacity with unit (1.5 L)","confidence":"high|medium|low","source_image":null},
    "voltage": {"value":"null or EXACT voltage (230V / 100-240V AC)","confidence":"high|medium|low","source_image":null},
    "power": {"value":"null or EXACT power (1200 W / 1.5 kW)","confidence":"high|medium|low","source_image":null},
    "current": {"value":"null or EXACT current (1.2 A)","confidence":"high|medium|low","source_image":null},
    "frequency": {"value":"null or EXACT frequency (50 Hz)","confidence":"high|medium|low","source_image":null},
    "website": {"value":"null or website as printed","confidence":"high|medium|low","source_image":null},
    "email": {"value":"null or e-mail as printed","confidence":"high|medium|low","source_image":null},
    "certifications": {"value":"null or certification marks/standards (ISI, BIS, CE, RoHS, ISO 9001)","confidence":"high|medium|low","source_image":null},
    "warnings": {"value":"null or warning/caution/danger text","confidence":"high|medium|low","source_image":null},
    "instructions": {"value":"null or usage/directions text","confidence":"high|medium|low","source_image":null}
  },
  "uncertain": ["list of field keys where value was printed but illegible"],
  "language_note": "short sentence about label languages"
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
  const candidates = [cleaned, jsonStringSafe(cleaned)]
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      /* try the next candidate */
    }
  }
  const m = cleaned.match(/\{[\s\S]*\}/)
  if (m) {
    const repaired = jsonStringSafe(m[0])
    try {
      return JSON.parse(repaired)
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

/** Long-form fields where multi-line / long text is legitimate. */
const LONG_TEXT_KEYS = new Set(['warnings', 'instructions', 'nutrition_info', 'ingredients', 'allergens'])

/** Normalize an extraction field — accepts {value,confidence,source_image} or plain string/null. */
export function normField(raw: unknown, key?: string): NormField {
  if (raw === null || raw === undefined) return { value: null, confidence: 'low', source_image: null }
  if (typeof raw === 'string') return { value: cleanStructured(raw), confidence: 'medium', source_image: null }
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    const rawValue = typeof o.value === 'string' ? o.value : o.value === null || o.value === undefined ? null : String(o.value)
    let value = cleanStructured(rawValue)
    // Short simple fields must be one line — reject OCR paragraphs/blobs here.
    // Long-form fields (warnings/instructions/nutrition/ingredients/allergens)
    // legitimately span lines and are kept verbatim.
    if (value !== null && !(key && LONG_TEXT_KEYS.has(key)) && looksLikeOcrBlob(value)) value = null
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
    model: null, serial_number: null, material: null, dimensions: null,
    capacity: null, voltage: null, power: null, current: null, frequency: null,
    website: null, email: null, certifications: null, warnings: null,
    instructions: null,
  }
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>
    for (const key of EXTRACTION_KEYS) {
      fields[key] = normField(src[key], key)
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