/**
 * Gemini Vision OCR provider — reads Indian product labels directly with
 * Gemini (multimodal), replacing the deployment dependency on the Python
 * PaddleOCR microservice. Returns real extracted fields from the photo.
 *
 * Env: GEMINI_API_KEY required, GEMINI_VISION_MODEL optional.
 */

import type { OcrConfidence, OcrProviderResult, PerImageExtract, PhotoInput, InspectionCategory } from './types.js'
import { DEFAULT_GEMINI_MODEL, geminiGenerateContent, dataUrlToInline, extractJson } from '../gemini.js'

const FIELD_KEYS = [
  'commodity_name',
  'brand',
  'manufacturer',
  'net_quantity',
  'mrp',
  'batch_no',
  'mfg_date',
  'expiry_date',
  'best_before_date',
  'ingredients_text',
  'allergen_info',
  'required_declarations',
  'warnings',
  'certification_details',
  'contact_info',
  'imported_manufacturer_detail',
  'country_of_origin',
  'storage_conditions',
  'customer_care_details',
] as const

const SYSTEM_PROMPT = `You are an expert OCR engine for Indian consumer product labels (FSSAI / Legal Metrology standards).
Read the label text EXACTLY as printed — do NOT invent, correct, summarise or translate anything.
Return ONLY valid JSON with this exact shape:

{
  "images": [
    {
      "text": "the full label text exactly as read, line by line",
      "confidence": 0.0-1.0,
      "fields": {
        "commodity_name": "generic/common product name or null",
        "brand": "brand name or null",
        "manufacturer": "manufacturer/packer/importer name and address or null",
        "net_quantity": "quantity in standard units e.g. 200 g or null",
        "mrp": "MRP including Rs symbol and price e.g. Rs 120 or null",
        "batch_no": "batch or lot number or null",
        "mfg_date": "manufacturing date as printed or null",
        "expiry_date": "expiry date as printed or null",
        "best_before_date": "best-before date as printed or null",
        "ingredients_text": "full ingredients list or null",
        "allergen_info": "allergen/Contains declaration or null",
        "required_declarations": "FSSAI licence/reg no., customer care, etc. or null",
        "warnings": "safety warnings or null",
        "certification_details": "certification/standard marks (ISI, BIS, AGMARK, IS, CE) or null",
        "contact_info": "address/contact details or null",
        "imported_manufacturer_detail": "importer/marketed-by details or null",
        "country_of_origin": "country of origin or null",
        "storage_conditions": "storage instructions or null",
        "customer_care_details": "customer care number/email or null"
      }
    }
  ]
}

Every field must be either a string exactly as printed or null. NEVER fabricate values. If a field is not readable from the image, use null.`

export async function geminiVisionOCR(
  photos: PhotoInput[],
  lang: string,
  _category: InspectionCategory,
): Promise<OcrProviderResult> {
  const images = photos
    .map((p) => p.data)
    .filter((d): d is string => typeof d === 'string' && !!d)
  if (images.length === 0) throw new Error('No image data for Gemini OCR.')

  const model = process.env.GEMINI_VISION_MODEL || process.env.GEMINI_TEXT_MODEL || DEFAULT_GEMINI_MODEL
  const parts: Array<{ text: string } | ReturnType<typeof dataUrlToInline>> = [
    { text: 'Read the following product label photo(s) and extract the fields as instructed.' },
  ]
  for (let i = 0; i < images.length; i++) {
    parts.push(dataUrlToInline(images[i]))
    parts.push({ text: `[Photo ${i + 1}]` })
  }

  const answer = await geminiGenerateContent({
    model,
    system: SYSTEM_PROMPT,
    parts,
    temperature: 0.05,
    maxOutputTokens: 8192,
  })
  const parsed = extractJson(answer)
  const rawImages = Array.isArray(parsed?.images) ? parsed.images : []

  if (rawImages.length === 0) throw new Error('Gemini returned no readable label data.')

  const perImages: PerImageExtract[] = images.map((_, idx) => {
    const raw = rawImages[idx] ?? {}
    const fields: Record<string, string | null> = {}
    const fieldConfidence: Record<string, OcrConfidence> = {}
    const fieldEvidence: Record<string, { text: string; confidence?: number | null; bbox?: number[] | null }> = {}

    for (const key of FIELD_KEYS) {
      const v = raw.fields?.[key]
      const s = v == null ? '' : String(v).trim()
      if (s) {
        fields[key] = s
        fieldConfidence[key] = 'high'
        fieldEvidence[key] = { text: s, confidence: 0.95 }
      } else {
        fields[key] = null
      }
    }

    const rawText = String(raw.text ?? '').trim()
    const confidence = typeof raw.confidence === 'number' ? raw.confidence : 0.85

    return {
      index: idx,
      text: rawText || `Label photo ${idx + 1} (Gemini Vision)`,
      language: lang || 'en',
      confidence,
      fields,
      field_confidence: fieldConfidence,
      field_evidence: fieldEvidence,
      regions: rawText.split('\n').filter(Boolean).map((line) => ({ text: line, bbox: null, conf: confidence })),
    }
  })

  return {
    provider: 'gemini',
    demo: false,
    perImages,
    engines: ['gemini'],
    unclear: [],
  }
}