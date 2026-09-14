/* PART 2 domain types (mirror the Supabase schema fields) */

export type ScanStatus = 'pending_review' | 'analyzed' | 'flagged' | 'manual_review' | 'resolved'

/** Which processing engine actually produced this scan (detected at runtime). */
export type ScanEngine = 'cloud_function' | 'gemini' | 'local' | 'fast' | 'queued' | 'unknown'
export type RiskBand = 'Low' | 'Medium' | 'High' | 'Critical'
export type Severity = 'low' | 'medium' | 'high' | 'critical'
export type ViolationStatus =
  | 'Detected'
  | 'Reviewing'
  | 'Investigating'
  | 'Resolved'
  | 'Escalated'
  | 'Rejected'
export type ReportStatus = 'Pending' | 'Reviewing' | 'Investigating' | 'Resolved' | 'Rejected'
export type Priority = 'Low' | 'Medium' | 'High' | 'Critical'

export type RuleStatus =
  | 'PASS'
  | 'FAIL'
  | 'WARNING'
  | 'NOT_DETECTED'
  | 'NOT_VERIFIABLE'
  | 'REQUIRES_PHYSICAL_INSPECTION'
  | 'NOT_APPLICABLE'

export interface RuleEvidence {
  source_image: number | null
  ocr_text: string
  image_url?: string | null
}

/** New engine schema (v2). Old scans may still use field/extracted_text/issue. */
export interface RuleCheck {
  rule_id: string
  field: string
  statement?: string
  requirement?: string
  status: RuleStatus
  extracted_text?: string
  issue?: string
  reason?: string
  weight?: number
  verification_type?: 'IMAGE_VERIFIABLE' | 'PHYSICAL_INSPECTION' | 'DATABASE' | 'NOT_VERIFIABLE'
  detected_value?: string | null
  evidence?: RuleEvidence
}

export interface EvidenceLink {
  rule_id: string
  requirement: string
  status: RuleStatus
  detected_value: string | null
  source_image: number | null
  ocr_text: string
}

export interface ScanContext {
  package_type: string
  origin: string
  is_food: boolean
  sold_by: string
  special_commodity?: string | null
  exemptions?: string[]
  reason: string
}

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

export interface DetectedSummary {
  passed: number
  failed: number
  warnings: number
  not_verifiable: number
  not_applicable: number
  missing: number
  uncertain: number
}

export interface AIIinsight {
  rule_id: string
  field: string
  status: string
  issue: string
}

export interface DetectedLabel {
  label: string
  verdict: string
  score: number
}

export interface OcrExtract {
  text: string
  languages: string[]
}

/**
 * Structured declarations the AI extracts from a package label.
 * Mirrors the extractions object returned by the Gemini `scanAnalysis` function.
 */
export interface ExtractedDeclarations {
  mrp?: string
  net_quantity?: string
  manufacturer?: string
  packer?: string
  importer?: string
  country_of_origin?: string
  mfg_date?: string
  best_before?: string
  consumer_care?: string
  lot_no?: string
  commodity_name?: string
  address?: string
  unit_sale_price?: string
}

export interface ProductRow {
  id: string
  barcode: string
  name: string
  brand: string
  manufacturer: string
  category: string
  net_quantity: string
  mrp: string
  consumer_care: string
  country_of_origin: string
  best_before_label: string
  created_at: string
  updated_at: string
}

export interface InspectorAssistant {
  summary: string
  suggestions: string[]
}

export interface ManualResult {
  score: number
  verified_by: string | null
  verified_at: string
  corrections: Record<string, string>
  notes: string
}

export interface OcrBlock {
  position: string
  text: string
  languages: string[]
}

export interface ExtractedField {
  value: string | null
  confidence: 'high' | 'medium' | 'low' | null
  source_image: number | null
  /** Textract v2: fine-grained read status (single value -> VERIFIED..MISSING). */
  status?: 'VERIFIED' | 'HIGH_CONFIDENCE' | 'MEDIUM_CONFIDENCE' | 'LOW_CONFIDENCE' | 'NEEDS_REVIEW' | 'MISSING' | 'INVALID' | 'USER_CORRECTED'
  /** Textract v2: blended multi-signal confidence 0..1. */
  confidence_score?: number
  conflict?: boolean
  votes?: number
  /** Textract v2: per-field evidence (where each value was read from). */
  evidence?: Array<{
    source_image: number
    bbox: { x0: number; y0: number; x1: number; y1: number } | null
    region_text: string
    pass: string
    ocr_conf: number
    value: string
    crop: string | null
  }>
  /** Adaptive evidence layer: pre-correction value kept when the user amends a field. */
  original_value?: string
  /** Adaptive evidence layer: verification outcome surfaced in the result UI. */
  verification?: 'verified' | 'needs_verification' | 'user_corrected'
}

/** Adaptive evidence layer — per-field verification outcome (trust/evidence). */
export interface FieldVerification {
  verified: boolean
  needsVerification: boolean
  via: 'direct' | 'cross_image' | 'targeted_re_scan'
  confidence_score: number
  ocrConfidence: number | null
  before: string | null
  after: string | null
  evidence: Array<{
    source_image: number
    region: [number, number, number, number] | null
    region_text: string
    pass: string
    ocr_conf: number | null
    value: string
  }>
}

export interface TrustBreakdown {
  ocr_confidence: number
  character_verification: number
  image_quality: number
  cross_image_agreement: number
  verification_rate: number
}

/** Adaptive evidence layer — scan-level verification summary. */
export interface AdaptiveVerificationSummary {
  verification: Record<string, FieldVerification>
  trust: { score: number; breakdown: TrustBreakdown }
  conflicts: Array<{ field: string; values: string[]; images: number[]; explanation: string }>
  uncertain: string[]
  scanned_regions: number
  processing: { initial_ocr_ms: number; verification_ms: number; total_ms: number }
}

export interface ScanRow {
  id: string
  created_at: string
  user_id: string | null
  product_name: string
  brand: string
  manufacturer: string
  category: string
  barcode: string
  overall_score: number
  verdict: string
  summary: string
  image_url: string
  rules: RuleCheck[]
  risk_score: number
  status: ScanStatus
  ocr_text: string
  ai_insights: AIIinsight[]
  image_urls?: string[]
  labels?: DetectedLabel[]
  ocr?: OcrExtract
  ocr_blocks?: OcrBlock[]
  assistant?: InspectorAssistant
  language_note?: string
  extractions?: ExtractedDeclarations
  extraction_fields?: Record<string, ExtractedField>
  detected?: DetectedSummary
  counts?: StatusCounts
  context?: ScanContext
  evidence_chain?: EvidenceLink[]
  uncertain?: string[]
  barcode_check?: { detected: string | null; from_ocr: string | null; agree: boolean; needs_review: boolean }
  pipeline_debug?: unknown
  /** Adaptive evidence layer — verification of individual extracted fields. */
  verification?: Record<string, FieldVerification>
  trust_score?: number
  trust_breakdown?: TrustBreakdown
  processing?: { initial_ocr_ms: number; verification_ms: number; total_ms: number }
  uncertain_regions?: number
  /** Missed-text-region detection (#9): candidate gaps auto-OCRed. */
  missed_regions?: { checked: number; found: number } | null
  manual_result: ManualResult | null
  notes: string
  latitude: number | null
  longitude: number | null
  location_name: string
  language: string
  /** Processing engine that produced this scan — set by the pipeline, never hardcoded. */
  engine?: ScanEngine
}

export interface ViolationRow {
  id: string
  created_at: string
  updated_at: string
  scan_id: string | null
  product_name: string
  manufacturer: string
  category: string
  type: string
  severity: Severity
  status: ViolationStatus
  description: string
  created_by: string | null
  resolved_by: string | null
  resolved_at: string | null
}

export interface ReportRow {
  id: string
  created_at: string
  updated_at: string
  user_id: string | null
  scan_id: string | null
  title: string
  description: string
  product_name: string
  manufacturer: string
  category: string
  severity: Severity
  priority: Priority
  status: ReportStatus
  assigned_to: string | null
  assigned_at: string | null
  resolved_by: string | null
  resolved_at: string | null
}

export interface NotificationRow {
  id: string
  created_at: string
  user_id: string
  type: string
  title: string
  body: string
  link: string
  read: boolean
  read_at: string | null
  data: Record<string, unknown>
}

export interface InspectionReviewRow {
  id: string
  created_at: string
  scan_id: string
  admin_id: string | null
  ai_score: number
  manual_score: number
  corrections: Record<string, string>
  violations_added: Array<Record<string, string>>
  violations_removed: Array<Record<string, string>>
  notes: string
}

export interface ActivityLogRow {
  id: string
  created_at: string
  user_id: string | null
  actor_id: string | null
  actor_name: string
  action: string
  target_type: string
  target_id: string
  details: Record<string, unknown>
}

export interface ComplianceRuleRow {
  id: string
  created_at: string
  updated_at: string
  rule_key: string
  title: string
  description: string
  category: string
  severity: Severity
  required: boolean
  status: 'active' | 'disabled' | 'draft'
  is_active: boolean
  created_by: string | null
}

export interface AdminRequestRow {
  id: string
  user_id: string
  created_at: string
  full_name: string
  email: string
  organization: string
  status: string
  reviewed_by: string | null
  reviewed_at: string | null
}

export interface ProfileAdminRow {
  id: string
  full_name: string
  organization: string
  role: string
  status: string
  created_at: string
  last_login: string | null
}

export interface ProfileUserRow extends ProfileAdminRow {}