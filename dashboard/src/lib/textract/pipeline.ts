/**
 * Textract pipeline orchestrator.
 *
 * Stages (per image, deterministic):
 *   1. quality gate          — skip hard-fail captures entirely
 *   2. text-region detection — blocks with bboxes (DBNet-analog)
 *   3. crop-from-original    — real pixels at real resolution per region
 *   4. de-skew               — when a region reads weakly
 *   5. per-region multi-pass OCR — chooses enhancers by region quality
 *   6. field consensus       — every field carries a list of Evidence records
 *   7. barcode cross-check   — VERIFY or hard-flag a disagreement
 *   8. debug payload         — surfaced when ?debug=1
 */
import type { OcrBlock } from '../types2'
import { extractAllFields, type ExtractResult } from './fields'
import { assessQuality, cropRegionFromOriginal, estimateSkewDegrees, renderVariant, renderRotated, rotateCrop, type VariantKind } from './image'
import { ocrCrop, type OcrLike, type CroppedPass } from './ocr'
import { detectRegions, type DetectorLike } from './regions'
import {
  TEXTRACT_VERSION,
  type BBox,
  type ConfidenceWeights,
  type OcPass,
  type PanelPrior,
  type QualityReport,
  type TexRegion,
} from './types'
import {
  crosscheckBarcode,
  normalizeBarcode,
  type BarcodeCrossCheckResult,
} from './crosscheck'

export interface PipelineInput {
  images: string[]
  hiResImages?: string[]
  lang: string
  productName?: string
  barcode?: string | null
  positions?: PanelPrior[]
  weights?: ConfidenceWeights
  maxRegionsPerImage?: number
  maxTotalPasses?: number
}

export interface PipelineDebugImage {
  source: number
  position: PanelPrior
  quality: QualityReport
  regions: Array<{
    bbox: BBox
    detectorConf: number
    passes: Array<{ pass: string; ocrConf: number; chars: number }>
    weakRead: boolean
    skewApplied: boolean
  }>
}

export interface PipelineDebug {
  version: string
  images: PipelineDebugImage[]
}

export interface PipelineOutput {
  passes: OcPass[]
  ocrBlocks: OcrBlock[]
  ocrText: string
  regions: Array<{ source: number; region: TexRegion; crop: string }>
  extraction: ExtractResult
  quality: Array<{ source: number; report: QualityReport }>
  debug: PipelineDebug
  resolvedBarcode: string | null
  barcodeCheck: BarcodeCrossCheckResult
  version: string
}

/* ------------------------------------------------------------------ */
/* Region pass planner                                                 */
/* ------------------------------------------------------------------ */

function planForRegion(region: TexRegion, quality: QualityReport): Array<{ kind: VariantKind; upscale: number; label: string }> {
  const size = region.bbox.y1 - region.bbox.y0
  const goodQuality = quality.meanLum >= 45 && quality.edgeEnergy >= 6
  const dark = quality.meanLum < 45
  // Tiny region (small print): 3× upscale + denoise beats 2× on codes/dates.
  if (size < 100 || region.detectorConf < 0.38) {
    if (dark) return [{ kind: 'brighten', upscale: 3, label: '3x-brighten' }, { kind: 'clahe', upscale: 3, label: '3x-clahe' }]
    return [{ kind: 'standard', upscale: 3, label: '3x-std' }, { kind: 'sharp', upscale: 3, label: '3x-sharp' }, { kind: 'denoise', upscale: 3, label: '3x-denoise' }]
  }
  if (dark) {
    return [{ kind: 'clahe', upscale: 1.5, label: 'clahe-1.5x' }, { kind: 'bin', upscale: 1.5, label: 'bin-1.5x' }, { kind: 'brighten', upscale: 1.5, label: 'brighten-1.5x' }]
  }
  if (size < 180 || region.detectorConf < 0.45) {
    return [{ kind: 'standard', upscale: 2, label: '2x-std' }, { kind: 'sharp', upscale: 2, label: '2x-sharp' }, { kind: 'denoise', upscale: 2, label: '2x-denoise' }]
  }
  if (goodQuality) {
    return [{ kind: 'standard', upscale: 2, label: '2x-std' }]
  }
  return [{ kind: 'standard', upscale: 2, label: '2x-std' }, { kind: 'sharp', upscale: 2, label: '2x-sharp' }]
}

const RESCUE_KEYWORDS = /\b(mrp|mfg|pkd|expiry|best before|net qty|manufactured|ingredients|fssai)\b/i

function getImageDimensions(url: string): Promise<[number, number]> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve([img.naturalWidth, img.naturalHeight])
    img.onerror = () => resolve([1, 1])
    img.src = url
  })
}

export async function runPipeline(
  worker: DetectorLike & OcrLike,
  input: PipelineInput,
): Promise<PipelineOutput> {
  const lang = input.lang ?? 'en'
  const maxRegions = input.maxRegionsPerImage ?? 6
  const maxPasses = input.maxTotalPasses ?? 24
  const positions: PanelPrior[] = input.positions ?? input.images.map((_, i) => (i === 0 ? 'front' : i === 1 ? 'back' : i === 2 ? 'side' : 'other'))
  const resolvedDetectedBarcode = normalizeBarcode(input.barcode)
  let totalPassCount = 0

  const cropSources = (input.hiResImages && input.hiResImages.length === input.images.length)
    ? input.hiResImages
    : input.images

  const qualityReports: Array<{ source: number; report: QualityReport }> = []
  const allPasses: OcPass[] = []
  const allOcrBlocks: OcrBlock[] = []
  const debugImages: PipelineDebugImage[] = []
  const allRegions: PipelineOutput['regions'] = []

  const detectedBlockHint = new Map<number, { region: string; conf: number }>()

  for (let i = 0; i < input.images.length; i++) {
    const analysisUrl = input.images[i]
    const report = await assessQuality(analysisUrl)
    qualityReports.push({ source: i, report })

    const pos = positions[i] ?? (i === 0 ? 'front' : i === 1 ? 'back' : i === 2 ? 'side' : 'other')
    const debugImage: PipelineDebugImage = { source: i, position: pos, quality: report, regions: [] }

    if (!report.pass) {
      // Hard-fail: do not OCR at all — any read is statistically likely wrong.
      debugImages.push(debugImage)
      continue
    }

    // Detect regions on the analysis-res image (cheap); crop from original-hiRes.
    const detectionSrc = analysisUrl
    const cropSrc = cropSources[i]
    const { regions } = await detectRegions(worker, detectionSrc, i, maxRegions)

    // Region coordinates are in detectionSrc space; scale once to cropSrc space
    // (both are data URLs with preserved aspect ratio).
    const [detW, detH] = await getImageDimensions(detectionSrc)
    const [cropW, cropH] = await getImageDimensions(cropSrc)
    const scaleX = cropW / Math.max(1, detW)
    const scaleY = cropH / Math.max(1, detH)

    for (const region of regions) {
      const scaledBBox: BBox = {
        x0: region.bbox.x0 * scaleX,
        y0: region.bbox.y0 * scaleY,
        x1: region.bbox.x1 * scaleX,
        y1: region.bbox.y1 * scaleY,
      }
      const { url: cropUrl } = await cropRegionFromOriginal(cropSrc, scaledBBox, 0.06, 1)
      const regionCropUrl = cropUrl

      if (!detectedBlockHint.has(i)) detectedBlockHint.set(i, { region: region.text ?? '', conf: region.detectorConf })

      // Minimal deskew for weak-read regions (word count < 15, only wide regions)
      const regionH = region.bbox.y1 - region.bbox.y0
      const regionW = region.bbox.x1 - region.bbox.x0
      let finalUrl = cropUrl
      let skewApplied = false
      if (regionW > 120 && regionH > 50) {
        const angle = await estimateSkewDegrees(cropUrl, 280)
        if (Math.abs(angle) >= 1) { finalUrl = await rotateCrop(cropUrl, angle); skewApplied = true }
      }

      const plan = planForRegion(region, report)
      const passesForRegion: CroppedPass[] = []
      for (const entry of plan) {
        if (totalPassCount >= maxPasses) break
        const vUrl = await renderVariant(finalUrl, entry.kind, entry.upscale)
        passesForRegion.push({ url: vUrl, label: `${entry.label}-r${region.id}` })
        totalPassCount++
      }

      let regionPasses: OcPass[] = []
      for (const cp of passesForRegion) {
        const result = await ocrCrop(worker, cp, { source: i, regionId: region.id, bbox: scaledBBox, crop: regionCropUrl })
        if (result) regionPasses.push(result)
      }

      debugImage.regions.push({
        bbox: region.bbox,
        detectorConf: region.detectorConf,
        passes: regionPasses.map((rp) => ({ pass: rp.pass, ocrConf: rp.ocrConf, chars: rp.text.length })),
        weakRead: regionPasses.every((rp) => rp.text.length < 20),
        skewApplied,
      })

      allPasses.push(...regionPasses)
      allOcrBlocks.push({ position: pos, text: regionPasses.map((rp) => rp.text).join('\n'), languages: [lang] })
      allRegions.push({ source: i, region, crop: cropUrl })
    }

    // Whole-image rescue: only when regions failed to produce usable text.
    const regionChars = allPasses.filter((p) => p.source === i).reduce((s, p) => s + p.text.length, 0)
    const regionKeywordHits = allPasses.filter((p) => p.source === i).some((p) => RESCUE_KEYWORDS.test(p.text))
    if ((regionChars < 80 || !regionKeywordHits) && totalPassCount < maxPasses) {
      const rescueVariants = [
        { kind: 'standard' as VariantKind, upscale: 2, label: 'full-2x-std' },
        { kind: 'color' as VariantKind, upscale: 2, label: 'full-2x-color' },
        { kind: 'denoise' as VariantKind, upscale: 2, label: 'full-2x-denoise' },
      ]
      for (const rv of rescueVariants) {
        if (totalPassCount >= maxPasses) break
        const vUrl = await renderVariant(analysisUrl, rv.kind, rv.upscale)
        const fullCrop: CroppedPass = { url: vUrl, label: rv.label }
        const result = await ocrCrop(worker, fullCrop, { source: i, regionId: null, bbox: null })
        if (result) {
          allPasses.push(result)
          allOcrBlocks.push({ position: pos, text: result.text, languages: [lang] })
        }
        totalPassCount++
      }
      // Rotation rescue on full frame (only if still weak).
      const postRescueChars = allPasses.filter((p) => p.source === i).reduce((s, p) => s + p.text.length, 0)
      if (postRescueChars < 80 && totalPassCount < maxPasses) {
        for (const deg of [180, 90, 270] as const) {
          if (totalPassCount >= maxPasses) break
          const rotUrl = await renderRotated(analysisUrl, deg)
          const vUrl = await renderVariant(rotUrl, 'standard', 1)
          const rotCrop: CroppedPass = { url: vUrl, label: `full-rot${deg}` }
          const result = await ocrCrop(worker, rotCrop, { source: i, regionId: null, bbox: null })
          if (result) {
            allPasses.push(result)
            allOcrBlocks.push({ position: pos, text: result.text, languages: [lang] })
          }
          totalPassCount++
        }
      }
    }

    debugImages.push(debugImage)
  }

  const extraction = extractAllFields(allPasses, {
    productName: input.productName,
    imageQuality: qualityReports.length > 0 ? qualityReports.filter((q) => q.report.pass).length / qualityReports.length : 0.5,
    positions,
    weights: input.weights,
  })

  const allOcrTexts = allPasses.map((p) => p.text)
  const barcodeCheck = crosscheckBarcode(resolvedDetectedBarcode, allOcrTexts)

  if (barcodeCheck.agree) {
    extraction.fields.barcode = {
      value: barcodeCheck.detected,
      status: 'VERIFIED',
      confidence: 1,
      legacyConfidence: 'high',
      source_image: 0,
      evidence: [{ source_image: 0, bbox: null, region_text: 'barcode-detected', pass: 'barcode-crosscheck', ocr_conf: 1, value: barcodeCheck.detected!, crop: null }],
      votes: 1,
      conflict: false,
    }
  } else if (barcodeCheck.fromOcr && barcodeCheck.needsReview) {
    extraction.fields.barcode = {
      value: barcodeCheck.fromOcr,
      status: 'NEEDS_REVIEW',
      confidence: 0.5,
      legacyConfidence: 'low',
      source_image: 0,
      evidence: [{ source_image: 0, bbox: null, region_text: 'barcode-digits-ocr-only', pass: 'barcode-crosscheck', ocr_conf: 0.5, value: barcodeCheck.fromOcr, crop: null }],
      votes: 1,
      conflict: true,
    }
  }

  // Fallback on zero passes.
  if (allPasses.length === 0) {
    throw new Error('No readable text detected on the label — hold the camera steady, add light and retake.')
  }

  return {
    passes: allPasses,
    ocrBlocks: allOcrBlocks,
    ocrText: allPasses.map((p) => p.text).join('\n'),
    regions: allRegions,
    extraction,
    quality: qualityReports,
    debug: { version: TEXTRACT_VERSION, images: debugImages },
    resolvedBarcode: barcodeCheck.detected ?? barcodeCheck.fromOcr ?? null,
    barcodeCheck,
    version: TEXTRACT_VERSION,
  }
}