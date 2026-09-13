/**
 * Field extraction & consensus — the accuracy core.
 *
 * Pure / DOM-free: runs in the browser pipeline AND in the Node probe tests.
 *
 * Upgrades vs the v1 extractor:
 *   - matches carry EVIDENCE (region bbox, source image, OCR pass, word conf)
 *   - hard guards kill false positives (bare 14-digit "FSSAI" no longer
 *     swallows a GTIN; money fields normalize "₹199" ≡ "199.00")
 *   - confidence is a multi-signal blend (vote share, OCR word confidence,
 *     source coverage, detector confidence, image quality, panel position,
 *     validation result), not just vote share
 *   - conflicts produce NEEDS_REVIEW (null value) instead of a wrong pick
 *   - prefix merge (e.g. "ITC Ltd" vs "ITC Limited") only applies to text
 *     names, never to numeric/money fields
 */
import type { Extractions } from '../compliance/types'
import { quantitySpans } from '../compliance/validators'
import {
  BBox,
  ConfidenceWeights,
  DEFAULT_WEIGHTS,
  FieldEvidence,
  FieldStatus,
  OcPass,
  PanelPrior,
  TexField,
} from './types'

export type { FieldEvidence, FieldStatus, TexField }

export type KeyOfExtractions = keyof Extractions

interface RegExProfile {
  labelKey: KeyOfExtractions
  patterns: RegExp[]
  multiline?: boolean
  numeric?: boolean
  money?: boolean
}

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

export const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()

export function brandFromManufacturer(name: string): string {
  const bare = clean(name)
    .replace(/\b(?:private|pvt\.?|limited|ltd\.?|llp)\b\.?/gi, ' ')
    .replace(/[,\s]+/g, ' ')
    .trim()
  return bare.split(' ')[0] ?? ''
}

export function classifyVegMark(v: string | null): string | null {
  if (!v) return null
  const s = v.toLowerCase()
  if (/non[\s-]*veg|nonveg/.test(s)) return 'nonveg'
  if (/veg/.test(s)) return 'veg'
  return null
}

/** O↔0 / I↔1 / S↔5 confusable map — only when a letter is flanked by digits. */
export function fixField(value: string, numeric: boolean): string {
  if (!numeric) return clean(value)
  return clean(value)
    .replace(/[oO](?=\d)|(?<=\d)[oO]/g, '0')
    .replace(/[lI](?=\d)|(?<=\d)[lI]/g, '1')
    .replace(/[sS](?=\d)|(?<=\d)[sS]/g, '5')
    .replace(/[bB](?=\d)|(?<=\d)[bB]/g, '8')
    .replace(/[gG](?=\d)|(?<=\d)[gG]/g, '6')
    .replace(/[zZ](?=\d)|(?<=\d)[zZ]/g, '2')
}

/**
 * Canonical key for consensus grouping. Numeric fields normalize confusable
 * chars; money fields additionally collapse "₹199" / "Rs.199" / "199.00" to
 * the same key. Text fields compare case/space/punct-insensitively.
 */
export function eqKey(key: KeyOfExtractions, value: string): string {
  const profile = PROFILES.find((p) => p.labelKey === key)
  const numeric = !!profile?.numeric
  const money = !!profile?.money
  if (numeric) {
    let v = fixField(value, true)
    if (money) v = String(Number(clean(v).replace(/[^\d.]/g, '')) ?? '')
    return v.replace(/[^\d]/g, '_')
  }
  return clean(value).toLowerCase().replace(/[\s.,;:()'"\-]+/g, ' ').trim()
}

export function validateField(key: KeyOfExtractions, value: string): boolean {
  if (!value || value.length < 2) return false
  switch (key) {
    case 'mrp':
    case 'unit_sale_price': {
      const digits = Array.from(value.replace(/[^\d.]/g, '')).filter((c) => c !== '.').length
      const amount = Number(clean(value).replace(/[^\d.]/g, ''))
      const justLabel = /^(?:mrp|m\.?r\.?p\.?|rs\.?|₹|inr|usp)$/i.test(value.trim())
      const numericLen = Array.from(value.replace(/[^\d]/g, '')).length
      const isBarcodeLen = numericLen === 8 || numericLen === 12 || numericLen === 13 || numericLen === 14
      return digits > 0 && Number.isFinite(amount) && !justLabel && !isBarcodeLen
    }
    case 'net_quantity': {
      return quantitySpans(value).length > 0
    }
    case 'mfg_date':
    case 'best_before': {
      return /\d/.test(value) || /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(value)
    }
    case 'fssai_license': {
      const digits = value.replace(/\D/g, '')
      return digits.length === 14 && (digits[0] === '1' || digits[0] === '2')
    }
    case 'veg_nonveg':
      return /^(?:veg|nonveg)$/i.test(value)
    case 'manufacturer':
    case 'packer':
    case 'importer': {
      const hasCompanyName = /[a-zA-Z]{3,}/.test(value)
      const justLabel = /^(?:manufactured?\s+by|packed\s+by|imported?\s+by|marketed?\s+by)$/i.test(value.trim())
      return hasCompanyName && !justLabel
    }
    case 'address':
      return /[a-zA-Z0-9]{4,}/.test(value)
    case 'consumer_care':
      return /\d{7,}/.test(value) || /@/.test(value) || /www|\.com|\.in/i.test(value)
    case 'lot_no': {
      const code = value.replace(/[^a-zA-Z0-9]/g, '')
      return code.length >= 3 && code.length <= 20
    }
    case 'country_of_origin':
      return /^[a-zA-Z ]{2,30}$/.test(value.trim())
    case 'commodity_name':
      return /\b[a-zA-Z]{3,}\b/.test(value)
    case 'ingredients':
    case 'allergens':
    case 'nutrition_info':
      return value.length >= 5
    default:
      return true
  }
}

/* ------------------------------------------------------------------ */
/* Extraction profiles (regex rules engine)                            */
/* ------------------------------------------------------------------ */

export const PROFILES: RegExProfile[] = [
  {
    labelKey: 'mrp',
    patterns: [
      /\bmaximum\s+retail\s+price\b[^\n]{0,40}?[₹rs.]?\s*[:.]?\s*[\d,.]+/i,
      /\bm\.?\s*r\.?\s*p\.?\b[^\n]{0,40}?[₹rs.]?\s*[:.]?\s*[\d,.]+/i,
      /\bmrp(?:\.|\s|:|-)*\s*(?:rs\.?|₹|inr)?\s*[:.]?\s*\(?\s*incl[a-z.\s]*of?\s*all?\s*tax\)?[\s:]*[₹r]?\s*[\d,.]+/i,
      /\bmrp\.?\s*[:.]?\s*rs\.?\s*[\d,.]+/i,
      /\bmrp\.?\s*[:.]?\s*(?:incl[a-z.\s]*tax)?[\s:]*[₹r]?\s*[\d,.]+/i,
      /\bmrp\.?\s*[:.]?\s*[\d,.]+/i,
    ],
    numeric: true,
    money: true,
  },
  {
    labelKey: 'net_quantity',
    patterns: [
      /\bnet\s*(?:wt\.?|weight|qty\.?|quantity|contents?|content|vol\.?)?\s*[:.]?\s*[\d.,]+\s*(?:x\s*)?(?:\d+\s*[x×]\s*)?(?:g|kg|gm|gram|grams|milligrams?|mg|ton|ml|millilitres?|l|litre|litres?|liter|liters?|cl|cm|centimetres?|m|metres?|km|pcs?|pieces?|nos|sheets?|rolls?|dozens?|pairs?|no\.?)\b/i,
      /\bnet\s*(?:qty\.?|quantity|weight|wt\.?|volume|vol\.?)\s*[:.\-]?\s*[\d.,]+(?:\s*[x×]\s*[\d.,]+\s*[a-z]+)?\s*(?:g|kg|ml|l|pcs?|nos?)\b/i,
      /\b(?:net|said\s+to\s+contain)\s*[:.]?\s*[\d.,]+(?:\s*[x×]\s*[\d.,]+\s*[a-z]+)?\s*(?:g|kg|ml|l|pcs?|nos?)\b/i,
      /\bnet\s*(?:wt\.?|weight|qty\.?|quantity)\s*[:-]+[\s\d.,a-z]+/i,
    ],
    numeric: true,
  },
  {
    labelKey: 'unit_sale_price',
    patterns: [
      /unit\s*sale\s*price[\s:]*[₹r]?\s*[\d,.]+/i,
      /\busp[\s:]*[₹r]?\s*[\d,.]+/i,
    ],
    money: true,
  },
  {
    labelKey: 'manufacturer',
    patterns: [
      /(?:manufactured?\s+by|manufacturer\s*[:.]|mfg\.?\s*(?:by|at|\.?\s*date)|made\s+(?:at|by))\s*[:.]?\s*([a-zA-Z&.,0-9 ]{4,80}?)(?=\n|,|addr|regd|tel|pin|phone|www|email|$)/i,
      /\b(?:mfr|mfg)\b[^a-zA-Z]{0,5}([a-zA-Z&.,0-9 ]{4,60}?)(?=\n|,|$)/i,
    ],
  },
  {
    labelKey: 'packer',
    patterns: [/(?:packed\s+by|packer\s*[:.]|packed\s+at)\s*[:.]?\s*([a-zA-Z&.,0-9 ]{4,80}?)(?=\n|,|addr|regd|tel|pin|phone|www|email|$)/i],
  },
  {
    labelKey: 'importer',
    patterns: [
      /(?:imported?\s+by|importer\s*[:.]|market\.?\s*by|marketed\s+by)\s*[:.]?\s*([a-zA-Z&.,0-9 ]{4,80}?)(?=\n|,|addr|regd|tel|pin|phone|www|email|$)/i,
    ],
  },
  {
    labelKey: 'address',
    patterns: [
      /(?:regd\.?\s*office|registered\s+office|corporate\s+office|address|addr\.?|principal\s+office|factory|plant)\s*[:.]?\s*([a-zA-Z.,0-9\- \n]{6,150}?)(?:consumer|tel|email|www|customer|phone|\n\d{2,5}|pin[\s:-]*\d{6}|mfg|mrp|net|best|exp|use\s+by|batch|lot)/i,
      /\b\d{6}\b/i,
      /([a-zA-Z.0-9 ,\-]{6,150}?\b\d{6}\b[a-zA-Z.,\- \n]{0,40})/i,
    ],
    multiline: true,
  },
  {
    labelKey: 'country_of_origin',
    patterns: [
      /(?:country\s+of\s+origin|origin\s+country)\s*[:.]?\s*([a-z ]{2,30}?)(?=\n|,|\.|$)/i,
      /(?:made\s+in|product\s+of|manufactured?\s+in)\s*[:.]?\s*([a-z ]{2,30}?)(?=\n|,|\.|$)/i,
    ],
  },
  {
    labelKey: 'mfg_date',
    patterns: [
      /\b(?:mfg\.?\s*|manufactur(?:ing|ed)?\s+date\s*:?|manufactured?\s+on\s*:?|packed\s+on\s*:?|pkd\.?\s*:?|pkg\.?\s*:?)\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.](?:20)?\d{2}|\d{1,2}[\/\-\.](?:20)?\d{2}|\b[a-z]{3,9}\.?\s*\d{4})/i,
      /\b(?:mfg|pck|pkd|pk)\.?\s*(?:date)?\s*[:.]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.](?:20)?\d{2}|\b[a-z]{3,9}\.?\s*\d{4})/i,
      /\b(?:mfg|pkd|packed)\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\b/i,
    ],
    numeric: true,
  },
  {
    labelKey: 'best_before',
    patterns: [
      /\bbest\s*before\s*(?:use\s*)?(?:by\s*)?(?:\s*date\s*:?)?\s*([^\n]{3,30})/i,
      /\bexp(?:iry|ires?)?\.?\s*(?:date\s*[:.]?)?\s*([^\n]{3,30})/i,
      /\buse\s*by\s*[:.]?\s*([^\n]{3,30})/i,
      /\b(?:shelf\s*life|validity)\s*[:.]?\s*([^\n]{3,30})/i,
    ],
    numeric: true,
  },
  {
    labelKey: 'consumer_care',
    patterns: [
      /(?:consumer\s*(?:care|call|helpline|customer\s*care|affairs)|customer\s*care|customer\s*service|help\s*line|toll\s*(?:free|free\s*no))\s*[:.]?\s*([^\n]{4,100})/i,
      /\b(?:helpline|toll\s*free)\s*[:.]?\s*([^\n]{4,80})/i,
    ],
  },
  {
    labelKey: 'lot_no',
    patterns: [
      /\b(?:lot|batch|let|bch|ltn)\s*(?:no\.?|number|#)?\s*[:.]?\s*([a-z0-9\-]{3,20})(?=\n|,|\.|$)/i,
      /\b(?:batch|lot)\s*[:.]?\s*([a-z0-9\-]{3,20})/i,
    ],
  },
  {
    labelKey: 'fssai_license',
    patterns: [
      /\bfssai\s*(?:lic(?:ence|ense)?|no\.?|number)?\s*[:.]?\s*(\d{14})\b/i,
      /\b(\d{14})\s*(?:fssai|lic(?:ence|ense)?)\b/i,
      // Bare 14-digit numbers are ONLY accepted when a licence keyword is
      // present in the same region — a GTIN/EAN must never be misread as FSSAI.
      /\b(?:lic(?:ence|ense)?\s*(?:no\.?|number)?\s*[:.]?\s*|\bfssai\b[^\n]{0,40}?)(\d{14})\b/i,
    ],
    numeric: true,
  },
  {
    labelKey: 'veg_nonveg',
    patterns: [
      /(?:pure\s*)?(?:veg(?:etarian)?)\b(?![\w]*(?:non))/i,
      /(?:non[\s\-]*veg|nonveg|non[\s\-]*vegetarian)\b/i,
    ],
  },
  {
    labelKey: 'ingredients',
    patterns: [/(?:ingredients?|contains?|composition)\s*[:.]?\s*([\s\S]{6,500}?)(?=\b(?:nutri|allergen|best\s*before|mrp|energy|fat|protein|carbo|sodium|sugar|fibre|fiber)\b|$)/i],
  },
  {
    labelKey: 'allergens',
    patterns: [/(?:allergen(?:s)?)\s*[:.]?\s*([\s\S]{4,300}?)(?=\b(?:nutri|best\s*before|mrp|energy|fat|protein|ingredients)\b|$)/i],
  },
  {
    labelKey: 'nutrition_info',
    patterns: [/(?:nutritional?\s*info(?:rmation)?|nutrition\s*facts|per\s*(?:100\s*g|serve)|energys?)\s*[:.]?\s*([\s\S]{10,1500}?)(?=mrp|ingredients?|best\s*before|allergen|$)/i],
  },
]

/* ------------------------------------------------------------------ */
/* Panel-position priors                                               */
/* ------------------------------------------------------------------ */

const PRIORS: Record<KeyOfExtractions, Partial<Record<PanelPrior, number>>> = {
  mrp: { back: 0.9, side: 0.8, front: 0.6, other: 0.5 },
  net_quantity: { back: 0.9, side: 0.9, front: 0.7, other: 0.5 },
  unit_sale_price: { side: 0.85, back: 0.7, front: 0.6, other: 0.5 },
  manufacturer: { back: 0.9, front: 0.5, side: 0.6, other: 0.5 },
  packer: { back: 0.9, front: 0.5, side: 0.6, other: 0.5 },
  importer: { back: 0.9, front: 0.5, side: 0.6, other: 0.5 },
  address: { back: 0.9, front: 0.5, side: 0.55, other: 0.5 },
  country_of_origin: { back: 0.8, front: 0.55, side: 0.5, other: 0.5 },
  mfg_date: { back: 0.95, side: 0.7, front: 0.4, other: 0.5 },
  best_before: { back: 0.8, side: 0.7, front: 0.45, other: 0.5 },
  consumer_care: { back: 0.85, side: 0.6, front: 0.4, other: 0.5 },
  lot_no: { back: 0.7, side: 0.6, front: 0.35, other: 0.5 },
  fssai_license: { back: 0.9, side: 0.7, front: 0.4, other: 0.5 },
  commodity_name: { front: 0.9, back: 0.6, side: 0.5, other: 0.5 },
  veg_nonveg: { front: 0.9, back: 0.6, side: 0.5, other: 0.5 },
  ingredients: { front: 0.9, back: 0.7, side: 0.5, other: 0.5 },
  allergens: { front: 0.9, back: 0.7, side: 0.5, other: 0.5 },
  nutrition_info: { back: 0.85, front: 0.8, side: 0.5, other: 0.5 },
}

/* ------------------------------------------------------------------ */
/* Match collection + consensus                                        */
/* ------------------------------------------------------------------ */

interface MatchEntry {
  key: string
  raw: string
  val: string
  ocrConf: number
  source: number
  passLabel: string
  regionId: number | null
  bbox: BBox | null
  regionText: string
  panelWeight: number
  crop: string | null
}

interface ConfidenceSignals {
  voteShare: number
  ocrConf: number
  sourceCoverage: number
  detectorConf: number
  imageQuality: number
  positionPrior: number
  validation: number
}

export function blendConfidence(s: ConfidenceSignals, w: ConfidenceWeights = DEFAULT_WEIGHTS): number {
  const total =
    s.voteShare * w.voteShare +
    s.ocrConf * w.ocrConf +
    s.sourceCoverage * w.sourceCoverage +
    s.detectorConf * w.detectorConf +
    s.imageQuality * w.imageQuality +
    s.positionPrior * w.positionPrior +
    s.validation * w.validation
  return Math.max(0, Math.min(1, total))
}

function statusFor(confidence: number, validationOk: boolean, conflict: boolean): FieldStatus {
  if (conflict) return 'NEEDS_REVIEW'
  if (!validationOk) return 'INVALID'
  if (confidence >= 0.72) return 'HIGH_CONFIDENCE'
  if (confidence >= 0.5) return 'MEDIUM_CONFIDENCE'
  if (confidence >= 0.3) return 'LOW_CONFIDENCE'
  return 'NEEDS_REVIEW'
}

function legacyFor(status: FieldStatus): 'high' | 'medium' | 'low' | null {
  switch (status) {
    case 'VERIFIED':
    case 'HIGH_CONFIDENCE':
      return 'high'
    case 'MEDIUM_CONFIDENCE':
      return 'medium'
    case 'LOW_CONFIDENCE':
    case 'NEEDS_REVIEW':
    case 'INVALID':
      return 'low'
    default:
      return null
  }
}

function toEvidence(m: MatchEntry): FieldEvidence {
  return {
    source_image: m.source,
    bbox: m.bbox,
    region_text: m.regionText,
    pass: m.passLabel,
    ocr_conf: m.ocrConf,
    value: m.val,
    crop: m.crop,
  }
}

export interface ExtractResult {
  ex: Extractions
  fields: Record<string, TexField>
  uncertain: string[]
}

export interface ExtractOptions {
  productName?: string
  /** Hard/soft quality gate score of the image set (0..1). */
  imageQuality?: number
  /** Panel position per source image index (photo order). */
  positions?: PanelPrior[]
  /** Mean detector confidence across regions (0..1), or null. */
  detectorConf?: number | null
  weights?: ConfidenceWeights
}

/**
 * Consensus over all region passes for one field.
 * Returns a TexField plus the normalized value for Extractions.
 */
function resolveField(
  key: KeyOfExtractions,
  entries: MatchEntry[],
  opts: ExtractOptions,
): TexField {
  const profile = PROFILES.find((p) => p.labelKey === key)
  const numeric = !!profile?.numeric
  const totalSources = Math.max(1, new Set(entries.map((m) => m.source)).size)
  const quality = opts.imageQuality ?? 0.5
  const detector = opts.detectorConf ?? 0.5

  if (entries.length === 0) {
    return {
      value: null,
      status: 'MISSING',
      confidence: 0,
      legacyConfidence: null,
      source_image: null,
      evidence: [],
      votes: 0,
      conflict: false,
    }
  }

  const groups = new Map<string, MatchEntry[]>()
  for (const m of entries) {
    const k = m.key
    const arr = groups.get(k) ?? []
    arr.push(m)
    groups.set(k, arr)
  }

  const ranked = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
  const [topKey, top] = ranked[0]
  const runnerUp = ranked[1]

  let value: string | null = null
  let status: FieldStatus = 'MISSING'
  let conflict = false
  let sig: ConfidenceSignals = {
    voteShare: 0, ocrConf: 0, sourceCoverage: 0, detectorConf: detector,
    imageQuality: quality, validation: 0, positionPrior: 0,
  }

  /** Pick the longest / highest-ocr-conf value from a group as the winner. */
  const pickWinner = (group: MatchEntry[]): MatchEntry =>
    group.slice().sort((a, b) => b.val.length - a.val.length || b.ocrConf - a.ocrConf)[0]

  const best = pickWinner(top)

  const positionPrior = best.panelWeight

  if (runnerUp && runnerUp[1].length === top.length && runnerUp[0] !== topKey) {
    // Tie between distinct values. Prefix-merge ALLOWED only for text names.
    const topNorm = topKey.toLowerCase().replace(/[^a-z0-9]/g, '')
    const runNorm = runnerUp[0].toLowerCase().replace(/[^a-z0-9]/g, '')
    if (
      !numeric &&
      topNorm.length >= 5 &&
      runNorm.length >= 5 &&
      (topNorm.startsWith(runNorm) || runNorm.startsWith(topNorm)) &&
      Math.min(topNorm.length, runNorm.length) / Math.max(topNorm.length, runNorm.length) >= 0.5
    ) {
      const longer = top[0].val.length >= runnerUp[1][0].val.length ? top : runnerUp[1]
      const win = pickWinner(longer)
      value = win.val
      conflict = false
      sig = {
        voteShare: top.length / Math.max(1, top.length + runnerUp[1].length),
        ocrConf: Math.max(...longer.map((m) => m.ocrConf)),
        sourceCoverage: new Set(longer.map((m) => m.source)).size / Math.max(1, totalSources),
        detectorConf: detector,
        imageQuality: quality,
        validation: 1,
        positionPrior,
      }
      const conf = blendConfidence(sig, opts.weights)
      const ok = validateField(key, value)
      status = ok ? statusFor(conf, true, false) : 'INVALID'
      return {
        value, status,
        confidence: ok ? conf : Math.min(conf, 0.4),
        legacyConfidence: legacyFor(status),
        source_image: win.source,
        evidence: longer.map(toEvidence),
        votes: longer.length,
        conflict,
      }
    }
    // True conflict — never guess. → NEEDS_REVIEW (null).
    conflict = true
    value = null
    status = 'NEEDS_REVIEW'
    const bestConf = Math.max(...top.map((m) => m.ocrConf), ...runnerUp[1].map((m) => m.ocrConf))
    sig = {
      voteShare: 0.5,
      ocrConf: bestConf,
      sourceCoverage: new Set([...top, ...runnerUp[1]].map((m) => m.source)).size / Math.max(1, totalSources),
      detectorConf: detector,
      imageQuality: quality,
      validation: 0,
      positionPrior,
    }
    return {
      value: null, status, confidence: 0.5, legacyConfidence: 'low',
      source_image: best.source, evidence: [...top, ...runnerUp[1]].map(toEvidence),
      votes: top.length, conflict,
    }
  }

  // Clear winner.
  value = best.val
  const topTotal = top.length
  const allTotal = ranked.reduce((s, [, g]) => s + g.length, 0)
  const ocrConf = Math.max(...top.map((m) => m.ocrConf))
  const sourcesInTop = new Set(top.map((m) => m.source)).size
  const validationOk = validateField(key, value)
  sig.voteShare = allTotal > 0 ? topTotal / allTotal : 0
  sig.ocrConf = ocrConf
  sig.sourceCoverage = Math.min(1, sourcesInTop / totalSources)
  sig.validation = validationOk ? 1 : 0
  sig.positionPrior = positionPrior

  const conf = blendConfidence(sig, opts.weights)
  status = statusFor(conf, validationOk, false)
  // VERIFIED only with real multi-source agreement AND strong OCR confidence
  // (barcode ⇄ OCR cross-checks upgrade fields elsewhere in the pipeline).
  if (validationOk && conf >= 0.82 && sourcesInTop >= 2 && topTotal >= 2) status = 'VERIFIED'

  const finalConf = validationOk ? conf : Math.min(conf, 0.4)
  if (!validationOk) status = 'INVALID'

  return {
    value, status,
    confidence: finalConf,
    legacyConfidence: legacyFor(status),
    source_image: best.source,
    evidence: top.map(toEvidence),
    votes: top.length,
    conflict: false,
  }
}

export function extractAllFields(passes: OcPass[], opts: ExtractOptions = {}): ExtractResult {
  const ex: Extractions = {
    commodity_name: null,
    mrp: null, net_quantity: null, unit_sale_price: null, manufacturer: null,
    packer: null, importer: null, address: null, country_of_origin: null,
    mfg_date: null, best_before: null, consumer_care: null, lot_no: null,
    fssai_license: null, veg_nonveg: null, nutrition_info: null, ingredients: null,
    allergens: null,
  }
  const fields: Record<string, TexField> = {}
  const uncertain: string[] = []
  const positions = opts.positions ?? []

  const posOf = (source: number): PanelPrior => positions[source] ?? (source === 0 ? 'front' : source === 1 ? 'back' : source === 2 ? 'side' : 'other')
  const priorOf = (key: KeyOfExtractions, source: number): number => PRIORS[key][posOf(source)] ?? 0.5

  const profileFor = (key: KeyOfExtractions) => PROFILES.find((p) => p.labelKey === key)

  for (const key of Object.keys(ex) as KeyOfExtractions[]) {
    if (key === 'commodity_name') continue
    const profile = profileFor(key)
    if (!profile) continue
    const minLen = profile.multiline ? 6 : 3
    const entries: MatchEntry[] = []

    for (const pass of passes) {
      if (!pass.text) continue
      for (const p of profile.patterns) {
        const m = pass.text.match(p)
        if (!m) continue
        const raw = m[1] ?? m[0]
        if (!raw) continue
        const val = fixField(raw, !!profile.numeric)
        if (val.length < minLen) continue
        entries.push({
          key: eqKey(key, raw),
          raw,
          val,
          ocrConf: pass.ocrConf,
          source: pass.source,
          passLabel: pass.pass,
          regionId: pass.regionId,
          bbox: pass.bbox,
          regionText: pass.text,
          panelWeight: priorOf(key, pass.source),
          crop: pass.crop ?? null,
        })
      }
    }

    const tf = resolveField(key, entries, opts)
    // Klass: veg/non-veg canonicalization.
    let finalField = tf
    let finalValue = tf.value
    if (key === 'veg_nonveg' && tf.value) {
      const canon = classifyVegMark(tf.value)
      if (canon !== tf.value) {
        finalValue = canon
        finalField = { ...tf, value: canon }
      }
    }
    ;(ex as unknown as Record<string, string | null>)[key] = finalValue
    fields[key] = finalField

    const flagsUncertain =
      finalField.status === 'NEEDS_REVIEW' ||
      finalField.status === 'INVALID' ||
      (finalValue != null && finalField.legacyConfidence === 'low')
    if (flagsUncertain) uncertain.push(key)
  }

  // commodity_name: user product name takes precedence (VERIFIED, no OCR need).
  const productName = opts.productName?.trim()
  const fallback = passes
    .filter((p) => p.text)
    .sort((a, b) => a.source - b.source || (a.pass < b.pass ? -1 : 1))[0]
    ?.text.split(',')[0]?.trim() || null
  ex.commodity_name = productName || fallback
  if (productName) {
    fields.commodity_name = {
      value: productName, status: 'VERIFIED', confidence: 1, legacyConfidence: 'high',
      source_image: null, evidence: [], votes: 1, conflict: false,
    }
  } else if (fallback) {
    fields.commodity_name = {
      value: fallback, status: 'MEDIUM_CONFIDENCE', confidence: 0.6, legacyConfidence: 'medium',
      source_image: passes.find((p) => p.text)?.source ?? null, evidence: [], votes: 1, conflict: false,
    }
  } else {
    fields.commodity_name = {
      value: null, status: 'MISSING', confidence: 0, legacyConfidence: null,
      source_image: null, evidence: [], votes: 0, conflict: false,
    }
  }

  return { ex, fields, uncertain }
}

/** Upgrade a field to 'VERIFIED' when the barcode digit check already agreed. */
export function upgradeToVerified(fields: Record<string, TexField>, key: KeyOfExtractions): void {
  const f = fields[key]
  if (f && f.value != null && f.status === 'HIGH_CONFIDENCE') {
    fields[key] = { ...f, status: 'VERIFIED' }
  }
}

/** Export bbox shape for the browser evidence overlay. */
export type { BBox }