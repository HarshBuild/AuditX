/**
 * MISA-style inspection contracts shared by the analysis pipeline, the
 * Express routes and (in mirror form) the dashboard.
 *
 * Top-level scan doc (collection `scans/{id}`):
 *   user_id, product_name, brand, manufacturer, category, barcode, notes,
 *   photo_path / photo_paths (storage paths, NOT urls),
 *   status ('needs_review' while pending → 'compliant' | 'needs_review' |
 *            'violation' | 'critical'),
 *   ocr_status ('pending' | 'processing' | 'done' | 'failed'),
 *   ocr_error, ocr_text, ocr_language, ocr_provider, ocr_confidence,
 *   ocr_regions, ocr_fields, field_sources, field_confidence, field_evidence,
 *   conflicts, compliance_findings, compliance_score,
 *   previous_scan_id, match_confidence, changes, changes_verified,
 *   briefing, remarks, analyzed_at, created_at, updated_at,
 *   legacy mirrors: overall_score, verdict, risk_score, summary,
 *   image_url / image_urls (= the storage paths).
 */

export type InspectionCategory = 'edible' | 'non_edible' | null

/** Top-level inspection status (also used per-compliance). */
export type InspectionStatus =
  | 'needs_review' // pending OR compliance tier
  | 'compliant'
  | 'violation'
  | 'critical'

export type OcrStatus = 'pending' | 'processing' | 'done' | 'failed'

export type FindingStatus =
  | 'compliant'
  | 'needs_review'
  | 'failed'
  | 'critical_failed'
  | 'na'

export type OcrConfidence = 'high' | 'medium' | 'low'

export interface OcrField {
  value?: string | null
  confidence?: OcrConfidence
  source?: string | null
}

/** Extractable label fields (MISA OcrFields). */
export interface OcrFields {
  commodity_name?: string
  brand?: string
  manufacturer?: string
  net_quantity?: string
  mrp?: string
  batch_no?: string
  mfg_date?: string
  expiry_date?: string
  best_before_date?: string
  ingredients_text?: string
  allergen_info?: string
  required_declarations?: string
  warnings?: string
  certification_details?: string
  contact_info?: string
  imported_manufacturer_detail?: string
  country_of_origin?: string
  storage_conditions?: string
  customer_care_details?: string
}

/** Evidence for one merged field value (image is 1-based photo index). */
export interface FieldSource {
  image: number
  text: string
  confidence?: number | null
  bbox?: number[] | null
}

export interface MisaConflict {
  field: string
  label: string
  values: Array<{ image: number; value: string }>
}

export interface Finding {
  rule_id: string
  category: InspectionCategory
  field: string
  label: string
  requirement: string
  status: FindingStatus
  detected_value: string | null
  explanation: string | null
  hint: string | null
}

export interface ComplianceCounts {
  passed: number
  review: number
  failed: number
  criticalFailed: number
  na: number
}

export interface ComplianceResult {
  overall_score: number
  status: InspectionStatus
  verdict: string
  risk: string
  summary: string
  findings: Finding[]
  counts: ComplianceCounts
}

export interface Change {
  field: string
  label: string
  previous: string
  current: string
  kind: 'added' | 'removed' | 'changed' | 'same'
}

export type AssistantStatus = 'demo' | 'ok' | 'skipped'

export interface Briefing {
  purpose: string
  summary: string
  key_points: string[]
  recommendations: string[]
  assistant_status: AssistantStatus
  provider: string
}

/** One photo's independent extraction (provider output before merge). */
export interface PerImageExtract {
  index: number
  text: string
  language: string
  confidence: number
  fields: Record<string, string | null>
  field_confidence: Record<string, OcrConfidence>
  field_evidence: Record<string, { text: string; confidence?: number | null; bbox?: number[] | null }>
  regions: Array<{ text: string; bbox?: number[] | null; conf?: number | null }>
}

export interface MergedFields {
  fields: Record<string, string>
  sources: Record<string, number>
  field_confidence: Record<string, OcrConfidence>
  field_evidence: Record<string, FieldSource>
  conflicts: MisaConflict[]
  text: string
  language: string
  regions: Array<{ text: string; bbox?: number[] | null; conf?: number | null; image: number }>
}

export interface OcrProviderResult {
  provider: string
  demo: boolean
  perImages: PerImageExtract[]
  engines?: string[]
  unclear?: string[]
}

/* ------------------------------------------------------------------ */
/* Multi-AI Evidence Verification & Adjudication                        */
/*                                                                     */
/* Up to 3 independent reports (Report 1 = Paddle/fast OCR, Report 2 = */
/* Gemini Vision, Report 3 = OpenRouter Vision) are compared           */
/* field-by-field into ONE adjudicated result. All types are explicit  */
/* so every decision is typed, stored and reproducible.                */
/* ------------------------------------------------------------------ */

export type AdjudicationStatus =
  | 'VERIFIED'
  | 'NEEDS_REVIEW'
  | 'CONFLICT'
  | 'NOT_DETECTED'
  | 'LOW_CONFIDENCE'

/** One report's vote for one field. */
export interface ReportFieldVote {
  /** 'report_1' | 'report_2' | 'report_3' */
  report: string
  /** 'paddle' | 'gemini' | 'openrouter' | 'mock' */
  provider: string
  value: string | null
  normalized: string | null
  /** 0..1 confidence as reported by the model (null when unknown). */
  confidence: number | null
}

/** Final adjudicated outcome for one label field. */
export interface AdjudicatedField {
  key: string
  label: string
  final_value: string | null
  status: AdjudicationStatus
  /** 0..1 evidence-based confidence (never just the model's number). */
  confidence: number
  supporting_reports: string[]
  conflicting_reports: string[]
  votes: ReportFieldVote[]
  /** Max pairwise similarity 0..1 when 2+ reports voted, else null. */
  similarity: number | null
  evidence_text: string | null
  evidence_bbox: number[] | null
  evidence_image: number | null
  verification_method: string
  reasoning: string
  /** True when canonical numbers differ by an exact factor of 10. */
  decimal_conflict: boolean
}

/** One verification report's health. */
export interface VerificationReportInfo {
  /** 'report_1' | 'report_2' | 'report_3' */
  name: string
  provider: string
  ok: boolean
  engines: string[]
  confidence: number | null
  error?: string | null
}

export interface VerificationCounts {
  verified: number
  needs_review: number
  conflict: number
  low_confidence: number
  not_detected: number
  resolved: number
  disagreements: number
  total: number
}

export interface VerificationSummary {
  single_source: boolean
  single_source_note: string | null
  /** 0..100 evidence-based trust score for the whole verification. */
  trust_score: number
  reports: VerificationReportInfo[]
  fields: AdjudicatedField[]
  counts: VerificationCounts
  adjudicated_at: string
}

/** Photo input accepted by the pipeline (data URL or storage path). */
export interface PhotoInput {
  data?: string
  path?: string
  name?: string
}

/** Hints the inspector typed for the product (also serve the demo provider). */
export interface InspectorHints {
  product_name?: string
  brand?: string
  manufacturer?: string
  barcode?: string
}

export interface AnalysisInput {
  uid: string
  photos: PhotoInput[]
  category: InspectionCategory
  lang?: string
  hints?: InspectorHints
  previousScanId?: string | null
}

export interface AnalysisResult {
  product_name: string
  brand: string
  manufacturer: string
  category: InspectionCategory
  barcode: string
  ocr_text: string
  ocr_status: OcrStatus
  ocr_error: string | null
  ocr_language: string
  ocr_provider: string
  ocr_confidence: number
  ocr_regions: unknown[]
  ocr_fields: Record<string, string | null>
  ocr_engines?: string[]
  unclear_text?: string[]
  /** Multi-AI verification & adjudication (null only for legacy docs). */
  verification: VerificationSummary | null
  field_sources: Record<string, FieldSource[]>
  field_confidence: Record<string, OcrConfidence>
  field_evidence: Record<string, FieldSource>
  conflicts: MisaConflict[]
  compliance_findings: Finding[]
  compliance_score: number
  compliance_status: InspectionStatus
  compliance_display: { verdict: string; risk: string; summary: string; counts: ComplianceCounts }
  previous_scan_id: string | null
  match_confidence: 'same_product' | 'same_barcode' | null
  changes: Change[]
  changes_verified: boolean
  briefing: Briefing
  status: InspectionStatus
  summary: string
  analyzed_at: string
}