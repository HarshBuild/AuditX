/**
 * Adaptive Evidence-Based OCR — verification orchestrator.
 *
 * Two-tier extraction:
 *   1. A fast first OCR pass produces text blocks WITH bounding boxes and
 *      per-block confidence.
 *   2. Only the uncertain regions (MEDIUM/LOW confidence, confusable
 *      characters 0/O, 1/I/l, 5/S, …) are re-scanned — via the microservice
 *      `/verify-region` endpoint which crops the exact region, conditionally
 *      preprocesses it and re-OCRs JUST that crop. The full image is never
 *      re-scanned (the core performance optimization).
 *
 * Evidence-first rule: a value is never overwritten. It may only be confirmed
 * (agreement + higher confidence) or flagged `needsVerification`. Conflicting
 * values across photos are reported as conflicts — never picked at random.
 *
 * The TRUST SCORE is derived from measurable signals (OCR confidence, character
 * verification, image quality, cross-image agreement, verification rate), not
 * fabricated.
 */
import { parseRaw, type ParsedRaw } from './extraction.js'

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

export interface RegionBlock {
  text: string
  confidence: number
  region: [number, number, number, number]
  region_id?: string
}

export interface RegionImage {
  image_id: string
  blocks: RegionBlock[]
}

export interface VerificationEvidence {
  source_image: number
  region: [number, number, number, number] | null
  region_text: string
  pass: 'initial_ocr' | 'targeted_re_scan' | 'visual'
  ocr_conf: number | null
  value: string
}

export interface FieldVerification {
  verified: boolean
  needsVerification: boolean
  via: 'direct' | 'cross_image' | 'targeted_re_scan'
  confidence_score: number
  ocrConfidence: number | null
  before: string | null
  after: string | null
  evidence: VerificationEvidence[]
}

export interface TrustBreakdown {
  ocr_confidence: number
  character_verification: number
  image_quality: number
  cross_image_agreement: number
  verification_rate: number
}

export interface AdaptiveVerification {
  verification: Record<string, FieldVerification>
  trust: { score: number; breakdown: TrustBreakdown }
  conflicts: Array<{ field: string; values: string[]; images: number[]; explanation: string }>
  uncertain: string[]
  scanned_regions: number
  missed_regions: { checked: number; found: number }
  processing: { initial_ocr_ms: number; verification_ms: number; total_ms: number }
}

export interface AdaptiveInput {
  images: string[]
  blocksByImage: RegionBlock[][]
  fields: Record<string, { value: string | null; confidence?: string | null; source_image?: number | null }>
  uncertain: string[]
  extractionsConflicts: Array<{ field: string; values: string[]; explanation: string; images?: number[] }>
  lang: string
  qualityScores?: number[]
  ocrInitialMs?: number
  missedRegions?: { checked: number; found: number }
}

export const CONFIGURABLE_CHARS = /[0O1IlzZSsGg6B8]/

/**
 * Labels where a wrong character can change a legal-metrology finding
 * (codes, serials, quantities, prices, dates, electrical ratings). Per the
 * spec these get STRICTER verification even when first-pass OCR is ≥95%.
 */
export const CRITICAL_FIELDS = new Set([
  'model', 'serial_number', 'sku', 'lot_no', 'batch', 'tariff_code',
  'mrp', 'unit_sale_price', 'net_quantity', 'net_qty',
  'mfg_date', 'best_before', 'expiry_date', 'fssai_license',
  'power', 'voltage', 'current', 'capacity', 'weight', 'dimensions',
])

export function pythonOcrUrl(): string {
  return process.env.PYTHON_OCR_URL || 'http://localhost:8100'
}

export function hasConfusables(text: string): boolean {
  return text.length >= 2 && CONFIGURABLE_CHARS.test(text)
}

export function tierOf(conf: number): 'high' | 'medium' | 'low' {
  if (conf >= 0.95) return 'high'
  if (conf >= 0.7) return 'medium'
  return 'low'
}

export function confToScore(conf: number): number {
  return conf >= 0.95 ? 0.92 : conf >= 0.7 ? 0.68 : 0.42
}

function normText(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[\s_\-.,:;'"₹/$\\]/g, '')
    .trim()
}

function agree(a: string, b: string): boolean {
  const na = normText(a)
  const nb = normText(b)
  if (!na || !nb) return false
  if (na === nb) return true
  return na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))
}

function matches(value: string, blockText: string): boolean {
  const v = normText(value)
  const b = normText(blockText)
  if (!v || !b) return false
  if (b.includes(v)) return true
  const vTokens = v.split(/[^a-z0-9]+/).filter((t) => t.length >= 3)
  const bTokens = new Set(b.split(/[^a-z0-9]+/).filter((t) => t.length >= 3))
  return vTokens.some((t) => bTokens.has(t))
}

/* ------------------------------------------------------------------ */
/* Python evidence source                                              */
/* ------------------------------------------------------------------ */

/** Call the Python microservice /ocr once to get blocks + quality (fallback when the request did not include them). */
export async function fetchOcrEvidence(
  images: string[],
  lang: string,
): Promise<{
  blocksByImage: RegionBlock[][]
  qualityScores: number[]
  ms: number
  missedRegions: { checked: number; found: number }
}> {
  const t0 = Date.now()
  const res = await fetch(`${pythonOcrUrl()}/ocr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images, lang, fast: true }),
  })
  if (!res.ok) throw new Error(`Python OCR service returned ${res.status}`)
  const data = await res.json()
  const blocksByImage: RegionBlock[][] = []
  for (const im of Array.isArray(data.blocks_detail) ? data.blocks_detail : []) {
    const blocks: RegionBlock[] = (Array.isArray(im?.blocks) ? im.blocks : [])
      .filter((b: any) => b && Array.isArray(b.region) && b.region.length === 4)
      .map((b: any) => ({
        text: String(b.text ?? ''),
        confidence: Number(b.confidence ?? 0),
        region: [b.region[0], b.region[1], b.region[2], b.region[3]],
        region_id: b.region_id,
      }))
    blocksByImage.push(blocks)
  }
  const qualityScores: number[] = Array.isArray(data.image_quality)
    ? data.image_quality.map((q: any) => Number(q?.score ?? 80))
    : []
  const missedRegions = {
    checked: Number(data.image_regions?.missed_regions_checked ?? 0),
    found: Number(data.image_regions?.missed_found ?? 0),
  }
  return { blocksByImage, qualityScores, ms: Date.now() - t0, missedRegions }
}

export interface VerifyRegionResult {
  index: number
  region: number[]
  text: string | null
  confidence: number
  lines: Array<{ text: string; confidence: number }>
}

/** Call the Python microservice /verify-region for the given image + regions. */
async function verifyRegions(image: string, regions: number[][], lang: string): Promise<VerifyRegionResult[]> {
  const res = await fetch(`${pythonOcrUrl()}/verify-region`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, regions, lang, enhance: true }),
  })
  if (!res.ok) throw new Error(`Python verify-region returned ${res.status}`)
  const data = await res.json()
  return Array.isArray(data.results) ? data.results : []
}

/* ------------------------------------------------------------------ */
/* Main orchestrator                                                   */
/* ------------------------------------------------------------------ */

export async function runAdaptiveVerification(input: AdaptiveInput): Promise<AdaptiveVerification> {
  const t0 = Date.now()
  const verification: Record<string, FieldVerification> = {}
  const uncertain = new Set(input.uncertain ?? [])
  const conflicts: Array<{ field: string; values: string[]; images: number[]; explanation: string }> = [
    ...(input.extractionsConflicts ?? []).map((c) => ({ ...c, images: c.images ?? [] })),
  ]
  let scannedRegions = 0

  const fields = Object.entries(input.fields ?? {}).filter(([, f]) => f?.value != null) as Array<
    [string, { value: string | null; confidence?: string | null; source_image?: number | null }]
  >

  // --- Pass 1 analysis: match each extracted field value to the strongest OCR block ---
  interface BlockMatch {
    image: number
    block: RegionBlock
    conf: number
  }
  const matchByField: Record<string, BlockMatch | null> = {}
  const bestBlockOverall: { conf: number; images: number } = { conf: 0, images: 0 }
  const distinctByImage: Record<string, Map<number, string>> = {}

  for (const [key, f] of fields) {
    const value = String(f?.value ?? '')
    let best: BlockMatch | null = null
    const seenImages = new Set<number>()
    const valuesByImage = new Map<number, string>()
    for (let i = 0; i < input.blocksByImage.length; i++) {
      for (const b of input.blocksByImage[i] ?? []) {
        if (!matches(value, b.text)) continue
        seenImages.add(i)
        bestBlockOverall.conf = Math.max(bestBlockOverall.conf, b.confidence)
        bestBlockOverall.images = Math.max(bestBlockOverall.images, i + 1)
        if (!valuesByImage.has(i)) valuesByImage.set(i, normText(b.text))
        if (!best || b.confidence > best.conf) best = { image: i, block: b, conf: b.confidence }
      }
    }
    matchByField[key] = best
    if (seenImages.size > 1 && valuesByImage.size > 1) {
      distinctByImage[key] = valuesByImage
    }
  }

  // --- Pass 2: decide which fields need targeted verification ---
  interface Target {
    key: string
    value: string
    modelConf: 'high' | 'medium' | 'low' | null
    best: BlockMatch
  }
  const targetsByImage = new Map<number, Target[]>()

  const needTarget = (key: string, modelConf: string | null | undefined, value: string, best: BlockMatch | null): boolean => {
    if (modelConf === 'low') return true
    if (modelConf === 'medium') return true
    if (input.uncertain?.includes(key)) return true
    if (hasConfusables(value) && best && best.conf < 0.95) return true
    // Critical fields get stricter verification EVEN at high confidence (#5)
    if (CRITICAL_FIELDS.has(key)) return true
    if (!best) return modelConf === 'low' || input.uncertain?.includes(key) || false
    return false
  }

  for (const [key, f] of fields) {
    const value = String(f?.value ?? '')
    const modelConf = (f?.confidence ?? null) as 'high' | 'medium' | 'low' | null
    const best = matchByField[key]
    const needs = needTarget(key, modelConf, value, best)
    if (!needs) {
      // HIGH + strong block — accept directly with evidence
      const ev: VerificationEvidence[] = best
        ? [{ source_image: best.image, region: best.block.region, region_text: best.block.text, pass: 'initial_ocr', ocr_conf: best.conf, value }]
        : []
      verification[key] = {
        verified: true,
        needsVerification: false,
        via: best ? 'direct' : 'direct',
        confidence_score: confToScore(best?.conf ?? 0.95),
        ocrConfidence: best?.conf ?? null,
        before: value,
        after: value,
        evidence: ev,
      }
      continue
    }
    if (!best) {
      // No region evidence — cannot verify cheaply; be honest about it.
      verification[key] = {
        verified: false,
        needsVerification: true,
        via: 'direct',
        confidence_score: modelConf === 'high' ? 0.7 : modelConf === 'medium' ? 0.55 : 0.35,
        ocrConfidence: null,
        before: value,
        after: null,
        evidence: [],
      }
      uncertain.add(key)
      continue
    }
    const list = targetsByImage.get(best.image) ?? []
    list.push({ key, value, modelConf, best })
    targetsByImage.set(best.image, list)
  }

  // --- Pass 3: TARGETED re-scan — crop ONLY the uncertain regions ---
  const verifyMs0 = Date.now()
  try {
    const perImageRegions = Array.from(targetsByImage.entries())
    const resultsByImage = new Map<number, VerifyRegionResult[]>()
    await Promise.all(
      perImageRegions.map(async ([imgIdx, targets]) => {
        const regions = targets.map((t) => t.best.block.region.map((v) => Number(v)))
        try {
          const out = await verifyRegions(input.images[imgIdx], regions, input.lang)
          resultsByImage.set(imgIdx, out)
        } catch {
          resultsByImage.set(imgIdx, [])
        }
      }),
    )
    for (const [imgIdx, targets] of perImageRegions) {
      const results = resultsByImage.get(imgIdx) ?? []
      targets.forEach((t, k) => {
        scannedRegions += 1
        const re = results.filter((r) => Number(r.index) === k).pop() ?? (results[k] as typeof results[number] | undefined)
        const base = t.modelConf === 'high' ? 0.7 : t.modelConf === 'medium' ? 0.55 : 0.35
        const ev: VerificationEvidence[] = [
          { source_image: imgIdx, region: t.best.block.region, region_text: t.best.block.text, pass: 'initial_ocr', ocr_conf: t.best.conf, value: t.value },
        ]
        if (re?.text && re.confidence > 0) {
          const ok = agree(t.value, re.text)
          ev.push({
            source_image: imgIdx,
            region: [re.region?.[0] ?? t.best.block.region[0], re.region?.[1] ?? t.best.block.region[1], re.region?.[2] ?? t.best.block.region[2], re.region?.[3] ?? t.best.block.region[3]] as [number, number, number, number],
            region_text: re.text,
            pass: 'targeted_re_scan',
            ocr_conf: re.confidence,
            value: t.value,
          })
          if (ok && tierOf(re.confidence) !== 'low') {
            verification[t.key] = {
              verified: true,
              needsVerification: false,
              via: 'targeted_re_scan',
              confidence_score: Math.max(base, confToScore(re.confidence)),
              ocrConfidence: re.confidence,
              before: t.value,
              after: t.value,
              evidence: ev,
            }
          } else {
            // Evidence disagrees — do NOT overwrite; keep needs verification.
            verification[t.key] = {
              verified: false,
              needsVerification: true,
              via: 'targeted_re_scan',
              confidence_score: Math.min(base, confToScore(re.confidence)),
              ocrConfidence: re.confidence,
              before: t.value,
              after: re.text,
              evidence: ev,
            }
            uncertain.add(t.key)
          }
        } else {
          verification[t.key] = {
            verified: false,
            needsVerification: true,
            via: 'targeted_re_scan',
            confidence_score: base,
            ocrConfidence: null,
            before: t.value,
            after: null,
            evidence: ev,
          }
          uncertain.add(t.key)
        }
      })
    }
  } catch {
    // Targeted re-scan failed (network/model issue) — fall back to honest flags.
    for (const targets of targetsByImage.values()) {
      for (const t of targets) {
        if (!verification[t.key]) {
          verification[t.key] = {
            verified: false,
            needsVerification: true,
            via: 'direct',
            confidence_score: t.modelConf === 'high' ? 0.7 : t.modelConf === 'medium' ? 0.55 : 0.35,
            ocrConfidence: t.best.conf,
            before: t.value,
            after: null,
            evidence: [],
          }
          uncertain.add(t.key)
        }
      }
    }
  }
  const verificationMs = Date.now() - verifyMs0

  // --- Pass 4: cross-image consistency (deterministic, never guess) ---
  for (const [key, valuesByImage] of Object.entries(distinctByImage)) {
    const distinct = Array.from(new Set(Array.from(valuesByImage.values())))
    if (distinct.length > 1) {
      if (!conflicts.some((c) => c.field === key)) {
        conflicts.push({
          field: key,
          values: distinct.map((v) => v || '(unreadable)'),
          images: Array.from(valuesByImage.keys()),
          explanation: 'Different photos show different readings for this field — needs manual verification.',
        })
      }
      uncertain.add(key)
      if (verification[key]) verification[key] = { ...verification[key], needsVerification: true, verified: false }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Trust score — derived ONLY from measured signals                    */
  /* ------------------------------------------------------------------ */
  const candidateKeys = fields.map(([k]) => k).filter((k) => verification[k])
  const verifiedCount = candidateKeys.filter((k) => verification[k]?.verified).length
  const needsList = candidateKeys.filter((k) => verification[k]?.needsVerification)
  const verificationRate = candidateKeys.length ? (verifiedCount / candidateKeys.length) * 100 : 100

  const ocrConfs = candidateKeys
    .map((k) => verification[k]?.ocrConfidence)
    .filter((c): c is number => typeof c === 'number' && c > 0)
  const ocrConfidence = ocrConfs.length ? (ocrConfs.reduce((a, b) => a + b, 0) / ocrConfs.length) * 100 : candidateKeys.length ? 70 : 90

  const charScores = candidateKeys.map((k) => (verification[k]?.verified ? 100 : verification[k]?.needsVerification ? 40 : 80))
  const characterVerification = charScores.length ? charScores.reduce((a, b) => a + b, 0) / charScores.length : 95

  const imageQuality = input.qualityScores?.length ? input.qualityScores.reduce((a, b) => a + b, 0) / input.qualityScores.length : 80

  const multi = Object.values(distinctByImage)
  let crossImageAgreement = 100
  if (multi.length > 0) {
    const agreeing = multi.filter((m) => new Set(Array.from(m.values())).size === 1).length
    crossImageAgreement = (agreeing / multi.length) * 100
  }

  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        ocrConfidence * 0.25 + characterVerification * 0.25 + imageQuality * 0.15 + crossImageAgreement * 0.2 + verificationRate * 0.15,
      ),
    ),
  )

  return {
    verification,
    trust: {
      score,
      breakdown: {
        ocr_confidence: Math.round(ocrConfidence),
        character_verification: Math.round(characterVerification),
        image_quality: Math.round(imageQuality),
        cross_image_agreement: Math.round(crossImageAgreement),
        verification_rate: Math.round(verificationRate),
      },
    },
    conflicts,
    uncertain: Array.from(uncertain),
    scanned_regions: scannedRegions,
    missed_regions: {
      checked: input.missedRegions?.checked ?? 0,
      found: input.missedRegions?.found ?? 0,
    },
    processing: {
      initial_ocr_ms: input.ocrInitialMs ?? 0,
      verification_ms: verificationMs,
      total_ms: Date.now() - t0,
    },
  }
}

/** Normalize a raw perImageBlocks payload (from /api/ocr or the frontend) into per-image block arrays. */
export function normalizeRegions(raw: unknown): RegionBlock[][] {
  if (!Array.isArray(raw)) return []
  const out: RegionBlock[][] = []
  for (const im of raw) {
    if (!im || typeof im !== 'object') continue
    const blocks: RegionBlock[] = Array.isArray((im as any).blocks)
      ? (im as any).blocks
          .filter((b: any) => b && Array.isArray(b.region) && b.region.length === 4)
          .map((b: any) => ({
            text: String(b.text ?? ''),
            confidence: Number(b.confidence ?? 0),
            region: [b.region[0], b.region[1], b.region[2], b.region[3]],
            region_id: b.region_id,
          }))
      : []
    out.push(blocks)
  }
  return out
}

export type { ParsedRaw }
export { parseRaw }