/**
 * Barcode route — mirrors the lookupBarcode callable as REST.
 *
 * POST /api/barcode  { barcode }
 *   -> { ok: true, found: boolean, source: 'off|firestore|none',
 *        product: { name, brand, manufacturer, category } | null }
 *
 * 1. Checks the local `products` collection first.
 * 2. Falls back to Open Food Facts (world.openfoodfacts.org).
 * 3. Returns found=false when neither has data.
 */

import { Router, Request, Response } from 'express'
import admin from 'firebase-admin'

const router = Router()

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const barcode = String((req.body ?? {}).barcode ?? '').trim()
    if (!barcode) {
      res.status(400).json({ ok: false, error: 'barcode is required.' })
      return
    }

    // 1️⃣ Local Firestore products collection
    try {
      const snap = await admin
        .firestore()
        .collection('products')
        .where('barcode', '==', barcode)
        .limit(1)
        .get()
      if (!snap.empty) {
        const p = snap.docs[0].data()
        res.json({
          ok: true,
          found: true,
          source: 'firestore',
          product: {
            name: p.name ?? null,
            brand: p.brand ?? null,
            manufacturer: p.manufacturer ?? null,
            category: p.category ?? null,
          },
        })
        return
      }
    } catch (e) {
      console.warn('⚠️ Firestore product lookup failed:', (e as Error).message)
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