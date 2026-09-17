/**
 * Accuracy evaluation endpoint — live, deterministic test batteries.
 *
 *   POST /api/evaluate  → runs 16 fixed cases through the REAL engines
 *                          (compliance + adjudication) and reports pass/fail.
 *
 * Read-only: touches no database, no storage, no AI APIs. All inputs use
 * far-past/far-future dates so results never drift with the calendar.
 * Safe to run in front of judges.
 */

import { Router, Request, Response } from 'express'
import { runCompliance } from '../lib/inspection/compliance.js'
import { adjudicateReports } from '../lib/inspection/adjudicate.js'
import type {
  InspectionCategory,
  InspectionStatus,
  OcrProviderResult,
} from '../lib/inspection/types.js'
import type { ReportOutcome } from '../lib/inspection/ocr.js'

const router = Router()

/* ------------------------------------------------------------------ */
/* Compliance battery (10 cases)                                       */
/* ------------------------------------------------------------------ */

interface ComplianceCase {
  id: string
  label: string
  fields: Record<string, string>
  category: InspectionCategory
  expectStatus: InspectionStatus
  minScore: number
  maxScore: number
}

const GOOD_EDIBLE: Record<string, string> = {
  commodity_name: 'Nut Mix 200 g',
  brand: 'Real Bites',
  manufacturer: 'Real Foods Pvt Ltd, Bengaluru',
  net_quantity: '200 g',
  mrp: 'Rs 120',
  batch_no: 'B4281',
  mfg_date: '2025-01-15',
  expiry_date: '2027-06-15',
  ingredients_text: 'Peanuts, cashew, salt',
  allergen_info: 'Contains peanuts',
  required_declarations: 'FSSAI Lic No 10012023001234',
}

const NON_EDIBLE: Record<string, string> = {
  commodity_name: 'Detergent Powder 1 kg',
  brand: 'Clean',
  manufacturer: 'Clean Ltd',
  net_quantity: '1 kg',
  mrp: 'Rs 90',
  batch_no: 'C1',
  mfg_date: '2025-03-01',
  expiry_date: '2027-03-01',
  warnings: 'Keep away from children',
  certification_details: 'ISI 4955',
}

const COMPLIANCE_CASES: ComplianceCaseFull[] = [
  { id: 'c-perfect', label: 'Perfect edible label', fields: GOOD_EDIBLE, category: 'edible', expectStatus: 'compliant', minScore: 90, maxScore: 100 },
  { id: 'c-expired', label: 'Expired product', fields: { ...GOOD_EDIBLE, expiry_date: '2020-01-01' }, category: 'edible', expectStatus: 'critical', minScore: 0, maxScore: 49 },
  { id: 'c-no-mrp', label: 'MRP missing', fields: sans(GOOD_EDIBLE, 'mrp'), category: 'edible', expectStatus: 'violation', minScore: 50, maxScore: 74 },
  { id: 'c-future-mfg', label: 'Future manufacturing date', fields: { ...GOOD_EDIBLE, mfg_date: '2030-01-01' }, category: 'edible', expectStatus: 'violation', minScore: 50, maxScore: 74 },
  { id: 'c-allergen', label: 'Undeclared peanut allergen', fields: { ...sans(GOOD_EDIBLE, 'allergen_info'), ingredients_text: 'Peanuts, sugar' }, category: 'edible', expectStatus: 'violation', minScore: 50, maxScore: 74 },
  { id: 'c-non-edible', label: 'Compliant detergent (non-edible)', fields: NON_EDIBLE, category: 'non_edible', expectStatus: 'compliant', minScore: 90, maxScore: 100 },
  { id: 'c-empty', label: 'Empty fields (defensive path: MRP rule fails shut)', fields: {}, category: null, expectStatus: 'critical', minScore: 0, maxScore: 49 },
  { id: 'c-name-only', label: 'Only product name', fields: { commodity_name: 'X' }, category: null, expectStatus: 'violation', minScore: 50, maxScore: 74 },
  { id: 'c-relative-expired', label: 'Best-before 6 months, mfg 2020 (computed expiry)', fields: { commodity_name: 'Milk', mfg_date: '2020-01-01' }, category: null, expectStatus: 'critical', minScore: 0, maxScore: 49, text: 'Best before 6 months from manufacture' },
  { id: 'c-2digit-year', label: 'Two-digit year dates (15/01/25, 15/06/27)', fields: { ...GOOD_EDIBLE, mfg_date: '15/01/25', expiry_date: '15/06/27' }, category: 'edible', expectStatus: 'compliant', minScore: 90, maxScore: 100 },
]

function sans(obj: Record<string, string>, ...keys: string[]): Record<string, string> {
  const out = { ...obj }
  for (const k of keys) delete out[k]
  return out
}

interface ComplianceCaseFull extends ComplianceCase {
  text?: string
}

export interface CaseResult {
  id: string
  label: string
  pass: boolean
  expected: string
  actual: string
  detail: string
  ms: number
}

const COMPLIANCE_CASES_FULL: ComplianceCaseFull[] = COMPLIANCE_CASES

function runComplianceBattery(): { name: string; cases: CaseResult[] } {
  const cases: CaseResult[] = COMPLIANCE_CASES_FULL.map((c) => {
    const t0 = Date.now()
    try {
      const text = c.text ?? Object.values(c.fields).join(' ')
      const r = runCompliance(
        {
          fields: c.fields,
          text,
          field_confidence: {},
          field_evidence: {},
          sources: {},
          conflicts: [],
          language: 'en',
          regions: [],
        },
        c.category,
      )
      const statusOk = r.status === c.expectStatus
      const scoreOk = r.overall_score >= c.minScore && r.overall_score <= c.maxScore
      return {
        id: c.id,
        label: c.label,
        pass: statusOk && scoreOk,
        expected: `${c.expectStatus} [${c.minScore}–${c.maxScore}]`,
        actual: `${r.status} [${r.overall_score}]`,
        detail: r.summary,
        ms: Date.now() - t0,
      }
    } catch (e) {
      return {
        id: c.id,
        label: c.label,
        pass: false,
        expected: `${c.expectStatus} [${c.minScore}–${c.maxScore}]`,
        actual: `threw: ${(e as Error)?.message ?? e}`,
        detail: '',
        ms: Date.now() - t0,
      }
    }
  })
  return { name: 'compliance', cases }
}

/* ------------------------------------------------------------------ */
/* Adjudication battery (6 cases)                                      */
/* ------------------------------------------------------------------ */

function pi(fields: Record<string, string | null>, conf = 0.9): OcrProviderResult['perImages'][number] {
  return {
    index: 0,
    text: Object.values(fields).filter(Boolean).join(' '),
    language: 'en',
    confidence: conf,
    fields,
    field_confidence: {},
    field_evidence: {},
    regions: [],
  }
}

function rep(provider: ReportOutcome['provider'], name: ReportOutcome['name'], fields: Record<string, string | null>): ReportOutcome {
  return {
    name,
    provider,
    ok: true,
    result: { provider, demo: false, perImages: [pi(fields)], engines: [provider], unclear: [] },
    error: null,
    latencyMs: 0,
  }
}

interface AdjCase {
  id: string
  label: string
  reports: ReportOutcome[]
  check: string
  expect: string
}

const ADJ_CASES: AdjCase[] = [
  {
    id: 'a-agree-noise',
    label: 'OCR noise agreement (REAL Bites! ≡ Real Bites, 200g ≡ 200 g)',
    reports: [
      rep('paddle', 'report_1', { brand: 'Real Bites!', mrp: 'Rs 120', net_quantity: '200g' }),
      rep('gemini', 'report_2', { brand: 'REAL Bites', mrp: '120', net_quantity: '200 g' }),
      rep('openrouter', 'report_3', { brand: 'Real Bites', mrp: '₹120.00', net_quantity: '200 G' }),
    ],
    check: 'brand',
    expect: 'VERIFIED',
  },
  {
    id: 'a-mrp-2v1',
    label: 'MRP majority (120, 120 vs 125) keeps majority, flagged',
    reports: [
      rep('paddle', 'report_1', { mrp: 'Rs 120' }),
      rep('gemini', 'report_2', { mrp: 'Rs 120' }),
      rep('openrouter', 'report_3', { mrp: 'Rs 125' }),
    ],
    check: 'mrp',
    expect: 'CONFLICT:Rs 120',
  },
  {
    id: 'a-decimal',
    label: 'Decimal trap (400g vs 40g) is a real conflict',
    reports: [
      rep('paddle', 'report_1', { net_quantity: '400 g' }),
      rep('gemini', 'report_2', { net_quantity: '40 g' }),
    ],
    check: 'net_quantity',
    expect: 'CONFLICT',
  },
  {
    id: 'a-single',
    label: 'Single source is never VERIFIED',
    reports: [rep('gemini', 'report_2', { brand: 'Real Bites', mrp: 'Rs 120' })],
    check: 'brand',
    expect: 'NEEDS_REVIEW',
  },
  {
    id: 'a-all-differ',
    label: 'Three-way disagreement stays in review',
    reports: [
      rep('paddle', 'report_1', { brand: 'Alpha' }),
      rep('gemini', 'report_2', { brand: 'Beta' }),
      rep('openrouter', 'report_3', { brand: 'Gamma' }),
    ],
    check: 'brand',
    expect: 'NEEDS_REVIEW',
  },
  {
    id: 'a-dates',
    label: 'Date variants agree by month (15/06/2027 ≡ 2027-06-15 ≡ 06/2027)',
    reports: [
      rep('paddle', 'report_1', { expiry_date: '15/06/2027' }),
      rep('gemini', 'report_2', { expiry_date: '2027-06-15' }),
      rep('openrouter', 'report_3', { expiry_date: '06/2027' }),
    ],
    check: 'expiry_date',
    expect: 'VERIFIED',
  },
]

function runAdjudicationBattery(): { name: string; cases: CaseResult[] } {
  const cases: CaseResult[] = ADJ_CASES.map((c) => {
    const t0 = Date.now()
    try {
      const out = adjudicateReports(c.reports)
      const f = out.verification.fields.find((x) => x.key === c.check)
      const got = f ? `${f.status}${c.expect.includes(':') ? `:${f.final_value}` : ''}` : 'MISSING'
      const pass = got === c.expect || (c.expect === 'CONFLICT' && f?.status === 'CONFLICT')
      return {
        id: c.id,
        label: c.label,
        pass,
        expected: c.expect,
        actual: got,
        detail: f?.reasoning ?? '',
        ms: Date.now() - t0,
      }
    } catch (e) {
      return {
        id: c.id,
        label: c.label,
        pass: false,
        expected: c.expect,
        actual: `threw: ${(e as Error)?.message ?? e}`,
        detail: '',
        ms: Date.now() - t0,
      }
    }
  })
  return { name: 'adjudication', cases }
}

/* ------------------------------------------------------------------ */
/* Public runner + route                                               */
/* ------------------------------------------------------------------ */

export interface EvaluationSummary {
  total: number
  passed: number
  failed: number
  ms: number
}

export function runEvaluation(): {
  summary: EvaluationSummary
  suites: Array<{ name: string; total: number; passed: number; failed: number; cases: CaseResult[] }>
} {
  const t0 = Date.now()
  const suites = [runComplianceBattery(), runAdjudicationBattery()].map((s) => ({
    ...s,
    total: s.cases.length,
    passed: s.cases.filter((c) => c.pass).length,
    failed: s.cases.filter((c) => !c.pass).length,
  }))
  const total = suites.reduce((n, s) => n + s.total, 0)
  const passed = suites.reduce((n, s) => n + s.passed, 0)
  return {
    summary: { total, passed, failed: total - passed, ms: Date.now() - t0 },
    suites,
  }
}

router.post('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json({ ok: true, ...runEvaluation() })
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: (e as Error)?.message ?? 'Evaluation failed.' })
  }
})

export default router
