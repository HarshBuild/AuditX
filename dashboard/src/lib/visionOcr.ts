/**
 * AuditX v3.0 — Google Cloud Vision OCR client (backend-only).
 *
 * Text extraction runs on the AuditX Express API (Render), where the Google
 * Cloud service-account secret lives. The browser never holds the key — it
 * only sends the image data URL + its Firebase ID token. The extracted text
 * is then fed into the existing AI analysis pipeline as a reference
 * transcript, so small/dense label text is read more reliably.
 *
 * The call is best-effort: any failure returns null so the scan can fall back
 * to the normal analysis without blocking the user.
 */

import { auth } from './firebase'
import { CONFIG } from './config'

const MAX_IMAGES = 6

export interface VisionOcrResult {
  provider: 'google_vision'
  text: string
  blocks: Array<{ text: string; confidence: number | null }>
  languages: string[]
}

/**
 * Run Google Cloud Vision DOCUMENT_TEXT_DETECTION on up to 6 photos.
 * Returns null on any failure (credentials missing, backend offline, empty
 * text) — callers should treat null as "no OCR hint available".
 */
export async function runVisionOcr(images: string[], lang = 'en'): Promise<VisionOcrResult | null> {
  if (!images || images.length === 0) return null
  const user = auth.currentUser
  if (!user) return null
  const base = CONFIG.AUDITX_API_URL.replace(/\/+$/, '')
  const token = await user.getIdToken(true).catch(() => null)
  if (!token) return null

  let res: Response
  try {
    res = await fetch(`${base}/api/ocr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ images: images.slice(0, MAX_IMAGES), language: lang }),
    })
  } catch {
    return null
  }
  if (!res.ok) return null

  let data: { ok?: boolean; text?: string; blocks?: VisionOcrResult['blocks']; languages?: string[] }
  try {
    data = (await res.json()) as typeof data
  } catch {
    return null
  }
  const text = String(data.text ?? '').trim()
  if (!data.ok || !text) return null
  return {
    provider: 'google_vision',
    text,
    blocks: Array.isArray(data.blocks) ? data.blocks : [],
    languages: Array.isArray(data.languages) && data.languages.length > 0 ? data.languages : ['en'],
  }
}