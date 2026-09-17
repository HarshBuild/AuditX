/**
 * Multi-AI Evidence Verification & Adjudication engine.
 *
 * Compares up to 3 independent OCR reports field-by-field and produces ONE
 * final adjudicated result. Deterministic, evidence-based, fully typed:
 *
 *   - Normalization (case, punctuation, spacing, OCR substitutions, units,
 *     numeric formatting, dates) — no exact-string requirement.
 *   - Strict canonical comparison for numeric/legal fields (400g vs 40g is
 *     a real conflict; 400g vs "400 g" is equivalent).
 *   - Majority + confidence + source handling; dissent is never silenced.
 *   - Single-source results are NEVER marked VERIFIED.
 *   - Confidence is evidence-based (agreement-weighted), never just the
 *     model's own number.
 *   - Every decision carries a concise user-facing reason (no hidden CoT).
 */

import type {
  AdjudicatedField,
  AdjudicationStatus,
  OcrConfidence,
  OcrProviderResult,
  PerImageExtract,
  ReportFieldVote,
  VerificationCounts,
  VerificationReportInfo,
  VerificationSummary,
} from './types.js'
import type { ReportOutcome } from './ocr.js'

/* ------------------------------------------------------------------ */
/* Field vocabulary                                                     */
/* ------------------------------------------------------------------ */

export interface AdjudicatedFieldDef {
  key: string
  label: string
  /** Strict canonical comparison (numeric/legal/date fields). */
  strict: boolean
}

export const ADJUDICATED_FIELDS: AdjudicatedFieldDef[] = [
  { key: 'commodity_name', label: 'Product name', strict: false },
  { key: 'brand', label: 'Brand name', strict: false },
  { key: 'product_variant', label: 'Product variant', strict: false },
  { key: 'manufacturer', label: 'Manufacturer', strict: false },
  { key: 'imported_manufacturer_detail', label: 'Importer / marketed-by', strict: false },
  { key: 'contact_info', label: 'Address', strict: false },
  { key: 'country_of_origin', label: 'Country of origin', strict: false },
  { key: 'customer_care_details', label: 'Customer care details', strict: false },
  { key: 'net_quantity', label: 'Net quantity', strict: true },
  { key: 'total_weight', label: 'Total weight', strict: true },
  { key: 'mrp', label: 'MRP', strict: true },
  { key: 'batch_no', label: 'Batch / lot number', strict: true },
  { key: 'mfg_date', label: 'Manufacturing date', strict: true },
  { key: 'packing_date', label: 'Packing date', strict: true },
  { key: 'expiry_date', label: 'Expiry / best-before', strict: true },
  { key: 'best_before_date', label: 'Best-before date', strict: true },
  { key: 'ingredients_text', label: 'Ingredients', strict: false },
  { key: 'nutrition_info', label: 'Nutrition information', strict: false },
  { key: 'allergen_info', label: 'Allergen information', strict: false },
  { key: 'required_declarations', label: 'FSSAI / required declarations', strict: false },
  { key: 'certification_details', label: 'Certification / standard marks', strict: false },
  { key: 'warnings', label: 'Warnings', strict: false },
  { key: 'storage_conditions', label: 'Storage conditions', strict: false },
  { key: 'product_claims', label: 'Product claims', strict: false },
]

/* ------------------------------------------------------------------ */
/* Normalization                                                        */
/* ------------------------------------------------------------------ */

/** Common OCR character substitutions, applied only for loose matching. */
const OCR_SUBS: Array<[RegExp, string]> = [
  [/0/g, 'o'], [/1/g, 'l'], [/5/g, 's'], [/8/g, 'b'], [/2/g, 'z'],
]

/** Loose normalization: case, punctuation, spacing, OCR substitutions. */
export function normalizeLoose(s: string): string {
  let t = s.toLowerCase()
  for (const [re, rep] of OCR_SUBS) t = t.replace(re, rep)
  return t
    .replace(/[^\w\u0900-\u097f ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Canonical numeric form: "₹120", "Rs. 120", "120" → "120"; "400 g" → "400g". */
export function canonicalNumeric(s: string): string | null {
  let t = s.toLowerCase().replace(/,/g, '')
  // Strip currency words/symbols.
  t = t.replace(/(rs\.?|inr|₹|\$|€)/g, '')
  // Strip units but keep them: number directly followed/preceded by unit.
  const m = t.match(/-?\d+(?:\.\d+)?/)
  if (!m) return null
  const num = parseFloat(m[0])
  if (!Number.isFinite(num)) return null
  const after = t.slice((m.index ?? 0) + m[0].length)
  const unit = (after.match(/^\s*(g|kg|mg|ml|l|pcs|pc|n|mm|cm|%)/) ?? [])[1] ?? ''
  // Normalize the number (drop trailing zeros) so "400.0" ≡ "400".
  const numStr = String(Math.round(num * 1000) / 1000)
  return `${numStr}${unit}`
}

/** Canonical date form: full dates → YYYYMMDD, month precision → YYYYMM, else null. */
export function canonicalDate(s: string): string | null {
  const t = s.trim()
  let m = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/.exec(t)
  if (m) {
    const [, y, mo, d] = m
    if (Number(mo) >= 1 && Number(mo) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
      return `${y}${mo.padStart(2, '0')}${d.padStart(2, '0')}`
    }
  }
  m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(t)
  if (m) {
    let [, d, mo, y] = m
    if (y.length === 2) y = Number(y) > 49 ? `19${y}` : `20${y}`
    if (Number(mo) >= 1 && Number(mo) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
      return `${y}${mo.padStart(2, '0')}${d.padStart(2, '0')}`
    }
  }
  // Month precision ("05/2026", "May 2026") → YYYYMM.
  m = /^(?:0?[1-9]|1[0-2])[\/\-.](?:19|20)?(\d{2}|\d{4})$/.exec(t)
  if (m) {
    const parts = t.split(/[\/\-.]/)
    const mo = parts[0].padStart(2, '0')
    let y = parts[1]
    if (y.length === 2) y = Number(y) > 49 ? `19${y}` : `20${y}`
    if (y.length !== 4) y = `20${y}`
    return `${y}${mo}`
  }
  m = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s/.\-]*(\d{2,4})$/i.exec(t)
  if (m) {
    const mon = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.exec(t)?.[1].toLowerCase() ?? ''
    const idx: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' }
    let y = m[1]
    if (y.length === 2) y = Number(y) > 49 ? `19${y}` : `20${y}`
    if (idx[mon]) return `${y}${idx[mon]}`
  }
  return null
}

const DATE_KEYS = new Set(['mfg_date', 'packing_date', 'expiry_date', 'best_before_date'])

/** Strict canonical form for numeric/legal fields; null when not parseable. */
export function canonicalStrict(key: string, s: string): string | null {
  if (DATE_KEYS.has(key)) return canonicalDate(s)
  if (key === 'batch_no') return s.toLowerCase().replace(/[\s\-_./]/g, '')
  return canonicalNumeric(s)
}

/** Token Jaccard similarity 0..1. */
function jaccard(a: string, b: string): number {
  const A = new Set(a.split(' ').filter(Boolean))
  const B = new Set(b.split(' ').filter(Boolean))
  if (A.size === 0 && B.size === 0) return 1
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / (A.size + B.size - inter)
}

/** Loose similarity between two raw values (0..1). */
export function looseSimilarity(a: string, b: string): number {
  const na = normalizeLoose(a)
  const nb = normalizeLoose(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  return Math.max(jaccard(na, nb), diceBigrams(na, nb))
}

/** Dice coefficient over character bigrams — catches OCR substitutions
 *  ("FSSAl" vs "FSSAI") that token comparison scores as 0. */
function diceBigrams(a: string, b: string): number {
  const sa = a.replace(/ /g, '')
  const sb = b.replace(/ /g, '')
  if (!sa || !sb) return 0
  if (sa === sb) return 1
  const grams = (s: string): Map<string, number> => {
    const m = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2)
      m.set(g, (m.get(g) ?? 0) + 1)
    }
    return m
  }
  const A = grams(sa)
  const B = grams(sb)
  let inter = 0
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0)
  return (2 * inter) / (sa.length - 1 + (sb.length - 1))
}

/** Group key for non-strict fields: exact normalized match, else fuzzy join
 *  at ≥0.85 similarity (OCR-substitution tolerance). Returns the key of the
 *  first matching group, or null when this vote starts a new group. */
const FUZZY_GROUP_THRESHOLD = 0.85

/* ------------------------------------------------------------------ */
/* Vote collection                                                      */
/* ------------------------------------------------------------------ */

interface FieldVote extends ReportFieldVote {
  image: number | null
  internalConflict: boolean
}

function confToNumber(c: unknown): number | null {
  if (typeof c === 'number' && Number.isFinite(c)) return Math.max(0, Math.min(1, c))
  if (c === 'high') return 0.9
  if (c === 'medium') return 0.7
  if (c === 'low') return 0.4
  return null
}

/**
 * Collect one vote per (report, field): the report's strongest per-photo
 * reading. Flags reports whose own photos disagree (cross-image check).
 */
function collectVotes(
  key: string,
  reports: ReportOutcome[],
): { votes: FieldVote[]; internallyInconsistent: string[] } {
  const votes: FieldVote[] = []
  const inconsistent: string[] = []

  for (const r of reports) {
    if (!r.ok || !r.result) continue
    const readings: Array<{ value: string; conf: number | null; image: number }> = []
    for (const pi of r.result.perImages) {
      const v = pi.fields?.[key]
      const s = v == null ? '' : String(v).trim()
      if (!s) continue
      const ev = pi.field_evidence?.[key]
      const conf = confToNumber(ev?.confidence)
        ?? confToNumber(pi.field_confidence?.[key])
        ?? (typeof pi.confidence === 'number' ? Math.max(0, Math.min(1, pi.confidence)) : null)
      readings.push({ value: s, conf, image: pi.index + 1 })
    }
    if (readings.length === 0) continue
    // Cross-image check inside this report.
    const distinct = new Set(readings.map((x) => normalizeLoose(x.value)))
    if (distinct.size > 1) inconsistent.push(r.name)
    // Strongest reading wins the vote.
    readings.sort((a, b) => (b.conf ?? 0.5) - (a.conf ?? 0.5))
    const best = readings[0]
    votes.push({
      report: r.name,
      provider: r.provider,
      value: best.value,
      normalized: normalizeLoose(best.value),
      confidence: best.conf,
      image: best.image,
      internalConflict: distinct.size > 1,
    })
  }
  return { votes, internallyInconsistent: inconsistent }
}

/* ------------------------------------------------------------------ */
/* Evidence mapping                                                     */
/* ------------------------------------------------------------------ */

interface EvidenceHit {
  text: string | null
  bbox: number[] | null
  image: number | null
}

/** Find a region whose text contains the final value (best-effort mapping). */
function findEvidence(
  finalValue: string | null,
  reports: ReportOutcome[],
): EvidenceHit {
  if (!finalValue || !finalValue.trim()) return { text: null, bbox: null, image: null }
  const needle = normalizeLoose(finalValue).replace(/ /g, '')
  let best: EvidenceHit & { score: number } = { text: '', bbox: null, image: null, score: 0 }
  for (const r of reports) {
    if (!r.ok || !r.result) continue
    for (const pi of r.result.perImages) {
      // 1) field-level evidence with a bbox wins immediately.
      const ev = pi.field_evidence
      if (ev) {
        for (const fv of Object.values(ev)) {
          if (fv?.bbox && fv.text && normalizeLoose(finalValue).includes(normalizeLoose(fv.text).slice(0, 12))) {
            return { text: fv.text, bbox: fv.bbox, image: pi.index + 1 }
          }
        }
      }
      // 2) region substring match.
      for (const reg of pi.regions ?? []) {
        const hay = normalizeLoose(String(reg.text ?? '')).replace(/ /g, '')
        if (!hay) continue
        const probe = needle.length > 24 ? needle.slice(0, 24) : needle
        if (hay.includes(probe) || probe.includes(hay.slice(0, 24))) {
          const score = Math.min(hay.length, probe.length) / Math.max(hay.length, probe.length)
          if (score > best.score) {
            best = { text: String(reg.text), bbox: reg.bbox ?? null, image: pi.index + 1, score }
          }
        }
      }
    }
  }
  return { text: best.text || null, bbox: best.bbox, image: best.image }
}

/* ------------------------------------------------------------------ */
/* Field adjudication                                                   */
/* ------------------------------------------------------------------ */

const clamp01 = (n: number): number => Math.max(0, Math.min(1, Math.round(n * 100) / 100))

function adjudicateField(
  def: AdjudicatedFieldDef,
  votes: FieldVote[],
  internallyInconsistent: string[],
  reports: ReportOutcome[],
  singleSource: boolean,
): AdjudicatedField {
  const base = {
    key: def.key,
    label: def.label,
    votes: votes.map(({ image: _i, internalConflict: _c, ...v }) => v),
    similarity: null as number | null,
    evidence_text: null as string | null,
    evidence_bbox: null as number[] | null,
    evidence_image: null as number | null,
    decimal_conflict: false,
  }

  if (votes.length === 0) {
    return {
      ...base,
      final_value: null,
      status: 'NOT_DETECTED',
      confidence: 0,
      supporting_reports: [],
      conflicting_reports: [],
      verification_method: 'not-detected',
      reasoning: 'No report could read this field from the photo.',
    }
  }

  // Group votes by canonical form. Dates group at MONTH granularity
  // (YYYYMM): day-level OCR wobble must not fake a conflict, and critical
  // prediction (expired or not) is decided month-wise with the
  // end-of-month rule in the compliance engine.
  // Non-strict text fields additionally fuzzy-join at ≥0.85 similarity so a
  // single OCR substitution ("FSSAl" vs "FSSAI") does not fake a conflict.
  const groups = new Map<string, FieldVote[]>()
  for (const v of votes) {
    let canon: string
    if (def.strict && DATE_KEYS.has(def.key)) {
      const c = canonicalStrict(def.key, v.value ?? '')
      canon = c && c.length === 8 ? c.slice(0, 6) : (c ?? `loose:${v.normalized}`)
    } else if (def.strict) {
      canon = canonicalStrict(def.key, v.value ?? '') ?? `loose:${v.normalized}`
    } else {
      canon = v.normalized ?? ''
      if (!groups.has(canon)) {
        for (const [key, members] of groups) {
          if (key.startsWith('loose:')) continue
          const rep = members[0]?.value ?? ''
          if (rep && looseSimilarity(v.value ?? '', rep) >= FUZZY_GROUP_THRESHOLD) {
            canon = key
            break
          }
        }
      }
    }
    const list = groups.get(canon) ?? []
    list.push(v)
    groups.set(canon, list)
  }
  const ranked = [...groups.values()].sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length
    const ca = a.reduce((s, x) => s + (x.confidence ?? 0.5), 0) / a.length
    const cb = b.reduce((s, x) => s + (x.confidence ?? 0.5), 0) / b.length
    return cb - ca
  })

  // Pairwise similarity across distinct values (for the UI).
  let similarity: number | null = null
  if (votes.length >= 2) {
    let best = 0
    for (let i = 0; i < votes.length; i++) {
      for (let j = i + 1; j < votes.length; j++) {
        best = Math.max(best, looseSimilarity(votes[i].value ?? '', votes[j].value ?? ''))
      }
    }
    similarity = clamp01(best)
  }

  // Decimal/scale conflict check on strict numerics (400g vs 40g).
  let decimalConflict = false
  if (def.strict && !DATE_KEYS.has(def.key) && def.key !== 'batch_no' && votes.length >= 2) {
    const nums = votes
      .map((v) => {
        const m = String(v.value).toLowerCase().replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
        return m ? parseFloat(m[0]) : null
      })
      .filter((n): n is number => n !== null && n !== 0)
    for (let i = 0; i < nums.length && !decimalConflict; i++) {
      for (let j = i + 1; j < nums.length; j++) {
        const ratio = Math.max(nums[i], nums[j]) / Math.min(nums[i], nums[j])
        if (Math.abs(ratio - 10) < 0.001) decimalConflict = true
      }
    }
  }

  const top = ranked[0]
  const topAvg = top.reduce((s, x) => s + (x.confidence ?? 0.5), 0) / top.length
  const avgAll = votes.reduce((s, x) => s + (x.confidence ?? 0.5), 0) / votes.length
  const inconsistentPenalty = internallyInconsistent.length > 0 ? 0.1 : 0
  const inconsistentNote = internallyInconsistent.length > 0
    ? ` ${internallyInconsistent.join(', ')} read this field differently across photos.`
    : ''

  const finish = (
    partial: Pick<AdjudicatedField, 'final_value' | 'status' | 'confidence' | 'supporting_reports' | 'conflicting_reports' | 'verification_method' | 'reasoning'>,
  ): AdjudicatedField => {
    const ev = partial.final_value ? findEvidence(partial.final_value, reports) : { text: null, bbox: null, image: null }
    return {
      ...base,
      ...partial,
      similarity,
      decimal_conflict: decimalConflict,
      evidence_text: ev.text,
      evidence_bbox: ev.bbox,
      evidence_image: ev.image,
      confidence: clamp01(partial.confidence),
    }
  }

  const names = (vs: FieldVote[]): string[] => vs.map((v) => v.report)
  const providersOf = (vs: FieldVote[]): string => [...new Set(vs.map((v) => v.provider))].join(' + ')

  // ---- Single group: agreement ----
  if (ranked.length === 1) {
    const best = [...top].sort((a, b) => (b.confidence ?? 0.5) - (a.confidence ?? 0.5))[0]
    if (singleSource || top.length === 1) {
      return finish({
        final_value: best.value,
        status: 'NEEDS_REVIEW',
        confidence: Math.min(topAvg, 0.75) - inconsistentPenalty,
        supporting_reports: names(top),
        conflicting_reports: [],
        verification_method: 'single-source',
        reasoning:
          `Only ${best.report} (${best.provider}) read this field — single-source result, multi-AI verification unavailable.${inconsistentNote}`,
      })
    }
    const agreed = top.length
    const conf = clamp01(Math.min(0.99, avgAll + 0.05 * (agreed - 1)) - inconsistentPenalty)
    if (conf < 0.6) {
      return finish({
        final_value: best.value,
        status: 'LOW_CONFIDENCE',
        confidence: conf,
        supporting_reports: names(top),
        conflicting_reports: [],
        verification_method: `agreement-${agreed}of${votes.length}-low`,
        reasoning:
          `${agreed} of ${votes.length} reports agree but overall confidence is low (${Math.round(conf * 100)}%). Retake the photo for a stronger reading.${inconsistentNote}`,
      })
    }
    return finish({
      final_value: best.value,
      status: 'VERIFIED',
      confidence: conf,
      supporting_reports: names(top),
      conflicting_reports: [],
      verification_method: `agreement-${agreed}of${votes.length}`,
      reasoning:
        `${agreed} of ${votes.length} reports agree (${providersOf(top)}) with supporting image evidence.`,
    })
  }

  // ---- Multiple groups: disagreement ----
  const others = ranked.slice(1).flat()
  const majority = top.length >= 2
  const best = [...top].sort((a, b) => (b.confidence ?? 0.5) - (a.confidence ?? 0.5))[0]
  const dissent = ranked.slice(1).map((g) => `"${g[0].value}" (${names(g).join(', ')})`).join(' vs ')

  if (majority) {
    const conf = clamp01(Math.min(0.9, topAvg * 0.9) - inconsistentPenalty)
    if (def.strict) {
      return finish({
        final_value: best.value,
        status: 'CONFLICT',
        confidence: Math.min(conf, 0.55),
        supporting_reports: names(top),
        conflicting_reports: names(others),
        verification_method: 'majority-strict-conflict',
        reasoning:
          `CONFLICT on a strict field: ${dissent}. Majority (${names(top).join(', ')}) accepted pending manual check.${decimalConflict ? ' Values differ by a factor of 10 — possible decimal error.' : ''}${inconsistentNote}`,
      })
    }
    return finish({
      final_value: best.value,
      status: 'NEEDS_REVIEW',
      confidence: conf,
      supporting_reports: names(top),
      conflicting_reports: names(others),
      verification_method: 'majority',
      reasoning:
        `${top.length} of ${votes.length} reports agree semantically (${providersOf(top)}); minority read ${dissent}. Final value accepted from the majority.${inconsistentNote}`,
    })
  }

  // No majority — highest confidence wins, flagged for review.
  const all = [...votes].sort((a, b) => (b.confidence ?? 0.5) - (a.confidence ?? 0.5))
  const winner = all[0]
  const conf = clamp01(Math.min(0.6, (winner.confidence ?? 0.5)) - inconsistentPenalty)
  return finish({
    final_value: winner.value,
    status: def.strict ? 'CONFLICT' : 'NEEDS_REVIEW',
    confidence: conf,
    supporting_reports: [winner.report],
    conflicting_reports: names(all.slice(1)),
    verification_method: 'highest-confidence',
    reasoning:
      `No majority — reports disagree (${votes.map((v) => `"${v.value}" [${v.report}]`).join(' vs ')}). Highest-confidence reading kept for manual review.${decimalConflict ? ' Values differ by a factor of 10 — possible decimal error.' : ''}${inconsistentNote}`,
  })
}

/* ------------------------------------------------------------------ */
/* Top-level adjudication                                               */
/* ------------------------------------------------------------------ */

function statusToConfidence(s: AdjudicationStatus): OcrConfidence {
  if (s === 'VERIFIED') return 'high'
  if (s === 'NEEDS_REVIEW') return 'medium'
  return 'low'
}

export interface AdjudicationOutcome {
  /** Consensus provider result — feeds the existing merge → compliance path. */
  consensus: OcrProviderResult
  verification: VerificationSummary
}

export function adjudicateReports(reports: ReportOutcome[]): AdjudicationOutcome {
  const okReports = reports.filter((r) => r.ok && r.result)
  const singleSource = okReports.length < 2

  const fields: AdjudicatedField[] = ADJUDICATED_FIELDS.map((def) => {
    const { votes, internallyInconsistent } = collectVotes(def.key, okReports)
    return adjudicateField(def, votes, internallyInconsistent, okReports, singleSource)
  })

  // ---- Counts (all dynamic) ----
  const counts: VerificationCounts = {
    verified: 0, needs_review: 0, conflict: 0, low_confidence: 0,
    not_detected: 0, resolved: 0, disagreements: 0, total: fields.length,
  }
  for (const f of fields) {
    if (f.status === 'VERIFIED') counts.verified++
    else if (f.status === 'NEEDS_REVIEW') counts.needs_review++
    else if (f.status === 'CONFLICT') counts.conflict++
    else if (f.status === 'LOW_CONFIDENCE') counts.low_confidence++
    else counts.not_detected++
    if (f.votes.length >= 2) {
      const distinct = new Set(f.votes.map((v) => {
        const def = ADJUDICATED_FIELDS.find((d) => d.key === f.key)!
        return def.strict
          ? (canonicalStrict(f.key, v.value ?? '') ?? `loose:${v.normalized}`)
          : (v.normalized ?? '')
      }))
      if (distinct.size > 1) {
        counts.disagreements++
        if (f.supporting_reports.length >= 2) counts.resolved++
      }
    }
  }

  // ---- Evidence-based trust score (0..100) ----
  // Genuine means coverage counts too: a report that read half the label
  // must not score 95. Missing fields weigh half in the denominator —
  // absence of evidence is not evidence of compliance.
  const WEIGHT: Record<AdjudicationStatus, number> = {
    VERIFIED: 1, NEEDS_REVIEW: 0.45, CONFLICT: 0.2, LOW_CONFIDENCE: 0.35, NOT_DETECTED: 0,
  }
  const assessable = fields.filter((f) => f.status !== 'NOT_DETECTED')
  const missing = fields.length - assessable.length
  const denom = assessable.length + 0.5 * missing
  let trust = denom === 0
    ? 0
    : Math.round((100 * assessable.reduce((s, f) => s + WEIGHT[f.status] * (0.5 + 0.5 * f.confidence), 0)) / denom)
  if (singleSource && okReports.length === 1) trust = Math.min(trust, 60)
  if (okReports.length === 0) trust = 0

  const verification: VerificationSummary = {
    single_source: singleSource,
    single_source_note: singleSource
      ? (okReports.length === 1
        ? `SINGLE-SOURCE RESULT — only ${okReports[0].name} (${okReports[0].provider}) succeeded. Multi-AI verification unavailable.`
        : 'No report succeeded.')
      : null,
    trust_score: trust,
    reports: reports.map((r): VerificationReportInfo => ({
      name: r.name,
      provider: r.provider,
      ok: r.ok,
      engines: r.result?.engines ?? [],
      confidence: r.result && r.result.perImages.length > 0
        ? Math.round((r.result.perImages.reduce((s, p) => s + (p.confidence ?? 0), 0) / r.result.perImages.length) * 100) / 100
        : null,
      error: r.error,
    })),
    fields,
    counts,
    adjudicated_at: new Date().toISOString(),
  }

  // ---- Consensus PerImageExtract (existing pipeline shape) ----
  const photoCount = Math.max(1, ...okReports.map((r) => r.result?.perImages.length ?? 1))
  const finals: Record<string, string | null> = {}
  const finalConf: Record<string, OcrConfidence> = {}
  const finalEv: Record<string, { text: string; confidence?: number | null; bbox?: number[] | null }> = {}
  for (const f of fields) {
    if (f.final_value) {
      finals[f.key] = f.final_value
      finalConf[f.key] = statusToConfidence(f.status)
      finalEv[f.key] = {
        text: f.evidence_text ?? f.final_value,
        confidence: f.confidence,
        bbox: f.evidence_bbox,
      }
    } else {
      finals[f.key] = null
    }
  }
  const combinedText = okReports
    .map((r) => (r.result?.perImages ?? []).map((p) => p.text).filter(Boolean).join('\n'))
    .filter(Boolean)
    .join('\n\n')
  const combinedRegions: PerImageExtract['regions'] = []
  const unclear: string[] = []
  okReports.forEach((r) => {
    for (const pi of r.result?.perImages ?? []) {
      for (const reg of pi.regions ?? []) {
        combinedRegions.push({ text: String(reg.text ?? ''), bbox: reg.bbox ?? null, conf: reg.conf ?? null })
      }
    }
    for (const u of r.result?.unclear ?? []) unclear.push(String(u))
  })
  for (const f of fields) {
    if ((f.status === 'CONFLICT' || f.status === 'LOW_CONFIDENCE') && f.final_value) {
      unclear.push(`${f.label}: ${f.final_value}`)
    }
  }

  const perImages: PerImageExtract[] = []
  for (let i = 0; i < photoCount; i++) {
    perImages.push({
      index: i,
      text: okReports.map((r) => r.result?.perImages[i]?.text).filter(Boolean).join('\n') || `Photo ${i + 1}`,
      language: okReports[0]?.result?.perImages[i]?.language ?? 'en',
      confidence: clamp01(assessable.length === 0 ? 0 : assessable.reduce((s, f) => s + f.confidence, 0) / assessable.length),
      fields: i === 0 ? finals : {},
      field_confidence: i === 0 ? finalConf : {},
      field_evidence: i === 0 ? finalEv : {},
      regions: combinedRegions,
    })
  }

  const provider = okReports.map((r) => r.result?.provider ?? r.provider).join('+') || 'none'
  const consensus: OcrProviderResult = {
    provider,
    demo: false,
    perImages,
    engines: [...new Set(okReports.flatMap((r) => r.result?.engines ?? [r.provider]))],
    unclear: [...new Set(unclear)].slice(0, 50),
  }

  return { consensus, verification }
}
