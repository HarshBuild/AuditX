/**
 * Textract — the on-device extraction pipeline (accuracy path).
 *
 * Stages:   quality gate → text-region detection → crop-from-ORIGINAL →
 *           adaptive multi-pass OCR → field consensus with per-field evidence
 *           → barcode ⇄ OCR-digits cross-check.
 *
 * Every field value produced here is traceable: image → region (bbox) →
 * OCR pass → value. This module is DOM-free (pure types/config).
 */

/** Pixel corners of a detected text region, in the ORIGINAL image space. */
export interface BBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** One detected text region on one source image. */
export interface TexRegion {
  id: number
  source: number
  bbox: BBox
  /** Layout-analysis confidence from the detector (0..1), if available. */
  detectorConf: number
  /** Short detected text hint (may be empty if detect() was unreliable). */
  text?: string
}

/** One OCR pass over one region: the source of every extraction match. */
export interface OcPass {
  text: string
  source: number
  regionId: number | null
  /** bbox of the region (or whole image) this pass covered. */
  bbox: BBox | null
  pass: string
  /** Mean Tesseract word confidence of this pass (0..1). */
  ocrConf: number
  /** Small crop of the region this pass read (browser-only, best-effort). */
  crop?: string | null
}

/** Per-field evidence: where the value was read from. */
export interface FieldEvidence {
  source_image: number
  bbox: BBox | null
  region_text: string
  pass: string
  ocr_conf: number
  value: string
  /** Small crop of the region (browser-only, best-effort). */
  crop: string | null
}

export type FieldStatus =
  | 'VERIFIED'
  | 'HIGH_CONFIDENCE'
  | 'MEDIUM_CONFIDENCE'
  | 'LOW_CONFIDENCE'
  | 'NEEDS_REVIEW'
  | 'MISSING'
  | 'INVALID'

export interface TexField {
  value: string | null
  status: FieldStatus
  /** Blended 0..1 confidence (multi-signal). */
  confidence: number
  /** Back-compatible coarse confidence for older UI/engine. */
  legacyConfidence: 'high' | 'medium' | 'low' | null
  source_image: number | null
  evidence: FieldEvidence[]
  votes: number
  conflict: boolean
}

/** Configurable confidence blend weights. Sum = 1. */
export interface ConfidenceWeights {
  voteShare: number
  ocrConf: number
  sourceCoverage: number
  detectorConf: number
  imageQuality: number
  positionPrior: number
  validation: number
}

export const DEFAULT_WEIGHTS: ConfidenceWeights = {
  voteShare: 0.3,
  ocrConf: 0.26,
  sourceCoverage: 0.18,
  detectorConf: 0.06,
  imageQuality: 0.08,
  positionPrior: 0.06,
  validation: 0.06,
}

/** Hard quality-gate report for one image. */
export interface QualityReport {
  pass: boolean
  meanLum: number
  contrast: number
  edgeEnergy: number
  textHeightPx: number
  warnings: string[]
}

/** Per-panel prior: which fields a label panel MOST plausibly carries. */
export type PanelPrior = 'front' | 'back' | 'side' | 'other'

/** OCR-level version tag, surfaced in debug output. */
export const TEXTRACT_VERSION = 'pipeline-v2'