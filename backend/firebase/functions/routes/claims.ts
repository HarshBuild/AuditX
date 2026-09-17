/**
 * Claims route — role/status administration (Supabase version).
 *
 * POST /api/set-claims  { uid, role?, status? }
 *   -> { ok: true, uid, role, status }
 *
 * Roles and statuses live directly on the `profiles` row (no custom-claim
 * indirection). Omitted fields are taken from the user's existing profile
 * so a status-only change never wipes the role.
 *
 * Restricted to admin / super_admin accounts (verified by the auth middleware).
 */

import { Router, Request, Response } from 'express'
import { getProfile, updateProfileRow, createProfileRow } from '../supabase-admin.js'

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
    const existing = await getProfile(uid).catch(() => null)
    let finalRole = role
    let finalStatus = status
    if (existing) {
      if (!finalRole) finalRole = String(existing.role ?? 'user')
      if (!finalStatus) finalStatus = String(existing.status ?? 'active')
    } else {
      if (!finalRole) finalRole = 'user'
      if (!finalStatus) finalStatus = 'active'
    }

    if (existing) {
      await updateProfileRow(uid, { role: finalRole, status: finalStatus, updated_by: (req as any).uid })
    } else {
      await createProfileRow({ id: uid, role: finalRole, status: finalStatus })
    }

    res.json({ ok: true, uid, role: finalRole, status: finalStatus })
  } catch (e: any) {
    console.error('⚠️ /api/set-claims error:', e?.message ?? e)
    res.status(500).json({ ok: false, error: e?.message ?? 'Set claims failed.' })
  }
})

export default router