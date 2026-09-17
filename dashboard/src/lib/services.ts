/*
 * AuditX — Supabase mutation services (replaces Firestore writes).
 *
 * Same exports and behavior as before; only the persistence layer moved.
 *
 * Security note: the client-side role check here (requireStaff) is a UX
 * fail-fast. The authorization boundary is Supabase RLS
 * (supabase/migrations/0001_auditx_core.sql) plus the Express backend
 * (service role) for privileged writes.
 */

import { supabase, accessToken } from './supabase'
import { mergeRow, splitRow } from './db'
import { syncUserClaims } from './claims'
import { CONFIG } from './config'
import { fetchWithTimeout } from './net'
import type { ManualResult, ScanRow, Severity } from './types2'

/* ------------------------------------------------------------------ */
/* Pre-flight authorization (UX only — RLS is the boundary)            */
/* ------------------------------------------------------------------ */

async function currentUser() {
  const { data } = await supabase.auth.getUser()
  return data.user ?? null
}

async function profileRow(uid: string): Promise<Record<string, unknown> | null> {
  const { data } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle()
  return (data as Record<string, unknown> | null) ?? null
}

async function requireStaff(): Promise<{ uid: string; name: string; role: string }> {
  const user = await currentUser()
  if (!user) throw new Error('Not authenticated')
  const row = await profileRow(user.id)
  const role = String(row?.role ?? 'user')
  const status = String(row?.status ?? 'pending')
  // Staff = super_admin only (legacy admin/inspector rows map here too).
  if (role !== 'admin' && role !== 'super_admin' && role !== 'inspector') {
    throw new Error('Forbidden: staff access required')
  }
  if (status !== 'active') {
    throw new Error('Forbidden: account is not active')
  }
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>
  return { uid: user.id, name: String(row?.full_name ?? meta.full_name ?? ''), role }
}

/** Managers only (admin + super_admin, incl. legacy admin rows) — for user/product/rule administration. */
async function requireManager(): Promise<{ uid: string; name: string }> {
  const actor = await requireStaff()
  if (actor.role !== 'admin' && actor.role !== 'super_admin') {
    throw new Error('Forbidden: manager access required')
  }
  return { uid: actor.uid, name: actor.name }
}

async function logActivity(actor: { uid: string; name: string }, action: string, targetType: string, targetId: string, details: Record<string, unknown>) {
  try {
    await supabase.from('activity_logs').insert({
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
  try {
    await supabase.from('notifications').insert({
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
  } catch {
    /* non-critical */
  }
}

async function getScanRow(scanId: string): Promise<Record<string, unknown> | null> {
  const { data } = await supabase.from('scans').select('*').eq('id', scanId).maybeSingle()
  if (!data) return null
  return mergeRow<Record<string, unknown>>('scans', data as Record<string, unknown>)
}

async function updateScanRow(scanId: string, patch: Record<string, unknown>): Promise<void> {
  const current = await getScanRow(scanId)
  if (!current) throw new Error('Scan not found')
  const merged = { ...current, ...patch, id: scanId, updated_at: new Date().toISOString() }
  const { cols, data } = splitRow('scans', merged)
  const { error } = await supabase.from('scans').update({ ...cols, data }).eq('id', scanId)
  if (error) throw new Error(error.message)
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
  const user = await currentUser()
  if (!user) throw new Error('Not authenticated')
  const uid = user.id
  const risk = Math.max(0, Math.min(100, input.risk_score ?? 100 - input.overall_score))
  const now = new Date().toISOString()
  const doc = {
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
    created_at: now,
    updated_at: now,
  }
  const { cols, data } = splitRow('scans', doc as unknown as Record<string, unknown>)
  const { data: inserted, error } = await supabase
    .from('scans')
    .insert({ ...cols, data: { ...data, ...doc } })
    .select('id')
    .single()
  if (error || !inserted) throw new Error(error?.message ?? 'Scan creation failed')
  const id = String((inserted as { id: string }).id)
  void notify(
    uid,
    'scan',
    'Analysis completed',
    `"${input.product_name}" scored ${input.overall_score}/100.`,
    '/scan-history',
    { scan_id: id },
  )
  return id
}

/**
 * User correction loop — a scanned field the OCR read wrong is corrected by
 * the user. Evidence-first: the previous (AI/OCR) value is KEPT as
 * `original_value`, never silently overwritten, and the correction is logged
 * on the scan so the audit trail stays intact. Only the owner or a staff
 * member may correct a scan.
 */
export async function userCorrectField(scanId: string, field: string, corrected: string): Promise<void> {
  const actor = await currentUser()
  if (!actor) throw new Error('Not authenticated')
  const scanned = await getScanRow(scanId)
  if (!scanned) throw new Error('Scan not found')
  const ownerId = scanned.user_id ? String(scanned.user_id) : ''
  const isStaff = await isStaffUser(actor.id).catch(() => false)
  if (ownerId && ownerId !== actor.id && !isStaff) throw new Error('You can only correct scans you created.')

  const key = field.replace(/[^a-zA-Z0-9_]/g, '_')
  const ef = (scanned.extraction_fields ?? {}) as Record<string, any>
  const prevField = ef[key]
  const prevValue = typeof prevField?.value === 'string' ? prevField.value : null
  const ex = (scanned.extractions ?? {}) as Record<string, unknown>
  const prevExtraction = ex[key]

  const nextEf = {
    ...ef,
    [key]: {
      ...(prevField ?? {}),
      value: corrected,
      verification: 'user_corrected',
      status: 'USER_CORRECTED',
      confidence_score: 1,
      conflict: false,
      original_value: prevValue ?? prevExtraction ?? null,
    },
  }
  const nextEx = { ...ex, [key]: corrected }
  const uc = (scanned.user_corrections ?? {}) as Record<string, unknown>
  const nextUc = {
    ...uc,
    [key]: {
      corrected_value: corrected,
      original_value: prevValue ?? prevExtraction ?? null,
      corrected_by: actor.id,
      corrected_at: new Date().toISOString(),
    },
  }

  await updateScanRow(scanId, {
    extraction_fields: nextEf,
    extractions: nextEx,
    user_corrections: nextUc,
  })
  const meta = (actor.user_metadata ?? {}) as Record<string, unknown>
  void logActivity({ uid: actor.id, name: String(meta.full_name ?? actor.email ?? '') }, 'scan.field_corrected', 'scan', scanId, { field: key, value: corrected, original: prevValue ?? prevExtraction ?? null })
}

async function isStaffUser(uid: string): Promise<boolean> {
  const row = await profileRow(uid)
  const role = String(row?.role ?? 'user')
  return role === 'admin' || role === 'super_admin'
}

export async function setScanStatus(scanId: string, status: ScanRow['status'], notes: string) {
  const actor = await requireStaff()
  const data = await getScanRow(scanId)
  if (!data) throw new Error('Scan not found')
  const ownerId = data.user_id ? String(data.user_id) : ''
  const product = String(data.product_name ?? '')

  await updateScanRow(scanId, {
    status,
    notes: notes.trim() ? notes.trim() : ((data.notes as string | undefined) ?? ''),
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

  const data = await getScanRow(scanId)
  if (!data) throw new Error('Scan not found')
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

  await updateScanRow(scanId, {
    manual_result: manual,
    overall_score: payload.score,
    risk_score: Math.max(0, Math.min(100, 100 - payload.score)),
    status: 'resolved',
    notes: payload.notes.trim() ? payload.notes.trim() : ((data.notes as string | undefined) ?? ''),
  })

  const now = new Date().toISOString()
  await supabase.from('inspection_reviews').insert({
    scan_id: scanId,
    created_at: now,
    data: {
      admin_id: actor.uid,
      ai_score: aiScore,
      manual_score: payload.score,
      corrections: payload.corrections,
      violations_added: payload.violationsAdded,
      violations_removed: payload.violationsRemoved.map((id) => ({ id })),
      notes: payload.notes,
    },
  })

  for (const v of payload.violationsAdded) {
    if (!v.type && !v.description) continue
    await supabase.from('violations').insert({
      scan_id: scanId,
      product_name: product,
      manufacturer: String((data.manufacturer as string | undefined) ?? (data.brand as string | undefined) ?? ''),
      category: String((data.category as string | undefined) ?? ''),
      type: v.type ?? 'rule_violation',
      severity: v.severity,
      status: 'Detected',
      description: v.description ?? '',
      created_at: now,
      updated_at: now,
      data: { created_by: actor.uid },
    })
  }

  for (const id of payload.violationsRemoved) {
    const { data: v } = await supabase.from('violations').select('id,scan_id').eq('id', id).maybeSingle()
    if (v && (v as { scan_id: string }).scan_id === scanId) {
      await supabase.from('violations').update({
        status: 'Rejected',
        updated_at: new Date().toISOString(),
        data: { resolved_by: actor.uid, resolved_at: new Date().toISOString() },
      }).eq('id', id)
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
  const { data: reqRow } = await supabase
    .from('admin_requests')
    .select('id')
    .eq('user_id', targetUserId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const status = approve ? 'approved' : 'rejected'
  const { error: profileErr } = await supabase.from('profiles').update({
    role: approve ? 'super_admin' : 'user',
    status: 'active',
    updated_at: new Date().toISOString(),
  }).eq('id', targetUserId)
  if (profileErr) throw new Error(profileErr.message)
  const reqId = (reqRow as { id: string } | null)?.id ?? ''
  if (reqId) {
    await supabase.from('admin_requests').update({
      status,
      updated_at: new Date().toISOString(),
      data: { reviewed_by: actor.uid, reviewed_at: new Date().toISOString() },
    }).eq('id', reqId)
  }
  void notify(
    targetUserId,
    'account',
    approve ? 'Admin access approved' : 'Admin request rejected',
    approve
      ? 'Welcome aboard! You now have super admin access.'
      : 'Your admin request was not approved. You can continue as a standard user.',
    approve ? '/super-admin-dashboard' : '/user-dashboard',
    { request_id: reqId },
  )
  void logActivity(actor, approve ? 'admin_request.approved' : 'admin_request.rejected', 'user', targetUserId, { status })
  // Roles live on the profiles row (no custom-claim indirection). Sync the
  // backend record best-effort so any server-side cache refreshes.
  try {
    await syncUserClaims({ uid: targetUserId, role: approve ? 'super_admin' : 'user', status: 'active' })
  } catch (e) {
    throw new Error(
      `Account updated, but backend sync failed (${(e as Error).message}). Check the AuditX API.`,
    )
  }
}

export async function setAdminStatus(targetUserId: string, status: 'active' | 'blocked' | 'pending') {
  const actor = await requireManager()
  const { error } = await supabase.from('profiles').update({
    status,
    updated_at: new Date().toISOString(),
  }).eq('id', targetUserId)
  if (error) throw new Error(error.message)
  void notify(
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
  try {
    await syncUserClaims({ uid: targetUserId, status })
  } catch (e) {
    throw new Error(
      `Status updated, but backend sync failed (${(e as Error).message}). Check the AuditX API.`,
    )
  }
}

export async function setUserStatus(targetUserId: string, status: 'active' | 'blocked') {
  const actor = await requireManager()
  const { error } = await supabase.from('profiles').update({
    status,
    updated_at: new Date().toISOString(),
  }).eq('id', targetUserId)
  if (error) throw new Error(error.message)
  void notify(
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
  try {
    await syncUserClaims({ uid: targetUserId, status })
  } catch (e) {
    throw new Error(
      `Status updated, but backend sync failed (${(e as Error).message}). Check the AuditX API.`,
    )
  }
}

export async function updateProfileFields(targetUserId: string, patch: { full_name?: string; organization?: string }) {
  const actor = await requireManager()
  void actor
  const updates: Record<string, string> = { updated_at: new Date().toISOString() }
  if (patch.full_name !== undefined) updates.full_name = patch.full_name
  if (patch.organization !== undefined) updates.organization = patch.organization
  const { error } = await supabase.from('profiles').update(updates).eq('id', targetUserId)
  if (error) throw new Error(error.message)
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
  const now = new Date().toISOString()
  const { data, error } = await supabase.from('compliance_rules').insert({
    title: input.title,
    created_at: now,
    data: {
      rule_key: input.rule_key.toUpperCase(),
      description: input.description,
      category: input.category,
      severity: input.severity,
      required: input.required,
      status: 'active',
      is_active: true,
      created_by: actor.uid,
      updated_at: now,
    },
  }).select('id').single()
  if (error || !data) throw new Error(error?.message ?? 'Rule creation failed')
  void logActivity(actor, 'compliance_rule.created', 'complianceRule', String((data as { id: string }).id), { rule_key: input.rule_key })
}

export async function toggleComplianceRule(ruleId: string, active: boolean) {
  const actor = await requireManager()
  const { data: current } = await supabase.from('compliance_rules').select('data').eq('id', ruleId).maybeSingle()
  const prev = ((current as { data?: Record<string, unknown> } | null)?.data ?? {}) as Record<string, unknown>
  const { error } = await supabase.from('compliance_rules').update({
    data: { ...prev, is_active: active, status: active ? 'active' : 'disabled', updated_at: new Date().toISOString() },
  }).eq('id', ruleId)
  if (error) throw new Error(error.message)
  void logActivity(actor, active ? 'compliance_rule.enabled' : 'compliance_rule.disabled', 'complianceRule', ruleId, {})
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export async function markNotificationRead(notificationId: string) {
  const { error } = await supabase.from('notifications').update({
    read: true,
    read_at: new Date().toISOString(),
  }).eq('id', notificationId)
  if (error) throw new Error(error.message)
}

export async function markAllNotificationsRead() {
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return
  const { data, error } = await supabase.from('notifications').select('id').eq('user_id', uid).eq('read', false).limit(150)
  if (error) throw new Error(error.message)
  const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
  if (ids.length === 0) return
  const { error: upErr } = await supabase.from('notifications').update({ read: true, read_at: new Date().toISOString() }).in('id', ids)
  if (upErr) throw new Error(upErr.message)
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
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) throw new Error('Not authenticated')
  const now = new Date().toISOString()
  const { data, error } = await supabase.from('reports').insert({
    scan_id: input.scanId ?? null,
    title: input.title,
    description: input.description,
    product_name: input.productName,
    manufacturer: input.manufacturer,
    category: input.category,
    status: 'Pending',
    priority: input.severity === 'critical' ? 'Critical' : input.severity === 'high' ? 'High' : input.severity === 'medium' ? 'Medium' : 'Low',
    created_at: now,
    updated_at: now,
    data: {
      user_id: uid,
      severity: input.severity,
      assigned_to: null,
      assigned_at: null,
      resolved_by: null,
      resolved_at: null,
    },
  }).select('id').single()
  if (error || !data) throw new Error(error?.message ?? 'Report creation failed')
  const reportId = String((data as { id: string }).id)
  // Notify active staff.
  try {
    const { data: roster } = await supabase.from('profiles').select('id,role,status').limit(500)
    const staff = ((roster ?? []) as Array<{ id: string; role: string; status: string }>).filter(
      (r) => (r.role === 'admin' || r.role === 'super_admin' || r.role === 'inspector') && r.status === 'active',
    )
    void Promise.all(
      staff.map((s) =>
        notify(
          s.id,
          'report',
          'New compliance report',
          `"${input.title}" — "${input.productName}" by ${input.manufacturer || 'unknown'}.`,
          '/admin/reports',
          { report_id: reportId },
        ),
      ),
    ).catch((e) => console.error('submitReport notify failed', e))
  } catch (e) {
    console.error('submitReport roster failed', e)
  }
  return reportId
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
    // Network-level failure (backend down / CORS / wrong base URL). Fall back
    // to a direct Supabase write, which succeeds whenever RLS allows
    // (is_admin()). If that write is denied, rethrow with the combined,
    // honest cause.
    console.warn(
      `[products] auditx-api unreachable at ${CONFIG.AUDITX_API_URL} — falling back to a direct Supabase write.`,
    )
    try {
      const productId = await saveProductDirect({ ...input, barcode })
      void logActivity(actor, 'product.upserted_via_supabase', 'product', productId, { barcode, api: false })
      return productId
    } catch (fallbackErr) {
      throw new Error(
        `Product save failed: ${describeWriteBlock(fallbackErr, 'save')} ` +
          `The AuditX product API at ${CONFIG.AUDITX_API_URL} is unreachable ` +
          'and the direct Supabase write was denied. Deploy the AuditX-111 backend service ' +
          'or confirm this account has the manager role.',
      )
    }
  }
}

/** Direct Supabase write used by the offline/fallback path for products. */
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
    const { error } = await supabase.from('products').update(data).eq('id', existing.id)
    if (error) throw new Error(error.message)
    return existing.id
  }
  const { data: inserted, error } = await supabase.from('products').insert({ ...data, created_at: now }).select('id').single()
  if (error || !inserted) throw new Error(error?.message ?? 'Product creation failed')
  return String((inserted as { id: string }).id)
}

/** Readable explanation of a Supabase fallback rejection. */
function describeWriteBlock(err: unknown, action: 'save' | 'delete'): string {
  const msg = (err as Error)?.message ?? ''
  if (/denied|permission|policy|rls/i.test(msg)) {
    return `Supabase rejected the ${action} ("permission denied" — RLS policy).`
  }
  return `The direct Supabase ${action} failed${msg ? ` (${msg})` : ''}.`
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
      `[products] auditx-api unreachable at ${CONFIG.AUDITX_API_URL} — falling back to a direct Supabase delete.`,
    )
    try {
      const { data: snap } = await supabase.from('products').select('barcode').eq('id', productId).maybeSingle()
      if (!snap) throw new Error('Product not found')
      const { error } = await supabase.from('products').delete().eq('id', productId)
      if (error) throw new Error(error.message)
      void logActivity(actor, 'product.deleted', 'product', productId, { barcode: (snap as { barcode: string }).barcode })
      return
    } catch (fallbackErr) {
      throw new Error(
        `Product delete failed: ${describeWriteBlock(fallbackErr, 'delete')} ` +
          `The AuditX product API at ${CONFIG.AUDITX_API_URL} is unreachable ` +
          'and the direct Supabase write was denied. Deploy the AuditX-111 backend service ' +
          'or confirm this account has the manager role.',
      )
    }
  }
}

/* Product writes via the AuditX Express API. The backend's service-role
   writes bypass RLS, so a working admin account can never be hit by
   "permission denied". */
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
  const token = await accessToken(true)
  if (!token) throw new Error('Not signed in for product API')
  const base = CONFIG.AUDITX_API_URL.replace(/\/+$/, '')
  const res = await fetchWithTimeout(`${base}/api/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
  const token = await accessToken(true)
  if (!token) throw new Error('Not signed in for product API')
  const base = CONFIG.AUDITX_API_URL.replace(/\/+$/, '')
  const res = await fetchWithTimeout(`${base}/api/products/${encodeURIComponent(productId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
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
  const { data } = await supabase.from('products').select('id,barcode').eq('barcode', barcode).limit(1).maybeSingle()
  if (!data) return null
  return data as { id: string; barcode: string }
}

/* ------------------------------------------------------------------ */
/* External barcode lookup (Open Food Facts via the Express API).       */
/* ------------------------------------------------------------------ */
export async function lookupBarcodeExternal(
  barcode: string,
): Promise<{ name: string; brand: string; manufacturer: string } | null> {
  try {
    const base = CONFIG.AUDITX_API_URL.replace(/\/+$/, '')
    const res = await fetchWithTimeout(`${base}/api/barcode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ barcode }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      found: boolean
      product: { name: string | null; brand: string | null; manufacturer: string | null } | null
    }
    if (!data.found || !data.product) return null
    const p = data.product
    return {
      name: p.name ?? barcode,
      brand: p.brand ?? '',
      manufacturer: p.manufacturer ?? '',
    }
  } catch {
    return null
  }
}
