/*
 * AuditX — Role/status sync client.
 *
 * Roles live directly on the `profiles` row (no custom-claim indirection).
 * This client calls the deployed AuditX Express API's existing
 * POST /api/set-claims route after a manager approves/revokes an admin or
 * changes account status, so any server-side cache refreshes.
 *
 * The call is best-effort and never blocks the profiles write that already
 * happened; if /api/set-claims fails, the operator is told to check the
 * AuditX API deployment.
 */

import { accessToken, currentUid } from './supabase'
import { CONFIG } from './config'
import { fetchWithTimeout } from './net'

export interface SyncClaimsInput {
  uid: string
  role?: 'user' | 'inspector' | 'admin' | 'super_admin'
  status?: 'active' | 'blocked' | 'pending'
}

/**
 * Sync role/status for a target user via /api/set-claims.
 * Requires the caller to be signed in (their session token authorizes the route).
 * Throws only when the request fails outright; callers decide how to surface it.
 */
export async function syncUserClaims(input: SyncClaimsInput): Promise<void> {
  const user = await currentUid()
  if (!user) throw new Error('Not signed in — claims cannot be synced')
  const base = CONFIG.AUDITX_API_URL.replace(/\/+$/, '')
  const token = await accessToken(true)
  if (!token) throw new Error('Not signed in — claims cannot be synced')
  const res = await fetchWithTimeout(`${base}/api/set-claims`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ uid: input.uid, role: input.role, status: input.status }),
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = ((await res.json()) as { error?: string }).error ?? ''
    } catch {
      /* ignore parse error */
    }
    throw new Error(`Claim sync failed (${res.status}${detail ? ` — ${detail}` : ''})`)
  }
}