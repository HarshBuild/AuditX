/**
 * Browser-only image primitives (the OpenCV-equivalent layer).
 *
 *   1. Hard quality gate            — blur / dark / flat contrast / low-res
 *   2. cropRegionFromOriginal      — never re-upscale an upscaled crop
 *   3. estimateAndApplySkew        — angle sweep by horizontal edge variance
 *   4. enhancement variants        — grayscale+contrast, CLAHE, Otsu, adaptive
 *                                    (moved here from localEngine, kept verbatim)
 *
 * Everything is deterministic and works on data URLs (no server, no packages).
 */
import { BBox, QualityReport } from './types'

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('Unsupported or corrupted image file.'))
    i.src = dataUrl
  })
}

function toGray(rgba: Uint8ClampedArray, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    out[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
  }
  return out
}

function gaussian3x3(buf: Float64Array, w: number, h: number, kernel: number[], kSum: number): Float64Array {
  const out = new Float64Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0, ki = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = Math.min(h - 1, Math.max(0, y + dy))
          const nx = Math.min(w - 1, Math.max(0, x + dx))
          acc += buf[ny * w + nx] * kernel[ki++]
        }
      }
      out[y * w + x] = acc / kSum
    }
  }
  return out
}

function contrastStretch(gray: Float64Array, lo: number, hi: number): Float64Array {
  const span = Math.max(1, hi - lo)
  const out = new Float64Array(gray.length)
  for (let j = 0; j < gray.length; j++) out[j] = ((gray[j] - lo) / span) * 255
  return out
}

export type VariantKind = 'color' | 'standard' | 'sharp' | 'clahe' | 'bin'

function drawColor(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
}

/**
 * Render one deterministic enhancement variant.
 * Always derived from ORIGINAL pixels (never from an already-upscaled image).
 */
export async function renderVariant(dataUrl: string, kind: VariantKind, upscale = 1): Promise<string> {
  const img = await loadImage(dataUrl)
  const w = Math.max(1, Math.round(img.width * upscale))
  const h = Math.max(1, Math.round(img.height * upscale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return dataUrl

  if (kind === 'color') {
    drawColor(ctx, img, w, h)
    return canvas.toDataURL('image/png')
  }

  const imageData = ctx.createImageData(w, h)
  const rgba = imageData.data
  drawColor(ctx, img, w, h)
  const src = ctx.getImageData(0, 0, w, h).data
  rgba.set(src)
  const gray = toGray(rgba, w, h)

  let min = 255, max = 0
  for (let j = 0; j < gray.length; j++) {
    if (gray[j] < min) min = gray[j]
    if (gray[j] > max) max = gray[j]
  }

  if (kind === 'standard' || kind === 'bin') {
    const stretched = contrastStretch(gray, min, max)
    const kernel = [1, 2, 1, 2, 4, 2, 1, 2, 1]
    const blurred = gaussian3x3(stretched, w, h, kernel, 16)
    const amount = 1.5
    const sharpened = new Float64Array(w * h)
    for (let j = 0; j < sharpened.length; j++) {
      sharpened[j] = Math.max(0, Math.min(255, stretched[j] + (stretched[j] - blurred[j]) * amount))
    }
    if (kind === 'bin') {
      const hist = new Float64Array(256)
      for (let j = 0; j < sharpened.length; j++) hist[Math.min(255, Math.max(0, Math.round(sharpened[j])))]++
      const total = w * h
      let sum = 0
      for (let t = 0; t < 256; t++) sum += t * hist[t]
      let sumB = 0, wB = 0, maxVariance = 0
      let threshold = 0
      for (let t = 0; t < 256; t++) {
        wB += hist[t]
        if (wB === 0) continue
        const wF = total - wB
        if (wF === 0) break
        sumB += t * hist[t]
        const mB = sumB / wB
        const mF = (sum - sumB) / wF
        const variance = wB * wF * (mB - mF) * (mB - mF)
        if (variance > maxVariance) { maxVariance = variance; threshold = t }
      }
      for (let j = 0; j < sharpened.length; j++) {
        const v = sharpened[j] > threshold ? 255 : 0
        rgba[j * 4] = v; rgba[j * 4 + 1] = v; rgba[j * 4 + 2] = v
      }
    } else {
      const S = 31
      const C = 12
      const integral = new Float64Array((w + 1) * (h + 1))
      for (let y = 0; y < h; y++) {
        let rowSum = 0
        for (let x = 0; x < w; x++) {
          rowSum += sharpened[y * w + x]
          integral[(y + 1) * (w + 1) + (x + 1)] = rowSum + integral[y * (w + 1) + (x + 1)]
        }
      }
      const half = Math.floor(S / 2)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const x1 = Math.max(0, x - half)
          const y1 = Math.max(0, y - half)
          const x2 = Math.min(w - 1, x + half)
          const y2 = Math.min(h - 1, y + half)
          const count = (x2 - x1 + 1) * (y2 - y1 + 1)
          const sum = integral[(y2 + 1) * (w + 1) + (x2 + 1)] - integral[y1 * (w + 1) + (x2 + 1)] - integral[(y2 + 1) * (w + 1) + x1] + integral[y1 * (w + 1) + x1]
          const threshold = sum / count - C
          const v = sharpened[y * w + x] > threshold ? 255 : 0
          const idx = (y * w + x) * 4
          rgba[idx] = v; rgba[idx + 1] = v; rgba[idx + 2] = v
        }
      }
    }
  } else if (kind === 'sharp') {
    const kernel = [1, 2, 1, 2, 4, 2, 1, 2, 1]
    const blurred = gaussian3x3(gray, w, h, kernel, 16)
    const amount = 1.8
    for (let j = 0; j < gray.length; j++) {
      const v = Math.max(0, Math.min(255, gray[j] + (gray[j] - blurred[j]) * amount))
      rgba[j * 4] = v; rgba[j * 4 + 1] = v; rgba[j * 4 + 2] = v
    }
  } else if (kind === 'clahe') {
    const SPAN = 64
    const CLIP = 2.5
    const tilesX = Math.ceil(w / SPAN)
    const tilesY = Math.ceil(h / SPAN)
    const maps: number[][][] = []
    for (let ty = 0; ty < tilesY; ty++) {
      maps[ty] = []
      const y0 = ty * SPAN, y1 = Math.min(h - 1, y0 + SPAN - 1)
      for (let tx = 0; tx < tilesX; tx++) {
        const x0 = tx * SPAN, x1 = Math.min(w - 1, x0 + SPAN - 1)
        const hist = new Float64Array(256)
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            hist[Math.min(255, Math.max(0, Math.round(gray[y * w + x])))]++
          }
        }
        const total = (x1 - x0 + 1) * (y1 - y0 + 1)
        const clipLimit = Math.max(1, (CLIP * total) / 256)
        let excess = 0
        for (let t = 0; t < 256; t++) {
          if (hist[t] > clipLimit) { excess += hist[t] - clipLimit; hist[t] = clipLimit }
        }
        const addEach = excess / 256
        for (let t = 0; t < 256; t++) hist[t] += addEach
        let cdf = 0
        const map = new Array<number>(256)
        for (let t = 0; t < 256; t++) { cdf += hist[t]; map[t] = (cdf * 255) / Math.max(1, total) }
        maps[ty][tx] = map
      }
    }
    for (let y = 0; y < h; y++) {
      const fy = Math.min(tilesY - 1, Math.floor(y / SPAN))
      const ty0 = Math.max(0, fy - 1), ty1 = Math.min(tilesY - 1, fy + 1)
      const wy = y - fy * SPAN
      for (let x = 0; x < w; x++) {
        const fx = Math.min(tilesX - 1, Math.floor(x / SPAN))
        const tx0 = Math.max(0, fx - 1), tx1 = Math.min(tilesX - 1, fx + 1)
        const wx = x - fx * SPAN
        const g = Math.min(255, Math.max(0, Math.round(gray[y * w + x])))
        const dy = fy >= tilesY - 1 ? 0 : wy / SPAN
        const dx = fx >= tilesX - 1 ? 0 : wx / SPAN
        const vTop = maps[ty0][tx0][g] * (1 - dx) + maps[ty0][tx1][g] * dx
        const vBot = ty1 === ty0 ? vTop : maps[ty1][tx0][g] * (1 - dx) + maps[ty1][tx1][g] * dx
        const v = Math.round(vTop * (1 - dy) + vBot * dy)
        const idx = (y * w + x) * 4
        rgba[idx] = v; rgba[idx + 1] = v; rgba[idx + 2] = v
      }
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}

/** Rotate a rendered PNG by 90/180/270 (for tilted labels). */
export async function renderRotated(dataUrl: string, deg: 90 | 180 | 270): Promise<string> {
  const img = await loadImage(dataUrl)
  const w = img.width
  const h = img.height
  const swap = deg === 90 || deg === 270
  const canvas = document.createElement('canvas')
  canvas.width = swap ? h : w
  canvas.height = swap ? w : h
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((deg * Math.PI) / 180)
  ctx.drawImage(img, -w / 2, -h / 2)
  return canvas.toDataURL('image/png')
}

/* ------------------------------------------------------------------ */
/* Hard quality gate                                                   */
/* ------------------------------------------------------------------ */

/**
 * Deterministic per-image gate. Returns warnings + a pass flag. A non-pass
 * image is NOT OCR'd (the pipeline skips it), so a blurry/dark/empty capture
 * can no longer produce a confident-looking but false result.
 */
export async function assessQuality(dataUrl: string): Promise<QualityReport> {
  const img = await loadImage(dataUrl)
  const sampleW = Math.min(192, img.width)
  const sampleH = Math.min(192, img.height)
  const canvas = document.createElement('canvas')
  canvas.width = sampleW
  canvas.height = sampleH
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return { pass: true, meanLum: 0, contrast: 0, edgeEnergy: 0, textHeightPx: 0, warnings: [] }

  ctx.drawImage(img, 0, 0, sampleW, sampleH)
  const data = ctx.getImageData(0, 0, sampleW, sampleH).data

  let totalLum = 0
  const n = sampleW * sampleH
  const hist = new Float64Array(256)
  for (let i = 0; i < data.length; i += 4) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    totalLum += l
    hist[Math.min(255, Math.max(0, Math.round(l)))]++
  }
  const meanLum = totalLum / n

  let pLow = -1, pHigh = 256
  let acc = 0
  for (let t = 0; t < 256; t++) {
    acc += hist[t]
    if (pLow < 0 && acc >= n * 0.01) pLow = t
    if (acc >= n * 0.99) { pHigh = t; break }
  }
  const contrast = (pHigh - pLow) / 255

  let edgeSum = 0
  let edgeCount = 0
  for (let y = 1; y < sampleH - 1; y++) {
    for (let x = 1; x < sampleW - 1; x++) {
      const idx = (y * sampleW + x) * 4
      const l = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
      const r = 0.299 * data[idx + 4] + 0.587 * data[idx + 5] + 0.114 * data[idx + 6]
      const b = 0.299 * data[idx + sampleW * 4] + 0.587 * data[idx + sampleW * 4 + 1] + 0.114 * data[idx + sampleW * 4 + 2]
      edgeSum += Math.abs(l - r) + Math.abs(l - b)
      edgeCount++
    }
  }
  const edgeEnergy = edgeCount > 0 ? edgeSum / edgeCount : 0

  const warnings: string[] = []
  if (meanLum < 40) warnings.push('Image too dark — retake in better lighting.')
  if (edgeEnergy < 6) warnings.push('Image appears blurry — hold steady and retake.')
  if (contrast < 0.08 && edgeEnergy < 10) warnings.push('Image has flat contrast — text may not be readable.')
  if (Math.min(img.width, img.height) < 900) warnings.push(`Low resolution (${img.width}×${img.height}) — small print may be unreadable.`)
  const hardFail = meanLum < 40 || (edgeEnergy < 6 && contrast < 0.08)

  return { pass: !hardFail, meanLum, contrast, edgeEnergy, textHeightPx: 0, warnings }
}

/* ------------------------------------------------------------------ */
/* Region cropping + de-skew                                          */
/* ------------------------------------------------------------------ */

/**
 * Crop a detected region from the ORIGINAL image (with padding), optionally
 * upscaled. Everything keyed off original pixels — the accuracy-critical step.
 */
export async function cropRegionFromOriginal(
  dataUrl: string,
  bbox: BBox,
  padRatio = 0.1,
  upscale = 1,
): Promise<{ url: string; bbox: BBox; w: number; h: number }> {
  const img = await loadImage(dataUrl)
  const padX = Math.max(2, Math.round((bbox.x1 - bbox.x0) * padRatio))
  const padY = Math.max(2, Math.round((bbox.y1 - bbox.y0) * padRatio))
  const x0 = Math.max(0, Math.round(bbox.x0) - padX)
  const y0 = Math.max(0, Math.round(bbox.y0) - padY)
  const x1 = Math.min(img.width, Math.round(bbox.x1) + padX)
  const y1 = Math.min(img.height, Math.round(bbox.y1) + padY)
  const cw = Math.max(1, x1 - x0)
  const ch = Math.max(1, y1 - y0)
  const w = Math.max(1, Math.round(cw * upscale))
  const h = Math.max(1, Math.round(ch * upscale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return { url: dataUrl, bbox, w: cw, h: ch }
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, x0, y0, cw, ch, 0, 0, w, h)
  return {
    url: canvas.toDataURL('image/png'),
    bbox: { x0, y0, x1, y1 },
    w, h,
  }
}

/** Estimate best small rotation (degrees) by maximizing row edge variance. */
export async function estimateSkewDegrees(dataUrl: string, sampleMax = 320): Promise<number> {
  const img = await loadImage(dataUrl)
  const scale = Math.min(1, sampleMax / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))

  let bestAngle = 0
  let bestScore = -1
  for (let a = -8; a <= 8; a++) {
    const canvas = document.createElement('canvas')
    canvas.width = w + 8
    canvas.height = h + 8
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) continue
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((a * Math.PI) / 180)
    ctx.drawImage(img, -w / 2, -h / 2, w, h)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    const rows = canvas.height
    const cols = canvas.width
    const rowEdge = new Float64Array(rows)
    for (let y = 0; y < rows; y++) {
      let sum = 0
      for (let x = 1; x < cols; x++) {
        const i = (y * cols + x) * 4
        const j = i - 4
        const l = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]
        const r = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
        sum += Math.abs(r - l)
      }
      rowEdge[y] = sum / cols
    }
    const mean = rowEdge.reduce((s, v) => s + v, 0) / rows
    let variance = 0
    for (const v of rowEdge) variance += (v - mean) * (v - mean)
    variance /= rows
    if (variance > bestScore) { bestScore = variance; bestAngle = a }
  }
  return bestAngle
}

/** Rotate a crop about its center by `deg` degrees on a white background. */
export async function rotateCrop(dataUrl: string, deg: number): Promise<string> {
  if (Math.abs(deg) < 0.5) return dataUrl
  const img = await loadImage(dataUrl)
  const w = img.width
  const h = img.height
  const rad = (deg * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const nw = Math.max(1, Math.ceil(w * cos + h * sin))
  const nh = Math.max(1, Math.ceil(w * sin + h * cos))
  const canvas = document.createElement('canvas')
  canvas.width = nw
  canvas.height = nh
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, nw, nh)
  ctx.translate(nw / 2, nh / 2)
  ctx.rotate(rad)
  ctx.drawImage(img, -w / 2, -h / 2)
  return canvas.toDataURL('image/png')
}

/** Downscale an existing data URL to at most maxDim (for cheap re-analysis). */
export async function fitMaxDim(dataUrl: string, maxDim: number): Promise<string> {
  const img = await loadImage(dataUrl)
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
  if (scale >= 1) return dataUrl
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', 0.85)
}

/** Small evidence thumbnail from a crop (≤ 96px tall, JPEG) for storage. */
export async function evidenceThumb(url: string, maxH = 96): Promise<string | null> {
  try {
    const img = await loadImage(url)
    const scale = Math.min(1, maxH / img.height)
    if (scale >= 1) return url
    const w = Math.max(1, Math.round(img.width * scale))
    const h = maxH
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', 0.72)
  } catch {
    return null
  }
}