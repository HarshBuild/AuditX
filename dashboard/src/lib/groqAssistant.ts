/*
 * AuditX — browser-side Groq assistant.
 *
 * Used when the complianceAssistant Cloud Function is not deployed: answers
 * questions about a scan using Groq (OpenAI-compatible chat completions).
 *
 * SCOPE GUARD: the system prompt pins the assistant to Legal Metrology
 * product-label compliance and the AuditX app ONLY. Any unrelated question
 * (general knowledge, entertainment, coding, etc.) is refused — the model is
 * instructed to say it can only help with this project.
 */

import type { ScanRow } from './types2'
import { CONFIG } from './config'
import { SUPPORTED_LANGUAGES } from '../i18n/report'

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const MAX_TOKENS = 900
const REQUEST_TIMEOUT_MS = 45000

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
 * Ask Groq a question about `scan`. Returns the assistant reply, or null when
 * Groq is not configured/unreachable so callers can fall back locally.
 */
export async function askGroqAssistant(scan: ScanRow, question: string, lang: string): Promise<string | null> {
  const key = CONFIG.GROQ_API_KEY
  if (!key) return null

  const userMsg =
    `Scan data (JSON):\n${buildContext(scan)}\n\n` +
    `Answer in ${langName(lang)}: ${question}`

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: CONFIG.GROQ_TEXT_MODEL,
          temperature: 0.2,
          max_tokens: MAX_TOKENS,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMsg },
          ],
        }),
      })
      if (!res.ok) {
        const body = await res.text()
        console.warn('Groq request failed', res.status, body.slice(0, 300))
        return null
      }
      const payload = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
      const content = payload.choices?.[0]?.message?.content?.trim() ?? ''
      return content.length > 0 ? content : null
    } finally {
      clearTimeout(timer)
    }
  } catch (e) {
    console.warn('Groq unreachable', (e as Error).message)
    return null
  }
}