/*
 * AuditX — browser-side Gemini assistant.
 *
 * Used when the complianceAssistant Cloud Function is not deployed: answers
 * questions about a scan using Google Gemini.
 *
 * SCOPE GUARD: the system prompt pins the assistant to Legal Metrology
 * product-label compliance and the AuditX app ONLY. Any unrelated question
 * (general knowledge, entertainment, coding, etc.) is refused — the model is
 * instructed to say it can only help with this project.
 */

import type { ScanRow } from './types2'
import { CONFIG } from './config'
import { SUPPORTED_LANGUAGES } from '../i18n/report'
import { extractJson, geminiApiKey, geminiGenerateContent } from './gemini'

const MAX_TOKENS = 900

function langName(lang: string): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === lang)?.name ?? 'English'
}

function safeStr(v: unknown): string {
  try {
    return String(v ?? '')
  } catch {
    return ''
  }
}

/** Condensed, deterministic context derived ONLY from the persisted scan. */
function buildContext(scan: ScanRow): string {
  const rules = (scan.rules ?? [])
    .map((r) => {
      const key = r.rule_id ?? r.requirement ?? ''
      const status = r.status ?? ''
      let line = status ? `${status}` : ''
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
      ocr_text_excerpt: safeStr(scan.ocr_text).slice(0, 4000),
    },
    null,
    0,
  )
}

const SYSTEM_PROMPT =
  'You are AuditX, a Legal Metrology label-compliance assistant built specifically for this product scanning app. ' +
  'You may ONLY answer questions about THIS scanned product and its compliance data, the Indian Legal Metrology ' +
  '(Packaged Commodities) Rules 2011, FSSAI label declarations (MRP, net quantity, unit sale price, manufacturer ' +
  'details, best-before date, consumer care), the inspection verdict/score/risk shown, and the AuditX app itself. ' +
  'Base every answer strictly on the scan data provided — never invent fields or compliance facts. ' +
  'If the user asks anything ELSE (general knowledge, news, entertainment, coding, personal advice, or any topic ' +
  'unrelated to this project), refuse politely in one line: you can only help with this product label\'s Legal ' +
  'Metrology compliance and the AuditX app. Answer concisely in the requested language.'

/**
 * Ask Gemini a question about `scan`. Returns the assistant reply, or null when
 * Gemini is not configured/unreachable so callers can fall back locally.
 */
export async function askGeminiAssistant(scan: ScanRow, question: string, lang: string): Promise<string | null> {
  if (!geminiApiKey()) return null

  const userMsg =
    `Scan data (JSON):\n${buildContext(scan)}\n\n` +
    `Answer in ${langName(lang)}: ${question}`

  try {
    const text = await geminiGenerateContent({
      model: CONFIG.GEMINI_MODEL,
      system: SYSTEM_PROMPT,
      parts: [{ text: userMsg }],
      temperature: 0.2,
      maxOutputTokens: MAX_TOKENS,
    })
    if (!text) return null
    // If Gemini returns JSON-wrapped text, unwrap it defensively.
    const json = extractJson(text)
    if (json && typeof json === 'object' && json.answer) return String(json.answer).trim()
    return text.trim()
  } catch (e) {
    console.warn('Gemini assistant unreachable', (e as Error).message)
    return null
  }
}