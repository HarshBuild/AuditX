/**
 * Assistant route — mirrors the complianceAssistant callable as REST.
 *
 * POST /api/assistant  { scanId, question, lang }
 *   -> { ok: true, answer: string }
 *
 * Loads the persisted scan, builds a deterministic context (same content as
 * the browser-side buildContext), and answers via Gemini with a strict
 * Legal-Metrology scope guard. Unrelated questions are refused.
 */

import { Router, Request, Response } from 'express'
import { getScanDoc } from '../supabase-admin.js'
import { DEFAULT_GEMINI_MODEL, geminiGenerateContent } from '../lib/gemini.js'

const router = Router()

const USER_PROMPT_HEAD =
  'You are AuditX, a Legal Metrology label-compliance assistant built specifically for this product scanning app. ' +
  'You may ONLY answer questions about THIS scanned product and its compliance data, the Indian Legal Metrology ' +
  '(Packaged Commodities) Rules 2011, FSSAI label declarations (MRP, net quantity, unit sale price, manufacturer ' +
  'details, best-before date, consumer care), the inspection verdict/score/risk shown, and the AuditX app itself. ' +
  'Base every answer strictly on the scan data provided — never invent fields or compliance facts. ' +
  'If the user asks anything ELSE (general knowledge, news, entertainment, coding, personal advice, or any topic ' +
  'unrelated to this project), refuse politely in one line: you can only help with this product label\'s Legal ' +
  'Metrology compliance and the AuditX app. Answer concisely in the requested language.'

function safeStr(v: unknown): string {
  try {
    return String(v ?? '')
  } catch {
    return ''
  }
}

function langName(lang: string | null | undefined): string {
  const map: Record<string, string> = {
    en: 'English', hi: 'Hindi', bn: 'Bengali', ta: 'Tamil', te: 'Telugu',
    kn: 'Kannada', ml: 'Malayalam', mr: 'Marathi', gu: 'Gujarati', pa: 'Punjabi',
  }
  return map[lang ?? 'en'] ?? 'English'
}

function buildContext(scan: any): string {
  const rules = (scan.rules ?? [])
    .map((r: any) => {
      const key = r.rule_id ?? r.requirement ?? ''
      const status = r.status ?? ''
      let line = status ? String(status) : ''
      line = key ? `${key}: ${line}` : line
      return line.trim()
    })
    .filter(Boolean)
    .join(', ')

  const fields = (scan.extraction_fields ?? {}) as Record<string, { value?: unknown }>
  const extras: Record<string, string> = {}
  for (const [k, v] of Object.entries(fields)) {
    const val = safeStr(v?.value)
    if (val) extras[k] = val
  }

  return JSON.stringify(
    {
      product_name: scan.product_name,
      brand: scan.brand,
      manufacturer: scan.manufacturer,
      category: scan.category,
      barcode: scan.barcode,
      overall_score: scan.overall_score,
      verdict: scan.verdict,
      risk_score: scan.risk_score,
      summary: scan.summary,
      counts: scan.counts,
      extracted_fields: extras,
      rules,
      ocr_text_excerpt: safeStr(scan.ocr_text ?? scan.ocr?.text).slice(0, 4000),
    },
    null,
    0,
  )
}

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { scanId, question, lang } = (req.body ?? {}) as { scanId?: string; question?: string; lang?: string }
    const q = String(question ?? '').trim()
    if (!scanId || !q) {
      res.status(400).json({ ok: false, error: 'scanId and question are required.' })
      return
    }

    const scan = await getScanDoc(scanId).catch(() => null)
    if (!scan) {
      res.status(404).json({ ok: false, error: 'Scan not found.' })
      return
    }

    const userMsg = `Scan data (JSON):\n${buildContext(scan)}\n\nAnswer in ${langName(lang)}: ${q}`

    const model = process.env.GEMINI_TEXT_MODEL ?? DEFAULT_GEMINI_MODEL
    const answer = await geminiGenerateContent({
      model,
      system: USER_PROMPT_HEAD,
      parts: [{ text: userMsg }],
      temperature: 0.2,
      maxOutputTokens: 900,
    })

    if (!answer) {
      res.status(502).json({ ok: false, error: 'Empty assistant response from Gemini.' })
      return
    }
    res.json({ ok: true, answer })
  } catch (e: any) {
    console.error('⚠️ /api/assistant error:', e?.message ?? e)
    res.status(500).json({ ok: false, error: e?.message ?? 'Assistant service error.' })
  }
})

export default router