/**
 * Claims route — mirrors the setClaims callable as REST.
 *
 * POST /api/set-claims  { uid, role?, status? }
 *   -> { ok: true, uid, role, status }
 *
 * Mint/prune the Firestore-rule custom claims (role, status) that collection
 * LIST queries depend on. Omitted fields are taken from the user's existing
 * profile/claims so a status-only change never wipes the role. The Firestore
 * document remains the authoritative role source for get rules; this keeps
 * custom claims in sync for query-compatible list rules.
 *
 * Restricted to admin / super_admin accounts (verified by the auth middleware).
 */

import { Router, Request, Response } from 'express'
import admin from 'firebase-admin'

const router = Router()

const VALID_ROLES = ['user', 'inspector', 'admin', 'super_admin']
const VALID_STATUSES = ['active', 'blocked', 'pending']

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const callerRole = String((req as any).role ?? '')
    if (callerRole !== 'admin' && callerRole !== 'super_admin') {
      res.status(403).json({ ok: false, error: 'Forbidden — admin or super_admin required.' })
      return
    }

    const uid = String((req.body ?? {}).uid ?? '').trim()
    const role = String((req.body ?? {}).role ?? '').trim()
    const status = String((req.body ?? {}).status ?? '').trim()
    if (!uid) {
      res.status(400).json({ ok: false, error: 'uid is required.' })
      return
    }
    if (role && !VALID_ROLES.includes(role)) {
      res.status(400).json({ ok: false, error: `role must be one of: ${VALID_ROLES.join(', ')}.` })
      return
    }
    if (status && !VALID_STATUSES.includes(status)) {
      res.status(400).json({ ok: false, error: `status must be one of: ${VALID_STATUSES.join(', ')}.` })
      return
    }

    // Resolve defaults from the existing profile so partial updates are safe.
    const now = new Date().toISOString()
    const profileRef = admin.firestore().doc(`users/${uid}`)
    const profileSnap = await profileRef.get()
    let finalRole = role
    let finalStatus = status
    if (profileSnap.exists) {
      const data = profileSnap.data() ?? {}
      if (!finalRole) finalRole = String(data.role ?? 'user')
      if (!finalStatus) finalStatus = String(data.status ?? 'active')
    } else {
      if (!finalRole) finalRole = 'user'
      if (!finalStatus) finalStatus = 'active'
    }

    await admin.auth().setCustomUserClaims(uid, { role: finalRole, status: finalStatus })

    // Mirror syncClaimsOnUserStatus: keep the Firestore profile in sync.
    if (profileSnap.exists) {
      await profileRef.update({ role: finalRole, status: finalStatus, updated_at: now, updated_by: (req as any).uid })
    } else {
      await profileRef.set({
        uid,
        email: '',
        name: '',
        role: finalRole,
        status: finalStatus,
        invited_by: (req as any).uid,
        created_at: now,
        updated_at: now,
      })
    }

    res.json({ ok: true, uid, role: finalRole, status: finalStatus })
  } catch (e: any) {
    console.error('⚠️ /api/set-claims error:', e?.message ?? e)
    res.status(500).json({ ok: false, error: e?.message ?? 'Set claims failed.' })
  }
})

export default router