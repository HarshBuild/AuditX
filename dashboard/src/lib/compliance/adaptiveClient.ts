/**
 * Adaptive evidence layer — browser-side verification.
 *
 * Mirrors the server-side `compliance/adaptiveOcr.ts` logic for the no-server
 * Gemini fallback path: matches every extracted field value to the OCR text
 * blocks (with bounding boxes + confidence) from the fast PaddleOCR pass,
 * flags NEEDS_VERIFICATION honestly instead of pretending, detects cross-image
 * conflicts, and derives a deterministic TRUST SCORE from measured signals
 * (OCR confidence, character verification, image quality, cross-image
 * agreement, verification rate).
 *
 * Evidence-first: a value is never overwritten here; it is confirmed or
 * flagged. We intentionally do NOT claim a real "targeted re-scan" happened
 * client-side (there is no Tesseract crop re-read in this path) — `via` is
 * only ever `direct` or `cross_image`, and the UI says so.
 */
import type { FieldVerification, TrustBreakdown } from '../types2'
import type { RegionBlock as LibRegionBlock } from '../visionOcr'

export interface BlocksImage {
  blocks: LibRegionBlock[]
}

export interface AdaptiveClientInput {
  blocksByImage?: BlocksImage[]
  qualityScores?: number[]
  ocrInitialMs?: number
  missedRegions?: { checked: number; found: number }
}

export interface AdaptiveClientResult {
  verification: Record<string, FieldVerification>
  trust: { score: number; breakdown: TrustBreakdown }
  conflicts: Array<{ field: string; values: string[]; images: number[]; explanation: string }>
  uncertain: string[]
  scanned_regions: number
  missed_regions: { checked: number; found: number }
  processing: { initial_ocr_ms: number; verification_ms: number; total_ms: number }
}

const CONFIGURABLE_CHARS = /[0O1IlzZSsGg6B8]/

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

export function hasConfusables(text: string): boolean {
  return text.length >= 2 && CONFIGURABLE_CHARS.test(text)
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

function tierOf(conf: number): 'high' | 'medium' | 'low' {
  return conf >= 0.95 ? 'high' : conf >= 0.7 ? 'medium' : 'low'
}

function confToScore(conf: number): number {
  return conf >= 0.95 ? 0.92 : conf >= 0.7 ? 0.68 : 0.42
}

function modelBase(conf: string | null | undefined): number {
  return conf === 'high' ? 0.7 : conf === 'medium' ? 0.55 : 0.35
}

/**
 * Trust score — derived ONLY from measured signals. Exported so the targeted
 * Gemini visual verification can recompute the score after re-checking a
 * region instead of keeping stale numbers.
 */
export function computeTrustFromVerification(
  verification: Record<string, FieldVerification>,
  candidateKeys: string[],
  qualityAvg: number,
  crossImageAgreementScore: number,
): { score: number; breakdown: TrustBreakdown } {
  const verifiedCount = candidateKeys.filter((k) => verification[k]?.verified).length
  const verificationRate = candidateKeys.length ? (verifiedCount / candidateKeys.length) * 100 : 100

  const ocrConfs = candidateKeys
    .map((k) => verification[k]?.ocrConfidence)
    .filter((c): c is number => typeof c === 'number' && c > 0)
  const ocrConfidence = ocrConfs.length ? (ocrConfs.reduce((a, b) => a + b, 0) / ocrConfs.length) * 100 : candidateKeys.length ? 70 : 90

  const charScores = candidateKeys.map((k) => (verification[k]?.verified ? 100 : verification[k]?.needsVerification ? 40 : 80))
  const characterVerification = charScores.length ? charScores.reduce((a, b) => a + b, 0) / charScores.length : 95

  const imageQuality = qualityAvg

  const crossImageAgreement = crossImageAgreementScore

  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(ocrConfidence * 0.25 + characterVerification * 0.25 + imageQuality * 0.15 + crossImageAgreement * 0.2 + verificationRate * 0.15),
    ),
  )

  const breakdown: TrustBreakdown = {
    ocr_confidence: Math.round(ocrConfidence),
    character_verification: Math.round(characterVerification),
    image_quality: Math.round(imageQuality),
    cross_image_agreement: Math.round(crossImageAgreement),
    verification_rate: Math.round(verificationRate),
  }
  return { score, breakdown }
}

/**
 * Verify fields against the fast-OCR blocks. Returns null when no blocks are
 * available so callers can silently skip adaptive verification.
 */
export function clientsideVerify(
  fields: Record<string, { value: string | null; confidence?: string | null }>,
  uncertain: string[],
  blocksByImage: BlocksImage[],
  qualityScores?: number[],
  ocrInitialMs?: number,
  opts?: { verifyCritical?: boolean; missedRegions?: { checked: number; found: number } },
): AdaptiveClientResult | null {
  if (!blocksByImage || blocksByImage.length === 0) return null
  const t0 = Date.now()
  const verification: Record<string, FieldVerification> = {}
  const uncertainSet = new Set(uncertain)
  const conflicts: AdaptiveClientResult['conflicts'] = []

  const candidates = Object.entries(fields ?? {}).filter(([, f]) => f?.value != null) as Array<
    [string, { value: string | null; confidence?: string | null }]
  >

  interface Best {
    image: number
    block: LibRegionBlock
    conf: number
  }
  const bestByField: Record<string, Best | null> = {}
  const distinctByImage: Record<string, Map<number, string>> = {}

  for (const [key, f] of candidates) {
    const value = String(f?.value ?? '')
    let best: Best | null = null
    const valuesByImage = new Map<number, string>()
    const imageSet = new Set<number>()
    for (let i = 0; i < blocksByImage.length; i++) {
      for (const b of blocksByImage[i]?.blocks ?? []) {
        if (!matches(value, b.text)) continue
        if (!valuesByImage.has(i)) valuesByImage.set(i, normText(b.text))
        imageSet.add(i)
        if (!best || b.confidence > best.conf) best = { image: i, block: b, conf: b.confidence }
      }
    }
    bestByField[key] = best
    if (imageSet.size > 1 && valuesByImage.size > 1) distinctByImage[key] = valuesByImage
  }

  // Cross-image conflict detection (deterministic, never guess).
  for (const [key, m] of Object.entries(distinctByImage)) {
    const distinct = Array.from(new Set(Array.from(m.values())))
    if (distinct.length > 1) {
      conflicts.push({
        field: key,
        values: distinct.map((v) => v || '(unreadable)'),
        images: Array.from(m.keys()),
        explanation: 'Different photos show different readings for this field — needs manual verification.',
      })
      uncertainSet.add(key)
    }
  }

  for (const [key, f] of candidates) {
    const value = String(f?.value ?? '')
    const modelConf = f?.confidence ?? null
    const best = bestByField[key]
    const hasConflict = distinctByImage[key] && new Set(Array.from(distinctByImage[key].values())).size > 1
    const confusable = hasConfusables(value)
    const needs =
      modelConf === 'low' ||
      modelConf === 'medium' ||
      uncertainSet.has(key) ||
      (confusable && (!best || best.conf < 0.95)) ||
      // Critical fields get stricter verification even at high confidence (#5)
      (!!opts?.verifyCritical && CRITICAL_FIELDS.has(key))

    if (!needs && best && tierOf(best.conf) === 'high') {
      verification[key] = {
        verified: true,
        needsVerification: false,
        via: 'direct',
        confidence_score: confToScore(best.conf),
        ocrConfidence: best.conf,
        before: value,
        after: value,
        evidence: [{ source_image: best.image, region: best.block.region ?? null, region_text: best.block.text, pass: 'initial_ocr', ocr_conf: best.conf, value }],
      }
      continue
    }

    // Cross-image confirmation when at least two photos agree on the value.
    if (!hasConflict) {
      const agreeingImages = Array.from(distinctByImage[key]?.keys() ?? []).filter(
        (i) => agree(value, distinctByImage[key]?.get(i) ?? ''),
      )
      if (agreeingImages.length >= 2 && !needs) {
        verification[key] = {
          verified: true,
          needsVerification: false,
          via: 'cross_image',
          confidence_score: 0.85,
          ocrConfidence: best?.conf ?? null,
          before: value,
          after: value,
          evidence: agreeingImages
            .slice(0, 2)
            .map((i) => ({ source_image: i, region: null, region_text: distinctByImage[key]?.get(i) ?? '', pass: 'initial_ocr', ocr_conf: null, value })),
        }
        continue
      }
    }

    // Honest flag — we did not re-scan this region on-device.
    verification[key] = {
      verified: false,
      needsVerification: true,
      via: 'direct',
      confidence_score: Math.max(modelBase(modelConf), hasConflict ? modelBase('medium') : 0),
      ocrConfidence: best?.conf ?? null,
      before: value,
      after: null,
      evidence: best
        ? [{ source_image: best.image, region: best.block.region ?? null, region_text: best.block.text, pass: 'initial_ocr', ocr_conf: best.conf, value }]
        : [],
    }
    uncertainSet.add(key)
  }

  // ---------------------------------------------------------------
  // Trust score — derived ONLY from measured signals.
  // ---------------------------------------------------------------
  const keys = candidates.map(([k]) => k)
  const imageQuality = qualityScores?.length ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length : 80

  const multi = Object.values(distinctByImage)
  let crossImageAgreement = 100
  if (multi.length > 0) {
    const agreeing = multi.filter((m) => new Set(Array.from(m.values())).size === 1).length
    crossImageAgreement = (agreeing / multi.length) * 100
  }

  const trust = computeTrustFromVerification(verification, keys, imageQuality, crossImageAgreement)

  return {
    verification,
    trust,
    conflicts,
    uncertain: Array.from(uncertainSet),
    scanned_regions: 0,
    missed_regions: opts?.missedRegions ?? { checked: 0, found: 0 },
    processing: { initial_ocr_ms: ocrInitialMs ?? 0, verification_ms: Date.now() - t0, total_ms: Date.now() - t0 + (ocrInitialMs ?? 0) },
  }
}