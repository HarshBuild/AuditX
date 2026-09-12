/**
 * Claims route — mirrors the setClaims callable as REST.
 *
 * POST /api/set-claims  { uid, role }
 *   -> { ok: true, uid, role }
 *
 * Restricted to admin / super_admin accounts (verified by the auth middleware).
 */

import { Router, Request, Response } from 'express'
import admin from 'firebase-admin'

const router = Router()

const VALID_ROLES = ['user', 'inspector', 'admin', 'super_admin']

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const callerRole = String((req as any).role ?? '')
    if (callerRole !== 'admin' && callerRole !== 'super_admin') {
      res.status(403).json({ ok: false, error: 'Forbidden — admin or super_admin required.' })
      return
    }

    const uid = String((req.body ?? {}).uid ?? '').trim()
    const role = String((req.body ?? {}).role ?? '').trim()
    if (!uid) {
      res.status(400).json({ ok: false, error: 'uid is required.' })
      return
    }
    if (!VALID_ROLES.includes(role)) {
      res.status(400).json({ ok: false, error: `role must be one of: ${VALID_ROLES.join(', ')}.` })
      return
    }

    await admin.auth().setCustomUserClaims(uid, { role })

    // Mirror syncClaimsOnUserStatus: keep Firestore profile in sync
    const now = new Date().toISOString()
    const profileRef = admin.firestore().doc(`users/${uid}`)
    const profileSnap = await profileRef.get()
    if (profileSnap.exists) {
      await profileRef.update({ role, updated_at: now, updated_by: (req as any).uid })
    } else {
      await profileRef.set({
        uid,
        email: '',
        name: '',
        role,
        status: 'active',
        invited_by: (req as any).uid,
        created_at: now,
        updated_at: now,
      })
    }

    res.json({ ok: true, uid, role })
  } catch (e: any) {
    console.error('⚠️ /api/set-claims error:', e?.message ?? e)
    res.status(500).json({ ok: false, error: e?.message ?? 'Set claims failed.' })
  }
})

export default router