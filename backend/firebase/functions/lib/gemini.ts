/**
 * Minimal Google Gemini (generativelanguage.googleapis.com) client.
 *
 * Used by the AuditX backend routes in place of the previous Groq client.
 * Model defaults to gemini-2.5-flash (supports text + inline images).
 *
 * Env: GEMINI_API_KEY (Google AI Studio key)
 */
const BASE = 'https://generativelanguage.googleapis.com/v1beta'

export interface GemPart {
  text?: string
  inline_data?: { mime_type: string; data: string }
}

export interface GeminiCallOptions {
  model?: string
  system?: string
  parts: GemPart[]
  temperature?: number
  maxOutputTokens?: number
}

export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash'

export function geminiApiKey(): string {
  return process.env.GEMINI_API_KEY ?? ''
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

/** Run one Gemini generateContent turn and return the model's text. */
export async function geminiGenerateContent(opts: GeminiCallOptions): Promise<string> {
  const key = geminiApiKey()
  if (!key) throw new Error('GEMINI_API_KEY is not set')

  const model = opts.model ?? DEFAULT_GEMINI_MODEL
  const body: Record<string, unknown> = {
    contents: [{ parts: opts.parts }],
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      maxOutputTokens: opts.maxOutputTokens ?? 4096,
    },
  }
  if (opts.system) {
    body.systemInstruction = { parts: [{ text: opts.system }] }
  }

  const url = `${BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 300)}`)
  }
  const data: any = await res.json()
  const text =
    data?.candidates?.[0]?.content?.parts?.map((p: any) => String(p?.text ?? '')).join('') ?? ''
  if (!text) {
    const blocked = data?.promptFeedback?.blockReason
    throw new Error(blocked ? `Gemini blocked request (${blocked})` : 'Empty Gemini response')
  }
  return text
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

/* ------------------------------------------------------------------ */
/* Transient-failure retry (503 overloaded / 429 rate-limit / network) */
/* ------------------------------------------------------------------ */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** True for errors worth one retry: overloaded, rate-limited, bad gateway, network blip. */
export function isTransientError(e: unknown): boolean {
  const msg = `${(e as Error)?.message ?? e}`.toLowerCase()
  return (
    /\b(503|502|429)\b/.test(msg) ||
    msg.includes('unavailable') ||
    msg.includes('overloaded') ||
    msg.includes('high demand') ||
    msg.includes('rate limit') ||
    msg.includes('rate-limit') ||
    msg.includes('fetch failed') ||
    msg.includes('timeout') ||
    msg.includes('temporarily')
  )
}

/**
 * Run fn; on transient errors retry with growing backoffs (default 5s, 15s).
 * Config errors (401/403/404/400) fail immediately — retrying is useless.
 * Returns the first success; throws the LAST error when exhausted.
 */
export async function withTransientRetry<T>(fn: () => Promise<T>, delaysMs: number[] = [5000]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      if (!isTransientError(e)) throw e
      if (attempt >= delaysMs.length) throw e
      const delay = delaysMs[Math.min(attempt, delaysMs.length - 1)]
      console.warn(`⚠️ transient AI error (${String((e as Error)?.message ?? e).slice(0, 120)}) — retry ${attempt + 1}/${delaysMs.length} in ${delay}ms.`)
      await sleep(delay)
    }
  }
}

/** Split a comma-separated model list env var into an ordered, deduped list. */
export function parseModelList(raw: string | undefined, fallback: string): string[] {
  const list = String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!list.includes(fallback)) list.push(fallback)
  return [...new Set(list)]
}