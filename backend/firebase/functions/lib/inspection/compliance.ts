/**
 * Deterministic MISA-style compliance engine for Indian product labels.
 *
 * Verdict tiers follow Misa: ≥90 compliant, ≥75 needs_review, ≥50 violation,
 * below critical. ANY failed check floors the verdict at violation (or
 * critical when a *critical* check failed, e.g. an expired product).
 *
 * Rules carry a category set:
 *   * cat 'edible' or 'both' → runs for edible inspections,
 *   * cat 'non_edible' or 'both' → runs for non-edible inspections,
 *   * unknown category runs the full set (review-flagged like Misa).
 *
 * A check returns a status + finding — never a legal verdict, only what the
 * recognized text supports. Everything here is deterministic (no AI).
 */

import type {
  ComplianceResult,
  Finding,
  FindingStatus,
  InspectionCategory,
  InspectionStatus,
  MergedFields,
} from './types.js'
import { primaryText, normalizeField } from './merge.js'

type RuleRuns = 'edible' | 'non_edible' | 'both'

interface Rule {
  rule_id: string
  label: string
  field: string
  runs: RuleRuns
  requirement: string
  hint?: string
  /** Returns { status, detected, note } given merged context. */
  check: (ctx: RuleContext) => RuleOutcome
}

interface RuleContext {
  fields: Record<string, string>
  text: string
  category: InspectionCategory
  productName?: string
}

interface RuleOutcome {
  status: FindingStatus
  detected: string | null
  note?: string
}

const categoryRuns = (runs: RuleRuns, category: InspectionCategory): boolean => {
  if (category === 'edible') return runs === 'edible' || runs === 'both'
  if (category === 'non_edible') return runs === 'non_edible' || runs === 'both'
  return true
}

const ok = (detected?: string | null, note?: string): RuleOutcome => ({ status: 'compliant', detected: detected ?? null, note })
const review = (detected?: string | null, note?: string): RuleOutcome => ({ status: 'needs_review', detected: detected ?? null, note })
const fail = (detected?: string | null, note?: string): RuleOutcome => ({ status: 'failed', detected: detected ?? null, note })
const crit = (detected?: string | null, note?: string): RuleOutcome => ({ status: 'critical_failed', detected: detected ?? null, note })
const na = (note?: string): RuleOutcome => ({ status: 'na', detected: null, note })

function findInText(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(text)
    if (m && m[0]) return m[0]
  }
  return null
}

const ALLERGEN_KEYWORDS = [
  /(?:^|[^\w])milk\b/, /(?:^|[^\w])dairy\b/, /(?:^|[^\w])cream\b/, /(?:^|[^\w])butter\b/,
  /(?:^|[^\w])egg[s]?\b/, /(?:^|[^\w])peanut[s]?\b/, /(?:^|[^\w])nut[s]?\b/,
  /(?:^|[^\w])soy[a]?\b/, /(?:^|[^\w])soya\b/, /(?:^|[^\w])wheat\b/, /(?:^|[^\w])gluten\b/,
  /(?:^|[^\w])fish\b/, /(?:^|[^\w])shellfish\b/, /(?:^|[^\w])sesame\b/, /(?:^|[^\w])sulphites?\b/,
]

const EXPIRY_PATTERNS = [
  /(?:exp|expiry|exp\.|use by|best before|best-before|bb)[.: ]*([0-9]{1,2}[\/\-.]{1}[0-9]{1,2}[\/\-.]{1}[0-9]{2,4}|[0-9]{4}-[0-9]{1,2}-[0-9]{1,2})/i,
  /([0-9]{1,2}[\/\-.]{1}[0-9]{1,2}[\/\-.]{1}[0-9]{2,4})/,
]

function parseDateValue(value: string | null | undefined): Date | null {
  const normalized = value ? normalizeField('mfg_date', value) : null
  if (!normalized) return null
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized)
  if (!parts) return null
  const d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

const today = (): Date => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

function dateStatus(raw: string | null | undefined, isExpiry: boolean): RuleOutcome {
  const parsed = parseDateValue(raw)
  if (!parsed) {
    if (!raw) return review(null, 'No date could be read — verify on the physical label.')
    return review(raw, `Could not recognise "${raw}" as a date — verify manually.`)
  }
  // Month-precision expiry ("05/2026", "May 2026") is valid through the END
  // of that month — never flag it critical on day 1. MFG keeps day 1
  // (conservative for future-date checks).
  const effective = isExpiry && raw && isMonthPrecision(raw) ? endOfMonth(parsed) : parsed
  const td = today().getTime()
  if (isExpiry) {
    return effective.getTime() > td
      ? ok(raw, 'The expiry/best-before date is in the future.')
      : crit(raw, `The expiry/best-before date (${fmtLocal(effective)}) is in the past or today — the product may be expired.`)
  }
  return effective.getTime() <= td
    ? ok(raw, 'The manufacturing date is not in the future.')
    : fail(raw, `The manufacturing date (${fmtLocal(effective)}) is in the future — suspicious read, verify on the label.`)
}

/** True when the raw text carries only month precision (no day digits). */
function isMonthPrecision(raw: string): boolean {
  const t = raw.trim()
  if (/^(?:0?[1-9]|1[0-2])[\/\-.](?:19|20)?\d{2}$/.test(t)) return true
  if (/^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s/.\-]*(\d{2,4})$/i.test(t)) return true
  return false
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

/** Local YYYY-MM-DD (toISOString is UTC and shifts IST dates back a day). */
function fmtLocal(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Add whole months to a date, clamping to the target month's last day. */
function addMonthsClamped(d: Date, months: number): Date {
  const day = d.getDate()
  const last = new Date(d.getFullYear(), d.getMonth() + months + 1, 0).getDate()
  return new Date(d.getFullYear(), d.getMonth() + months, Math.min(day, last))
}

/**
 * Relative shelf life ("Best before 6 months from manufacture/packaging",
 * "Use within 12 months") → months, else null.
 */
function relativeShelfMonths(text: string): number | null {
  const m = /best\s*(?:before|within|use\s*within|before\s*the\s*end\s*of)\s*(\d{1,3})\s*(day|month|year)/i.exec(text)
  if (!m) return null
  const n = Number(m[1])
  const unit = m[2].toLowerCase()
  if (!Number.isFinite(n) || n <= 0) return null
  if (unit.startsWith('day')) return n / 30.44
  if (unit.startsWith('year')) return n * 12
  return n
}

const RULES: Rule[] = [
  {
    rule_id: 'rule_identification',
    label: 'Product identification',
    field: 'commodity_name',
    runs: 'both',
    requirement: 'The label must clearly identify the product (generic/commodity name or product title).',
    hint: 'Type the product name to help identification.',
    check: (ctx) => {
      const v = ctx.fields.commodity_name ?? ctx.productName ?? ''
      return primaryText(v) ? ok(v, 'Product identified from the label.') : review(null, 'Product name could not be read — verify on the label or type it manually.')
    },
  },
  {
    rule_id: 'rule_manufacturer',
    label: 'Manufacturer / packer / importer',
    field: 'manufacturer',
    runs: 'both',
    requirement: 'Name and complete address of the manufacturer, packer or importer must appear (Legal Metrology Packaged Commodities Rules, Rule 6).',
    hint: 'Type the manufacturer name if it is hard to read.',
    check: (ctx) => {
      const v = ctx.fields.manufacturer ?? ctx.fields.contact_info ?? ''
      return primaryText(v) ? ok(v, 'Manufacturer/packer/importer detail detected.') : review(null, 'Manufacturer detail could not be read — verify on the label.')
    },
  },
  {
    rule_id: 'rule_net_quantity',
    label: 'Net quantity',
    field: 'net_quantity',
    runs: 'both',
    requirement: 'Net quantity must be declared in standard units (Rule 6, Rule 11).',
    check: (ctx) => {
      const v = ctx.fields.net_quantity
      if (!v) return review(null, 'Net quantity could not be read — verify on the label.')
      return /(\d+(?:\.\d+)?)\s*(g|kg|ml|l|mg)\b/i.test(v)
        ? ok(v, 'Net quantity declared in standard units.')
        : review(v, 'Quantity value detected but no standard unit — verify on the label.')
    },
  },
  {
    rule_id: 'rule_mrp',
    label: 'MRP (max retail price)',
    field: 'mrp',
    runs: 'both',
    requirement: 'Maximum retail price inclusive of all taxes must be declared (Rule 6).',
    check: (ctx) => {
      const v = ctx.fields.mrp
      if (!v) return fail(null, 'MRP not declared on the label.')
      return /(\d+(?:\.\d+)?)/.test(v) ? ok(v, 'MRP declared.') : review(v, 'MRP-like value detected but not numeric — verify on the label.')
    },
  },
  {
    rule_id: 'rule_batch',
    label: 'Batch / lot number',
    field: 'batch_no',
    runs: 'both',
    requirement: 'Batch or lot number is expected for traceability.',
    check: (ctx) => {
      const v = ctx.fields.batch_no ?? findInText(ctx.text, [/(?:batch|l(?:ot)?\.?\s*no\.?|lot)[.: ]*([A-Z0-9]{2,12})/i, /\b(?:Batch|Lot)\s*[Nn]?[Oo]?[:.]?\s*[A-Z0-9\-]{2,}\b/])
      return v ? ok(v, 'Batch/lot number detected.') : review(null, 'Batch/lot number could not be read — verify on the label.')
    },
  },
  {
    rule_id: 'rule_mfg_date',
    label: 'Manufacturing date',
    field: 'mfg_date',
    runs: 'both',
    requirement: 'Month and year of manufacture, packing or import must be shown (Rule 6).',
    check: (ctx) => dateStatus(ctx.fields.mfg_date, false),
  },
  {
    rule_id: 'rule_expiry',
    label: 'Expiry / best-before date',
    field: 'expiry_date',
    runs: 'both',
    requirement: 'Best-before / use-by / expiry date must be declared for packaged commodities (Rule 6).',
    check: (ctx) => {
      const raw = ctx.fields.expiry_date ?? ctx.fields.best_before_date
      if (raw) return dateStatus(raw, true)
      const hit = findInText(ctx.text, EXPIRY_PATTERNS)
      if (hit) return dateStatus(hit, true)
      // Relative shelf life: "Best before 6 months from manufacture" +
      // a known MFG/packing date → compute the effective expiry. This
      // catches expired products whose label states no absolute date.
      const shelfMonths = relativeShelfMonths(`${ctx.fields.best_before_date ?? ''}\n${ctx.text}`)
      const mfgRaw = ctx.fields.mfg_date
      const mfg = mfgRaw ? parseDateValue(mfgRaw) : null
      if (shelfMonths !== null && mfg) {
        const computed = addMonthsClamped(mfg, Math.round(shelfMonths))
        const iso = `${computed.getFullYear()}-${String(computed.getMonth() + 1).padStart(2, '0')}-${String(computed.getDate()).padStart(2, '0')}`
        const outcome = dateStatus(iso, true)
        if (outcome.status === 'critical_failed') {
          return crit(
            `${mfgRaw} + ${Math.round(shelfMonths)} months`,
            `Best-before period computed from manufacture date ended ${iso} — the product may be expired.`,
          )
        }
        return ok(
          `${mfgRaw} + ${Math.round(shelfMonths)} months`,
          `Best-before period computed from manufacture date runs to ${iso}.`,
        )
      }
      return review(null, 'Expiry/best-before date could not be read — verify on the label.')
    },
  },
  {
    rule_id: 'rule_ingredients',
    label: 'Ingredients',
    field: 'ingredients_text',
    runs: 'edible',
    requirement: 'A list of ingredients is mandatory on food labels (FSSAI Labelling Regulations).',
    check: (ctx) => {
      const v = ctx.fields.ingredients_text
      if (v) return ok(v, 'Ingredients list detected.')
      const hit = findInText(ctx.text, [/\bingredients\s*[:.]/i])
      return hit ? ok(hit, 'Ingredient list marker detected.') : review(null, 'Ingredient list could not be read — verify on the label.')
    },
  },
  {
    rule_id: 'rule_allergen',
    label: 'Allergen information',
    field: 'allergen_info',
    runs: 'edible',
    requirement: 'When a declared ingredient is a known allergen, the allergen must be highlighted (Contains …).',
    check: (ctx) => {
      const declared = ctx.fields.allergen_info
      if (declared) return ok(declared, 'Allergen declaration detected.')
      const ingredientText = ctx.fields.ingredients_text ?? ctx.text
      const allergens = ALLERGEN_KEYWORDS.filter((re) => re.test(ingredientText.toLowerCase()))
      if (allergens.length === 0) return na('No common allergen keywords in the declared ingredients.')
      return fail(null, `Ingredients contain possible allergen(s): ${allergens.map((r) => r.source).join(', ')} — but no "Contains" declaration was read.`)
    },
  },
  {
    rule_id: 'rule_required_declarations',
    label: 'Required declarations',
    field: 'required_declarations',
    runs: 'edible',
    requirement: 'Food labels must carry the FSSAI licence number / "FSSAI REG. NO." and other mandatory declarations.',
    check: (ctx) => {
      const v = ctx.fields.required_declarations
      if (v) return ok(v, 'Mandatory declarations detected.')
      const hit = findInText(ctx.text, [/\bFSSAI\b[^\n]{0,60}/i, /\bLic\.?\s*[Nn]?[Oo]?\.?\s*\d{4,}/i, /\bReg\.?\s*[Nn]?[Oo]?\.?\s*\d{4,}/i])
      return hit ? ok(hit, 'Declaration marker detected.') : review(null, 'FSSAI reg. no. or mandatory declarations could not be read — verify on the label.')
    },
  },
  {
    rule_id: 'rule_warnings',
    label: 'Safety warnings',
    field: 'warnings',
    runs: 'non_edible',
    requirement: 'Safety instructions / usage warnings must be present where the product demands them (e.g. cleaning, electrical).',
    check: (ctx) => {
      const v = ctx.fields.warnings
      if (v) return ok(v, 'Warning/instruction text detected.')
      const hit = findInText(ctx.text, [/\b(?:warn(?:ing)?|caution|hazard|do not use|flammable|keep out of reach|danger)\b/i])
      return hit ? ok(hit, 'Warning marker detected.') : review(null, 'No warning text detected — verify on the label.')
    },
  },
  {
    rule_id: 'rule_label_info',
    label: 'Product / label information',
    field: 'required_declarations',
    runs: 'non_edible',
    requirement: 'The label must state what the product is and how to use it (product information / usage notes).',
    check: (ctx) => {
      const v = ctx.fields.required_declarations ?? ctx.fields.ingredients_text
      if (v) return ok(v, 'Product information text detected.')
      return ctx.text.length > 40 ? ok(null, 'Label text is present.') : review(null, 'Very little label text could be read — verify on the label.')
    },
  },
  {
    rule_id: 'rule_certification',
    label: 'Certification / standard marking',
    field: 'certification_details',
    runs: 'non_edible',
    requirement: 'Relevant certification/standard marks (ISI, IS number, BIS, AGMARK, etc.) must be present where required.',
    check: (ctx) => {
      const v = ctx.fields.certification_details
      if (v) return ok(v, 'Certification/standard mark detected.')
      const hit = findInText(ctx.text, [/\b(?:ISI|BIS|AGMARK|IS\s*\d{3,}|CE)\b/i])
      return hit ? ok(hit, 'Standard mark detected.') : review(null, 'No certification/standard mark detected — verify on the label (may not be required).')
    },
  },
]

export function runCompliance(
  merged: MergedFields,
  category: InspectionCategory,
  extra?: { productName?: string },
): ComplianceResult {
  const ctx: RuleContext = {
    fields: merged.fields,
    text: merged.text,
    category,
    productName: extra?.productName,
  }

  const findings: Finding[] = []
  for (const rule of RULES) {
    if (!categoryRuns(rule.runs, category)) continue
    const outcome = rule.check(ctx)
    findings.push({
      rule_id: rule.rule_id,
      category: rule.runs === 'both' ? null : rule.runs,
      field: rule.field,
      label: rule.label,
      requirement: rule.requirement,
      status: outcome.status,
      detected_value: outcome.detected,
      explanation: outcome.note ?? null,
      hint: rule.hint ?? null,
    })
  }

  const counts = {
    passed: findings.filter((f) => f.status === 'compliant').length,
    review: findings.filter((f) => f.status === 'needs_review').length,
    failed: findings.filter((f) => f.status === 'failed').length,
    criticalFailed: findings.filter((f) => f.status === 'critical_failed').length,
    na: findings.filter((f) => f.status === 'na').length,
  }

  const total = Math.max(1, findings.length)
  const hardFails = counts.failed + counts.criticalFailed
  const rawScore = (100 * (counts.passed + 0.7 * counts.review)) / total - 15 * hardFails
  const overall_score = Math.max(0, Math.round(rawScore))

  let status: InspectionStatus
  if (counts.criticalFailed > 0) status = 'critical'
  else if (counts.failed > 0) status = overall_score >= 50 ? 'violation' : 'critical'
  else if (overall_score >= 90) status = 'compliant'
  else if (overall_score >= 75) status = 'needs_review'
  else if (overall_score >= 50) status = 'violation'
  else status = 'critical'

  const verdict = status === 'compliant' ? 'COMPLIANT' : status === 'critical' ? 'NON_COMPLIANT' : 'PARTIALLY_COMPLIANT'
  const risk = status === 'compliant' ? 'Low' : status === 'needs_review' ? 'Medium' : status === 'violation' ? 'High' : 'Critical'

  const missing = findings.filter((f) => f.status === 'needs_review' || f.status === 'failed' || f.status === 'critical_failed')
  const summaryParts = [`${overall_score}/100 — ${status} (risk ${risk}).`, `${counts.passed} passed, ${hardFails} failed, ${counts.review} need review.`]
  if (missing.length > 0) {
    const names = [...new Set(missing.map((m) => m.label))].slice(0, 4).join(', ')
    summaryParts.push(`Needs attention: ${names}${missing.length > 4 ? ' and more.' : '.'}`)
  }

  return {
    overall_score,
    status,
    verdict,
    risk,
    summary: summaryParts.join(' '),
    findings,
    counts,
  }
}

export function tierFromStatus(status: InspectionStatus): string {
  return status
}