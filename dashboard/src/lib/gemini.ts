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

/** Replace unescaped control characters inside JSON string literals. */
function jsonStringSafe(text: string): string {
  let out = ''
  let inStr = false
  let esc = false
  for (const ch of text) {
    if (inStr) {
      if (esc) {
        out += ch
        esc = false
        continue
      }
      if (ch === '\\') {
        out += ch
        esc = true
        continue
      }
      if (ch === '"') {
        inStr = false
        out += ch
        continue
      }
      if (ch === '\n' || ch === '\r' || ch === '\t') {
        out += ch === '\n' ? '\\n' : ch === '\t' ? '\\t' : '\\r'
        continue
      }
      out += ch
      continue
    }
    if (ch === '"') inStr = true
    out += ch
  }
  return out
}

/** Extract the first JSON object from model output (tolerates fences/verbosity). */
export function extractJson(text: string): any {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  for (const candidate of [cleaned, jsonStringSafe(cleaned)]) {
    try {
      return JSON.parse(candidate)
    } catch {
      /* try the next candidate */
    }
  }
  const m = cleaned.match(/\{[\s\S]*\}/)
  if (m) {
    try {
      return JSON.parse(jsonStringSafe(m[0]))
    } catch {
      return null
    }
  }
  return null
}