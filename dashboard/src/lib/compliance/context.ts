/**
 * Package context detection — decides WHICH rules apply and with what
 * verification method, BEFORE any rule is evaluated.
 *
 * The engine never assumes. When a context dimension cannot be determined
 * from the image/data it is marked 'unknown' and the affected rules become
 * NOT_VERIFIABLE.
 */
import {
  AD_KEYWORDS, DIMENSION_COMMODITIES, IMPORT_KEYWORDS, WHOLESALE_KEYWORDS, EXPORT_KEYWORDS,
  EXEMPTION_KEYWORDS, NON_FOOD_CATEGORY_HINTS, PRICE_LINKED_COMMODITIES, COUNT_COMMODITIES,
  SHEET_COMMODITIES,
} from './data'
import type { EngineInputs } from './types'
import { FOOD_CATEGORIES } from './types'

export type PackageType = 'retail' | 'wholesale' | 'export' | 'advertisement' | 'unknown'
export type OriginType = 'indian' | 'imported' | 'unknown'
export type SoldByType = 'weight' | 'volume' | 'length' | 'area' | 'number' | 'unknown'

export interface PackageContext {
  package_type: PackageType
  origin: OriginType
  is_food: boolean
  is_known_category: boolean
  category: string
  sold_by: SoldByType
  special_commodity: string | null
  is_price_linked: boolean
  is_advertisement: boolean
  applicable_exemptions: string[]
  reason: string
}

const lower = (s: string | null): string => (s ?? '').toLowerCase()

/** Sold-by kind of an extracted quantity unit string. */
export function soldByFromQuantity(qty: string | null): SoldByType {
  const q = lower(qty)
  if (/\b(kg|g|gm|gram|mg|tonne|ton)\b/.test(q)) return 'weight'
  if (/\b(ml|millilitre|l|litre|liter|cl)\b/.test(q)) return 'volume'
  if (/\b(cm|centimetre|m|metre|km)\b/.test(q)) return 'length'
  if (/\b(sq cm|sq m|sq ft|square)\b/.test(q)) return 'area'
  if (/\b(pcs|pieces|nos|count|sheets?|rolls?|pairs?|dozen|pairs)\b/.test(q)) return 'number'
  return 'unknown'
}

export function detectContext(d: EngineInputs): PackageContext {
  const ex = d.ex
  const fullText = lower([ex.commodity_name, ex.manufacturer, ex.packer, ex.importer, ex.address,
    ex.country_of_origin, ex.net_quantity, d.productLabelText ?? '', d.ocrText].join(' '))

  // Package type.
  let package_type: PackageType = 'retail'
  if (WHOLESALE_KEYWORDS.some((k) => fullText.includes(k))) package_type = 'wholesale'
  else if (EXPORT_KEYWORDS.some((k) => fullText.includes(k))) package_type = 'export'
  if (d.isAdvertisement || AD_KEYWORDS.some((k) => fullText.includes(k))) package_type = 'advertisement'

  // Origin.
  let origin: OriginType = 'indian'
  const importHint = Boolean(ex.importer || ex.country_of_origin || IMPORT_KEYWORDS.some((k) => fullText.includes(k)))
  if (importHint) origin = 'imported'

  // Food / category.
  const cat = (d.userCategory ?? ex.commodity_name ?? '').trim()
  const isFoodCat = FOOD_CATEGORIES.includes(cat) || (cat.length === 0 && false)
  const foodHintText = lower(ex.commodity_name ?? '') + ' ' + lower(d.userCategory ?? '')
  const nonFoodHit = NON_FOOD_CATEGORY_HINTS.some((k) => foodHintText.includes(k))
  const is_food = isFoodCat || (!nonFoodHit && /(food|snack|lassi|juice|chips|biscuit|tea|coffee|sugar|salt|rice|atta|oil|milk|sauce)|nutrition facts|ingredients/i.test(foodHintText + ' ' + lower(ex.nutrition_info ?? '') + ' ' + lower(ex.ingredients ?? '')))

  // Sold by.
  const soldByQty = soldByFromQuantity(ex.net_quantity)

  // Special commodity (Rules 14/16/17) — check the more specific count/area
  // categories first so ambiguous names (e.g. "kitchen towel") resolve to the
  // sheet/roll basis when the quantity is declared as a count.
  const text = lower(ex.commodity_name ?? '') + ' ' + lower(d.userCategory ?? '')
  let special_commodity: string | null = null
  const qtyLower = lower(ex.net_quantity ?? '')
  const soldAsCount = /\b(pcs|pieces|sheets?|rolls?|count|nos)\b/.test(qtyLower)
  if (soldAsCount) {
    for (const c of SHEET_COMMODITIES) if (text.includes(c)) { special_commodity = `sheets:${c}`; break }
    if (!special_commodity) for (const c of COUNT_COMMODITIES) if (text.includes(c)) { special_commodity = `count:${c}`; break }
  }
  if (!special_commodity) for (const c of DIMENSION_COMMODITIES) if (text.includes(c)) { special_commodity = `dimension:${c}`; break }
  if (!special_commodity) for (const c of SHEET_COMMODITIES) if (text.includes(c)) { special_commodity = `sheets:${c}`; break }
  if (!special_commodity) for (const c of COUNT_COMMODITIES) if (text.includes(c)) { special_commodity = `count:${c}`; break }

  const is_price_linked = PRICE_LINKED_COMMODITIES.some((k) => text.includes(k))

  // Exemptions (Rule 26).
  const applicable_exemptions = EXEMPTION_KEYWORDS
    .filter((e) => e.keywords.some((k) => fullText.includes(k)))
    .map((e) => e.exempt)

  return {
    package_type,
    origin,
    is_food,
    is_known_category: FOOD_CATEGORIES.includes(cat) || ['Cosmetic', 'Household', 'Electronics', 'Stationery', 'PersonalCare', 'Other'].includes(cat),
    category: cat || 'unknown',
    sold_by: soldByQty,
    special_commodity,
    is_price_linked,
    is_advertisement: package_type === 'advertisement',
    applicable_exemptions,
    reason: [
      `Package type: ${package_type}`,
      `Origin: ${origin}`,
      `Category: ${cat || 'unknown'}${is_food ? ' (food)' : ''}`,
      `Sold by: ${soldByQty}`,
      special_commodity ? `Special commodity: ${special_commodity}` : '',
      applicable_exemptions.length ? `Exemptions: ${applicable_exemptions.join(', ')}` : '',
    ].filter(Boolean).join('; '),
  }
}