/**
 * MISA-style photo pipeline client:
 *  - downsizes every shot to ≤1600 px JPEG (~0.82 quality) before upload,
 *  - grades the frame budget (brightness, sharpness, resolution) and returns
 *  - honest warnings so the user can retake a bad shot BEFORE analysis,
 *  - wraps a File/Blob into a ready-to-send data URL.
 */

export const MAX_PHOTO_DIM = 1600
export const JPEG_QUALITY = 0.82
export const MAX_PHOTOS = 5

export type PhotoWarning = 'dark' | 'blurry' | 'lowres'

export interface PhotoQuality {
  dark: boolean
  blurry: boolean
  lowRes: boolean
  /** Machine-readable warning codes — the UI maps them to translated text. */
  warnings: PhotoWarning[]
  averageLuma: number
  variance: number
  minDim: number
}

export interface PreparedPhoto {
  file: File
  dataUrl: string
  quality: PhotoQuality
}

/** Grayscale luma-weighted Laplacian-ish variance on a small downscaled canvas. */
function gradeImage(bitmap: ImageBitmap): PhotoQuality {
  const warnings: PhotoWarning[] = []
  const sampleW = Math.min(128, bitmap.width)
  const sampleH = Math.min(128, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = sampleW
  canvas.height = sampleH
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    return {
      dark: false,
      blurry: false,
      lowRes: false,
      warnings,
      averageLuma: 127.5,
      variance: 25,
      minDim: Math.min(bitmap.width, bitmap.height),
    }
  }
  ctx.drawImage(bitmap, 0, 0, sampleW, sampleH)
  const data = ctx.getImageData(0, 0, sampleW, sampleH).data
  const lum = new Float32Array(sampleW * sampleH)
  let sum = 0
  for (let i = 0; i < data.length; i += 4) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    lum[i / 4] = l
    sum += l
  }
  const averageLuma = sum / lum.length

  if (averageLuma < 35) {
    warnings.push('dark')
  }

  // Top-5% brightest pixels' variance around their own mean ≈ sharp edge energy.
  const sorted = Array.from(lum).sort((a, b) => a - b)
  const top = sorted.slice(Math.floor(sorted.length * 0.95))
  const mean = top.reduce((a, b) => a + b, 0) / (top.length || 1)
  const variance = top.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (top.length || 1)

  if (variance < 20) {
    warnings.push('blurry')
  }

  const minDim = Math.min(bitmap.width, bitmap.height)
  if (minDim < 400) {
    warnings.push('lowres')
  }

  return {
    dark: averageLuma < 35,
    blurry: variance < 20,
    lowRes: minDim < 400,
    warnings,
    averageLuma: Math.round(averageLuma * 10) / 10,
    variance: Math.round(variance * 10) / 10,
    minDim,
  }
}

/** Draw a bitmap downscaled to ≤ maxDim and return a JPEG data URL. */
function drawScaled(bitmap: ImageBitmap, maxDim: number): string {
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable in this browser.')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bitmap, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
}

/**
 * Prepare a photo for the inspection: single decode, downsample to 1600px,
 * grade quality and return both the compressed data URL and the warnings.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file (JPG, PNG or WEBP).')
  if (file.size > 10 * 1024 * 1024) throw new Error('Photo must be 10 MB or smaller.')

  try {
    const bitmap = await createImageBitmap(file)
    try {
      const quality = gradeImage(bitmap)
      return { file, dataUrl: drawScaled(bitmap, MAX_PHOTO_DIM), quality }
    } finally {
      bitmap.close()
    }
  } catch {
    // ImageBitmap can be unavailable on some older browsers — fall back to <img>.
    const dataUrl = await fileToDataUrl(file, MAX_PHOTO_DIM)
    return { file, dataUrl, quality: { dark: false, blurry: false, lowRes: false, warnings: [], averageLuma: 127.5, variance: 25, minDim: 0 } }
  }
}

export function fileToDataUrl(file: File, maxDim = MAX_PHOTO_DIM): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the image file.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Unsupported or corrupted image file.'))
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas unavailable in this browser.'))
          return
        }
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}