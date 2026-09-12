/*
 * AuditX v3.0 — Custom-claim sync client.
 *
 * Firestore security rules gate staff collection LIST queries on custom claims
 * (role, status) because a list rule cannot call get() on another document.
 * Claims can only be minted server-side (Firebase Admin SDK), so this client
 * calls the deployed AuditX Express API's existing POST /api/set-claims route
 * after a manager approves/revokes an admin or changes account status.
 *
 * The call is best-effort and never blocks the Firestore write that already
 * happened; if /api/set-claims fails, the operator is told to run
 * scripts/mint-claims.cjs (see DEPLOYMENT.md) so staff list queries work again.
 */

import { auth } from './firebase'
import { CONFIG } from './config'

export interface SyncClaimsInput {
  uid: string
  role?: 'user' | 'inspector' | 'admin' | 'super_admin'
  status?: 'active' | 'blocked' | 'pending'
}

/**
 * Mint/sync custom claims for a target user via /api/set-claims.
 * Requires the caller to be signed in (their ID token authorizes the route).
 * Throws only when the request fails outright; callers decide how to surface it.
 */
export async function syncUserClaims(input: SyncClaimsInput): Promise<void> {
  const user = auth.currentUser
  if (!user) throw new Error('Not signed in — claims cannot be synced')
  const base = CONFIG.AUDITX_API_URL.replace(/\/+$/, '')
  const token = await user.getIdToken(true)
  const res = await fetch(`${base}/api/set-claims`, {
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