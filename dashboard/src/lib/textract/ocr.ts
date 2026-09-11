/**
 * Per-region OCR passes with confidence capture.
 *
 * Each region is OCR'd in isolation (never the whole frame), so scores come
 * from the focused, high-resolution crop — this is the core accuracy fix for
 * small print and mixed multi-zone labels.
 */
import { BBox, OcPass } from './types'

export interface OcrLike {
  recognize(image: string): Promise<{ data?: { text?: string; confidence?: number } }>
  setParameters(p: Record<string, string | number>): Promise<unknown>
}

export interface CroppedPass {
  /** data URL of the crop that was OCR'd. */
  url: string
  label: string
}

/** Tesseract aggregate confidence (0..1); guard against NaN. */
export function conf01(c: number | undefined | null): number {
  if (c === undefined || c === null || !Number.isFinite(c)) return 0.5
  return Math.max(0.05, Math.min(1, c / 100))
}

export function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

export async function ocrCrop(
  worker: OcrLike,
  pass: CroppedPass,
  meta: { source: number; regionId: number | null; bbox: BBox | null; crop?: string | null },
): Promise<OcPass | null> {
  const { data } = await worker.recognize(pass.url)
  const text = cleanText(data?.text ?? '')
  const characters = text.replace(/\W/g, '').length
  if (characters === 0) return null
  return {
    text,
    source: meta.source,
    regionId: meta.regionId,
    bbox: meta.bbox,
    pass: pass.label,
    ocrConf: conf01(data?.confidence),
    crop: meta.crop ?? null,
  }
}

/**
 * Run several recognized variants of a crop. Results are ordered so the
 * pipeline can pick the best; near-duplicate empty passes are filtered out.
 */
export async function runRegionPasses(
  worker: OcrLike,
  passes: CroppedPass[],
  meta: { source: number; regionId: number | null; bbox: BBox | null; crop?: string | null },
): Promise<OcPass[]> {
  const out: OcPass[] = []
  for (const p of passes) {
    const r = await ocrCrop(worker, p, meta)
    if (r) out.push(r)
  }
  return out
}