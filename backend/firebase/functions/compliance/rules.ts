/**
 * Versioned rule registry — The Legal Metrology (Packaged Commodities)
 * Rules, 2011. Rules 3-31 with applicability predicates and deterministic
 * evaluation. The engine (engine.ts) decides, per package context, which of
 * these rules actually apply to the scanned package.
 */
import {
  STANDARD_PACKAGE_SIZES, VAGUE_QUANTITY_WORDS,
} from './data.js'
import { detectContext, type PackageContext } from './context.js'
import {
  validateMRP, validateQuantity, validateUnitAgainstSoldBy, validateDate, validateContact,
  validateFssai, validateVegNonVeg, validateAddressCompleteness, validateCounted, validateSheets,
  detectUnit,
} from './validators.js'
import type { EngineInputs, Extractions, RuleCheck, RuleEvidence, RuleStatus, VerificationType } from './types.js'

export interface EvaluatedRule {
  id: string
  number: string
  title: string
  scope: string
  verification_type: VerificationType
  weight: number
  applies: (ctx: PackageContext, d: EngineInputs) => boolean
  evaluate: (ctx: PackageContext, d: EngineInputs) => RuleCheck[]
}

export { detectContext }
export type { PackageContext }

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function rc(
  ruleId: string,
  requirement: string,
  status: RuleStatus,
  opts: { detected_value?: string | null; reason: string; evidence?: RuleEvidence; verification_type?: VerificationType; weight: number },
): RuleCheck {
  return {
    rule_id: ruleId,
    requirement,
    status,
    detected_value: opts.detected_value ?? null,
    reason: opts.reason,
    evidence: opts.evidence ?? { source_image: null, ocr_text: null },
    verification_type: opts.verification_type ?? 'IMAGE_VERIFIABLE',
    weight: opts.weight,
  }
}

function ev(d: EngineInputs, key: keyof Extractions): RuleEvidence {
  return {
    source_image: d.fields[key as string]?.source_image ?? null,
    ocr_text: d.ocrText ? d.ocrText.slice(0, 280) : null,
  }
}

/** Printed-but-illegible → NOT_VERIFIABLE, per Rule 9 honesty rules. */
function uncertainCheck(d: EngineInputs, key: string, ruleId: string, requirement: string, weight: number): RuleCheck | null {
  if (d.uncertain.includes(key)) {
    return rc(ruleId, requirement, 'NOT_VERIFIABLE', {
      reason: 'This value is printed but could not be read confidently from the image. A human inspector must verify it on the physical label.',
      evidence: ev(d, key as keyof Extractions),
      verification_type: 'NOT_VERIFIABLE',
      weight,
    })
  }
  return null
}

const applyReason = (ctx: PackageContext, detail: string): string =>
  `Not applicable for this scan — ${detail} (context: ${ctx.reason.split(';')[0]}).`

/* ------------------------------------------------------------------ */
/* Rule 6 — the core declaration checks (single entry, many outputs).   */
/* ------------------------------------------------------------------ */
function runRule6(ctx: PackageContext, d: EngineInputs): RuleCheck[] {
  const ex = d.ex
  const out: RuleCheck[] = []

  /* 6(1)(a) Name & complete address of manufacturer/packer/importer */
  const supplier = ex.manufacturer || ex.packer || ex.importer
  const supplierValue = ([ex.manufacturer, ex.packer, ex.importer].filter(Boolean) as string[]).join(' · ')
  const ucA = uncertainCheck(d, 'manufacturer', 'Rule 6(1)(a)', 'Name & complete address of manufacturer/packer/importer', 2)
  if (ucA) out.push(ucA)
  else if (supplier) {
    const addr = validateAddressCompleteness(ex.address)
    out.push(
      rc('Rule 6(1)(a)', 'Name & complete address of manufacturer/packer/importer',
        addr.ok ? 'PASS' : 'WARNING',
        {
          detected_value: supplierValue,
          reason: addr.ok
            ? `Business name "${supplierValue}" with complete postal address detected.`
            : `Business name "${supplierValue}" detected but address completeness could not be confirmed (${addr.reason}).`,
          evidence: ev(d, 'address'),
          weight: 2,
        }),
    )
  } else {
    out.push(rc('Rule 6(1)(a)', 'Name & complete address of manufacturer/packer/importer', 'FAIL',
      { reason: 'No manufacturer/packer/importer name detected on the label.', evidence: ev(d, 'manufacturer'), weight: 2 }))
  }

  /* 6(1)(b) Common/generic name */
  const ucB = uncertainCheck(d, 'commodity_name', 'Rule 6(1)(b)', 'Common/generic name of commodity', 1)
  if (ucB) out.push(ucB)
  else if (ex.commodity_name) {
    out.push(rc('Rule 6(1)(b)', 'Common/generic name of commodity', 'PASS',
      { detected_value: ex.commodity_name, reason: 'Common/generic name of the commodity is declared.', evidence: ev(d, 'commodity_name'), weight: 1 }))
  } else {
    out.push(rc('Rule 6(1)(b)', 'Common/generic name of commodity', 'FAIL',
      { reason: 'No common/generic name of the commodity detected.', evidence: ev(d, 'commodity_name'), weight: 1 }))
  }

  /* 6(1)(c) Net quantity — Rules 11/12/13 validate format+unit (see separate rules too). */
  const ucC = uncertainCheck(d, 'net_quantity', 'Rule 6(1)(c)', 'Net quantity in standard units', 2)
  if (ucC) out.push(ucC)
  else if (ex.net_quantity) {
    const vq = validateQuantity(ex.net_quantity)
    out.push(rc('Rule 6(1)(c)', 'Net quantity in standard units',
      vq.ok ? 'PASS' : 'WARNING',
      {
        detected_value: vq.normalized ?? ex.net_quantity,
        reason: vq.ok ? `Net quantity "${vq.normalized}" declared in a standard unit.` : vq.reason,
        evidence: ev(d, 'net_quantity'),
        weight: 2,
      }))
  } else {
    out.push(rc('Rule 6(1)(c)', 'Net quantity in standard units', 'FAIL',
      { reason: 'No net quantity declared.', evidence: ev(d, 'net_quantity'), weight: 2 }))
  }

  /* 6(1)(d) Month & year of manufacture/packing/import (or best-before substitution) */
  const ucD = uncertainCheck(d, 'mfg_date', 'Rule 6(1)(d)', 'Month & year of manufacture/packing/import', 1)
  if (ucD) out.push(ucD)
  else if (ex.mfg_date) {
    const vd = validateDate(ex.mfg_date)
    out.push(rc('Rule 6(1)(d)', 'Month & year of manufacture/packing/import', vd.ok ? 'PASS' : 'WARNING',
      { detected_value: ex.mfg_date, reason: vd.ok ? 'Month & year of manufacture detected.' : vd.reason, evidence: ev(d, 'mfg_date'), weight: 1 }))
  } else if (ex.best_before) {
    out.push(rc('Rule 6(1)(d)', 'Month & year of manufacture/packing/import', 'WARNING',
      { detected_value: ex.best_before, reason: 'No month & year of manufacture printed, but a best-before line exists — verify applicable substitution (food categories).', evidence: ev(d, 'best_before'), weight: 1 }))
  } else {
    out.push(rc('Rule 6(1)(d)', 'Month & year of manufacture/packing/import', 'FAIL',
      { reason: 'No month & year of manufacture/packing/import and no best-before line detected.', evidence: ev(d, 'mfg_date'), weight: 1 }))
  }

  /* 6(1)(e) MRP incl. all taxes — never invented, multiple values flagged. */
  const ucE = uncertainCheck(d, 'mrp', 'Rule 6(1)(e)', 'MRP (maximum retail price incl. all taxes)', 2)
  if (ucE) out.push(ucE)
  else if (ex.mrp) {
    const vm = validateMRP(ex.mrp)
    out.push(rc('Rule 6(1)(e)', 'MRP (maximum retail price incl. all taxes)',
      vm.ok ? 'PASS' : 'WARNING',
      { detected_value: ex.mrp, reason: vm.ok ? 'MRP declared with symbol and "incl. of all taxes".' : vm.reason, evidence: ev(d, 'mrp'), weight: 2 }))
  } else {
    out.push(rc('Rule 6(1)(e)', 'MRP (maximum retail price incl. all taxes)', 'FAIL',
      { reason: 'No MRP (maximum retail price inclusive of all taxes) detected.', evidence: ev(d, 'mrp'), weight: 2 }))
  }

  /* 6(1)(f) Consumer care contact */
  const ucF = uncertainCheck(d, 'consumer_care', 'Rule 6(1)(f)', 'Consumer-care contact', 1)
  if (ucF) out.push(ucF)
  else if (ex.consumer_care) {
    const vc = validateContact(ex.consumer_care)
    out.push(rc('Rule 6(1)(f)', 'Consumer-care contact', vc.ok ? 'PASS' : 'WARNING',
      { detected_value: ex.consumer_care, reason: vc.ok ? 'Consumer-care phone/email/web detected.' : vc.reason, evidence: ev(d, 'consumer_care'), weight: 1 }))
  } else {
    out.push(rc('Rule 6(1)(f)', 'Consumer-care contact', 'FAIL',
      { reason: 'No consumer-care contact (phone/email/web) detected.', evidence: ev(d, 'consumer_care'), weight: 1 }))
  }

  /* 6(1)(g) Best before / use-by — food & perishable only (conditional). */
  const ucG = uncertainCheck(d, 'best_before', 'Rule 6(1)(g)', 'Best-before / use-by / expiry', 1)
  if (ucG) out.push(ucG)
  else if (ex.best_before) {
    const vb = validateDate(ex.best_before)
    out.push(rc('Rule 6(1)(g)', 'Best-before / use-by / expiry', vb.ok ? 'PASS' : 'WARNING',
      { detected_value: ex.best_before, reason: vb.ok ? 'Best-before/use-by line detected.' : vb.reason, evidence: ev(d, 'best_before'), weight: 1 }))
  } else if (ctx.is_food) {
    out.push(rc('Rule 6(1)(g)', 'Best-before / use-by / expiry', 'WARNING',
      { reason: 'Food commodity — a best-before/use-by line is normally expected but none was detected.', evidence: ev(d, 'best_before'), weight: 1 }))
  } else {
    out.push(rc('Rule 6(1)(g)', 'Best-before / use-by / expiry', 'NOT_APPLICABLE',
      { reason: applyReason(ctx, 'non-perishable/non-food commodities are not always required to print a best-before line'), weight: 1 }))
  }

  /* 6(1)(h) Unit sale price (USP) — only when required (small/price-linked packages). */
  if (ex.unit_sale_price) {
    out.push(rc('Rule 6(1)(h)', 'Unit sale price (USP)', 'PASS',
      { detected_value: ex.unit_sale_price, reason: 'Unit sale price declared.', evidence: ev(d, 'unit_sale_price'), weight: 1 }))
  } else if (!ex.net_quantity) {
    out.push(rc('Rule 6(1)(h)', 'Unit sale price (USP)', 'NOT_VERIFIABLE',
      { reason: 'USP applies to specified retail packages — net quantity was not readable so applicability cannot be confirmed.', evidence: ev(d, 'unit_sale_price'), verification_type: 'NOT_VERIFIABLE', weight: 1 }))
  } else {
    out.push(rc('Rule 6(1)(h)', 'Unit sale price (USP)', 'NOT_VERIFIABLE',
      { reason: 'USP is required only for the retail package sizes/exemptions covered by the rules — could not confirm applicability from the image.', evidence: ev(d, 'unit_sale_price'), verification_type: 'NOT_VERIFIABLE', weight: 1 }))
  }

  /* 6(1)(i) Country of origin + importer details — imported packages only. */
  if (ctx.origin === 'imported') {
    if (ex.country_of_origin && ex.importer) {
      out.push(rc('Rule 6(1)(i)', 'Country of origin & importer details', 'PASS',
        { detected_value: `${ex.importer} · ${ex.country_of_origin}`, reason: 'Country of origin and importer details declared on imported package.', evidence: ev(d, 'country_of_origin'), weight: 1 }))
    } else if (ex.country_of_origin) {
      out.push(rc('Rule 6(1)(i)', 'Country of origin & importer details', 'WARNING',
        { detected_value: ex.country_of_origin, reason: 'Country of origin found but importer/marketed-by details not detected.', evidence: ev(d, 'country_of_origin'), weight: 1 }))
    } else {
      out.push(rc('Rule 6(1)(i)', 'Country of origin & importer details', 'WARNING',
        { detected_value: ex.importer, reason: 'Importer/marketed-by found but country of origin not detected.', evidence: ev(d, 'importer'), weight: 1 }))
    }
  } else {
    out.push(rc('Rule 6(1)(i)', 'Country of origin & importer details', 'NOT_APPLICABLE',
      { reason: applyReason(ctx, 'no import indicators detected (domestic package)'), weight: 1 }))
  }

  /* 6(2) Declarations in Hindi OR English (Rule 6(2)). Extra languages optional. */
  const LANG_CODES: Record<string, string> = {
    eng: 'en', english: 'en', enUs: 'en',
    hin: 'hi', hindi: 'hi',
    tam: 'ta', tel: 'te', ben: 'bn', mar: 'mr', guj: 'gu', pan: 'pa', mal: 'ml', kan: 'kn',
  }
  const meaningful = d.languages
    .map((l) => LANG_CODES[l.toLowerCase()] ?? l.toLowerCase().split(/[-_]/)[0])
    .filter((l) => l && l !== 'und' && l !== 'unknown')
  const uniqueLangs = Array.from(new Set(meaningful))
  const hasHindiOrEnglish = uniqueLangs.some((l) => l === 'en' || l === 'hi')
  if (hasHindiOrEnglish) {
    out.push(rc('Rule 6(2)', 'Language of declarations (Hindi/English)', 'PASS',
      { detected_value: uniqueLangs.join(', '), reason: 'Mandatory declarations are printed in Hindi or English as required.', weight: 1 }))
  } else if (uniqueLangs.length > 0) {
    out.push(rc('Rule 6(2)', 'Language of declarations (Hindi/English)', 'WARNING',
      { detected_value: uniqueLangs.join(', '), reason: `Detected languages (${uniqueLangs.join(', ')}) are neither Hindi nor English — Rule 6(2) requires mandatory declarations in Hindi or English.`, weight: 1 }))
  } else {
    out.push(rc('Rule 6(2)', 'Language of declarations (Hindi/English)', 'NOT_VERIFIABLE',
      { reason: 'Label languages could not be determined from the photos.', verification_type: 'NOT_VERIFIABLE', weight: 1 }))
  }

  /* Food-safety (FSS Act) supplementary label checks on food items. */
  if (ctx.is_food) {
    const ucFssai = uncertainCheck(d, 'fssai_license', 'FSS', 'FSSAI licence number (food labelling)', 1)
    if (ucFssai) out.push(ucFssai)
    else if (ex.fssai_license) {
      const vf = validateFssai(ex.fssai_license)
      out.push(rc('FSS', 'FSSAI licence number (food labelling)', vf.ok ? 'PASS' : 'WARNING',
        { detected_value: vf.normalized ?? ex.fssai_license, reason: vf.reason, evidence: ev(d, 'fssai_license'), weight: 1 }))
    } else {
      out.push(rc('FSS', 'FSSAI licence number (food labelling)', 'WARNING',
        { reason: 'Food item — FSSAI licence number is expected on the label (separate from Legal Metrology obligations).', evidence: ev(d, 'fssai_license'), weight: 1 }))
    }

    const ucVeg = uncertainCheck(d, 'veg_nonveg', 'FSS', 'Veg/Non-veg green-brown dot indicator', 1)
    if (ucVeg) out.push(ucVeg)
    else if (ex.veg_nonveg) {
      const vv = validateVegNonVeg(ex.veg_nonveg)
      out.push(rc('FSS', 'Veg/Non-veg green-brown dot indicator', vv.ok ? 'PASS' : 'WARNING',
        { detected_value: ex.veg_nonveg, reason: vv.reason, evidence: ev(d, 'veg_nonveg'), weight: 1 }))
    } else {
      out.push(rc('FSS', 'Veg/Non-veg green-brown dot indicator', 'WARNING',
        { reason: 'Food item — Veg/Non-veg symbol is expected on the label.', evidence: ev(d, 'veg_nonveg'), weight: 1 }))
    }
  }

  return out
}

/* ------------------------------------------------------------------ */
/* Barcode / GTIN (traceability aid, not a Rule 6 mandate).             */
/* ------------------------------------------------------------------ */
function runBarcode(d: EngineInputs): RuleCheck[] {
  if (!d.barcode) return [rc('BARCODE', 'Barcode / GTIN', 'NOT_APPLICABLE', {
    reason: 'No barcode captured/entered — traceability aid, not a Rule 6 mandate.', weight: 1,
  })]
  const digits = d.barcode.replace(/\D/g, '')
  const okLength = digits.length === 8 || digits.length === 12 || digits.length === 13 || digits.length === 14
  return [rc('BARCODE', 'Barcode / GTIN', okLength ? 'PASS' : 'WARNING',
    {
      detected_value: digits,
      reason: okLength ? `Barcode "${digits}" is a standard EAN/GTIN length.` : `Barcode "${d.barcode}" is not a standard EAN-8/12/13/GTIN format.`,
      weight: 1,
    })]
}

/* ------------------------------------------------------------------ */
/* Rule definitions — order matters for display.                        */
/* ------------------------------------------------------------------ */
export const RULES: EvaluatedRule[] = [
  {
    id: 'rule3', number: 'Rule 3', title: 'Applicability', scope: 'all packages', verification_type: 'NOT_VERIFIABLE', weight: 1,
    applies: () => true,
    evaluate: (ctx) => [rc('Rule 3', 'Applicability of the rules', 'NOT_APPLICABLE', {
      reason: applyReason(ctx, `engine applied the ruleset against detected context`), weight: 1,
    })],
  },
  {
    id: 'rule4', number: 'Rule 4', title: 'Pre-packing and sale', scope: 'retail/wholesale', verification_type: 'IMAGE_VERIFIABLE', weight: 2,
    applies: (ctx) => ctx.package_type === 'retail' || ctx.package_type === 'wholesale',
    evaluate: (ctx, d) => {
      const ex = d.ex
      const missing: string[] = []
      if (!ex.manufacturer && !ex.packer && !ex.importer) missing.push('name/address')
      if (!ex.commodity_name) missing.push('common name')
      if (!ex.net_quantity) missing.push('net quantity')
      if (!ex.mrp) missing.push('MRP')
      if (missing.length === 0) {
        return [rc('Rule 4', 'Pre-packing and sale (mandatory declarations present)', 'PASS',
          { reason: 'Core declaration set (name, common name, net quantity, MRP) detected on the package.', weight: 2 })]
      }
      if (missing.length === 4) {
        return [rc('Rule 4', 'Pre-packing and sale (mandatory declarations present)', 'NOT_DETECTED',
          { reason: 'No mandatory declarations could be read — the label may not be legible in the photos.', weight: 2 })]
      }
      return [rc('Rule 4', 'Pre-packing and sale (mandatory declarations present)', 'FAIL',
        { reason: `Missing core declarations: ${missing.join(', ')}.`, weight: 2 })]
    },
  },
  {
    id: 'rule5', number: 'Rule 5', title: 'Standard package sizes (Second Schedule)', scope: 'retail packages', verification_type: 'IMAGE_VERIFIABLE', weight: 1,
    applies: (ctx) => ctx.package_type === 'retail',
    evaluate: (ctx, d) => {
      if (!d.ex.net_quantity) return [rc('Rule 5', 'Standard package sizes (Second Schedule)', 'NOT_DETECTED',
        { reason: 'Net quantity not detected — cannot compare against Second Schedule standard sizes.', evidence: ev(d, 'net_quantity'), weight: 1 })]
      const vq = validateQuantity(d.ex.net_quantity)
      const declared = (vq.normalized ?? d.ex.net_quantity).toLowerCase()
      const text = (d.ex.commodity_name ?? d.userProductName ?? '').toLowerCase()
      const entry = STANDARD_PACKAGE_SIZES.find((s) => text.includes(s.commodity.split(' / ')[0]))
      if (!entry) {
        return [rc('Rule 5', 'Standard package sizes (Second Schedule)', 'NOT_VERIFIABLE',
          { detected_value: vq.normalized, reason: `Declared "${vq.normalized}" — commodity not matched in the standard-size table; verify against Second Schedule.`, evidence: ev(d, 'net_quantity'), verification_type: 'NOT_VERIFIABLE', weight: 1 })]
      }
      const allowed = entry.allowed.map((a) => a.toLowerCase())
      const standard = allowed.find((a) => declared.includes(a))
      return [rc('Rule 5', 'Standard package sizes (Second Schedule)',
        standard ? 'PASS' : 'WARNING',
        { detected_value: vq.normalized, reason: standard
            ? `Declared "${vq.normalized}" matches standard size "${standard}" for ${entry.commodity}.`
            : `Declared "${vq.normalized}" does not match the standard sizes for ${entry.commodity} (${entry.allowed.join(', ')}). Verify against Second Schedule.`,
          evidence: ev(d, 'net_quantity'), weight: 1 })]
    },
  },
  {
    id: 'rule6', number: 'Rule 6', title: 'Mandatory declarations on pre-packed commodities', scope: 'retail/wholesale', verification_type: 'IMAGE_VERIFIABLE', weight: 2,
    applies: () => true,
    evaluate: runRule6,
  },
  {
    id: 'rule7', number: 'Rule 7', title: 'Principal display panel / lettering', scope: 'retail', verification_type: 'NOT_VERIFIABLE', weight: 1,
    applies: (ctx) => ctx.package_type === 'retail',
    evaluate: (ctx, d) => {
      const high = Object.values(d.fields).filter((f) => f?.confidence === 'high').length
      const lo = Object.values(d.fields).filter((f) => f?.confidence === 'low').length
      if (lo > high) {
        return [rc('Rule 7', 'Principal display panel / lettering', 'NOT_VERIFIABLE',
          { reason: 'Multiple declarations were barely legible — letter height/contrast could not be assessed reliably from the photos.', verification_type: 'NOT_VERIFIABLE', weight: 1 })]
      }
      return [rc('Rule 7', 'Principal display panel / lettering', 'NOT_VERIFIABLE',
        { reason: 'Principal Display Panel area and letter size require a calibrated/printed-A4 physical check; cannot be measured reliably from label photos.', verification_type: 'NOT_VERIFIABLE', weight: 1 })]
    },
  },
  {
    id: 'rule8', number: 'Rule 8', title: 'Placement of declarations', scope: 'retail', verification_type: 'NOT_VERIFIABLE', weight: 1,
    applies: (ctx) => ctx.package_type === 'retail',
    evaluate: (ctx, d) => {
      if (d.ocrBlocks.length >= 2) {
        return [rc('Rule 8', 'Placement of declarations', 'NOT_VERIFIABLE',
          { reason: 'Declarations span multiple views; whether they sit on the same principal/nearby panel requires visual inspection of the physical package.', verification_type: 'NOT_VERIFIABLE', weight: 1 })]
      }
      return [rc('Rule 8', 'Placement of declarations', 'NOT_VERIFIABLE',
        { reason: 'Single-view scan cannot confirm that all declarations share the required panel placement.', verification_type: 'NOT_VERIFIABLE', weight: 1 })]
    },
  },
  {
    id: 'rule9', number: 'Rule 9', title: 'Manner & legibility of declarations', scope: 'all', verification_type: 'IMAGE_VERIFIABLE', weight: 1,
    applies: () => true,
    evaluate: (ctx, d) => {
      const fieldCount = Object.values(d.fields).filter((f) => f && f.value).length
      const low = Object.values(d.fields).filter((f) => f?.confidence === 'low').length
      const unclear = d.uncertain.length
      if (fieldCount > 0 && low === 0 && unclear === 0) {
        return [rc('Rule 9', 'Manner & legibility of declarations', 'PASS',
          { reason: 'All detected declarations were read with high/medium confidence — no legibility issue observed.', weight: 1 })]
      }
      if (unclear > 0) {
        return [rc('Rule 9', 'Manner & legibility of declarations', 'NOT_VERIFIABLE',
          { detected_value: `${unclear} uncertain`, reason: `${unclear} declaration${unclear > 1 ? 's' : ''} printed but illegible from the photos — legibility cannot be confirmed.`, verification_type: 'NOT_VERIFIABLE', weight: 1 })]
      }
      return [rc('Rule 9', 'Manner & legibility of declarations', 'NOT_VERIFIABLE',
        { reason: 'No declarations were confidently detected — legibility of the label could not be verified from the image.', verification_type: 'NOT_VERIFIABLE', weight: 1 })]
    },
  },
  {
    id: 'rule10', number: 'Rule 10', title: 'Manufacturer/packer/importer name and address', scope: 'retail/wholesale', verification_type: 'IMAGE_VERIFIABLE', weight: 1,
    applies: (ctx) => ctx.package_type !== 'advertisement',
    evaluate: (ctx, d) => {
      const ex = d.ex
      const supplier = ex.manufacturer || ex.packer || ex.importer
      if (!supplier) return [rc('Rule 10', 'Manufacturer/packer/importer name and address', 'FAIL',
        { reason: 'No business name detected.', evidence: ev(d, 'manufacturer'), weight: 1 })]
      const addrOk = validateAddressCompleteness(ex.address)
      if (ctx.origin === 'imported' && !ex.importer) {
        return [rc('Rule 10', 'Manufacturer/packer/importer name and address', 'WARNING',
          { detected_value: ex.country_of_origin ?? null, reason: 'Imported product — importer details must be declared; not detected.', weight: 1 })]
      }
      return [rc('Rule 10', 'Manufacturer/packer/importer name and address', addrOk.ok ? 'PASS' : 'WARNING',
        { detected_value: supplier, reason: addrOk.ok ? 'Business name + complete address detected.' : addrOk.reason, evidence: ev(d, 'address'), weight: 1 })]
    },
  },
  {
    id: 'rule11', number: 'Rule 11', title: 'Requisites of quantity declaration', scope: 'retail/wholesale', verification_type: 'IMAGE_VERIFIABLE', weight: 1,
    applies: (ctx) => ctx.package_type !== 'advertisement',
    evaluate: (ctx, d) => {
      const ex = d.ex
      if (!ex.net_quantity) return [rc('Rule 11', 'Requisites of quantity declaration', 'FAIL',
        { reason: 'Net quantity not declared.', evidence: ev(d, 'net_quantity'), weight: 1 })]
      const vague = VAGUE_QUANTITY_WORDS.some((w) => ex.net_quantity!.toLowerCase().includes(w))
      const vq = validateQuantity(ex.net_quantity)
      if (vague) return [rc('Rule 11', 'Requisites of quantity declaration', 'WARNING',
        { detected_value: ex.net_quantity, reason: `Quantity "${ex.net_quantity}" uses an approximate/forbidden expression.`, evidence: ev(d, 'net_quantity'), weight: 1 })]
      return [rc('Rule 11', 'Requisites of quantity declaration', vq.ok ? 'PASS' : 'WARNING',
        { detected_value: vq.normalized ?? ex.net_quantity, reason: vq.ok ? 'Quantity declared in a valid manner.' : vq.reason, evidence: ev(d, 'net_quantity'), weight: 1 })]
    },
  },
  {
    id: 'rule12', number: 'Rule 12', title: 'Manner of declaring quantity', scope: 'retail', verification_type: 'IMAGE_VERIFIABLE', weight: 1,
    applies: (ctx) => ctx.package_type === 'retail',
    evaluate: (ctx, d) => {
      const ex = d.ex
      if (!ex.net_quantity) return [rc('Rule 12', 'Manner of declaring quantity', 'FAIL',
        { reason: 'Net quantity not declared.', evidence: ev(d, 'net_quantity'), weight: 1 })]
      const vq = validateQuantity(ex.net_quantity)
      if (!vq.ok) return [rc('Rule 12', 'Manner of declaring quantity', 'WARNING',
        { detected_value: ex.net_quantity, reason: vq.reason, evidence: ev(d, 'net_quantity'), weight: 1 })]
      const vs = validateUnitAgainstSoldBy(vq.kind ?? 'unknown', ctx.sold_by)
      return [rc('Rule 12', 'Manner of declaring quantity', vs.ok ? 'PASS' : 'WARNING',
        { detected_value: vq.normalized, reason: vs.reason, evidence: ev(d, 'net_quantity'), weight: 1 })]
    },
  },
  {
    id: 'rule13', number: 'Rule 13', title: 'Units of weight/measure/number (Fourth Schedule)', scope: 'retail', verification_type: 'IMAGE_VERIFIABLE', weight: 1,
    applies: (ctx) => ctx.package_type === 'retail',
    evaluate: (ctx, d) => {
      const ex = d.ex
      if (!ex.net_quantity) return [rc('Rule 13', 'Units of weight/measure/number (Fourth Schedule)', 'FAIL',
        { reason: 'Net quantity not declared.', evidence: ev(d, 'net_quantity'), weight: 1 })]
      const u = detectUnit(ex.net_quantity)
      if (u.kind === 'unknown') return [rc('Rule 13', 'Units of weight/measure/number (Fourth Schedule)', 'WARNING',
        { detected_value: ex.net_quantity, reason: `Unit in "${ex.net_quantity}" is not a Fourth Schedule unit.`, evidence: ev(d, 'net_quantity'), weight: 1 })]
      return [rc('Rule 13', 'Units of weight/measure/number (Fourth Schedule)', 'PASS',
        { detected_value: ex.net_quantity, reason: `Net quantity uses a permitted unit (${u.unit ?? u.kind}).`, evidence: ev(d, 'net_quantity'), weight: 1 })]
    },
  },
  {
    id: 'rule14', number: 'Rule 14', title: 'Dimensions of specified commodities', scope: 'length/area/number commodities', verification_type: 'IMAGE_VERIFIABLE', weight: 1,
    applies: (ctx) => Boolean(ctx.special_commodity?.startsWith('dimension')) || ctx.sold_by === 'length' || ctx.sold_by === 'area',
    evaluate: (ctx, d) => {
      const ex = d.ex
      if (ex.net_quantity) {
        const vq = validateQuantity(ex.net_quantity)
        if ((vq.kind === 'length' || vq.kind === 'area' || vq.kind === 'number') && vq.ok) {
          return [rc('Rule 14', 'Dimensions of specified commodities', 'PASS',
            { detected_value: vq.normalized, reason: `Declared dimension "${vq.normalized}" in a permitted unit (${vq.kind}).`, evidence: ev(d, 'net_quantity'), weight: 1 })]
        }
      }
      return [rc('Rule 14', 'Dimensions of specified commodities', 'NOT_DETECTED',
        { reason: 'Commodity sold by length/area/number but no dimension/number declared.', evidence: ev(d, 'net_quantity'), weight: 1 })]
    },
  },
  {
    id: 'rule15', number: 'Rule 15', title: 'Dimension/weight declaration where price is linked', scope: 'price-linked commodities', verification_type: 'IMAGE_VERIFIABLE', weight: 1,
    applies: (ctx) => ctx.is_price_linked,
    evaluate: (ctx, d) => {
      const ex = d.ex
      if (ex.unit_sale_price && ex.net_quantity) {
        return [rc('Rule 15', 'Dimension/weight declaration where price is linked', 'PASS',
          { detected_value: `${ex.unit_sale_price} / ${ex.net_quantity}`, reason: 'Unit price and linked quantity/dimension both declared.', weight: 1 })]
      }
      return [rc('Rule 15', 'Dimension/weight declaration where price is linked', 'NOT_VERIFIABLE',
        { reason: 'Commodity price appears linked to dimension/weight — requires the unit price and declared dimension; not fully readable from the image.', verification_type: 'NOT_VERIFIABLE', weight: 1 })]
    },
  },
  {
    id: 'rule16', number: 'Rule 16', title: 'Number of usable sheets', scope: 'sheets commodities', verification_type: 'IMAGE_VERIFIABLE', weight: 1,
    applies: (ctx) => Boolean(ctx.special_commodity?.startsWith('sheets')),
    evaluate: (ctx, d) => {
      const ex = d.ex
      const candidate = ex.net_quantity ?? ex.commodity_name
      const vs = validateSheets(candidate)
      return [rc('Rule 16', 'Number of usable sheets', vs.ok ? 'PASS' : 'NOT_DETECTED',
        { detected_value: vs.normalized ?? candidate, reason: vs.ok ? 'Sheet count / unrolled length declared.' : 'Tile/tissue/foil commodity without a declared sheet count or unrolled length.', evidence: ev(d, 'net_quantity'), weight: 1 })]
    },
  },
  {
    id: 'rule17', number: 'Rule 17', title: 'Packages with commodities sold by number', scope: 'count commodities', verification_type: 'IMAGE_VERIFIABLE', weight: 1,
    applies: (ctx) => Boolean(ctx.special_commodity?.startsWith('count')) || ctx.sold_by === 'number',
    evaluate: (ctx, d) => {
      const ex = d.ex
      if (!ex.net_quantity) return [rc('Rule 17', 'Packages with commodities sold by number', 'FAIL',
        { reason: 'No count declared.', evidence: ev(d, 'net_quantity'), weight: 1 })]
      const vc = validateCounted(ex.net_quantity)
      return [rc('Rule 17', 'Packages with commodities sold by number', vc.ok ? 'PASS' : 'WARNING',
        { detected_value: ex.net_quantity, reason: vc.reason, evidence: ev(d, 'net_quantity'), weight: 1 })]
    },
  },
  {
    id: 'rule18', number: 'Rule 18', title: 'Wholesale/retail dealer obligations (Rules 18-21)', scope: 'dealer inspection', verification_type: 'PHYSICAL_INSPECTION', weight: 1,
    applies: (ctx) => ctx.package_type === 'retail' || ctx.package_type === 'wholesale',
    evaluate: (ctx, d) => [rc('Rule 18', 'Wholesale/retail dealer obligations (Rules 18-21)', 'REQUIRES_PHYSICAL_INSPECTION',
      { reason: 'Dealer obligations and inspection procedures (Rules 18-21: records, sampling, seizure) are enforced at the trade premises — not verifiable by a camera scan.', verification_type: 'PHYSICAL_INSPECTION', weight: 1 })],
  },
  {
    id: 'rule22', number: 'Rule 22', title: 'Maximum permissible error', scope: 'all packages', verification_type: 'PHYSICAL_INSPECTION', weight: 1,
    applies: (ctx) => ctx.package_type === 'retail' || ctx.package_type === 'wholesale',
    evaluate: (ctx, d) => [rc('Rule 22', 'Maximum permissible error (First Schedule)', 'REQUIRES_PHYSICAL_INSPECTION',
      { detected_value: d.ex.net_quantity, reason: 'MPE (declared net vs. actual net) can only be verified by physically weighing/measuring the package (First Schedule).', verification_type: 'PHYSICAL_INSPECTION', weight: 1 })],
  },
  {
    id: 'rule23', number: 'Rule 23', title: 'Deceptive packages', scope: 'all packages', verification_type: 'PHYSICAL_INSPECTION', weight: 1,
    applies: (ctx) => ctx.package_type === 'retail',
    evaluate: (ctx, d) => {
      const fillerHints = /\b(filler|(?:net w[te]?\.?\s*[0-9]|contains?[: ]|free space|slack fill|underfilled)\b)/i.test(d.ocrText) || d.uncertain.includes('net_quantity')
      if (fillerHints) {
        return [rc('Rule 23', 'Deceptive packages', 'WARNING',
          { reason: 'OCR reported slack-fill/filler or quantity-affecting text — potential deceptive packaging flagged for physical inspection.', verification_type: 'PHYSICAL_INSPECTION', weight: 1 })]
      }
      return [rc('Rule 23', 'Deceptive packages', 'NOT_VERIFIABLE',
        { reason: 'Deceptive packaging (container substantially larger than contents, slack fill) cannot be determined from image appearance alone — requires physical inspection.', verification_type: 'NOT_VERIFIABLE', weight: 1 })]
    },
  },
  {
    id: 'rule24', number: 'Rule 24', title: 'Wholesale package declarations', scope: 'wholesale', verification_type: 'IMAGE_VERIFIABLE', weight: 1,
    applies: (ctx) => ctx.package_type === 'wholesale',
    evaluate: (ctx, d) => {
      const ex = d.ex
      const wholesaleMarked = /not for retail sale|for wholesale|wholesale only|for trade/i.test(d.ocrText + ' ' + (ex.manufacturer ?? '') + (ex.importer ?? ''))
      if (wholesaleMarked && ex.net_quantity) {
        return [rc('Rule 24', 'Wholesale package declarations', 'PASS',
          { detected_value: `${wholesaleMarked ? 'Wholesale-marked, ' : ''}${ex.net_quantity}`, reason: 'Wholesale package carries trade marking and net quantity.', weight: 1 })]
      }
      return [rc('Rule 24', 'Wholesale package declarations', 'WARNING',
        { reason: 'Wholesale package detected — verify the required wholesale declarations ("not for retail sale" + net quantity).', verification_type: 'NOT_VERIFIABLE', weight: 1 })]
    },
  },
  {
    id: 'rule25', number: 'Rule 25', title: 'Export package restrictions', scope: 'export', verification_type: 'IMAGE_VERIFIABLE', weight: 1,
    applies: (ctx) => ctx.package_type === 'export',
    evaluate: (ctx, d) => {
      const marked = /for export|export only|for export only/i.test(d.ocrText)
      return [rc('Rule 25', 'Export package restrictions', marked ? 'PASS' : 'WARNING',
        { detected_value: marked ? 'For export marked' : null, reason: marked ? 'Package marked for export — outside domestic retail declaration regime.' : 'Suspected export package but "for export" marking not found; verify packaging.', weight: 1 })]
    },
  },
  {
    id: 'rule26', number: 'Rule 26', title: 'Exemptions', scope: 'all packages', verification_type: 'IMAGE_VERIFIABLE', weight: 1,
    applies: () => true,
    evaluate: (ctx, d) => ctx.applicable_exemptions.length > 0
      ? [rc('Rule 26', 'Exemptions', 'NOT_APPLICABLE',
          { reason: `Exemption category detected: ${ctx.applicable_exemptions.join(', ')}. The applicable declarations may be relaxed under Rule 26 — verify the specific exemption.`, weight: 1 })]
      : [rc('Rule 26', 'Exemptions', 'NOT_APPLICABLE',
          { reason: 'No exemption indicator detected on the package — full declaration regime applies.', weight: 1 })],
  },
  {
    id: 'rule27', number: 'Rule 27', title: 'Manufacturer/packer/importer registration', scope: 'all packages', verification_type: 'DATABASE', weight: 1,
    applies: () => true,
    evaluate: () => [rc('Rule 27', 'Manufacturer/packer/importer registration', 'NOT_VERIFIABLE',
      { reason: 'Registration status cannot be established from a label photograph without a trusted registration database/API.', verification_type: 'DATABASE', weight: 1 })],
  },
  {
    id: 'rule31', number: 'Rule 31', title: 'Advertisement requirements', scope: 'advertisement only', verification_type: 'IMAGE_VERIFIABLE', weight: 1,
    applies: (ctx) => ctx.is_advertisement,
    evaluate: (ctx, d) => {
      const mrpMentioned = /\bmrp\b|max\.?\s*retail|₹/.test(d.ocrText)
      const quantityMentioned = /(net|w\.?t\.?|content|quantity|g|kg|ml|l)\b/.test(d.ocrText)
      if (mrpMentioned && !quantityMentioned) {
        return [rc('Rule 31', 'Advertisement requirements', 'WARNING',
          { reason: 'Advertisement mentions MRP but a quantity/number declaration on the same advertised item is not visible.', weight: 1 })]
      }
      if (mrpMentioned && quantityMentioned) {
        return [rc('Rule 31', 'Advertisement requirements', 'PASS',
          { reason: 'Advertisement carries both MRP and quantity/number information.', weight: 1 })]
      }
      return [rc('Rule 31', 'Advertisement requirements', 'NOT_VERIFIABLE',
        { reason: 'Scanned item is an advertisement but MRP/quantity declaration coverage could not be confirmed.', verification_type: 'NOT_VERIFIABLE', weight: 1 })]
    },
  },
]

/** Convenience: pull the barcode rule + Rule 6 together, flatten, then the registry. */
export function runAllRules(ctx: PackageContext, d: EngineInputs): RuleCheck[] {
  const out: RuleCheck[] = []

  // Rule 6 (core) is always evaluated first — it is the heart of the scan.
  const rule6 = RULES.find((r) => r.id === 'rule6')!
  out.push(...rule6.evaluate(ctx, d))

  // Barcode traceability.
  out.push(...runBarcode(d))

  // Remaining registry rules (Rules 3,4,5,7,8,9,10,11,12,13,14,15,16,17,18,22,23,24,25,26,27,31).
  for (const r of RULES) {
    if (r.id === 'rule6') continue
    if (!r.applies(ctx, d)) {
      out.push(rc(r.number, r.title, 'NOT_APPLICABLE', { reason: applyReason(ctx, `rule applies only when ${r.scope}`), weight: r.weight }))
      continue
    }
    out.push(...r.evaluate(ctx, d))
  }

  // Contract guarantee: every rule carries an evidence chain (Image -> OCR -> field).
  const ocrSnippet = d.ocrText ? d.ocrText.slice(0, 280) : ''
  return out.map((r) => ({
    ...r,
    detected_value: r.detected_value ?? null,
    reason: r.reason,
    evidence: {
      source_image: r.evidence?.source_image ?? null,
      ocr_text: r.evidence?.ocr_text ?? ocrSnippet,
    },
  }))
}