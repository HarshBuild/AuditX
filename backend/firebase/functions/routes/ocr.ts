/**
 * OCR route — Fast Python OCR microservice (PaddleOCR) with parallel processing.
 *
 * POST /api/ocr
 *   { images: string[] }        // data URLs or raw base64 (1..6 photos)
 *   { language?: string }       // optional OCR language hint (default en)
 *   { fast?: boolean }          // enable fast path (default true)
 *
 * Returns structured OCR text that feeds the existing AI analysis pipeline:
 *   { ok, provider: 'paddleocr', text, blocks, languages, perImage, processing_time_ms }
 *
 * Empty/low-quality results never throw — they return ok:true with empty text
 * so the caller can continue with the regular AI analysis. Errors are always
 * friendly and generic.
 */

import { Router, Request, Response } from 'express'

const router = Router()

const MAX_IMAGES = 6
const MAX_BASE64 = 28_000_000 // ~21 MB binary per image

// Python OCR microservice URL (set via env var in Render)
const PYTHON_OCR_URL = process.env.PYTHON_OCR_URL || 'http://localhost:8100'

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { images, language, fast = true } = (req.body ?? {}) as { images?: unknown; language?: string; fast?: boolean }

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

    // Call Python OCR microservice
    const ocrRes = await fetch(`${PYTHON_OCR_URL}/ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: clean, lang: hints[0], fast }),
    })

    if (!ocrRes.ok) {
      throw new Error(`Python OCR service returned ${ocrRes.status}`)
    }

    const data = await ocrRes.json()

    // Transform Python OCR response to match expected format
    const perImage = data.ocr_blocks?.map((b: any) => b.text) || []
    const blocks = data.ocr_blocks?.map((b: any) => ({ text: b.text, confidence: b.confidence })) || []

    res.json({
      ok: true,
      provider: 'paddleocr',
      text: data.ocr_text || '',
      empty: !data.ocr_text?.trim(),
      blocks,
      languages: hints,
      perImage,
      processing_time_ms: data.processing_time_ms,
      cache_hits: data.cache_hits,
      reocr_count: data.reocr_count,
      // Adaptive evidence layer: per-block bounding boxes + per-image quality.
      regions: Array.isArray(data.blocks_detail) ? data.blocks_detail : [],
      image_quality: Array.isArray(data.image_quality) ? data.image_quality : [],
      // Missed-text-region detection (#9): candidate gaps auto-re-OCRed.
      image_regions: data.image_regions,
      // Full deterministic extraction so the frontend can decide whether the
      // fast path already produced a valid result (skip Gemini when it did).
      fields: data.fields,
      rules: data.rules,
      result: data.result,
    })
  } catch (e) {
    const message = (e as Error)?.message ?? ''
    console.warn('Python OCR failed, falling back to Google Cloud Vision:', message)
    
    // Fallback to Google Cloud Vision (optional - requires vision lib)
    try {
      const { extractTextWithVision } = await import('../lib/vision.js')
      // NOTE: declared INSIDE the catch — the outer try's locals are not in
      // scope here, so derive them again from the request body.
      const fbBody = (req.body ?? {}) as { images?: unknown; language?: string }
      const fbImages: string[] = Array.isArray(fbBody.images)
        ? fbBody.images.filter((x): x is string => typeof x === 'string' && !!x)
        : []
      const fbHints =
        typeof fbBody.language === 'string' && fbBody.language && fbBody.language !== 'en'
          ? ['en', fbBody.language]
          : ['en']
      const out = await extractTextWithVision(fbImages, { languageHints: fbHints })
      
      res.json({
        ok: true,
        provider: out.provider,
        text: out.text,
        empty: !out.text.trim(),
        blocks: out.blocks,
        languages: out.languages,
        perImage: out.perImage,
      })
    } catch {
      res.status(500).json({
        ok: false,
        error: 'Could not read the label text. The scan will continue using the standard analysis.',
      })
    }
  }
})

export default router