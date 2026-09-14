/*
 * AuditX v3.0 — Firestore mutation services.
 *
 * These replace the former Supabase RPCs (admin_set_scan_status, admin_manual_review,
 * set_admin_status, set_user_status, approve/reject_admin_request, touch_last_login…).
 *
 * Security note: the client-side role check here (requireClaim) mirrors the previous
 * "UX fail-fast". The actual authorization boundary is the Firestore security rules
 * (backend/firebase/firestore.rules) which verify Firebase custom claims
 * (role = {admin,super_admin}, status == 'active') before allowing any write.
 */

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { auth, db } from './firebase'
import { COLLECTIONS } from './db'
import { syncUserClaims } from './claims'
import { CONFIG } from './config'
import type { ManualResult, ScanRow, Severity } from './types2'

/* ------------------------------------------------------------------ */
/* Pre-flight authorization (UX only — rules are the boundary)         */
/* ------------------------------------------------------------------ */

async function requireStaff(): Promise<{ uid: string; name: string }> {
  const user = auth.currentUser
  if (!user) throw new Error('Not authenticated')
  const snap = await getDoc(doc(db, COLLECTIONS.USERS, user.uid))
  const role = String(snap.data()?.role ?? 'user')
  const status = String(snap.data()?.status ?? 'pending')
  // Staff = super_admin only (legacy admin/inspector docs map here too).
  if (role !== 'admin' && role !== 'super_admin' && role !== 'inspector') {
    throw new Error('Forbidden: staff access required')
  }
  if (status !== 'active') {
    throw new Error('Forbidden: account is not active')
  }
  return { uid: user.uid, name: String(snap.data()?.full_name ?? user.displayName ?? '') }
}

/** Managers only (admin + super_admin, incl. legacy admin docs) — for user/product/rule administration. */
async function requireManager(): Promise<{ uid: string; name: string }> {
  const actor = await requireStaff()
  const snap = await getDoc(doc(db, COLLECTIONS.USERS, actor.uid))
  const role = String(snap.data()?.role ?? 'user')
  if (role !== 'admin' && role !== 'super_admin') {
    throw new Error('Forbidden: manager access required')
  }
  return actor
}

async function logActivity(actor: { uid: string; name: string }, action: string, targetType: string, targetId: string, details: Record<string, unknown>) {
  try {
    await addDoc(collection(db, COLLECTIONS.ACTIVITY_LOGS), {
      user_id: null,
      actor_id: actor.uid,
      actor_name: actor.name,
      action,
      target_type: targetType,
      target_id: targetId,
      details,
      created_at: new Date().toISOString(),
    })
  } catch {
    /* audit must never break the primary mutation */
  }
}

async function notify(userId: string, type: string, title: string, body: string, link: string, data: Record<string, unknown> = {}) {
  if (!userId) return
  await addDoc(collection(db, COLLECTIONS.NOTIFICATIONS), {
    user_id: userId,
    type,
    title,
    body,
    link,
    read: false,
    read_at: null,
    data,
    created_at: new Date().toISOString(),
  })
}

/* ------------------------------------------------------------------ */
/* Scan lifecycle                                                      */
/* ------------------------------------------------------------------ */

export async function createScan(
  input: Pick<ScanRow, 'product_name' | 'brand' | 'manufacturer' | 'category' | 'overall_score' | 'verdict' | 'summary' | 'rules'> &
    Partial<Pick<ScanRow, 'barcode' | 'ocr_text' | 'ai_insights' | 'risk_score' | 'status' | 'latitude' | 'longitude' | 'location_name' | 'language'>> & {
      image_url?: string
    },
): Promise<string> {
  const user = auth.currentUser
  if (!user) throw new Error('Not authenticated')
  const uid = user.uid
  const risk = Math.max(0, Math.min(100, input.risk_score ?? 100 - input.overall_score))
  const ref = doc(collection(db, COLLECTIONS.SCANS))
  await setDoc(ref, {
    user_id: uid,
    product_name: input.product_name,
    brand: input.brand ?? '',
    manufacturer: input.manufacturer ?? '',
    category: input.category ?? '',
    barcode: input.barcode ?? '',
    overall_score: input.overall_score,
    verdict: input.verdict,
    summary: input.summary ?? '',
    image_url: input.image_url ?? '',
    rules: input.rules ?? [],
    risk_score: risk,
    status: input.status ?? 'analyzed',
    ocr_text: input.ocr_text ?? '',
    ai_insights: input.ai_insights ?? [],
    manual_result: null,
    notes: '',
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    location_name: input.location_name ?? '',
    language: input.language ?? '',
    created_at: new Date().toISOString(),
  })
  await notify(
    uid,
    'scan',
    'Analysis completed',
    `"${input.product_name}" scored ${input.overall_score}/100.`,
    '/scan-history',
    { scan_id: ref.id },
  )
  return ref.id
}

/**
 * User correction loop — a scanned field the OCR read wrong is corrected by
 * the user. Evidence-first: the previous (AI/OCR) value is KEPT as
 * `original_value`, never silently overwritten, and the correction is logged
 * on the scan so the audit trail stays intact. Only the owner or a staff
 * member may correct a scan.
 */
export async function userCorrectField(scanId: string, field: string, corrected: string): Promise<void> {
  const actor = auth.currentUser
  if (!actor) throw new Error('Not authenticated')
  const scanned = await getDoc(doc(db, COLLECTIONS.SCANS, scanId))
  if (!scanned.exists()) throw new Error('Scan not found')
  const data = scanned.data()
  const ownerId = data.user_id ? String(data.user_id) : ''
  const isStaff = await isStaffUser(actor.uid).catch(() => false)
  if (ownerId && ownerId !== actor.uid && !isStaff) throw new Error('You can only correct scans you created.')

  const key = field.replace(/[^a-zA-Z0-9_]/g, '_')
  const prevField = data.extraction_fields?.[key]
  const prevValue = typeof prevField?.value === 'string' ? prevField.value : null
  const prevExtraction = data.extractions?.[key]

  const fresh: Record<string, unknown> = {
    [`extraction_fields.${key}`]: {
      ...(prevField ?? {}),
      value: corrected,
      verification: 'user_corrected',
      status: 'USER_CORRECTED',
      confidence_score: 1,
      conflict: false,
      original_value: prevValue ?? prevExtraction ?? null,
    },
    [`extractions.${key}`]: corrected,
    [`user_corrections.${key}`]: {
      corrected_value: corrected,
      original_value: prevValue ?? prevExtraction ?? null,
      corrected_by: actor.uid,
      corrected_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  }

  await updateDoc(doc(db, COLLECTIONS.SCANS, scanId), fresh)
  void logActivity({ uid: actor.uid, name: actor.displayName ?? actor.email ?? '' }, 'scan.field_corrected', 'scan', scanId, { field: key, value: corrected, original: prevValue ?? prevExtraction ?? null })
}

async function isStaffUser(uid: string): Promise<boolean> {
  const snap = await getDoc(doc(db, COLLECTIONS.USERS, uid))
  const role = String(snap.data()?.role ?? 'user')
  return role === 'admin' || role === 'super_admin'
}

export async function setScanStatus(scanId: string, status: ScanRow['status'], notes: string) {
  const actor = await requireStaff()
  const scan = await getDoc(doc(db, COLLECTIONS.SCANS, scanId))
  if (!scan.exists()) throw new Error('Scan not found')
  const data = scan.data()
  const ownerId = data.user_id ? String(data.user_id) : ''
  const product = String(data.product_name ?? '')

  await updateDoc(doc(db, COLLECTIONS.SCANS, scanId), {
    status,
    notes: notes.trim() ? notes.trim() : (data.notes ?? ''),
    updated_at: new Date().toISOString(),
  })

  if (ownerId) {
    const msg =
      status === 'flagged'
        ? 'was flagged for review'
        : status === 'manual_review'
          ? 'was sent for manual review'
          : status === 'resolved'
            ? 'was marked as reviewed'
            : 'was updated'
    void notify(ownerId, 'scan', 'Scan status updated', `Your scan "${product}" ${msg}.`, '/scan-history', {
      scan_id: scanId,
      status,
    })
  }
  void logActivity(actor, 'scan.status_changed', 'scan', scanId, { status, notes })
}

export async function manualReview(
  scanId: string,
  payload: {
    score: number
    corrections: Record<string, string>
    violationsAdded: Array<{ type?: string; severity: Severity; description?: string }>
    violationsRemoved: string[]
    notes: string
  },
) {
  const actor = await requireStaff()
  if (payload.score < 0 || payload.score > 100) throw new Error('Manual score must be 0-100')

  const scanRef = doc(db, COLLECTIONS.SCANS, scanId)
  const scan = await getDoc(scanRef)
  if (!scan.exists()) throw new Error('Scan not found')
  const data = scan.data()
  const ownerId = data.user_id ? String(data.user_id) : ''
  const product = String(data.product_name ?? '')
  const aiScore = Number(data.overall_score ?? 0)

  const manual: ManualResult = {
    score: payload.score,
    verified_by: actor.uid,
    verified_at: new Date().toISOString(),
    corrections: payload.corrections,
    notes: payload.notes,
  }

  await updateDoc(scanRef, {
    manual_result: manual,
    overall_score: payload.score,
    risk_score: Math.max(0, Math.min(100, 100 - payload.score)),
    status: 'resolved',
    notes: payload.notes.trim() ? payload.notes.trim() : (data.notes ?? ''),
    updated_at: new Date().toISOString(),
  })

  await addDoc(collection(db, COLLECTIONS.INSPECTION_REVIEWS), {
    scan_id: scanId,
    admin_id: actor.uid,
    ai_score: aiScore,
    manual_score: payload.score,
    corrections: payload.corrections,
    violations_added: payload.violationsAdded,
    violations_removed: payload.violationsRemoved.map((id) => ({ id })),
    notes: payload.notes,
    created_at: new Date().toISOString(),
  })

  for (const v of payload.violationsAdded) {
    if (!v.type && !v.description) continue
    await addDoc(collection(db, COLLECTIONS.VIOLATIONS), {
      scan_id: scanId,
      product_name: product,
      manufacturer: data.manufacturer ?? data.brand ?? '',
      category: data.category ?? '',
      type: v.type ?? 'rule_violation',
      severity: v.severity,
      status: 'Detected',
      description: v.description ?? '',
      created_by: actor.uid,
      created_at: new Date().toISOString(),
    })
  }

  for (const id of payload.violationsRemoved) {
    const vRef = doc(db, COLLECTIONS.VIOLATIONS, id)
    const v = await getDoc(vRef)
    if (v.exists() && v.data().scan_id === scanId) {
      await updateDoc(vRef, {
        status: 'Rejected',
        resolved_by: actor.uid,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    }
  }

  if (ownerId) {
    void notify(
      ownerId,
      'review',
      'Manual review completed',
      `An inspector verified your scan "${product}" (score ${payload.score}/100).`,
      '/scan-history',
      { scan_id: scanId, manual_score: payload.score },
    )
  }
  void logActivity(actor, 'scan.manual_review', 'scan', scanId, {
    ai_score: aiScore,
    manual_score: payload.score,
    violations_added: payload.violationsAdded.length,
    violations_removed: payload.violationsRemoved.length,
  })
}

/* ------------------------------------------------------------------ */
/* Account administration (super admin / admin)                        */
/* ------------------------------------------------------------------ */

export async function approveAdminRequest(targetUserId: string, approve: boolean) {
  const actor = await requireManager()
  const reqSnapshot = await getDocs(
    query(collection(db, COLLECTIONS.ADMIN_REQUESTS), where('user_id', '==', targetUserId), limit(1)),
  )
  const status = approve ? 'approved' : 'rejected'
  await updateDoc(doc(db, COLLECTIONS.USERS, targetUserId), {
    role: approve ? 'super_admin' : 'user',
    status: 'active',
    updated_at: new Date().toISOString(),
  })
  if (!reqSnapshot.empty) {
    await updateDoc(reqSnapshot.docs[0].ref, {
      status,
      reviewed_by: actor.uid,
      reviewed_at: new Date().toISOString(),
    })
  }
  await notify(
    targetUserId,
    'account',
    approve ? 'Admin access approved' : 'Admin request rejected',
    approve
      ? 'Welcome aboard! You now have super admin access.'
      : 'Your admin request was not approved. You can continue as a standard user.',
    approve ? '/super-admin-dashboard' : '/user-dashboard',
    { request_id: reqSnapshot.empty ? '' : reqSnapshot.docs[0].id },
  )
  void logActivity(actor, approve ? 'admin_request.approved' : 'admin_request.rejected', 'user', targetUserId, { status })
  // The doc write above already succeeded — but custom claims are what Firestore
  // LIST rules check, and only the Admin SDK (via the AuditX API) can mint them.
  // Sync them now; if the API is unreachable, surface it so the operator can run
  // scripts/mint-claims.cjs and staff list queries take effect.
  try {
    await syncUserClaims({ uid: targetUserId, role: approve ? 'super_admin' : 'user', status: 'active' })
  } catch (e) {
    throw new Error(
      `Account updated, but staff-access sync failed (${(e as Error).message}). Run scripts/mint-claims.cjs to grant list access, or check the AuditX API.`,
    )
  }
}

export async function setAdminStatus(targetUserId: string, status: 'active' | 'blocked' | 'pending') {
  const actor = await requireManager()
  await updateDoc(doc(db, COLLECTIONS.USERS, targetUserId), {
    status,
    updated_at: new Date().toISOString(),
  })
  await notify(
    targetUserId,
    'account',
    status === 'blocked' ? 'Account blocked' : status === 'active' ? 'Account activated' : 'Account pending',
    status === 'blocked'
      ? 'Your admin access has been blocked. Contact the super admin.'
      : status === 'active'
        ? 'Your admin account is active again.'
        : 'Your admin account is pending approval.',
    '/admin-pending',
    {},
  )
  void logActivity(actor, `admin.status.${status}`, 'user', targetUserId, { status })
  // Keep custom claims in sync so status-gated rules (claimsActive) apply
  // immediately after refresh. Role is preserved server-side when omitted.
  try {
    await syncUserClaims({ uid: targetUserId, status })
  } catch (e) {
    throw new Error(
      `Status updated, but claim sync failed (${(e as Error).message}). Run scripts/mint-claims.cjs to apply the access change.`,
    )
  }
}

export async function setUserStatus(targetUserId: string, status: 'active' | 'blocked') {
  const actor = await requireManager()
  await updateDoc(doc(db, COLLECTIONS.USERS, targetUserId), {
    status,
    updated_at: new Date().toISOString(),
  })
  await notify(
    targetUserId,
    'account',
    status === 'blocked' ? 'Account blocked' : 'Account activated',
    status === 'blocked'
      ? 'Your account has been blocked. Contact support for assistance.'
      : 'Your account has been re-activated. Welcome back!',
    status === 'blocked' ? '/blocked' : '/user-dashboard',
    {},
  )
  void logActivity(actor, `user.status.${status}`, 'user', targetUserId, { status })
  // Keep custom claims in sync — a blocked claim immediately denies the
  // account's staff-scoped queries on next token refresh.
  try {
    await syncUserClaims({ uid: targetUserId, status })
  } catch (e) {
    throw new Error(
      `Status updated, but claim sync failed (${(e as Error).message}). Run scripts/mint-claims.cjs to apply the access change.`,
    )
  }
}

export async function updateProfileFields(targetUserId: string, patch: { full_name?: string; organization?: string }) {
  const actor = await requireManager()
  void actor
  const updates: Record<string, string> = { updated_at: new Date().toISOString() }
  if (patch.full_name !== undefined) updates.full_name = patch.full_name
  if (patch.organization !== undefined) updates.organization = patch.organization
  await updateDoc(doc(db, COLLECTIONS.USERS, targetUserId), updates)
}

/* ------------------------------------------------------------------ */
/* Compliance rules (super admin)                                      */
/* ------------------------------------------------------------------ */

export async function addComplianceRule(input: {
  rule_key: string
  title: string
  description: string
  category: string
  severity: Severity
  required: boolean
}) {
  const actor = await requireManager()
  const ref = doc(collection(db, COLLECTIONS.COMPLIANCE_RULES))
  await setDoc(ref, {
    rule_key: input.rule_key.toUpperCase(),
    title: input.title,
    description: input.description,
    category: input.category,
    severity: input.severity,
    required: input.required,
    status: 'active',
    is_active: true,
    created_by: actor.uid,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  void logActivity(actor, 'compliance_rule.created', 'complianceRule', ref.id, { rule_key: input.rule_key })
}

export async function toggleComplianceRule(ruleId: string, active: boolean) {
  const actor = await requireManager()
  await updateDoc(doc(db, COLLECTIONS.COMPLIANCE_RULES, ruleId), {
    is_active: active,
    status: active ? 'active' : 'disabled',
    updated_at: new Date().toISOString(),
  })
  void logActivity(actor, active ? 'compliance_rule.enabled' : 'compliance_rule.disabled', 'complianceRule', ruleId, {})
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export async function markNotificationRead(notificationId: string) {
  await updateDoc(doc(db, COLLECTIONS.NOTIFICATIONS, notificationId), {
    read: true,
    read_at: new Date().toISOString(),
  })
}

export async function markAllNotificationsRead() {
  const uid = auth.currentUser?.uid
  if (!uid) return
  const snap = await getDocs(
    query(collection(db, COLLECTIONS.NOTIFICATIONS), orderBy('created_at', 'desc'), limit(150)),
  )
  const mine = snap.docs.filter((d) => d.data()?.user_id === uid && d.data()?.read === false)
  await Promise.all(mine.map((d) => updateDoc(d.ref, { read: true, read_at: new Date().toISOString() })))
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

export async function submitReport(input: {
  scanId?: string | null
  title: string
  description: string
  productName: string
  manufacturer: string
  category: string
  severity: Severity
}) {
  const uid = auth.currentUser?.uid
  if (!uid) throw new Error('Not authenticated')
  const ref = doc(collection(db, COLLECTIONS.REPORTS))
  await setDoc(ref, {
    user_id: uid,
    scan_id: input.scanId ?? null,
    title: input.title,
    description: input.description,
    product_name: input.productName,
    manufacturer: input.manufacturer,
    category: input.category,
    severity: input.severity,
    priority: input.severity === 'critical' ? 'Critical' : input.severity === 'high' ? 'High' : input.severity === 'medium' ? 'Medium' : 'Low',
    status: 'Pending',
    assigned_to: null,
    assigned_at: null,
    resolved_by: null,
    resolved_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  // Notify active staff. Enforcement is via rules; we gather the roster here.
  const roster = await getDocs(query(collection(db, COLLECTIONS.USERS), orderBy('created_at', 'desc'), limit(500)))
  const staff = roster.docs.filter((d) => {
    const r = d.data()
    return (r.role === 'admin' || r.role === 'super_admin' || r.role === 'inspector') && r.status === 'active'
  })
  await Promise.all(
    staff.map((d) =>
      notify(
        d.id,
        'report',
        'New compliance report',
        `"${input.title}" — "${input.productName}" by ${input.manufacturer || 'unknown'}.`,
        '/admin/reports',
        { report_id: ref.id },
      ),
    ),
  )
  return ref.id
}

/* ------------------------------------------------------------------ */
/* Product database (admin-managed barcode catalogue)                   */
/* ------------------------------------------------------------------ */

export async function upsertProduct(input: {
  barcode: string
  name: string
  brand?: string
  manufacturer?: string
  category?: string
  net_quantity?: string
  mrp?: string
  consumer_care?: string
  country_of_origin?: string
  best_before_label?: string
}) {
  const actor = await requireManager()
  const barcode = input.barcode.trim()
  if (!barcode) throw new Error('Barcode is required')

  try {
    const productId = await apiUpsertProduct(input)
    void logActivity(actor, 'product.upserted_via_api', 'product', productId, { barcode, api: true })
    return productId
  } catch (e) {
    // Server-authoritative failures (auth, validation, 403/500) are never
    // retried — they surface to the admin as the real cause.
    if (!(e instanceof TypeError)) throw e
    // Network-level failure (backend down / CORS / wrong base URL). Every
    // build falls back to a direct Firestore write, which succeeds whenever
    // the products rules allow (isManager() || claimsManager()). If that
    // write is denied, rethrow with the combined, honest cause so the
    // operator knows exactly which gate to fix: backend availability or
    // rules/claims.
    console.warn(
      `[products] auditx-api unreachable at ${CONFIG.AUDITX_API_URL} — falling back to a direct Firestore write.`,
    )
    try {
      const productId = await saveProductDirect({ ...input, barcode })
      void logActivity(actor, 'product.upserted_via_firestore', 'product', productId, { barcode, api: false })
      return productId
    } catch (fallbackErr) {
      throw new Error(
        `Product save failed: ${describeWriteBlock(fallbackErr, 'save')} ` +
          `The AuditX product API at ${CONFIG.AUDITX_API_URL} is unreachable ` +
          'and the direct Firestore write was denied. Deploy the auditx-api service (render.yaml) ' +
          'or upload backend/firebase/firestore.rules and confirm this account has the manager role/claims.',
      )
    }
  }
}

/** Direct Firestore write used by the offline/fallback path for products. */
async function saveProductDirect(input: {
  barcode: string
  name: string
  brand?: string
  manufacturer?: string
  category?: string
  net_quantity?: string
  mrp?: string
  consumer_care?: string
  country_of_origin?: string
  best_before_label?: string
}): Promise<string> {
  const existing = await findProductByBarcodeInternal(input.barcode)
  const now = new Date().toISOString()
  const data = {
    barcode: input.barcode,
    name: input.name.trim(),
    brand: (input.brand ?? '').trim(),
    manufacturer: (input.manufacturer ?? '').trim(),
    category: (input.category ?? 'Other').trim(),
    net_quantity: (input.net_quantity ?? '').trim(),
    mrp: (input.mrp ?? '').trim(),
    consumer_care: (input.consumer_care ?? '').trim(),
    country_of_origin: (input.country_of_origin ?? '').trim(),
    best_before_label: (input.best_before_label ?? '').trim(),
    updated_at: now,
  }

  if (existing) {
    await updateDoc(doc(db, COLLECTIONS.PRODUCTS, existing.id), data)
    return existing.id
  }
  const ref = doc(collection(db, COLLECTIONS.PRODUCTS))
  await setDoc(ref, { ...data, created_at: now })
  return ref.id
}

/** Readable explanation of a Firestore fallback rejection. */
function describeWriteBlock(err: unknown, action: 'save' | 'delete'): string {
  const code = (err as { code?: string })?.code ?? ''
  const msg = (err as Error)?.message ?? ''
  if (code === 'permission-denied' || /denied|permission/i.test(msg)) {
    return `Firestore rejected the ${action} with "Missing or insufficient permissions".`
  }
  return `The direct Firestore ${action} failed${msg ? ` (${msg})` : ''}.`
}

export async function deleteProduct(productId: string) {
  const actor = await requireManager()
  try {
    await apiDeleteProduct(productId)
    void logActivity(actor, 'product.deleted_via_api', 'product', productId, { api: true })
    return
  } catch (e) {
    if (!(e instanceof TypeError)) throw e
    console.warn(
      `[products] auditx-api unreachable at ${CONFIG.AUDITX_API_URL} — falling back to a direct Firestore delete.`,
    )
    try {
      const snap = await getDoc(doc(db, COLLECTIONS.PRODUCTS, productId))
      if (!snap.exists()) throw new Error('Product not found')
      const { deleteDoc } = await import('firebase/firestore')
      await deleteDoc(doc(db, COLLECTIONS.PRODUCTS, productId))
      void logActivity(actor, 'product.deleted', 'product', productId, { barcode: snap.data()?.barcode })
      return
    } catch (fallbackErr) {
      throw new Error(
        `Product delete failed: ${describeWriteBlock(fallbackErr, 'delete')} ` +
          `The AuditX product API at ${CONFIG.AUDITX_API_URL} is unreachable ` +
          'and the direct Firestore write was denied. Deploy the auditx-api service (render.yaml) ' +
          'or upload backend/firebase/firestore.rules and confirm this account has the manager role/claims.',
      )
    }
  }
}

/* Admin-SDK product writes via the AuditX Express API. The backend's
   firebase-admin writes are exempt from client Firestore rules, so a working
   admin account can never be hit by "Missing or insufficient permissions". */
async function apiUpsertProduct(input: {
  barcode: string
  name: string
  brand?: string
  manufacturer?: string
  category?: string
  net_quantity?: string
  mrp?: string
  consumer_care?: string
  country_of_origin?: string
  best_before_label?: string
}): Promise<string> {
  if (!auth.currentUser) throw new Error('Not signed in for product API')
  const idToken = await auth.currentUser.getIdToken(true)
  const base = CONFIG.AUDITX_API_URL.replace(/\/+$/, '')
  const res = await fetch(`${base}/api/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = ((await res.json()) as { error?: string }).error ?? ''
    } catch {
      /* ignore */
    }
    throw Object.assign(new Error(`Product save failed (${res.status}${detail ? ` — ${detail}` : ''})`), {
      name: 'HttpError',
    })
  }
  const data = (await res.json()) as { ok: boolean; product_id: string }
  return String(data.product_id ?? '')
}

async function apiDeleteProduct(productId: string): Promise<void> {
  const idToken = await auth.currentUser?.getIdToken(true)
  if (!idToken) throw new Error('Not signed in for product API')
  const base = CONFIG.AUDITX_API_URL.replace(/\/+$/, '')
  const res = await fetch(`${base}/api/products/${encodeURIComponent(productId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = ((await res.json()) as { error?: string }).error ?? ''
    } catch {
      /* ignore */
    }
    throw Object.assign(new Error(`Product delete failed (${res.status}${detail ? ` — ${detail}` : ''})`), {
      name: 'HttpError',
    })
  }
}

async function findProductByBarcodeInternal(barcode: string) {
  const ref = collection(db, COLLECTIONS.PRODUCTS)
  const snap = await getDocs(query(ref, where('barcode', '==', barcode), limit(1)))
  if (snap.empty) return null
  return { id: snap.docs[0].id, ...snap.docs[0].data() } as { id: string; barcode: string }
}

/* ------------------------------------------------------------------ */
/* External barcode lookup (Open Food Facts via server callable).       */
/* ------------------------------------------------------------------ */
export async function lookupBarcodeExternal(
  barcode: string,
): Promise<{ name: string; brand: string; manufacturer: string } | null> {
  try {
    const { httpsCallable } = await import('firebase/functions')
    const { functions } = await import('./firebase')
    const fn = httpsCallable<{ barcode: string }, { found: boolean; source: string; product: { name: string | null; brand: string | null; manufacturer: string | null; category: string | null } | null }>(
      functions,
      'lookupBarcode',
    )
    const res = await fn({ barcode })
    if (!res.data.found || !res.data.product) return null
    const p = res.data.product
    return {
      name: p.name ?? barcode,
      brand: p.brand ?? '',
      manufacturer: p.manufacturer ?? '',
    }
  } catch {
    return null
  }
}