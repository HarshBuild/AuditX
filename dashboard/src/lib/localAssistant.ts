/*
 * AuditX — local deterministic compliance assistant.
 *
 * Answers questions about a scan using only the persisted scan data (rules,
 * extractions, counts, summary). The assistant NEVER hangs: it returns a
 * guaranteed, factual answer for any input. The `complianceAssistant` Cloud
 * Function is optional and, when unreachable, these local answers are used.
 */

import type { ScanRow } from './types2'

interface Fa {
  pattern: RegExp
  answer: () => string
}

const FIELD_LABELS: Record<string, string> = {
  commodity_name: 'generic name',
  mrp: 'MRP',
  net_quantity: 'net quantity',
  unit_sale_price: 'unit sale price (USP)',
  manufacturer: 'manufacturer',
  packer: 'packer',
  importer: 'importer',
  address: 'address',
  country_of_origin: 'country of origin',
  mfg_date: 'manufacturing date',
  best_before: 'best before / expiry date',
  consumer_care: 'consumer care details',
  lot_no: 'batch / lot number',
  fssai_license: 'FSSAI licence number',
}

function safeStr(v: unknown): string {
  try {
    return String(v ?? '')
  } catch {
    return ''
  }
}

function extractField(scan: ScanRow, key: string): string | null {
  const block = scan.extraction_fields?.[key]
  const raw = block?.value ?? (scan.extractions as Record<string, unknown> | undefined)?.[key]
  const v = safeStr(raw).trim()
  return v.length > 0 ? v : null
}

function count(scan: ScanRow, status: string): number {
  const s = scan.counts as Record<string, number> | undefined
  const n = s?.[status]
  if (typeof n === 'number') return n
  return (scan.rules ?? []).filter((r) => r && r.status === status).length
}

function verdictWords(scan: ScanRow): string {
  return safeStr(scan.verdict).toLowerCase().replace(/_/g, ' ').trim() || 'not available'
}

function riskBandOf(scan: ScanRow): string {
  const risk = scan.risk_score
  if (risk == null) return 'Low'
  if (risk >= 76) return 'Critical'
  if (risk >= 51) return 'High'
  if (risk >= 26) return 'Medium'
  return 'Low'
}

function scoreOf(scan: ScanRow): number {
  const direct = Number(scan.overall_score)
  if (Number.isFinite(direct) && direct > 0) {
    return Math.max(0, Math.min(100, direct))
  }
  const fromRisk = 100 - (Number(scan.risk_score) || 0)
  return Math.max(0, Math.min(100, fromRisk))
}

function prescribedFields(scan: ScanRow): string[] {
  return (scan.rules ?? [])
    .filter((r) => r && (r.status === 'FAIL' || r.status === 'WARNING'))
    .map((r) => FIELD_LABELS[r.rule_id] || r.requirement || r.rule_id)
    .filter(Boolean)
}

function answersFromScan(scan: ScanRow): Fa[] {
  const pass = count(scan, 'passed')
  const fail = count(scan, 'failed')
  const warn = count(scan, 'warnings') + count(scan, 'not_detected') + count(scan, 'uncertain')
  const score = scoreOf(scan)
  const band = riskBandOf(scan)

  const headline = () =>
    `${safeStr(scan.product_name) || 'This product'} scored ${score}/100 — verdict: ${verdictWords(scan)} (risk band: ${band}).`
  const gaps = () => {
    const list = prescribedFields(scan).slice(0, 6)
    return list.length > 0 ? list.join(', ') : 'none'
  }

  return [
    {
      pattern: /pass|passed|passing|verdict|result|score|compliant|good|okay|\bok\b/i,
      answer: () =>
        `${headline()} ${pass} checks passed, ${fail} failed, ${warn} need attention. ${fail === 0 && warn === 0 ? 'All mandatory declarations are present — no corrective action is needed.' : 'See below for what needs attention.'}`,
    },
    {
      pattern: /what.*(missing|wrong|fail|issue|problem)|why.*fail|which.*(missing|fail|incomplete)/i,
      answer: () => {
        const list = prescribedFields(scan).slice(0, 6)
        if (list.length === 0) return 'No declaration is flagged as missing or incorrect — all checks passed.'
        return `The declarations that failed or need attention: ${list.join(', ')}.`
      },
    },
    {
      pattern: /(missing|not present|absent|not available|incomplete|incorrect)/i,
      answer: () => {
        const list = prescribedFields(scan).filter(Boolean).length
        if (list === 0) return 'Every checked declaration is present and correct.'
        return `These declarations are flagged: ${prescribedFields(scan).slice(0, 6).join(', ')} (${list === 1 ? '1 issue' : `${list} issues`}).`
      },
    },
    { pattern: /mrp|price|maximum retail/i, answer: () => `The MRP on the label is ${extractField(scan, 'mrp') ?? 'not detected'}.` },
    { pattern: /net|quantity|weight|volume|grams|grams|litr|\bml\b|\bg\b|\bkg\b/i, answer: () => `The net quantity is ${extractField(scan, 'net_quantity') ?? 'not detected'}.` },
    { pattern: /unit sale|usp\b/i, answer: () => `The unit sale price is ${extractField(scan, 'unit_sale_price') ?? 'not detected'}.` },
    { pattern: /manufacturer|made by|company|who make/i, answer: () => `The manufacturer is ${extractField(scan, 'manufacturer') ?? 'not detected'}.` },
    { pattern: /packe(r|d)|packing/i, answer: () => `The packer is ${extractField(scan, 'packer') ?? 'not detected'}.` },
    { pattern: /import/i, answer: () => `The importer is ${extractField(scan, 'importer') ?? 'not detected'}.` },
    { pattern: /\baddress\b/i, answer: () => `The address is ${extractField(scan, 'address') ?? 'not detected'}.` },
    { pattern: /origin|where.*(from|made)|indian/i, answer: () => `The country of origin is ${extractField(scan, 'country_of_origin') ?? 'not detected'}.` },
    { pattern: /manufactur.*date|\bmfg\b|made on|when.*make/i, answer: () => `The manufacturing date is ${extractField(scan, 'mfg_date') ?? 'not detected'}.` },
    { pattern: /expir|best before|best-before|shelf|use by/i, answer: () => `The best-before / expiry is ${extractField(scan, 'best_before') ?? 'not detected'}.` },
    { pattern: /batch|\blot\b|lot number|lot no/i, answer: () => `The batch / lot number is ${extractField(scan, 'lot_no') ?? 'not detected'}.` },
    { pattern: /consumer care|customer care|helpline|contact/i, answer: () => `The consumer-care contact is ${extractField(scan, 'consumer_care') ?? 'not detected'}.` },
    { pattern: /fssai|licen[cs]e/i, answer: () => `The FSSAI licence number is ${extractField(scan, 'fssai_license') ?? 'not detected'}.` },
    { pattern: /barcode|ean|gtin|code/i, answer: () => `The barcode is ${scan.barcode ? safeStr(scan.barcode) : 'not detected'}.` },
    { pattern: /brand|product|name/i, answer: () => `This product is ${safeStr(scan.product_name) || 'unknown'}${scan.brand ? ` by ${safeStr(scan.brand)}` : ''}${scan.category ? ` (${safeStr(scan.category)})` : ''}.` },
    { pattern: /summary|explain|overview|tell me|about/i, answer: () => `${scan.summary && safeStr(scan.summary).trim() ? safeStr(scan.summary) : headline()} Overall ${score}/100, risk band ${band}.` },
    {
      pattern: /(should|advice|recommend|suggest|action|next|correct)/i,
      answer: () => {
        const list = prescribedFields(scan).slice(0, 6)
        const base = `${headline()} `
        if (list.length === 0) return base + 'No corrective action is required.'
        return `${base}Correct the flagged declarations first: ${list.join(', ')}. Repeated or deliberate non-compliance is actionable under the Legal Metrology (Packaged Commodities) Rules, 2011.`
      },
    },
    { pattern: /oc[r]?|text|lettering|font|legible/i, answer: () => `The OCR read ${scan.ocr_text ? `${safeStr(scan.ocr_text).length} characters` : 'inconclusive text'} across ${(scan.ocr_blocks ?? []).length} label block(s).` },
    {
      pattern: /why|how|is this|does this/i,
      answer: () =>
        `${headline()} ${fail} of the checked declarations failed, ${warn} need attention (${pass} passed). ${gaps() === 'none' ? 'Nothing is flagged — the label is compliant.' : `The flagged items are: ${gaps()}.`}`,
    },
  ]
}

function askRules(scan: ScanRow, q: string): string | null {
  const safe = safeStr(q).toLowerCase()
  for (const fa of answersFromScan(scan)) {
    try {
      if (fa.pattern.test(safe)) {
        const r = fa.answer()
        if (r && r.trim().length > 0) return r
      }
    } catch {
      /* never let one rule break the loop */
    }
  }
  return null
}

/** Best-effort, always-ready fallback so the assistant never goes silent. */
function genericAnswer(scan: ScanRow): string {
  const score = scoreOf(scan)
  const pass = count(scan, 'passed')
  const fail = count(scan, 'failed')
  const warn = count(scan, 'warnings') + count(scan, 'not_detected') + count(scan, 'uncertain')
  const band = riskBandOf(scan)
  const summary = scan.summary && safeStr(scan.summary).trim() ? safeStr(scan.summary) : ''
  return `${safeStr(scan.product_name) || 'This product'}: ${score}/100, verdict ${verdictWords(scan)}, risk band ${band}. ${pass} passed, ${fail} failed, ${warn} need attention.${summary ? ' ' + summary : ''}`
}

/** Signals that a question has NOTHING to do with this project/scan. */
const OUT_OF_SCOPE =
  /(weather|news|sports|politics|cricket|music|movie|film|song|recipe|food recipe|math|calculate|my homework|essay|joke|\bhobby|\bgame\b|gaming|stock|share market|pelvis|relationship|love\b|what is your name|who are you|how old are you|capital of|president|prime minister|history of|translate|code (in|for)|python|javascript|cooking|medicine|health advice|invest)/i

function isOutOfScope(q: string): boolean {
  return OUT_OF_SCOPE.test(q)
}

/**
 * Deterministic local answer for a question about `scan`. Never returns null:
 * every question gets a factual answer built from the scan data. Questions
 * completely unrelated to this project are refused (returned as a notice).
 */
export function localAssistantAnswer(scan: ScanRow, question: string): string | null {
  try {
    const q = (question ?? '').trim()
    if (!q) return null
    if (isOutOfScope(q)) {
      return 'I can only help with this product label and Legal Metrology compliance. Please ask something related to the scanned product, its label declarations, or the AuditX app.'
    }
    const direct = askRules(scan, q)
    return direct ?? genericAnswer(scan)
  } catch {
    return genericAnswer(scan)
  }
}