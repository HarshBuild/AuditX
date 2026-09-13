/*
 * AuditX — display text normalization for OCR-derived content.
 *
 * Raw OCR is SOURCE EVIDENCE (kept verbatim in the collapsed
 * "Raw OCR / Extracted Text" section). Everything else that shows OCR-derived
 * text passes through this layer so users see clean, professional values —
 * never mojibake, hidden zero-width characters, random letter spacing or
 * machine-garbled strings.
 *
 * Guarantees:
 *  - Unicode is NFC-normalized; invisible/hidden chars are stripped (a common
 *    cause of "split characters" and "random spaces" in OCR output).
 *  - Excessive whitespace is collapsed.
 *  - Meaningful numbers, units, dates and symbols (₹ % g kg ml L etc.) are
 *    preserved verbatim.
 *  - We NEVER invent or replace data. If text looks genuinely corrupted we show
 *    an honest fallback instead of unreadable garbage.
 */

export const UNREADABLE_TEXT = 'Text could not be reliably read'
export const PRODUCT_NAME_FALLBACK = 'Product name not clearly detected'

/** Indic scripts we must not second-guess (their complex combining forms are valid). */
const INDIC_SCRIPTS = /[\u0900-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0BFF\u0C00-\u0CFF\u0D00-\u0DFF\u0E00-\u0E7F\u0600-\u06FF]/

/** Invisible / format controls OCR & encoding corruption like to inject. */
const HIDDEN_RE = /[\u00AD\u200B\u200E\u200F\u2060\u2066-\u2069\uFEFF]/g

/** Classic UTF-8-read-as-Latin-1 mojibake pairs (Ã© → é, â€™ → ’, etc.). */
const MOJIBAKE_RE = /Ã[\x80-\xBF]|â€[\x80-\xBF]|Â[\x80-\xBF]|ï¿½/g

/** C1 controls + decorative symbols that signal decoder garbage in text fields. */
const SUSPICIOUS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F¤§½¾¼±ªº¹²³°«»]/g

const ENTITY_RE = /&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-fA-F]+);/g

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

export function normalizeUnicode(s: string): string {
  return s.normalize ? s.normalize('NFC') : s
}

/** Remove hidden zero-width/format characters that split words apart. */
export function stripHidden(s: string): string {
  return s.replace(HIDDEN_RE, '')
}

/**
 * Repair JSON/transport escaping artifacts: a value double-stringified on the
 * wire arrives as literal `\n` / `\t` / `\r` (two characters) that should read
 * as real separators, and stray backslashes before quotes as plain quotes.
 */
export function repairEscapes(s: string): string {
  return s
    .replace(/\\n/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\r/g, '')
    .replace(/\\(["'\\/])/g, '$1')
}

/**
 * Decode common UTF-8-read-as-Latin-1 mojibake (Ã© → é, â€™ → ’, â€œ → “,
 * â€“ → –, â€¦ → …, etc.) instead of discarding the text. A general decoder:
 * Latin-1 bytes that were originally 2/3-byte UTF-8 are re-read as code points.
 * Returns a string with characters decoded; undecodable control chars are
 * dropped. Only touches the C2–F4 high-byte range, so valid Indic text is
 * never affected.
 */
export function decodeMojibake(s: string): string {
  if (!s) return s
  if (!/[\u0080-\u00FF]/.test(s)) return s
  const bytes = Array.from(s, (ch) => ch.charCodeAt(0))
  const out: string[] = []
  let i = 0
  while (i < bytes.length) {
    const b0 = bytes[i]
    let cp = -1
    let len = 1
    if (b0 >= 0xc2 && b0 <= 0xdf && i + 1 < bytes.length) {
      const b1 = bytes[i + 1]
      if (b1 >= 0x80 && b1 <= 0xbf) {
        cp = ((b0 & 0x1f) << 6) | (b1 & 0x3f)
        len = 2
      }
    } else if (b0 >= 0xe0 && b0 <= 0xef && i + 2 < bytes.length) {
      const b1 = bytes[i + 1]
      const b2 = bytes[i + 2]
      if (b1 >= 0x80 && b1 <= 0xbf && b2 >= 0x80 && b2 <= 0xbf) {
        cp = ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f)
        len = 3
      }
    }
    if (cp >= 0) {
      // Keep printable decoded characters (incl. NBSP → collapses to a space);
      // swallow C0/C1 control artifacts.
      if (!(cp < 0x20 || (cp >= 0x7f && cp <= 0x9f))) out.push(String.fromCodePoint(cp))
      i += len
      continue
    }
    out.push(String.fromCharCode(b0))
    i += 1
  }
  return out.join('')
}

/**
 * Rejoin OCR letter-staggering ("S  u  r  f" from a second-guessed reading)
 * into a real word. Only fires when the text is mostly single characters, so
 * normal label words and Indic scripts are never merged.
 */
export function rejoinStaggered(s: string): string {
  if (!s) return s
  if (INDIC_SCRIPTS.test(s)) return s
  const toks = s.split(/\s+/).filter(Boolean)
  if (toks.length < 6) return s
  const tokenChars = /^[A-Za-z0-9₹%.,:/\-()']+$/
  if (!toks.every((t) => tokenChars.test(t))) return s
  const singles = toks.filter((t) => t.length === 1).length
  if (singles / toks.length >= 0.6) return toks.join('')
  return s
}

/** Collapse every run of whitespace (incl. unicode spaces) to a single space. */
export function collapseWhitespace(s: string): string {
  return s.replace(/[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g, ' ').trim()
}

/** Decode HTML entities once (double-encoded strings render as clean text). */
export function unescapeEntities(s: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return s.replace(ENTITY_RE, (m) => {
    const body = m.slice(1, -1)
    if (body.startsWith('#x')) {
      const cp = Number.parseInt(body.slice(2), 16)
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m
    }
    if (body.startsWith('#')) {
      const cp = Number.parseInt(body.slice(1), 10)
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m
    }
    return named[body] ?? m
  })
}

/* ------------------------------------------------------------------ */
/* Corruption detection (fails closed — never guesses data)            */
/* ------------------------------------------------------------------ */

export function isGarbled(s: string): boolean {
  if (!s) return false
  if (s.includes('\uFFFD')) return true // U+FFFD replacement char = corrupt stream
  if (MOJIBAKE_RE.test(s)) return true // double-encoded UTF-8
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(s)) return true // stray control chars
  if (INDIC_SCRIPTS.test(s)) return false // never second-guess valid Indic text

  const core = s.replace(/\s/g, '')
  if (core.length === 0) return false
  const suspicious = core.match(SUSPICIOUS_RE)?.length ?? 0
  if (suspicious / core.length > 0.04) return true

  // OCR often emits letter-by-letter words ("S  u  r  f") — only for non-Indic
  // text, where single-char tokens are not a valid writing pattern.
  const tokens = s.split(/\s+/).filter(Boolean)
  if (tokens.length >= 8) {
    const singles = tokens.filter((tk) => tk.length === 1).length
    if (singles / tokens.length > 0.5) return true
  }
  return false
}

/* ------------------------------------------------------------------ */
/* Public display helpers                                              */
/* ------------------------------------------------------------------ */

/**
 * Clean a piece of OCR-derived text for display.
 * Returns the clean value, '' for empty, or UNREADABLE_TEXT when the source
 * looks corrupted. Never truncates below `limit` chars if you want full text
 * (pass 0 to disable).
 */
export function displayText(raw: unknown, limit = 500): string {
  const src = String(raw ?? '').trim()
  if (!src) return ''
  let s = repairEscapes(unescapeEntities(normalizeUnicode(stripHidden(src))))
  s = decodeMojibake(s)
  s = collapseWhitespace(s)
  s = rejoinStaggered(s)
  // Strip stray JSON/markdown fences some models leak into string fields.
  s = s.replace(/^```json\s*/i, '').replace(/^```/, '').replace(/```$/, '').trim()
  if (isGarbled(s)) return UNREADABLE_TEXT
  if (limit > 0 && s.length > limit) s = s.slice(0, limit).trimEnd() + '…'
  return s
}

/**
 * A product name is ONE short line, never an OCR paragraph. Returns the clean
 * name when one is reliably available, otherwise PRODUCT_NAME_FALLBACK.
 */
export function displayProductName(raw: unknown): string {
  const src = String(raw ?? '').trim()
  if (!src || /\r|\n/.test(src)) return PRODUCT_NAME_FALLBACK
  const cleaned = displayText(src, 140)
  if (!cleaned || cleaned === UNREADABLE_TEXT) return PRODUCT_NAME_FALLBACK
  if (cleaned.split(/\s+/).length > 18) return PRODUCT_NAME_FALLBACK
  return cleaned
}

/** Clean a sentence-style string (summaries, reasons, issues), removing markdown. */
export function displaySentence(raw: unknown): string {
  const cleaned = displayText(raw, 600)
  if (!cleaned || cleaned === UNREADABLE_TEXT) return cleaned
  const s = cleaned
    .replace(/^\s*[#>_*`-]+\s*/gm, '')
    .replace(/[`*_]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return s || '—'
}

/** Short-count for the summary headers (e.g. "(214 chars)") — never negative. */
export function safeLen(v: unknown): number {
  const s = String(v ?? '')
  return s.length > 0 ? s.length : 0
}