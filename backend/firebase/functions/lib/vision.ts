/**
 * Google Cloud Vision OCR — backend-only text extraction.
 *
 * Credentials are resolved ONLY from environment secrets (never committed):
 *   GOOGLE_VISION_CREDENTIALS_JSON   — full service-account JSON as a single
 *                                       string (Render secret). Preferred.
 *   GOOGLE_APPLICATION_CREDENTIALS   — path to a service-account JSON file.
 *   (fallback: Application Default Credentials if neither is set)
 *
 * We use `documentTextDetection` (DOCUMENT_TEXT_DETECTION) because it is
 * optimized for small/dense printed text on labels and documents.
 *
 * Never log the credentials or any raw API error that could leak them.
 */

import vision from '@google-cloud/vision'

/** One decoded image ready for the Vision API (base64 without the data: header). */
export interface VisionImageInput {
  base64: string
  mime: string
}

/** A paragraph/block of recognized text with a confidence score. */
export interface VisionTextBlock {
  text: string
  confidence: number | null
}

/** Structured OCR outcome handed back to the scan pipeline. */
export interface VisionOcrOutput {
  provider: 'google_vision'
  text: string
  blocks: VisionTextBlock[]
  languages: string[]
}

let clientPromise: Promise<vision.ImageAnnotatorClient> | null = null

/** Build the Vision client lazily from environment secrets only. */
function getClient(): Promise<vision.ImageAnnotatorClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const json = process.env.GOOGLE_VISION_CREDENTIALS_JSON
      if (json && json.trim()) {
        const creds = JSON.parse(json.trim()) as { project_id?: string }
        return new vision.ImageAnnotatorClient({
          credentials: JSON.parse(json.trim()) as Record<string, string>,
          projectId: creds.project_id,
        })
      }
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        return new vision.ImageAnnotatorClient({
          keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
        })
      }
      // Application Default Credentials (e.g. GCE metadata server).
      return new vision.ImageAnnotatorClient()
    })().catch((e: Error) => {
      clientPromise = null
      throw new Error(`Vision API is not configured. Set GOOGLE_VISION_CREDENTIALS_JSON in the backend environment.${e?.message ? '' : ''}`)
    })
  }
  return clientPromise
}

/** Split a data URL (or raw base64) into { base64, mime }. */
export function decodeImageInput(img: string): VisionImageInput {
  if (img.startsWith('data:')) {
    const comma = img.indexOf(',')
    if (comma === -1) throw new Error('Invalid image data URL.')
    const header = img.slice(0, comma)
    const mime = /^data:(.*?);/i.exec(header)?.[1] ?? 'image/jpeg'
    return { base64: img.slice(comma + 1), mime }
  }
  return { base64: img, mime: 'image/jpeg' }
}

/** Run DOCUMENT_TEXT_DETECTION on one image and collect its text + blocks. */
async function detectOne(
  client: vision.ImageAnnotatorClient,
  image: VisionImageInput,
  languageHints: string[],
): Promise<{ text: string; blocks: VisionTextBlock[] }> {
  const [response] = await client.documentTextDetection({
    image: { content: Buffer.from(image.base64, 'base64') },
    imageContext: { languageHints },
  })
  const annotation = response.fullTextAnnotation
  const text = String(annotation?.text ?? '').trim()
  const blocks: VisionTextBlock[] = []
  for (const page of annotation?.pages ?? []) {
    for (const block of page.blocks ?? []) {
      const blockText = (block.paragraphs ?? [])
        .map((p) =>
          (p.words ?? [])
            .map((w) => (w.symbols ?? []).map((s) => s.text ?? '').join(''))
            .join(' '),
        )
        .join('\n')
        .trim()
      if (blockText) {
        blocks.push({ text: blockText, confidence: block.confidence ?? null })
      }
    }
  }
  return {
    text,
    blocks: blocks.length > 0 ? blocks : text ? [{ text, confidence: null }] : [],
  }
}

/**
 * Extract text from up to `images` photos using Google Cloud Vision OCR.
 *
 * Every image is processed; the per-image results (index-aligned with the
 * input) and the merged transcript are returned. Throws a friendly, generic
 * Error on transport/config failures so callers can fall back to the existing
 * analysis path without exposing internals.
 */
export async function extractTextWithVision(
  images: string[],
  opts: { languageHints?: string[] } = {},
): Promise<VisionOcrOutput & { perImage: string[] }> {
  const hints = opts.languageHints && opts.languageHints.length > 0 ? opts.languageHints : ['en']
  const client = await getClient()
  const perImage: string[] = []
  const allBlocks: VisionTextBlock[] = []
  let merged: string[] = []

  // Process images sequentially to avoid burst quota errors on large photos.
  for (const img of images) {
    const decoded = decodeImageInput(img)
    const one = await detectOne(client, decoded, hints)
    perImage.push(one.text)
    allBlocks.push(...one.blocks)
    if (one.text) merged.push(one.text)
  }

  const languages = Array.from(new Set(hints))
  return {
    provider: 'google_vision',
    text: merged.join('\n\n'),
    blocks: allBlocks,
    languages,
    perImage,
  }
}