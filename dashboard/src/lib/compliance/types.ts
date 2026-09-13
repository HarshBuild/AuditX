/**
 * Shared types for the Legal Metrology compliance engine.
 *
 * Source: The Legal Metrology (Packaged Commodities) Rules, 2011.
 * This is a deterministic engine — the LLM is never allowed to produce
 * statuses, verdicts or legal conclusions.
 */

export type RuleStatus =
  | 'PASS'
  | 'FAIL'
  | 'WARNING'
  | 'NOT_DETECTED'
  | 'NOT_VERIFIABLE'
  | 'REQUIRES_PHYSICAL_INSPECTION'
  | 'NOT_APPLICABLE'

export type VerificationType = 'IMAGE_VERIFIABLE' | 'PHYSICAL_INSPECTION' | 'DATABASE' | 'NOT_VERIFIABLE'

export interface RuleEvidence {
  source_image: number | null
  ocr_text: string | null
}

/**
 * One evaluated rule — the canonical per-rule result schema.
 * Every PASS/FAIL/WARNING is traceable: Image -> OCR text -> extracted field -> rule -> status.
 */
export interface RuleCheck {
  rule_id: string
  requirement: string
  status: RuleStatus
  detected_value: string | null
  reason: string
  evidence: RuleEvidence
  verification_type: VerificationType
  weight: number
}

/** Aggregated status counts for the summary chips. */
export interface StatusCounts {
  passed: number
  failed: number
  warnings: number
  not_detected: number
  not_verifiable: number
  requires_physical_inspection: number
  not_applicable: number
  uncertain: number
}

export type FinalVerdict = 'COMPLIANT' | 'PARTIALLY_COMPLIANT' | 'NON_COMPLIANT' | 'REQUIRES_PHYSICAL_INSPECTION'

export interface ComplianceSummary {
  overall_score: number
  verdict: FinalVerdict
  risk_score: number
  counts: StatusCounts
  /** Backwards-compatible summary counts (used by older frontend chips). */
  detected: { passed: number; failed: number; warnings: number; not_verifiable: number; not_applicable: number; missing: number; uncertain: number }
  ai_insights: Array<{ rule_id: string; field: string; status: string; issue: string }>
  passed: string[]
  failed: string[]
  warnings: string[]
  requires_physical_inspection: string[]
  evidence_chain: Array<{ rule_id: string; requirement: string; status: string; detected_value: string | null; source_image: number | null; ocr_text: string | null }>
}

/**
 * Extracted (verbatim-only) label fields — the ONLY thing the LLM produces.
 *
 * Beyond the mandatory Legal Metrology declarations, the pipeline also pulls
 * maximum useful product detail off the label (model/codes, electrical specs,
 * dimensions, material, contact web/email, certifications, warnings and
 * instructions). Every value here is EXACT text as printed — never guessed.
 */
export interface Extractions {
  commodity_name: string | null
  mrp: string | null
  net_quantity: string | null
  unit_sale_price: string | null
  manufacturer: string | null
  packer: string | null
  importer: string | null
  address: string | null
  country_of_origin: string | null
  mfg_date: string | null
  best_before: string | null
  consumer_care: string | null
  lot_no: string | null
  fssai_license: string | null
  veg_nonveg: string | null
  nutrition_info: string | null
  ingredients: string | null
  allergens: string | null
  model: string | null
  serial_number: string | null
  material: string | null
  dimensions: string | null
  capacity: string | null
  voltage: string | null
  power: string | null
  current: string | null
  frequency: string | null
  website: string | null
  email: string | null
  certifications: string | null
  warnings: string | null
  instructions: string | null
}

export interface ExtractedField {
  value: string | null
  confidence: 'high' | 'medium' | 'low' | null
  source_image: number | null
}

export interface LabelCheck {
  label: string
  label_text: string
}

export interface EngineInputs {
  ex: Extractions
  fields: Record<string, ExtractedField>
  ocrText: string
  ocrBlocks: Array<{ position: string; text: string; languages: string[] }>
  uncertain: string[]
  barcode: string | null
  languages: string[]
  labels: LabelCheck[]
  userCategory: string | null
  userProductName: string | null
  /** Combined label text built from commodity name + user category (context hint). */
  productLabelText?: string
  isAdvertisement?: boolean
}

export const EXTRACTION_KEYS: (keyof Extractions)[] = [
  'commodity_name', 'mrp', 'net_quantity', 'unit_sale_price', 'manufacturer', 'packer',
  'importer', 'address', 'country_of_origin', 'mfg_date', 'best_before', 'consumer_care',
  'lot_no', 'fssai_license', 'veg_nonveg', 'nutrition_info', 'ingredients', 'allergens',
  'model', 'serial_number', 'material', 'dimensions', 'capacity', 'voltage', 'power',
  'current', 'frequency', 'website', 'email', 'certifications', 'warnings', 'instructions',
]

/** Categories that are food/beverage (carry food-specific label obligations). */
export const FOOD_CATEGORIES = ['Food', 'Beverage']

/** Whether the extraction stage produced usable data. */
export type ExtractionStatus = 'ok' | 'failed'