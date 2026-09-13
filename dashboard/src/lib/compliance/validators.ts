/**
 * Deterministic field validators.
 *
 * These validate raw extracted values for the compliance engine.
 * IMPORTANT: a valid-looking value is still NOT a legal fact — the engine
 * controls what each validator result means (PASS / WARNING / NOT_VERIFIABLE).
 */
import { VAGUE_QUANTITY_WORDS } from './data'

export interface Validation {
  ok: boolean
  reason: string
  normalized?: string | null
  kind?: 'weight' | 'volume' | 'length' | 'area' | 'number' | 'unknown'
}

const num = (raw: string | null): string | null => (raw ?? '').trim() || null

/** MRP must have: digits + currency/Rs/MRP + "incl. of all taxes". Multiple amounts = ambiguous. */
export function validateMRP(raw: string | null): Validation {
  const v = num(raw)
  if (!v) return { ok: false, reason: 'MRP not detected (NOT_DETECTED).' }
  const hasSymbol = /[₹]|rs\.?|inr|\bmrp\b/i.test(v)
  const hasDigits = /\d/.test(v)
  const hasTaxPhrase = /incl\.?\s*of\s*all\s*taxes|inclusive\s*of\s*all\s*taxes/i.test(v)
  if (!hasDigits) return { ok: false, reason: `"${v}" contains no numeric amount.` }
  if (!hasSymbol) return { ok: false, reason: `"${v}" has no ₹/Rs/MRP symbol.` }
  if (!hasTaxPhrase) return { ok: false, reason: `"${v}" lacks the required "incl. of all taxes" wording (Rule 6(1)(e)).` }
  const amounts = v.match(/\d+(?:\.\d+)?/g)
  if (amounts && amounts.length > 1) {
    return { ok: false, reason: `Multiple amounts "${amounts.join(', ')}" — MRP is ambiguous; flag for verification rather than auto-selecting.`, normalized: v }
  }
  return { ok: true, reason: 'MRP declared with symbol and tax-inclusive wording.', normalized: v }
}

export interface QuantitySpan {
  amount: string
  unit: string
  kind: 'weight' | 'volume' | 'length' | 'area' | 'number'
  start: number
}

/**
 * Fourth Schedule unit dictionary (Rule 13). Longer/spelled-out forms first so
 * "millilitre" wins over "m", "milligram" over "m", "gram" over "g", etc.
 * Units are matched adjacent to a number (e.g. "100g", "900ml", "1L") without
 * requiring a word boundary before them — compact dense label printing is the
 * norm on Indian packaged goods and must not be treated as unreadable.
 */
const QUANTITY_UNITS: Array<{ kind: QuantitySpan['kind']; p: string[] }> = [
  { kind: 'area', p: ['sq\\.?\\s*cm', 'square centimetres?', 'sq\\.?\\s*m', 'square metres?', 'sq\\.?\\s*ft', 'square feet'] },
  { kind: 'weight', p: ['tonnes?', 'tons?', 'kilograms?', 'kg', 'milligrams?', 'mg', 'grams?', 'gms?', 'gm', 'g'] },
  { kind: 'volume', p: ['millilitres?', 'milliliters?', 'mls?', 'ml', 'centilitres?', 'centiliters?', 'cls?', 'cl', 'litres?', 'liters?', 'litres?', 'liters?', 'litre', 'liter', 'ltrs?', 'ltr', 'l'] },
  { kind: 'length', p: ['centimetres?', 'centimeters?', 'cms?', 'cm', 'millimetres?', 'millimeters?', 'mms?', 'mm', 'metres?', 'meters?', 'mtrs?', 'mtr', 'm'] },
  { kind: 'number', p: ['pieces?', 'pcs?', 'nos\\.?', 'numbers?', 'counts?', 'sheets?', 'leaves', 'rolls?', 'pairs?', 'dozens?', 'packs?', 'pkts?'] },
]

const QUANTITY_TAIL = '(?![a-z])'

export function quantitySpans(raw: string | null): QuantitySpan[] {
  const v = (num(raw) ?? '').replace(/,/g, '').toLowerCase()
  if (!v) return []
  const spans: QuantitySpan[] = []
  for (const g of QUANTITY_UNITS) {
    const rx = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${g.p.join('|')})${QUANTITY_TAIL}`, 'gi')
    let m: RegExpExecArray | null
    while ((m = rx.exec(v)) !== null) {
      spans.push({ amount: m[1], unit: m[2], kind: g.kind, start: m.index })
      if (m.index === rx.lastIndex) rx.lastIndex++
    }
  }
  spans.sort((a, b) => a.start - b.start || b.unit.length - a.unit.length)
  return spans
}

/** Detect a unit keyword and normalize it to its canonical symbol. */
export function detectUnit(raw: string | null): { kind: 'weight' | 'volume' | 'length' | 'area' | 'number' | 'unknown'; unit?: string } {
  const spans = quantitySpans(raw)
  if (spans.length === 0) return { kind: 'unknown' }
  const last = spans[spans.length - 1]
  return { kind: last.kind, unit: last.unit }
}

/**
 * Net quantity must carry a standard unit from the dictionary (Rules 11, 12, 13).
 * On multi-unit lines like "5 x 100 g" the right-most quantity pair is the
 * actual net declaration ("5" is the pack count, not the net quantity).
 */
export function validateQuantity(raw: string | null): Validation {
  const v = num(raw)
  if (!v) return { ok: false, reason: 'Net quantity not detected (NOT_DETECTED).' }
  if (VAGUE_QUANTITY_WORDS.some((w) => v.toLowerCase().includes(w))) {
    return { ok: false, reason: `Vague expression "${v}" — Rules 11 & 12 prohibit "approximately/about/minimum" style net-quantity declarations.` }
  }
  const spans = quantitySpans(v)
  if (spans.length === 0) {
    return { ok: false, reason: `"${v}" lacks a standard unit from the Fourth Schedule (g/kg/ml/L/cm/m/pcs…).`, normalized: v }
  }
  const s = spans[spans.length - 1]
  return { ok: true, reason: `Net quantity declared in a standard unit (${s.kind}).`, normalized: `${s.amount} ${s.unit}`.trim(), kind: s.kind }
}

/** A unit must be allowed for the commodity's sold-by type (Rule 13). */
export function validateUnitAgainstSoldBy(unitKind: string, soldBy: string | null): Validation {
  if (!soldBy || soldBy === 'unknown') return { ok: false, reason: 'Sold-by unit type could not be established — mark NOT_VERIFIABLE.', kind: unitKind as 'weight' }
  // sold_by is one of the kinds; compare kinds directly.
  const ok = unitKind === soldBy
  return ok
    ? { ok: true, reason: `Unit kind (${unitKind}) matches commodity sold-by basis (${soldBy}).` }
    : { ok: false, reason: `Unit kind "${unitKind}" does not match the commodity's sold-by basis "${soldBy}".`, kind: unitKind as 'weight' }
}

/** Manufacturing / best-before / use-by date formats (Rule 6(1)(d), 6(1)(g)). */
export function validateDate(raw: string | null): Validation {
  const v = num(raw)
  if (!v) return { ok: false, reason: 'No date detected.' }
  // Shelf-life duration ("Best Before 12 Months") is an accepted declaration form.
  const isDuration = /\b\d+\s*(?:months?|years?|days?|weeks?)\b/i.test(v) &&
    /\b(?:best\s*before|use\s*by|expiry|exp\.?|valid)/i.test(v)
  if (isDuration) {
    return { ok: true, reason: 'Best-before / shelf-life duration declared (e.g. "12 months").' }
  }
  const okFormat =
    /\b\d{1,2}[\s\/\-.]\d{1,2}[\s\/\-.]\d{2,4}\b/.test(v) ||                 // DD/MM/YYYY
    /\b\d{1,2}[\s\/\-.]\d{2,4}\b/.test(v) ||                                  // MM/YYYY
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s*(?:\d{1,2},?\s*)?\d{4}\b/i.test(v) // Jun 2026 / June 2026 / Jan 1, 2026
  if (!okFormat) return { ok: false, reason: `"${v}" is not a recognizable DD/MM/YYYY, Month-YYYY or shelf-life format.` }
  // Strict day/month bounds when the format is DD/MM/YYYY (the common case).
  const dmy = v.trim().match(/^(\d{1,2})[\s\/\-.](\d{1,2})[\s\/\-.](\d{2,4})$/)
  if (dmy) {
    const d = +dmy[1]
    const mo = +dmy[2]
    const year = dmy[3].length === 2 ? 2000 + +dmy[3] : +dmy[3]
    const daysInMonth = new Date(year, mo, 0).getDate()
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth) {
      return { ok: false, reason: `"${v}" has an out-of-range or impossible day/month (${d}/${mo}).` }
    }
    return { ok: true, reason: 'Date format recognized and day/month plausible.' }
  }
  // Basic plausibility for the remaining shapes: month 1-12 / month name.
  const m = v.match(/(?:0?[1-9]|1[0-2])(?=[\s\/\-.]\d)/) || v.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*/i)
  if (!m) return { ok: false, reason: `"${v}" does not contain a valid month.` }
  return { ok: true, reason: 'Date format recognized and month plausible.' }
}

/** Consumer care: must be an actual phone, email or web contact (Rule 6(1)(f)). */
export function validateContact(raw: string | null): Validation {
  const v = num(raw)
  if (!v) return { ok: false, reason: 'Consumer-care contact not detected (NOT_DETECTED).' }
  const digits = (v.match(/\d/g) ?? []).join('')
  const has10Digit = /^\d{10,}$/.test(digits.replace(/^\+?91/, ''))
  const hasTollFree = /1800[\s-]?\d{3}[\s-]?\d{3,4}/i.test(v)
  const hasGrouped = /(?:\d{2,4}[\s-]\d{2,4}[\s-]\d{3,4}|\d{3,5}[\s-/]\d{3,5})/.test(v)
  const hasContactWord = /tel\.?[: ]|phone|helpline|customer care|toll.?free/i.test(v)
  const hasEmail = /\S+@\S+\.\S+/.test(v) || /(?:^|[\s:(])email[: ]|e-mail/i.test(v)
  const hasWeb = /\b(?:www\.|https?:\/\/)\S+|\b[\w.-]+\.(?:com|in|co\.in|org)\b/i.test(v)
  if (has10Digit || hasTollFree || hasGrouped || hasEmail || hasWeb || hasContactWord) {
    return { ok: true, reason: 'Consumer-care contact includes a phone, email or web address.' }
  }
  return { ok: false, reason: `Contact text "${v}" found, but no valid phone number, email or web address is recognizable.` }
}

/** FSSAI licence (food items, FSS Act labelling): 14-digit number ± license format. */
export function validateFssai(raw: string | null): Validation {
  const v = num(raw)
  if (!v) return { ok: false, reason: 'FSSAI licence number not detected on a food item (VERIFY — food labels must carry it).' }
  const digits = (v.match(/\d+/g) ?? []).join('')
  if (digits.length === 14) return { ok: true, reason: `FSSAI licence "${digits}" detected (14-digit format).`, normalized: digits }
  if (digits.length >= 10) return { ok: false, reason: `Detected "${v}" — ${digits.length} digits, expected 14. Flag for manual verification.`, normalized: digits }
  return { ok: false, reason: `Detected "${v}" — not a 14-digit FSSAI licence number.` }
}

/** Veg/non-veg green-dot indicator (FSS labelling). */
export function validateVegNonVeg(raw: string | null): Validation {
  const v = num(raw)
  if (!v) return { ok: false, reason: 'Veg/Non-veg symbol (green/brown dot) not detected on a food item.' }
  const isVeg = /veg|vegetarian|pure veg/i.test(v)
  const isNonVeg = /non.?veg|non.?vegetarian/i.test(v)
  if (isVeg || isNonVeg) return { ok: true, reason: isVeg ? 'Veg mark indicated.' : 'Non-veg mark indicated.', normalized: v }
  return { ok: false, reason: `Detected "${v}" but could not classify as veg/non-veg indicator.` }
}

/** Complete postal address check (Rule 10): needs pincode, state/district hint, city. */
export function validateAddressCompleteness(raw: string | null): Validation {
  const v = num(raw)
  if (!v) return { ok: false, reason: 'No address detected.' }
  const hasPin = /\b\d{6}\b/.test(v)
  const hasState = /\b(?:andhra pradesh|arunachal|assam|bihar|chhattisgarh|goa|gujarat|haryana|himachal|jharkhand|karnataka|kerala|madhya pradesh|maharashtra|manipur|meghalaya|mizoram|nagaland|odisha|orissa|punjab|rajasthan|sikkim|tamil nadu|telangana|tripura|uttar pradesh|uttarakhand|west bengal|delhi|jammu|ladakh|puducherry|chandigarh|dadra|daman|diu|lakshadweep|andaman|nicobar)\b/i.test(v)
  const hasCityish = /\b(?:p\.o\.|po\b|post|district|tehsil|taluka|industrial area|road|street|nagar|phase|chowk|bazaar|bazar)\b/i.test(v)
  if (hasPin || (hasState && hasCityish)) return { ok: true, reason: 'Address has a pincode and/or recognizable locality + state.', normalized: v }
  return { ok: false, reason: `Address "${v}" is present but incomplete — no pincode/state/locality detected. Verify against the physical label.` }
}

/** Detect "by number" declarations (Rule 17). */
export function validateCounted(raw: string | null): Validation {
  const v = num(raw)
  if (!v) return { ok: false, reason: 'No counted quantity declared.' }
  const hasCount = /\b\d+\b/.test(v) && /\b(pcs|pieces|nos|numbers|count|sheets|rolls|pairs|dozen)\b/i.test(v)
  if (hasCount) return { ok: true, reason: 'Counted quantity declared in number units.', normalized: v }
  return { ok: false, reason: `"${v}" does not clearly declare a number of pieces/sheets/units.` }
}

/** Number of usable sheets (Rule 16 — toilet paper, tissues, foils). */
export function validateSheets(raw: string | null): Validation {
  const v = num(raw)
  if (!v) return { ok: false, reason: 'No sheet count / unrolled length declared.' }
  const hasSheets = /\b\d+\s*(?:sheets|leaves|ply)?\b/i.test(v)
  const hasLength = /\b\d+(\.\d+)?\s*(?:m|metre|meter|cm)\b/i.test(v)
  if (hasSheets || hasLength) return { ok: true, reason: 'Sheet count / unrolled length declared.', normalized: v }
  return { ok: false, reason: `"${v}" is not a clear sheet count or unrolled length.` }
}