/**
 * Text-region detection — the browser analog of DBNet/CRAFT layout analysis.
 *
 * Uses Tesseract's built-in layout analysis (`worker.detect()`), which splits
 * the image into BLOCKS with bounding boxes. Cropping each block back out of the
 * ORIGINAL image and OCRing it individually is what fixes the whole-image
 * problems: small text gets real resolution, and each field can be traced to
 * the exact bbox it was read from.
 *
 * Defensive: if detect() is unavailable or returns nothing readable, we fall
 * back to a single full-image region so the pipeline never dead-ends.
 */
import { BBox, TexRegion } from './types'

export interface DetectorLike {
  detect(image: string): Promise<{ data?: unknown }>
}

export interface DetectResult {
  regions: TexRegion[]
  /** true when we fell back to the whole image (no usable blocks). */
  fellBack: boolean
}

const MIN_BOX_AREA = 8

export function fullImageRegion(source: number, w: number, h: number): TexRegion {
  return {
    id: -1,
    source,
    bbox: { x0: 0, y0: 0, x1: w, y1: h },
    detectorConf: 0.5,
  }
}

/** Merge tiny/nearby blocks that belong to the same text cluster. */
export function mergeRegions(regions: TexRegion[]): TexRegion[] {
  if (regions.length <= 1) return regions
  const sorted = regions.slice().sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0)
  const merged: TexRegion[] = []
  for (const r of sorted) {
    const last = merged[merged.length - 1]
    if (
      last &&
      r.bbox.y0 <= last.bbox.y1 + 4 &&
      Math.max(r.bbox.y1, last.bbox.y1) - Math.min(r.bbox.y0, last.bbox.y0) <
        Math.max(r.bbox.y1 - r.bbox.y0, last.bbox.y1 - last.bbox.y0) * 1.5 + 8
    ) {
      last.bbox.x1 = Math.max(last.bbox.x1, r.bbox.x1)
      last.bbox.y1 = Math.max(last.bbox.y1, r.bbox.y1)
      last.bbox.x0 = Math.min(last.bbox.x0, r.bbox.x0)
      last.bbox.y0 = Math.min(last.bbox.y0, r.bbox.y0)
      last.detectorConf = Math.max(last.detectorConf, r.detectorConf)
      last.text = last.text ? `${last.text}\n${r.text ?? ''}` : r.text
    } else {
      merged.push({ ...r })
    }
  }
  return merged
}

/**
 * Run layout analysis on an image and return the text regions.
 * Coordinates are returned in the image's own pixel space.
 */
export async function detectRegions(
  worker: DetectorLike,
  imageUrl: string,
  source: number,
  maxRegions = 6,
): Promise<DetectResult> {
  try {
    const res = await worker.detect(imageUrl)
    const data = res?.data as
      | { blocks?: Array<{ text?: string; confidence?: number; bbox?: BBox }> }
      | undefined
    const blocks = data?.blocks
    if (!blocks || blocks.length === 0) {
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('image decode failed'))
        img.src = imageUrl
      })
      return { regions: [fullImageRegion(source, img.width, img.height)], fellBack: true }
    }
    const dropped: number[] = []
    let regions: TexRegion[] = blocks
      .map((b, i) => {
        const bb = b?.bbox
        if (!bb || !Number.isFinite(bb.x0)) { dropped.push(i); return null }
        const area = Math.max(1, bb.x1 - bb.x0) * Math.max(1, bb.y1 - bb.y0)
        if (area < MIN_BOX_AREA) { dropped.push(i); return null }
        return {
          id: i,
          source,
          bbox: bb,
          detectorConf: Math.max(0.05, Math.min(1, (b?.confidence ?? 50) / 100)),
          text: b?.text ?? '',
        } as TexRegion
      })
      .filter((r): r is TexRegion => r !== null)

    regions = mergeRegions(regions).slice(0, maxRegions)
    if (regions.length === 0) {
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('image decode failed'))
        img.src = imageUrl
      })
      return { regions: [fullImageRegion(source, img.width, img.height)], fellBack: true }
    }
    return { regions, fellBack: false }
  } catch {
    const img = new Image()
    try {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('image decode failed'))
        img.src = imageUrl
      })
    } catch {
      return { regions: [fullImageRegion(source, 1, 1)], fellBack: true }
    }
    return { regions: [fullImageRegion(source, img.width, img.height)], fellBack: true }
  }
}