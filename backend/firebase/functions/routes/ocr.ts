/**
 * OCR route — backend-only Google Cloud Vision text extraction.
 *
 * POST /api/ocr
 *   { images: string[] }        // data URLs or raw base64 (1..6 photos)
 *   { language?: string }       // optional OCR language hint (default en)
 *
 * Returns structured OCR text that feeds the existing AI analysis pipeline:
 *   { ok, provider: 'google_vision', text, blocks, languages, perImage }
 *
 * Empty/low-quality results never throw — they return ok:true with empty text
 * so the caller can continue with the regular AI analysis. Errors are always
 * friendly and generic (no SDK internals, no credentials).
 */

import { Router, Request, Response } from 'express'
import { extractTextWithVision } from '../lib/vision.js'

const router = Router()

const MAX_IMAGES = 6
const MAX_BASE64 = 28_000_000 // ~21 MB binary per image

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { images, language } = (req.body ?? {}) as { images?: unknown; language?: string }

    if (!Array.isArray(images) || images.length === 0) {
      res.status(400).json({ ok: false, error: 'No image provided for text extraction.' })
      return
    }
    if (images.length > MAX_IMAGES) {
      res.status(400).json({ ok: false, error: `At most ${MAX_IMAGES} photos per inspection.` })
      return
    }

    const clean: string[] = []
    for (const img of images) {
      if (typeof img !== 'string' || !img.trim()) {
        res.status(400).json({ ok: false, error: 'One of the provided images is invalid.' })
        return
      }
      const value = img.slice(img.indexOf(',') + 1)
      if (value.length > MAX_BASE64) {
        res.status(400).json({ ok: false, error: 'One of the provided images is too large. Retake at a lower resolution.' })
        return
      }
      clean.push(img)
    }

    const hints = typeof language === 'string' && language && language !== 'en'
      ? ['en', language]
      : ['en']

    const out = await extractTextWithVision(clean, { languageHints: hints })

    res.json({
      ok: true,
      provider: out.provider,
      text: out.text,
      empty: !out.text.trim(),
      blocks: out.blocks,
      languages: out.languages,
      perImage: out.perImage,
    })
  } catch (e) {
    const message = (e as Error)?.message ?? ''
    res.status(500).json({
      ok: false,
      error: /not configured/i.test(message)
        ? 'Text extraction is not configured yet. The scan will continue using the standard analysis.'
        : 'Could not read the label text. The scan will continue using the standard analysis.',
    })
  }
})

export default router