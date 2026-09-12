/*
 * AuditX — Google Gemini client (browser).
 *
 * Talks directly to generativelanguage.googleapis.com using the configured
 * Gemini API key. Used for:
 *   - scan analysis (vision extraction -> compliance engine)
 *   - the AI assistant (scope-guarded questions)
 *
 * MODEL: gemini-2.5-flash (fast, multimodal, generous output).
 */

import { CONFIG } from './config'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'
const REQUEST_TIMEOUT_MS = 60000

export interface GemPart {
  text?: string
  inline_data?: { mime_type: string; data: string }
}

export function geminiApiKey(): string {
  return (CONFIG.GEMINI_API_KEY ?? '').trim()
}

/** Turn a data URL ("data:image/jpeg;base64,...") or bare base64 into an inline_data part. */
export function dataUrlToInline(url: string): GemPart {
  let mime = 'image/jpeg'
  let b64 = url
  if (url.startsWith('data:')) {
    const [meta, rest] = url.split(',', 2)
    const m = /^data:([^;]+);/.exec(meta)
    if (m) mime = m[1]
    b64 = rest
  }
  return { inline_data: { mime_type: mime, data: b64 } }
}

export async function geminiGenerateContent(opts: {
  model?: string
  system?: string
  parts: GemPart[]
  temperature?: number
  maxOutputTokens?: number
}): Promise<string> {
  const key = geminiApiKey()
  if (!key) throw new Error('Gemini API key is not configured.')

  const model = opts.model ?? CONFIG.GEMINI_MODEL
  const body: Record<string, unknown> = {
    contents: [{ parts: opts.parts }],
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      maxOutputTokens: opts.maxOutputTokens ?? 4096,
    },
  }
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Gemini ${res.status}: ${err.slice(0, 200)}`)
    }
    const data: any = await res.json()
    const text =
      data?.candidates?.[0]?.content?.parts?.map((p: any) => String(p?.text ?? '')).join('') ?? ''
    if (!text) {
      const blocked = data?.promptFeedback?.blockReason
      throw new Error(blocked ? `Gemini blocked request (${blocked})` : 'Empty Gemini response')
    }
    return text
  } finally {
    clearTimeout(timer)
  }
}

/** Extract the first JSON object from model output (tolerates fences/verbosity). */
export function extractJson(text: string): any {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/)
    return m ? JSON.parse(m[0]) : null
  }
}