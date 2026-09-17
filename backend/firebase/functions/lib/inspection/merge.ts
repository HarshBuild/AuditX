/**
 * Multi-photo merge — Node port of the Python merge layer (itself a port of
 * Misa lib/ocr/merge.ts) plus label-field cleanup used as guard rails.
 *
 * Several label photos are extracted independently; this combines them into
 * ONE inspection:
 *   * first non-empty value wins per field (source image recorded),
 *   * per-field normalizers hide trivial OCR/format differences,
 *   * disagreeing normalized values are flagged as CONFLICTS (both kept),
 *   * per-field confidence + evidence (image, line text, bbox) are returned.
 */

import type {
  MisaConflict,
  MergedFields,
  OcrConfidence,
  PerImageExtract,
} from './types.js'

export interface MergeLabel {
  key: string
  label: string
}

export const FIELD_LABELS: MergeLabel[] = [
  { key: 'commodity_name', label: 'Generic/commodity name' },
  { key: 'brand', label: 'Brand' },
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'net_quantity', label: 'Net quantity' },
  { key: 'mrp', label: 'MRP' },
  { key: 'batch_no', label: 'Batch / lot number' },
  { key: 'mfg_date', label: 'Manufacturing date' },
  { key: 'expiry_date', label: 'Expiry date' },
  { key: 'best_before_date', label: 'Best before date' },
  { key: 'ingredients_text', label: 'Ingredients' },
  { key: 'allergen_info', label: 'Allergen information' },
  { key: 'required_declarations', label: 'Required declarations' },
  { key: 'warnings', label: 'Warnings' },
  { key: 'certification_details', label: 'Certification / standard marking' },
  { key: 'contact_info', label: 'Contact information' },
  { key: 'imported_manufacturer_detail', label: 'Importer detail' },
  { key: 'country_of_origin', label: 'Country of origin' },
  { key: 'storage_conditions', label: 'Storage conditions' },
  { key: 'customer_care_details', label: 'Customer care details' },
]

/* ------------------------------------------------------------------ */
/* Normalizers                                                         */
/* ------------------------------------------------------------------ */

function normText(v: string | null | undefined): string | null {
  if (!v) return null
  const t = String(v).trim().replace(/\s+/g, ' ')
  return t || null
}

function stripTag(v: string): string {
  return v.replace(/\s+#\d+\s*$/, '').trim()
}

function normName(v: string | null | undefined): string | null {
  return normText(stripTag(String(v ?? '')))
}

function normMoney(v: string | null | undefined): string | null {
  const t = String(v ?? '').toLowerCase().replace(/,/g, '')
  const m = /(\d+(?:\.\d+)?)/.exec(t)
  if (!m) return normText(v)
  const cur = /₹|rs\.?|inr/.test(t) ? '₹' : ''
  const n = Number(m[1])
  if (!Number.isFinite(n)) return normText(v)
  return `${cur}${n}`
}

const UNIT_FAMILY: Record<string, [number, string]> = {
  mg: [0.001, 'g'],
  g: [1, 'g'],
  kg: [1000, 'g'],
  ml: [1, 'ml'],
  l: [1000, 'ml'],
}

function normQty(v: string | null | undefined): string | null {
  const t = String(v ?? '').toLowerCase().replace(/,/g, '')
  const m = /(\d+(?:\.\d+)?)\s*(mg|kg|ml|g|l)\b/.exec(t)
  if (!m) return normText(v)
  const [factor, base] = UNIT_FAMILY[m[2]]
  const n = Number(m[1]) * factor
  if (!Number.isFinite(n)) return normText(v)
  return `${n} ${base}`
}

/** Normalize "12/06/2025", "2025-06-12", "12.06.25", "Jun 2025", "05/2026". */
export function normDate(v: string | null | undefined): string | null {
  const t = String(v ?? '').trim()
  if (!t) return null
  const full = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t)
  if (full) {
    const [, y, mo, d] = full
    const n = new Date(Number(y), Number(mo) - 1, Number(d))
    return validDate(n) ? fmtDate(n) : normText(t)
  }
  const dmy = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(t)
  if (dmy) {
    let [, a, b, y] = dmy
    // Two-digit years are everywhere on Indian labels ("12/06/25").
    if (y.length === 2) y = Number(y) > 49 ? `19${y}` : `20${y}`
    let n: Date | null = null
    if (Number(a) > 12 && Number(a) <= 31) {
      n = new Date(Number(y), Number(b) - 1, Number(a))
    } else {
      // Prefer day-first (common on Indian labels) unless month-first is unambiguous.
      n = new Date(Number(y), Number(b) - 1, Number(a))
      if (!validDate(n)) n = new Date(Number(y), Number(a) - 1, Number(b))
    }
    if (n && validDate(n)) return fmtDate(n)
  }
  const mon = /(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[.\- ]*(\d{2,4})/i.exec(t)
  if (mon && Number(mon[2]) > 1900) {
    const m = monthIndex(mon[1])
    if (m > 0) return `${Number(mon[2]) > 99 ? Number(mon[2]) : 2000 + Number(mon[2])}-${String(m).padStart(2, '0')}-01`
  }
  const my = /(?:0?[1-9]|1[0-2])\/(?:19|20)?\d{2}/.exec(t)
  if (my) {
    const [mo, y] = my[0].split('/')
    return `${Number(y) > 99 ? Number(y) : 2000 + Number(y)}-${String(Number(mo)).padStart(2, '0')}-01`
  }
  return normText(t)
}

function validDate(d: Date): boolean {
  return !Number.isNaN(d.getTime()) && d.getFullYear() >= 1980 && d.getFullYear() <= 2100
}

function fmtDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function monthIndex(name: string): number {
  const map: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9,
    september: 9, sept: 9, oct: 10, october: 10, nov: 11, november: 11,
    dec: 12, december: 12,
  }
  return map[name.toLowerCase()] ?? 0
}

function normId(v: string | null | undefined): string | null {
  if (!v) return null
  const t = String(v).replace(/[\s\-]/g, '').toUpperCase()
  return t || null
}

const NORMALIZERS: Record<string, (v: string | null | undefined) => string | null> = {
  commodity_name: normName,
  brand: normName,
  manufacturer: normText,
  net_quantity: normQty,
  mrp: normMoney,
  batch_no: normId,
  mfg_date: normDate,
  expiry_date: normDate,
  best_before_date: normDate,
  ingredients_text: normText,
  allergen_info: normText,
  required_declarations: normText,
  warnings: normText,
  certification_details: normText,
  contact_info: normText,
  imported_manufacturer_detail: normText,
  country_of_origin: normText,
  storage_conditions: normText,
  customer_care_details: normText,
}

export function normalizeField(key: string, value: unknown): string | null {
  const raw = value == null ? null : String(value).trim()
  if (!raw) return null
  const n = (NORMALIZERS[key] ?? normText)(raw)
  return n ?? (raw || null)
}

/** MISA-style alignment text: normalized full-text view of a value. */
export function primaryText(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/* ------------------------------------------------------------------ */
/* Merge                                                               */
/* ------------------------------------------------------------------ */

function val(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s || null
}

export function mergeResults(perImages: PerImageExtract[]): MergedFields {
  const fields: Record<string, string> = {}
  const sources: Record<string, number> = {}
  for (const pi of perImages) {
    for (const { key } of FIELD_LABELS) {
      if (val(fields[key])) continue
      const v = val(pi.fields[key])
      if (v) {
        fields[key] = v
        sources[key] = pi.index + 1
      }
    }
  }

  const conflicts: MisaConflict[] = []
  for (const { key, label } of FIELD_LABELS) {
    const seen = new Map<string, { image: number; value: string }>()
    for (const pi of perImages) {
      const raw = val(pi.fields[key])
      if (!raw) continue
      const n = normalizeField(key, raw)
      if (n === null) continue
      if (!seen.has(n)) seen.set(n, { image: pi.index + 1, value: raw })
    }
    if (seen.size > 1) {
      conflicts.push({ field: key, label, values: [...seen.values()] })
    }
  }

  const fieldConfidence: Record<string, OcrConfidence> = {}
  const fieldEvidence: Record<string, MergedFields['field_evidence'][string]> = {}
  for (const key of Object.keys(sources)) {
    for (const pi of perImages) {
      if (!val(pi.fields[key])) continue
      const ev = pi.field_evidence[key]
      const conf = pi.field_confidence[key] ?? 'low'
      fieldConfidence[key] = conf
      fieldEvidence[key] = {
        image: pi.index + 1,
        text: ev?.text ?? val(pi.fields[key]) ?? '',
        confidence: ev?.confidence ?? null,
        bbox: ev?.bbox ?? null,
      }
      break
    }
  }

  const regions: Array<{ text: string; bbox?: number[] | null; conf?: number | null; image: number }> = []
  for (const pi of perImages) {
    for (const r of pi.regions ?? []) {
      regions.push({ ...r, image: pi.index + 1 })
    }
  }

  const parts = perImages.map((pi, idx) =>
    perImages.length > 1 ? `--- Image ${idx + 1} ---\n${pi.text ?? ''}` : (pi.text ?? ''),
  )

  return {
    fields,
    sources,
    field_confidence: fieldConfidence,
    field_evidence: fieldEvidence,
    conflicts,
    text: parts.join('\n'),
    language: perImages[0]?.language ?? 'und',
    regions,
  }
}

/* ------------------------------------------------------------------ */
/* Guard rails — deterministic cleanup applied to merged field values  */
/* ------------------------------------------------------------------ */

/** Remove noisy OCR artifacts from a free-text value. */
export function cleanClaim(value: string | null | undefined): string | null {
  const v = val(value)
  if (!v) return null
  return v
    .replace(/\r/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\bNRP\b/i, 'MRP')
    .replace(/\bRs\.?\b/gi, '₹')
    .replace(/\bMfg\b/gi, 'Mfg')
    .trim() || null
}

/** Cap label values at a sane length so bad reads cannot inflate the doc. */
export function truncateValue(value: string | null | undefined, max = 500): string | null {
  const v = val(value)
  if (!v) return null
  return v.length > max ? `${v.slice(0, max)}…` : v
}