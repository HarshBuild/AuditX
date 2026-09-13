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
 * These writes use the Firebase Admin SDK, which is NOT constrained by the
 * client Firestore security rules — so a product save on the admin panel can
 * never be rejected with "Missing or insufficient permissions" even if the
 * deployed rules lag behind the repo. The Admin SDK also means the audit trail
 * (activityLogs) is recorded server-side.
 *
 * Authorization: the firebaseAuthMiddleware has already verified the ID token
 * and validated the caller's users/{uid} profile; this route additionally
 * restricts to admin / super_admin accounts (matching allow isManager() in
 * backend/firebase/firestore.rules).
 */

import { Router, Request, Response } from 'express'
import admin from 'firebase-admin'

const router = Router()

function isManager(req: Request): boolean {
  const role = String((req as any).role ?? '')
  return role === 'admin' || role === 'super_admin'
}

async function actorName(uid: string): Promise<string> {
  const snap = await admin.firestore().doc(`users/${uid}`).get()
  const data = snap.data() ?? {}
  return String(data.full_name ?? data.display_name ?? data.name ?? '')
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

    const products = admin.firestore().collection('products')
    const existing = await products.where('barcode', '==', barcode).limit(1).get()

    let productId: string
    let action: 'product.created' | 'product.updated'
    if (!existing.empty) {
      productId = existing.docs[0].id
      await existing.docs[0].ref.update(data)
      action = 'product.updated'
    } else {
      const docRef = await products.add({ ...data, created_at: now })
      productId = docRef.id
      action = 'product.created'
    }

    void admin
      .firestore()
      .collection('activityLogs')
      .add({
        user_id: null,
        actor_id: (req as any).uid,
        actor_name: await actorName((req as any).uid),
        action,
        target_type: 'product',
        target_id: productId,
        details: { barcode },
        created_at: now,
      })
      .catch(() => {})

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

    const ref = admin.firestore().doc(`products/${id}`)
    const snap = await ref.get()
    if (!snap.exists) {
      res.status(404).json({ ok: false, error: 'Product not found.' })
      return
    }
    const dataDoc = snap.data() ?? {}
    await ref.delete()

    void admin
      .firestore()
      .collection('activityLogs')
      .add({
        user_id: null,
        actor_id: (req as any).uid,
        actor_name: await actorName((req as any).uid),
        action: 'product.deleted',
        target_type: 'product',
        target_id: id,
        details: { barcode: String(dataDoc.barcode ?? '') },
        created_at: new Date().toISOString(),
      })
      .catch(() => {})

    res.json({ ok: true })
  } catch (e: any) {
    console.error('⚠️ /api/products/:id error:', e?.message ?? e)
    res.status(500).json({ ok: false, error: e?.message ?? 'Product delete failed.' })
  }
})

export default router