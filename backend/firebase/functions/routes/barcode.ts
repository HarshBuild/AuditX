/**
 * Barcode route — mirrors the lookupBarcode callable as REST.
 *
 * POST /api/barcode  { barcode }
 *   -> { ok: true, found: boolean, source: 'off|firestore|none',
 *        product: { name, brand, manufacturer, category } | null }
 *
 * 1. Checks the local `products` table first.
 * 2. Falls back to Open Food Facts (world.openfoodfacts.org).
 * 3. Returns found=false when neither has data.
 */

import { Router, Request, Response } from 'express'
import { findProductByBarcode } from '../supabase-admin.js'

const router = Router()

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const barcode = String((req.body ?? {}).barcode ?? '').trim()
    if (!barcode) {
      res.status(400).json({ ok: false, error: 'barcode is required.' })
      return
    }

    // 1️⃣ Local Supabase products table
    try {
      const p = await findProductByBarcode(barcode)
      if (p) {
        res.json({
          ok: true,
          found: true,
          source: 'supabase',
          product: {
            name: (p.name as string | null) ?? null,
            brand: (p.brand as string | null) ?? null,
            manufacturer: (p.manufacturer as string | null) ?? null,
            category: (p.category as string | null) ?? null,
          },
        })
        return
      }
    } catch (e) {
      console.warn('⚠️ Supabase product lookup failed:', (e as Error).message)
    }

    // 2️⃣ Open Food Facts lookup
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)
      try {
        const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`, {
          signal: controller.signal,
          headers: { 'User-Agent': 'AuditX-SIH26034/1.0 (label compliance dashboard)' },
        })
        if (r.ok) {
          const data: any = await r.json()
          const p = data?.product
          if (data?.status === 1 && p?.product_name) {
            const nutriscore = p.nutriscore_grade ? String(p.nutriscore_grade).toUpperCase() : null
            const ecoscore = p.ecoscore_grade ? String(p.ecoscore_grade).toUpperCase() : null
            res.json({
              ok: true,
              found: true,
              source: 'off',
              product: {
                name: p.product_name ?? null,
                brand: p.brands ?? null,
                manufacturer: p.manufacturing_places ? (p.manufacturing_places as string).split(',').map((s: string) => s.trim()).filter(Boolean).join(', ') : (p.owner ? String(p.owner) : null),
                category: p.categories_hierarchy?.[0] ?? p.categories ?? null,
              },
              nutriscore,
              ecoscore,
            })
            return
          }
        }
      } finally {
        clearTimeout(timer)
      }
    } catch (e) {
      console.warn('⚠️ Open Food Facts lookup failed:', (e as Error).message)
    }

    res.json({ ok: true, found: false, source: 'none', product: null })
  } catch (e: any) {
    console.error('⚠️ /api/barcode error:', e?.message ?? e)
    res.status(500).json({ ok: false, error: e?.message ?? 'Barcode lookup failed.' })
  }
})

export default router