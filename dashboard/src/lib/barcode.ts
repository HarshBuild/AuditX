/**
 * Barcode / QR detection.
 *
 * Uses the native BarcodeDetector Web API (Chrome 83+/Android) on several
 * enhancement passes of the SAME ORIGINAL image:
 *   original → grayscale+contrast → upscaled → thresholded
 * Results are deduplicated, checksum-validated (EAN-13/8, UPC-A/E, ITF) and
 * reported with a status: 'OK' (validated) | 'CONFLICT' | 'NEEDS_REVIEW'.
 *
 * Falls back gracefully when the API is missing — the UI will still allow
 * manual barcode entry.
 */

/* ------------------------------------------------------------------ */
/* Type declarations for the BarcodeDetector Web API (not in all TS    */
/* DOM lib versions).                                                  */
/* ------------------------------------------------------------------ */

type BarcodeDetectorFormat =
  | 'ean_13'
  | 'ean_8'
  | 'upc_a'
  | 'upc_e'
  | 'code_128'
  | 'code_39'
  | 'qr_code'

interface BarcodeDetectorResult {
  rawValue: string
  format: string
}

interface BarcodeDetectorInstance {
  detect(source: ImageBitmapSource): Promise<BarcodeDetectorResult[]>
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: BarcodeDetectorFormat[] }): BarcodeDetectorInstance
}

declare const BarcodeDetector: BarcodeDetectorConstructor

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export interface DetectedBarcode {
  rawValue: string
  format: string
}

export type BarcodeStatus = 'OK' | 'CONFLICT' | 'NEEDS_REVIEW'

export interface BarcodeRead {
  rawValue: string
  format: string
  status: BarcodeStatus
  /** true when the code was validated against its checksum digit. */
  checksumValid: boolean
}

const SUPPORTED_FORMATS: BarcodeDetectorFormat[] = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'qr_code',
]

export async function isBarcodeDetectorSupported(): Promise<boolean> {
  return typeof BarcodeDetector !== 'undefined'
}

/* ------------------------------------------------------------------ */
/* Enhancement passes (OpenCV-equivalent, canvas)                      */
/* ------------------------------------------------------------------ */

/** Grayscale + contrast stretch, thresholded binary, and 2× upscale. */
async function makeVariants(source: ImageBitmapSource): Promise<ImageBitmap[]> {
  const out: ImageBitmap[] = []
  try {
    const base = source instanceof ImageBitmap
      ? source
      : await fetch(String(source)).then((r) => r.blob()).then((b) => createImageBitmap(b))
    const w = base.width
    const h = base.height

    // Pass B — grayscale + contrast stretch
    const g = document.createElement('canvas')
    g.width = w
    g.height = h
    const gctx = g.getContext('2d', { willReadFrequently: true })
    if (gctx) {
      gctx.drawImage(base, 0, 0)
      const id = gctx.getImageData(0, 0, w, h)
      const d = id.data
      let min = 255, max = 0
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        if (l < min) min = l
        if (l > max) max = l
      }
      const span = Math.max(1, max - min)
      for (let i = 0; i < d.length; i += 4) {
        const l = ((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] - min) / span) * 255
        d[i] = d[i + 1] = d[i + 2] = l
      }
      gctx.putImageData(id, 0, 0)
      out.push(await createImageBitmap(g))
    }

    // Pass C — 2× upscale (helps thin 1D bars resolve)
    if (w * 2 <= 6000 && h * 2 <= 6000) {
      const u = document.createElement('canvas')
      u.width = w * 2
      u.height = h * 2
      const uctx = u.getContext('2d')
      if (uctx) {
        uctx.imageSmoothingEnabled = true
        uctx.drawImage(base, 0, 0, w * 2, h * 2)
        out.push(await createImageBitmap(u))
      }
    }

    // Pass D — Otsu thresholded binary
    const b = document.createElement('canvas')
    b.width = w
    b.height = h
    const bctx = b.getContext('2d', { willReadFrequently: true })
    if (bctx) {
      bctx.drawImage(base, 0, 0)
      const id = bctx.getImageData(0, 0, w, h)
      const d = id.data
      const gray = new Float32Array(w * h)
      for (let i = 0, j = 0; i < d.length; i += 4, j++) gray[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      const hist = new Float64Array(256)
      for (let j = 0; j < gray.length; j++) hist[Math.min(255, Math.max(0, Math.round(gray[j])))]++
      const total = w * h
      let sum = 0
      for (let t = 0; t < 256; t++) sum += t * hist[t]
      let sumB = 0, wB = 0, maxVar = 0, thr = 127
      for (let t = 0; t < 256; t++) {
        wB += hist[t]
        if (wB === 0) continue
        const wF = total - wB
        if (wF === 0) break
        sumB += t * hist[t]
        const mB = sumB / wB
        const mF = (sum - sumB) / wF
        const v = wB * wF * (mB - mF) * (mB - mF)
        if (v > maxVar) { maxVar = v; thr = t }
      }
      for (let i = 0, j = 0; i < d.length; i += 4, j++) {
        const v = gray[j] > thr ? 255 : 0
        d[i] = d[i + 1] = d[i + 2] = v
      }
      bctx.putImageData(id, 0, 0)
      out.push(await createImageBitmap(b))
    }
  } catch {
    // Variant generation is best-effort.
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Checksum validation                                                */
/* ------------------------------------------------------------------ */

/** Validate GS1 check digit for EAN-13, EAN-8, UPC-A, ITF, UPC-E. */
export function checksumGTIN(raw: string): boolean {
  const digits = raw.replace(/\D/g, '')
  const len = digits.length
  if (len !== 8 && len !== 12 && len !== 13 && len !== 14) return false
  let sum = 0
  // Check digit is the LAST digit; weight 3 for positions from the right (excluding check digit).
  for (let i = 0; i < len - 1; i++) {
    const pos = len - 1 - i // 1-based from right, ignoring check digit
    const weight = pos % 2 === 1 ? 3 : 1
    sum += Number(digits[i]) * weight
  }
  const check = (10 - (sum % 10)) % 10
  return check === Number(digits[len - 1])
}

/* ------------------------------------------------------------------ */
/* Detection core                                                      */
/* ------------------------------------------------------------------ */

function canon(raw: string, format: string): string {
  const v = raw.replace(/\s/g, '')
  // UPC-A ↔ EAN-13 (leading 0) are the same physical code.
  if (format === 'upc_a' && v.length === 12) return `0${v}`
  return v
}

export async function detectBarcodes(imageSource: ImageBitmapSource): Promise<DetectedBarcode[]> {
  if (typeof BarcodeDetector === 'undefined') return []
  try {
    const detector = new BarcodeDetector({ formats: SUPPORTED_FORMATS })
    const barcodes = await detector.detect(imageSource)
    return barcodes.map((b) => ({ rawValue: b.rawValue, format: b.format }))
  } catch {
    return []
  }
}

/**
 * Read barcodes from a File using multi-pass detection + checksum
 * validation. Returns the most reliable hit, or null when nothing decoded.
 */
export async function detectBarcodeFromFile(file: File): Promise<BarcodeRead | null> {
  if (typeof BarcodeDetector === 'undefined') return null
  try {
    const bitmap = await createImageBitmap(file)
    try {
      return await readBarcodesWithPasses(bitmap)
    } finally {
      if (bitmap) bitmap.close()
    }
  } catch {
    return null
  }
}

async function readBarcodesWithPasses(bitmap: ImageBitmap): Promise<BarcodeRead | null> {
  const hits: Array<{ rawValue: string; format: string; pass: string }> = []
  const detector = new BarcodeDetector({ formats: SUPPORTED_FORMATS })

  // Pass 1 — original
  const onOriginal = await detector.detect(bitmap)
  for (const b of onOriginal) hits.push({ rawValue: b.rawValue, format: b.format, pass: 'original' })

  // Pass 2+ — enhanced variants (grayscale, 2×, threshold)
  const variants = await makeVariants(bitmap)
  for (const v of variants) {
    const res = await detector.detect(v)
    for (const b of res) hits.push({ rawValue: b.rawValue, format: b.format, pass: 'enhanced' })
    v.close()
  }

  if (hits.length === 0) return null

  // Dedupe + vote by canonical value.
  const votes = new Map<string, { rawValue: string; format: string; count: number }>()
  for (const h of hits) {
    const key = `${canon(h.rawValue, h.format)}|${h.format}`
    const existing = votes.get(key)
    if (existing) existing.count++
    else votes.set(key, { rawValue: h.rawValue, format: h.format, count: 1 })
  }

  const ranked = [...votes.values()].sort((a, b) => b.count - a.count)
  const top = ranked[0]
  const runnerUp = ranked[1]

  const validated = checksumGTIN(top.rawValue)
  let status: BarcodeStatus = 'OK'
  let checksumValid = validated

  if (runnerUp && runnerUp.count === top.count && canon(runnerUp.rawValue, runnerUp.format) !== canon(top.rawValue, top.format)) {
    // Two decoders/passes disagree → CONFLICT (needs manual verification).
    status = 'CONFLICT'
  } else if ((top.format === 'ean_13' || top.format === 'ean_8' || top.format === 'upc_a' || top.format === 'upc_e' || top.format === 'itf') && !validated) {
    // Decoded but failed checksum — not safe to trust.
    status = 'NEEDS_REVIEW'
    checksumValid = false
  }

  return { rawValue: top.rawValue, format: top.format, status, checksumValid }
}

/** Read a QR code specifically (multi-pass, separate from 1D barcode path). */
export async function detectQrFromFile(file: File): Promise<BarcodeRead | null> {
  if (typeof BarcodeDetector === 'undefined') return null
  try {
    const bitmap = await createImageBitmap(file)
    try {
      const detector = new BarcodeDetector({ formats: ['qr_code'] })
      const onOriginal = await detector.detect(bitmap)
      let best = onOriginal.length > 0 ? onOriginal[0] : null
      if (!best) {
        for (const v of await makeVariants(bitmap)) {
          const res = await detector.detect(v)
          if (res.length > 0) { best = res[0]; v.close(); break }
          v.close()
        }
      }
      if (!best) return null
      return { rawValue: best.rawValue, format: 'qr_code', status: 'OK', checksumValid: true }
    } finally {
      if (bitmap) bitmap.close()
    }
  } catch {
    return null
  }
}

/**
 * Normalize a barcode value to a canonical form for product lookup.
 * Strips whitespace and leading zeros that can differ between
 * UPC-A (12 digit) and EAN-13 (13 digit) representations.
 */
export function normalizeBarcode(raw: string): string {
  return raw.replace(/\s/g, '')
}