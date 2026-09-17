/**
 * Multi-pass OCR engine — runs PaddleOCR + Google Cloud Vision in parallel,
 * compares results, then verifies disagreements / low-confidence regions
 * with Gemini Vision.
 *
 * Performance rules:
 *   1. PaddleOCR runs first (Python microservice — fast, preprocessed).
 *   2. Google Cloud Vision runs in parallel (second pass for small/dense text).
 *   3. Both transcripts are normalised and compared line-by-line.
 *   4. Lines found in both engines → high confidence (no Gemini call needed).
 *   5. Lines in only one engine or with numeric/symbol disagreements → sent
 *      to Gemini for region-level verification (cropped via Python /crop-region).
 *   6. Gemini is only called for flagged regions; the scan never blocks on it.
 *
 * Graceful degradation:
 *   - Vision missing → Paddle only, Gemini verifies low-confidence Paddle lines.
 *   - Gemini missing → Paddle + Vision, disagreements shown as "needs review".
 *   - Both missing   → Paddle only (legacy behaviour).
 */

import type { OcrConfidence, PerImageExtract, PhotoInput, OcrProviderResult } from './types.js'
import { DEFAULT_GEMINI_MODEL } from '../gemini.js'

/* ------------------------------------------------------------------ */
/* Environment                                                         */
/* ------------------------------------------------------------------ */

const PYTHON_OCR_URL = process.env.PYTHON_OCR_URL || 'http://localhost:8100'

/** Maximum Gemini crop-verification calls per scan (budget cap). */
const GEMINI_BUDGET = parseInt(process.env.MULTIPASS_GEMINI_BUDGET ?? '8', 10)

/* ------------------------------------------------------------------ */
/* Normalisation                                                        */
/* ------------------------------------------------------------------ */

/** Collapse whitespace, lowercase, strip punctuation that OCR varies on. */
function normLine(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w₹$€.,/%\-\u0900-\u097f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Tokenise a normalised line for fuzzy matching. */
function tokens(s: string): string[] {
  return normLine(s).split(' ').filter(Boolean)
}

/** Jaccard similarity between two token sets (0..1). */
function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1
  const setA = new Set(a)
  const setB = new Set(b)
  let inter = 0
  for (const t of setA) if (setB.has(t)) inter++
  return inter / (setA.size + setB.size - inter)
}

/* ------------------------------------------------------------------ */
/* Per-image line comparison                                            */
/* ------------------------------------------------------------------ */

export interface LineVerdict {
  text: string
  verdict: 'agreed' | 'paddle_only' | 'vision_only' | 'conflict'
  confidence: 'high' | 'medium' | 'low'
  bbox?: number[] | null
}

/**
 * Compare the line sets from one image's PaddleOCR and Vision output.
 * Lines are matched by normalised similarity (≥ 0.75 = same line).
 */
function compareLines(
  paddleLines: Array<{ text: string; bbox?: number[] | null }>,
  visionLines: string[],
): LineVerdict[] {
  const verdicts: LineVerdict[] = []
  const usedVision = new Set<number>()

  for (const pl of paddleLines) {
    const pt = normLine(pl.text)
    if (!pt) continue
    let matched = false
    for (let vi = 0; vi < visionLines.length; vi++) {
      if (usedVision.has(vi)) continue
      const vt = normLine(visionLines[vi])
      if (!vt) continue
      if (jaccard(tokens(pt), tokens(vt)) >= 0.75 || pt === vt) {
        verdicts.push({ text: pl.text, verdict: 'agreed', confidence: 'high', bbox: pl.bbox })
        usedVision.add(vi)
        matched = true
        break
      }
    }
    if (!matched) {
      // Check for numeric conflicts (same position, different number)
      const num = pt.match(/[\d.,]+/)
      let conflict = false
      if (num) {
        for (let vi = 0; vi < visionLines.length; vi++) {
          if (usedVision.has(vi)) continue
          const vt = normLine(visionLines[vi])
          const vn = vt.match(/[\d.,]+/)
          if (vn && num[0] !== vn[0] && jaccard(tokens(pt), tokens(vt)) >= 0.6) {
            verdicts.push({ text: pl.text, verdict: 'conflict', confidence: 'low', bbox: pl.bbox })
            usedVision.add(vi)
            conflict = true
            break
          }
        }
      }
      if (!conflict) {
        verdicts.push({ text: pl.text, verdict: 'paddle_only', confidence: 'medium', bbox: pl.bbox })
      }
    }
  }

  for (let vi = 0; vi < visionLines.length; vi++) {
    if (usedVision.has(vi)) continue
    const vt = visionLines[vi].trim()
    if (!vt) continue
    verdicts.push({ text: vt, verdict: 'vision_only', confidence: 'medium' })
  }

  return verdicts
}

/* ------------------------------------------------------------------ */
/* Vision second pass (optional, graceful skip)                         */
/* ------------------------------------------------------------------ */

interface VisionOutcome {
  ok: boolean
  perImage: string[]
  error?: string
}

async function tryVision(images: string[], lang: string): Promise<VisionOutcome> {
  try {
    const mod = await import('../vision.js')
    const hints = lang && lang !== 'en' ? ['en', lang] : ['en']
    const out = await mod.extractTextWithVision(images, { languageHints: hints })
    return { ok: true, perImage: out.perImage }
  } catch (e) {
    return { ok: false, perImage: [], error: (e as Error)?.message ?? 'Vision unavailable' }
  }
}

/* ------------------------------------------------------------------ */
/* Gemini region verification (optional, budget-capped)                 */
/* ------------------------------------------------------------------ */

interface GeminiVerifyRequest {
  imageIndex: number
  bbox: number[]
  paddleText: string
  context?: string
}

interface GeminiVerifyResult {
  text: string | null
  verified: boolean
}

async function geminiVerifyCrops(
  images: string[],
  requests: GeminiVerifyRequest[],
): Promise<GeminiVerifyResult[]> {
  if (requests.length === 0) return []
  const key = process.env.GEMINI_API_KEY
  if (!key) return requests.map(() => ({ text: null, verified: false }))

  // Crop regions via Python /crop-region
  const capped = requests.slice(0, GEMINI_BUDGET)
  let crops: string[] = []
  try {
    const res = await fetch(`${PYTHON_OCR_URL}/crop-region`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        images,
        regions: capped.map((r) => ({ image: r.imageIndex, bbox: r.bbox })),
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`crop-region ${res.status}`)
    const data = await res.json()
    crops = data.crops ?? []
  } catch {
    return capped.map(() => ({ text: null, verified: false }))
  }

  // Build Gemini parts: one system prompt + all crop images in a single call
  const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = []
  for (let i = 0; i < capped.length; i++) {
    const crop = crops[i]
    if (!crop) continue
    const comma = crop.indexOf(',')
    const b64 = comma >= 0 ? crop.slice(comma + 1) : crop
    const mime = /^data:([^;,]+)/.exec(crop)?.[1] ?? 'image/jpeg'
    parts.push({ inline_data: { mime_type: mime, data: b64 } })
    parts.push({ text: `[Region ${i}] The PaddleOCR read: "${capped[i].paddleText}". What exact text do you see? Reply with JSON: {"regions":[{"i":N,"text":"EXACT_TEXT"}]} — never invent, if unreadable say "UNCLEAR".` })
  }

  const body = {
    contents: [{ parts }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
    systemInstruction: {
      parts: [{
        text: 'You are an OCR verification assistant. Read text from each image crop EXACTLY as printed — preserve spelling, capitalisation, symbols, ₹/$/€, decimals, %, units. Do NOT invent, correct, translate or add any text. If a crop is illegible, return "UNCLEAR". Return ONLY valid JSON.',
      }],
    },
  }

  try {
    const model = process.env.GEMINI_VISION_MODEL || process.env.GEMINI_TEXT_MODEL || DEFAULT_GEMINI_MODEL
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    })
    if (!res.ok) return capped.map(() => ({ text: null, verified: false }))
    const data = await res.json()
    const raw = data?.candidates?.[0]?.content?.parts?.map((p: any) => String(p?.text ?? '')).join('') ?? ''
    const parsed = extractJson(raw)
    if (!parsed?.regions) return capped.map(() => ({ text: null, verified: false }))
    const out: GeminiVerifyResult[] = capped.map((_, i) => {
      const match = parsed.regions.find((r: any) => r.i === i)
      if (!match?.text || match.text === 'UNCLEAR') return { text: null, verified: false }
      return { text: String(match.text).trim(), verified: true }
    })
    return out
  } catch {
    return capped.map(() => ({ text: null, verified: false }))
  }
}

/* ------------------------------------------------------------------ */
/* JSON extraction helper (minimal)                                     */
/* ------------------------------------------------------------------ */

function extractJson(text: string): any {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  try { return JSON.parse(cleaned) } catch { /* skip */ }
  const m = cleaned.match(/\{[\s\S]*\}/)
  if (m) { try { return JSON.parse(m[0]) } catch { /* skip */ } }
  return null
}

/* ------------------------------------------------------------------ */
/* Public API                                                           */
/* ------------------------------------------------------------------ */

export interface MultipassOutcome {
  perImages: PerImageExtract[]
  engines: string[]
  unclearLines: string[]
}

/**
 * Run the multi-engine OCR pipeline for one inspection's photos.
 *
 * 1. PaddleOCR (Python microservice) — primary
 * 2. Google Cloud Vision — parallel second pass (optional)
 * 3. Per-image line comparison → flag disagreements
 * 4. Gemini Vision — crop-verify flagged regions (optional, budget-capped)
 * 5. Build final per-image extracts with adjusted confidence
 */
export async function runMultipass(
  photos: PhotoInput[],
  lang: string,
  category: string | null,
): Promise<MultipassOutcome> {
  const images = photos
    .map((p) => p.data)
    .filter((d): d is string => typeof d === 'string' && !!d)
  if (images.length === 0) {
    throw new Error('No image data for multipass OCR.')
  }

  const engines: string[] = ['paddle']
  const unclearLines: string[] = []

  // ---- Stage 1: PaddleOCR ----
  const paddleRes = await fetch(`${PYTHON_OCR_URL}/ocr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images, lang: lang || 'en', fast: true, category: category ?? undefined }),
    signal: AbortSignal.timeout(90_000),
  })
  if (!paddleRes.ok) throw new Error(`Python OCR returned ${paddleRes.status}`)
  const paddle = await paddleRes.json()
  if (!paddle?.ok) throw new Error(paddle?.error ?? 'PaddleOCR failed')

  const paddleText: string = paddle.ocr_text ?? ''
  const paddleFields: Record<string, { value?: unknown; confidence?: unknown; source?: unknown }> = paddle.fields ?? {}
  const paddleFieldConf: Record<string, string> = paddle.field_confidence ?? {}
  const paddleFieldEvidence: Record<string, any> = paddle.field_evidence ?? {}
  const paddleConflicts: any[] = paddle.conflicts ?? []
  const blocksDetail: any[] = paddle.blocks_detail ?? []

  // Per-image data from Python
  const pyPerImages: any[] = []
  for (const bd of blocksDetail) {
    const blocks = (bd.blocks ?? []).map((b: any) => ({
      text: String(b.text ?? ''),
      bbox: b.region ?? null,
      conf: typeof b.confidence === 'number' ? b.confidence : 0.7,
      uncertain: Boolean(b.uncertain),
      single_pass: Boolean(b.single_pass),
    }))
    pyPerImages.push({ blocks, text: blocks.map((b: any) => b.text).join('\n') })
  }

  // ---- Stage 2: Vision (parallel) ----
  const vision = await tryVision(images, lang || 'en')
  if (vision.ok) engines.push('vision')

  // ---- Stage 3: Per-image comparison ----
  const verifyCandidates: GeminiVerifyRequest[] = []
  const imageVerdicts: LineVerdict[][] = []

  for (let i = 0; i < pyPerImages.length; i++) {
    const paddleLines = pyPerImages[i]?.blocks ?? []
    const visionLines = vision.ok ? (vision.perImage[i] ?? '').split('\n').filter(Boolean) : []
    const verdicts = compareLines(paddleLines, visionLines)
    imageVerdicts.push(verdicts)

    for (const v of verdicts) {
      if ((v.verdict === 'conflict' || v.verdict === 'paddle_only' || v.verdict === 'vision_only') && v.bbox) {
        verifyCandidates.push({
          imageIndex: i,
          bbox: v.bbox,
          paddleText: v.text,
        })
      }
    }
  }

  // ---- Stage 4: Gemini region verification (budget-capped) ----
  let geminiResults: GeminiVerifyResult[] = []
  if (verifyCandidates.length > 0 && process.env.GEMINI_API_KEY) {
    engines.push('gemini')
    geminiResults = await geminiVerifyCrops(images, verifyCandidates)
  }

  // Apply Gemini corrections to verdicts
  const geminiCorrections = new Map<number, string | null>()
  for (let i = 0; i < geminiResults.length; i++) {
    geminiCorrections.set(i, geminiResults[i].text)
  }

  // ---- Stage 5: Build final per-image extracts ----
  const pyFieldMap: Record<string, string> = {
    commodity_name: 'commodity_name', brand: 'brand', manufacturer: 'manufacturer',
    net_quantity: 'net_quantity', mrp: 'mrp', lot_no: 'batch_no', batch_no: 'batch_no',
    mfg_date: 'mfg_date', expiry_date: 'expiry_date', best_before: 'best_before_date',
    best_before_date: 'best_before_date', ingredients_text: 'ingredients_text',
    allergen_info: 'allergen_info', required_declarations: 'required_declarations',
    warnings: 'warnings', certification_details: 'certification_details',
    contact_info: 'contact_info', imported_manufacturer_detail: 'imported_manufacturer_detail',
    country_of_origin: 'country_of_origin', storage_conditions: 'storage_conditions',
    customer_care_details: 'customer_care_details', consumer_care: 'customer_care_details',
    address: 'contact_info', fssai_license: 'required_declarations',
  }

  const mappedFields: Record<string, string | null> = {}
  for (const [pyKey, f] of Object.entries(paddleFields)) {
    const ourKey = pyFieldMap[pyKey] ?? pyKey
    const v = f?.value
    const s = v == null ? '' : String(v).trim()
    if (s) mappedFields[ourKey] = s
  }

  const fieldConfidence: Record<string, OcrConfidence> = {}
  for (const [k, v] of Object.entries(paddleFieldConf)) {
    fieldConfidence[pyFieldMap[k] ?? k] = confFromRaw(v)
  }

  // Boost field confidence where both engines agree
  const allAgreedTexts = new Set<string>()
  for (const verdicts of imageVerdicts) {
    for (const v of verdicts) {
      if (v.verdict === 'agreed') allAgreedTexts.add(normLine(v.text))
    }
  }

  for (const [key, ev] of Object.entries(paddleFieldEvidence)) {
    const srcText = normLine(ev?.text ?? '')
    if (srcText && allAgreedTexts.has(srcText)) {
      fieldConfidence[key] = 'high'
    }
  }

  // Gemini corrections boost confidence
  const correctedTexts = new Set<string>()
  for (const [, text] of geminiCorrections) {
    if (text) correctedTexts.add(normLine(text))
  }
  for (const [key, ev] of Object.entries(paddleFieldEvidence)) {
    const srcText = normLine(ev?.text ?? '')
    if (srcText && correctedTexts.has(srcText)) {
      fieldConfidence[key] = 'high'
    }
  }

  // Track unclear lines: single-engine lines that Gemini did NOT verify,
  // plus conflicts where the two engines disagree on numbers/symbols.
  const verifiedCandidateTexts = new Set<string>()
  for (let i = 0; i < verifyCandidates.length; i++) {
    if (geminiResults[i]?.verified) {
      verifiedCandidateTexts.add(normLine(verifyCandidates[i]?.paddleText ?? ''))
    }
  }
  for (const [imgIdx, verdicts] of imageVerdicts.entries()) {
    void imgIdx
    for (const v of verdicts) {
      if (v.verdict === 'conflict') {
        unclearLines.push(v.text)
        continue
      }
      if (v.verdict === 'paddle_only' || v.verdict === 'vision_only') {
        const key = normLine(v.text)
        if (!verifiedCandidateTexts.has(key)) {
          unclearLines.push(v.text)
        }
      }
    }
  }

  // Build per-image extracts (one per photo)
  const perImages: PerImageExtract[] = images.map((_, i) => {
    const blocks = pyPerImages[i]?.blocks ?? []
    const text = blocks.map((b: any) => b.text).join('\n')
    const conf = blocks.length > 0
      ? blocks.reduce((sum: number, b: any) => sum + (b.conf ?? 0.7), 0) / blocks.length
      : 0.7

    return {
      index: i,
      text,
      language: lang || 'en',
      confidence: Math.round(conf * 100) / 100,
      fields: i === 0 ? mappedFields : {},
      field_confidence: i === 0 ? fieldConfidence : {},
      field_evidence: i === 0 ? paddleFieldEvidence : {},
      regions: blocks.map((b: any) => ({ text: b.text, bbox: b.bbox, conf: b.conf })),
    }
  })

  return { perImages, engines, unclearLines }
}

function confFromRaw(raw: unknown): OcrConfidence {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Python Paddle stack sends 0..1 confidences — map by threshold.
    if (raw >= 0.85) return 'high'
    if (raw >= 0.6) return 'medium'
    return 'low'
  }
  const v = String(raw ?? '').toLowerCase().trim()
  if (v === 'high' || v === 'high.0' || v === '1') return 'high'
  if (v === 'low' || v === 'low.0' || v === '0') return 'low'
  return 'medium'
}
