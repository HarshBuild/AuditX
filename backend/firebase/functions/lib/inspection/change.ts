/**
 * Change detection between the current scan and a previous scan of the same
 * product (Misa lib/change/compare.ts + match.ts). Compares the static label
 * declarations only — never the free-text OCR transcript.
 */

import type { Change, MergedFields } from './types.js'
import { normalizeField, primaryText } from './merge.js'

interface ComparableScan {
  id: string
  product_name?: string | null
  barcode?: string | null
  ocr_fields?: Record<string, string | null> | null
  created_at?: string | null
}

const COMPARE_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'commodity_name', label: 'Product name' },
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'net_quantity', label: 'Net quantity' },
  { key: 'mrp', label: 'MRP' },
  { key: 'batch_no', label: 'Batch / lot number' },
  { key: 'mfg_date', label: 'Manufacturing date' },
  { key: 'expiry_date', label: 'Expiry date' },
]

/** Normalize both sides to hide trivial OCR/format differences. */
function normalized(key: string, value: string | null | undefined): string | null {
  return normalizeField(key, value)
}

export function compareScans(previous: ComparableScan | null, current: MergedFields): Change[] {
  if (!previous) return COMPARE_FIELDS.map(({ key, label }) => ({
    field: key,
    label,
    previous: '',
    current: current.fields[key] ?? '',
    kind: 'added',
  }))

  const prevFields: Record<string, string | null> = {}
  const prevAny = previous as unknown as Record<string, unknown>
  const prevExtractions = (prevAny['extractions'] ?? {}) as Record<string, unknown>
  if (previous.ocr_fields) {
    for (const key of COMPARE_FIELDS.map((c) => c.key)) {
      prevFields[key] = previous.ocr_fields[key] ?? null
    }
  } else {
    // Legacy scan documents: map their old field vocabulary onto our keys.
    const legacyMap: Record<string, string> = {
      commodity_name: 'commodity_name',
      manufacturer: 'manufacturer',
      net_quantity: 'net_quantity',
      mrp: 'mrp',
      lot_no: 'batch_no',
      mfg_date: 'mfg_date',
      best_before: 'expiry_date',
    }
    for (const oldKey of Object.keys(legacyMap)) {
      const v = prevAny[oldKey] ?? prevExtractions?.[oldKey]
      prevFields[legacyMap[oldKey]] = v != null ? String(v) : null
    }
  }

  const changes: Change[] = []
  for (const { key, label } of COMPARE_FIELDS) {
    const prev = normalized(key, prevFields[key])
    const curr = normalized(key, current.fields[key])
    if (!prev && !curr) continue
    if (curr && !prev) {
      changes.push({ field: key, label, previous: '', current: prevFields[key] ?? current.fields[key] ?? '', kind: 'added' })
      continue
    }
    if (prev && !curr) {
      changes.push({ field: key, label, previous: prevFields[key] ?? '', current: '', kind: 'removed' })
      continue
    }
    if (primaryText(prev) === primaryText(curr)) continue
    changes.push({ field: key, label, previous: prevFields[key] ?? '', current: current.fields[key] ?? '', kind: 'changed' })
  }
  return changes
}

export type MatchConfidence = 'same_product' | 'same_barcode' | null

/**
 * Pick the best previous scan of the same product and describe how confident
 * the match is. Assumes `candidates` is already latest-first for this user.
 */
export function findPreviousScan(
  ownId: string,
  own: { product_name?: string | null; barcode?: string | null },
  candidates: Array<{ id: string } & Record<string, unknown>>,
  collected: MergedFields | null,
): { previous: ComparableScan | null; confidence: MatchConfidence } {
  const product = own.product_name ?? collected?.fields.commodity_name ?? ''
  const barcode = own.barcode ?? ''
  const pn = primaryText(product)
  const bc = barcode.replace(/\s+/g, '')

  for (const c of candidates) {
    if (c.id === ownId) continue
    const cName = primaryText(typeof c.product_name === 'string' ? c.product_name : '')
    if (pn && cName && (cName === pn || cName.includes(pn) || pn.includes(cName))) {
      return { previous: c, confidence: 'same_product' }
    }
  }
  if (bc) {
    for (const c of candidates) {
      if (c.id === ownId) continue
      const cBc = String(typeof c.barcode === 'string' ? c.barcode : '').replace(/\s+/g, '')
      if (cBc && cBc === bc) return { previous: c, confidence: 'same_barcode' }
    }
  }
  return { previous: null, confidence: null }
}