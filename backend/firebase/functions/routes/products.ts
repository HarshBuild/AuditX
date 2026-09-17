/**
 * Products route — server-authoritative product database writes.
 *
 *   POST   /api/products  { barcode, name, brand?, manufacturer?, category?,
 *                           net_quantity?, mrp?, consumer_care?,
 *                           country_of_origin?, best_before_label? }
 *                          upserts a product keyed on its normalized barcode and
 *                          returns { ok: true, product_id }.
 *   DELETE /api/products/:id
 *                          deletes the product document.
 *
 * These writes use the Supabase service-role client, which bypasses RLS —
 * so a product save on the admin panel can never be rejected with
 * "permission denied" even if the deployed policies lag behind the repo.
 * The audit trail (activity_logs) is recorded server-side.
 *
 * Authorization: the auth middleware has already verified the session
 * and validated the caller's profiles row; this route additionally
 * restricts to admin / super_admin accounts.
 */

import { Router, Request, Response } from 'express'
import { deleteProductRow, getProfile, logActivity, upsertProduct } from '../supabase-admin.js'

const router = Router()

function isManager(req: Request): boolean {
  const role = String((req as any).role ?? '')
  return role === 'admin' || role === 'super_admin'
}

async function actorName(uid: string): Promise<string> {
  const profile = await getProfile(uid).catch(() => null)
  return String(profile?.full_name ?? '')
}

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isManager(req)) {
      res.status(403).json({ ok: false, error: 'Forbidden — admin or super_admin required.' })
      return
    }

    const body: Record<string, unknown> = (req.body ?? {}) as Record<string, unknown>
    const barcode = String(body.barcode ?? '').trim()
    const name = String(body.name ?? '').trim()
    if (!barcode || !name) {
      res.status(400).json({ ok: false, error: 'barcode and name are required.' })
      return
    }

    const text = (v: unknown) => String(v ?? '').trim()
    const now = new Date().toISOString()
    const data = {
      barcode,
      name,
      brand: text(body.brand),
      manufacturer: text(body.manufacturer),
      category: text(body.category) || 'Other',
      net_quantity: text(body.net_quantity),
      mrp: text(body.mrp),
      consumer_care: text(body.consumer_care),
      country_of_origin: text(body.country_of_origin),
      best_before_label: text(body.best_before_label),
      updated_at: now,
    }

    const { id: productId, created } = await upsertProduct({ ...data, created_at: now })
    const action = created ? 'product.created' : 'product.updated'

    void logActivity({
      user_id: null,
      actor_id: (req as any).uid,
      actor_name: await actorName((req as any).uid),
      action,
      target_type: 'product',
      target_id: productId,
      details: { barcode },
    })

    res.json({ ok: true, product_id: productId })
  } catch (e: any) {
    console.error('⚠️ /api/products error:', e?.message ?? e)
    res.status(500).json({ ok: false, error: e?.message ?? 'Product save failed.' })
  }
})

router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isManager(req)) {
      res.status(403).json({ ok: false, error: 'Forbidden — admin or super_admin required.' })
      return
    }

    const id = String(req.params.id ?? '').trim()
    if (!id) {
      res.status(400).json({ ok: false, error: 'Product id is required.' })
      return
    }

    const barcodeOfDeleted = await deleteProductRow(id)
    if (barcodeOfDeleted === null) {
      res.status(404).json({ ok: false, error: 'Product not found.' })
      return
    }

    void logActivity({
      user_id: null,
      actor_id: (req as any).uid,
      actor_name: await actorName((req as any).uid),
      action: 'product.deleted',
      target_type: 'product',
      target_id: id,
      details: { barcode: barcodeOfDeleted },
    })

    res.json({ ok: true })
  } catch (e: any) {
    console.error('⚠️ /api/products/:id error:', e?.message ?? e)
    res.status(500).json({ ok: false, error: e?.message ?? 'Product delete failed.' })
  }
})

export default router