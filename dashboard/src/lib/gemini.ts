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
  const env = import.meta.env.VITE_GEMINI_API_KEY as string | undefined
  return (env ?? localStorage.getItem('mc_gemini_api_key') ?? '').trim()
}

export interface GeminiKeyCheck {
  ok: boolean
  status: number
  kind: 'verified' | 'quota' | 'invalid' | 'network'
  message: string
}

/** Gemini generation-quota error codes (a valid key may still be throttled). */
const QUOTA_HINT = /429|resource_exhausted|quota|rate limit/i

/**
 * Verify a Gemini API key WITHOUT spending generation quota.
 *
 * `GET /v1beta/models?key=…` validates the key and lists the enabled models —
 * the metadata call is not subject to the generateContent rate/per-day quota,
 * so a key that is merely throttled (429) is correctly reported as VALID
 * instead of being rejected like an invalid key.
 */
export async function geminiVerifyKey(key: string): Promise<GeminiKeyCheck> {
  const clean = key.trim()
  if (!clean) return { ok: false, status: 0, kind: 'invalid', message: 'No API key entered.' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(`${BASE}/models?key=${encodeURIComponent(clean)}`, {
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
    })
    const body = await res.text().catch(() => '')
    if (res.ok) {
      return { ok: true, status: res.status, kind: 'verified', message: 'Key is valid and models are reachable.' }
    }
    let msg = body.slice(0, 160)
    try {
      const j = JSON.parse(body)
      if (j?.error?.message) msg = String(j.error.message).slice(0, 200)
    } catch {
      /* plain-text error body */
    }
    if (QUOTA_HINT.test(msg)) {
      return { ok: true, status: res.status, kind: 'quota', message: msg }
    }
    return { ok: false, status: res.status, kind: 'invalid', message: msg || `Gemini HTTP ${res.status}` }
  } catch {
    return { ok: false, status: 0, kind: 'network', message: 'Could not reach the Gemini API (network). Check your connection.' }
  } finally {
    clearTimeout(timer)
  }
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
      const status = res.status
      let friendly = `Gemini ${status}: ${err.slice(0, 200)}`
      if (QUOTA_HINT.test(err)) {
        friendly = `Gemini quota exceeded (${status}). The key is valid but your AI Studio plan/billing is throttling requests — try again later or check https://ai.google.dev/gemini-api/docs/rate-limits.`
      } else if (status === 400 || status === 401 || status === 403) {
        friendly = `Gemini rejected the API key (${status}). Check the key in your AI Studio account.`
      } else if (status === 404) {
        friendly = `Gemini model "${model}" is unavailable for this key (${status}).`
      }
      const e = new Error(friendly) as Error & { status?: number }
      e.status = res.status
      throw e
    }
    const data: any = await res.json()
    const text =
      data?.candidates?.[0]?.content?.parts?.map((p: any) => String(p?.text ?? '')).join('') ?? ''
    if (!text) {
      const blocked = data?.promptFeedback?.blockReason
      const finish = data?.candidates?.[0]?.finishReason
      const safety: string[] = (data?.candidates?.[0]?.safetyRatings ?? [])
        .filter((r: any) => r?.probability && r.probability !== 'NEGLIGIBLE')
        .map((r: any) => r.category ?? '')
        .filter(Boolean)
      throw new Error(
        blocked
          ? `Gemini blocked request (${blocked})`
          : finish
            ? `Gemini returned no text (${finish}${safety.length ? `; safety: ${safety.join(', ')}` : ''})`
            : 'Empty Gemini response',
      )
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