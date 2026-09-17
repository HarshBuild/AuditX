/**
 * OpenRouter Vision OCR provider — Report 3 of the multi-AI verification
 * pipeline. Sends label photos to an OpenRouter vision model and extracts
 * the MISA label fields as JSON. Fully server-side (key never leaves the
 * backend). Gracefully unavailable when OPENROUTER_API_KEY is unset.
 *
 * Env: OPENROUTER_API_KEY (required), OPENROUTER_VISION_MODEL (optional),
 *      OPENROUTER_SITE_URL / OPENROUTER_APP_NAME (optional attribution).
 */

import type { OcrConfidence, OcrProviderResult, PerImageExtract, PhotoInput, InspectionCategory } from './types.js'
import { extractJson } from '../gemini.js'

const BASE = 'https://openrouter.ai/api/v1'

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
  'product_variant',
  'total_weight',
  'packing_date',
  'nutrition_info',
  'product_claims',
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
        "customer_care_details": "customer care number/email or null",
        "product_variant": "flavour/variant/sub-type or null",
        "total_weight": "total/gross weight if printed or null",
        "packing_date": "packing date if printed or null",
        "nutrition_info": "nutrition facts table as read or null",
        "product_claims": "marketing claims (e.g. No Added Sugar) or null"
      }
    }
  ]
}

Every field must be either a string exactly as printed or null. NEVER fabricate values. If a field is not readable from the image, use null.`

export function openRouterApiKey(): string {
  return process.env.OPENROUTER_API_KEY ?? ''
}

export function openRouterModel(): string {
  return process.env.OPENROUTER_VISION_MODEL || 'qwen/qwen2.5-vl-72b-instruct'
}

export async function openRouterVisionOCR(
  photos: PhotoInput[],
  lang: string,
  _category: InspectionCategory,
): Promise<OcrProviderResult> {
  const key = openRouterApiKey()
  if (!key) throw new Error('OPENROUTER_API_KEY is not set.')

  const images = photos
    .map((p) => p.data)
    .filter((d): d is string => typeof d === 'string' && !!d)
  if (images.length === 0) throw new Error('No image data for OpenRouter OCR.')

  const content: Array<Record<string, unknown>> = [
    { type: 'text', text: 'Read the following product label photo(s) and extract the fields as instructed.' },
  ]
  for (let i = 0; i < images.length; i++) {
    content.push({ type: 'image_url', image_url: { url: images[i] } })
    content.push({ type: 'text', text: `[Photo ${i + 1}]` })
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
  }
  if (process.env.OPENROUTER_SITE_URL) headers['HTTP-Referer'] = process.env.OPENROUTER_SITE_URL
  if (process.env.OPENROUTER_APP_NAME) headers['X-Title'] = process.env.OPENROUTER_APP_NAME

  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: openRouterModel(),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content },
      ],
      temperature: 0.05,
      max_tokens: 8192,
    }),
    signal: AbortSignal.timeout(90_000),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`OpenRouter ${res.status}: ${err.slice(0, 300)}`)
  }
  const data: any = await res.json()
  const answer = String(data?.choices?.[0]?.message?.content ?? '').trim()
  if (!answer) throw new Error('Empty OpenRouter response.')

  const parsed = extractJson(answer)
  const rawImages = Array.isArray(parsed?.images) ? parsed.images : []
  if (rawImages.length === 0) throw new Error('OpenRouter returned no readable label data.')

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
        fieldEvidence[key] = { text: s, confidence: 0.9 }
      } else {
        fields[key] = null
      }
    }

    const rawText = String(raw.text ?? '').trim()
    const confidence = typeof raw.confidence === 'number' ? raw.confidence : 0.85

    return {
      index: idx,
      text: rawText || `Label photo ${idx + 1} (OpenRouter Vision)`,
      language: lang || 'en',
      confidence,
      fields,
      field_confidence: fieldConfidence,
      field_evidence: fieldEvidence,
      regions: rawText.split('\n').filter(Boolean).map((line) => ({ text: line, bbox: null, conf: confidence })),
    }
  })

  return {
    provider: 'openrouter',
    demo: false,
    perImages,
    engines: ['openrouter'],
    unclear: [],
  }
}
