/**
 * Supabase backend client (service role) — replaces Firebase Admin.
 *
 * Tables (see supabase/migrations/0001_auditx_core.sql):
 *   profiles, scans, products, violations, reports, notifications,
 *   activity_logs, compliance_rules, admin_requests, inspection_reviews
 * Storage bucket: `scans` (public read).
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (secret — never
 * exposed to the frontend). The service role bypasses RLS; the dashboard's
 * anon key is still gated by the SQL policies.
 */

import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    const msg = `❌ Missing required env var: ${name}`
    console.error(msg)
    throw new Error(msg)
  }
  return v
}

const SUPABASE_URL = required('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = required('SUPABASE_SERVICE_ROLE_KEY')

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

console.log('✅ Supabase Admin client configured')

/* ------------------------------------------------------------------ */
/* Auth                                                                 */
/* ------------------------------------------------------------------ */

export interface SupabaseAuthContext {
  uid: string
  email: string
  name: string
}

/** Verify a Supabase access token (Bearer) and return the caller identity. */
export async function verifyAccessToken(token: string): Promise<SupabaseAuthContext> {
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) throw new Error('Unauthorized — invalid or expired session.')
  const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>
  const name = typeof meta.full_name === 'string' && meta.full_name.trim()
    ? meta.full_name.trim()
    : typeof meta.name === 'string' && meta.name.trim()
      ? meta.name.trim()
      : (data.user.email ?? '').split('@')[0] || 'User'
  return { uid: data.user.id, email: data.user.email ?? '', name }
}

/* ------------------------------------------------------------------ */
/* Profiles                                                             */
/* ------------------------------------------------------------------ */

export interface ProfileRow {
  id: string
  email: string
  full_name: string
  organization: string
  role: string
  status: string
  prefs: Record<string, unknown>
  created_at: string | null
  last_login: string | null
}

export async function getProfile(uid: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle()
  if (error) throw new Error(`Profile lookup failed: ${error.message}`)
  return (data as ProfileRow | null) ?? null
}

/** Fetch the profile, auto-creating a consumer profile on first login. */
export async function ensureProfile(uid: string, email: string, name: string): Promise<ProfileRow> {
  const existing = await getProfile(uid)
  if (existing) return existing
  const now = new Date().toISOString()
  const row: ProfileRow = {
    id: uid,
    email,
    full_name: name,
    organization: '',
    role: 'user',
    status: 'active',
    prefs: {},
    created_at: now,
    last_login: now,
  }
  const { error } = await supabase.from('profiles').insert({
    id: uid,
    email,
    full_name: name,
    organization: '',
    role: 'user',
    status: 'active',
    prefs: {},
    created_at: now,
    last_login: now,
    updated_at: now,
  })
  if (error) throw new Error(`Profile creation failed: ${error.message}`)
  return row
}

export async function updateProfileRow(uid: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', uid)
  if (error) throw new Error(`Profile update failed: ${error.message}`)
}

export async function createProfileRow(row: {
  id: string; email?: string; full_name?: string; organization?: string;
  role?: string; status?: string;
}): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabase.from('profiles').insert({
    id: row.id,
    email: row.email ?? '',
    full_name: row.full_name ?? '',
    organization: row.organization ?? '',
    role: row.role ?? 'user',
    status: row.status ?? 'active',
    prefs: {},
    created_at: now,
    updated_at: now,
  })
  if (error) throw new Error(`Profile creation failed: ${error.message}`)
}

/* ------------------------------------------------------------------ */
/* Scans (document-style helpers — same shape as the old Firestore API) */
/* ------------------------------------------------------------------ */

const SCAN_MIRROR_KEYS = [
  'user_id', 'status', 'verdict', 'overall_score', 'risk_score',
  'product_name', 'brand', 'manufacturer', 'barcode', 'category',
  'ocr_status', 'photo_path',
] as const

type ScanMirrorKey = (typeof SCAN_MIRROR_KEYS)[number]

function toRow(id: string, doc: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = { id, data: { ...doc, id } }
  for (const k of SCAN_MIRROR_KEYS) {
    const v = doc[k]
    row[k] = v === undefined ? null : v
  }
  const now = new Date().toISOString()
  row.created_at = typeof doc.created_at === 'string' ? doc.created_at : now
  row.updated_at = typeof doc.updated_at === 'string' ? doc.updated_at : now
  return row
}

function fromRow(row: Record<string, unknown>): Record<string, unknown> {
  const data = (row.data ?? {}) as Record<string, unknown>
  return { ...data, id: String(row.id) }
}

/** Insert a scan document. Returns the id (generated when absent). */
export async function createScanDoc(doc: Record<string, unknown>): Promise<string> {
  const id = typeof doc.id === 'string' && doc.id ? doc.id : randomUUID()
  const { error } = await supabase.from('scans').insert(toRow(id, doc))
  if (error) throw new Error(`Scan creation failed: ${error.message}`)
  return id
}

export async function getScanDoc(id: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.from('scans').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`Scan lookup failed: ${error.message}`)
  if (!data) return null
  return fromRow(data as Record<string, unknown>)
}

export async function updateScanDoc(id: string, patch: Record<string, unknown>): Promise<void> {
  const current = await getScanDoc(id)
  if (!current) throw new Error('Scan not found.')
  const merged = { ...current, ...patch, id, updated_at: new Date().toISOString() }
  const row = toRow(id, merged)
  const { id: _drop, created_at: _keep, ...updatable } = row
  void _drop
  void _keep
  const { error } = await supabase.from('scans').update(updatable).eq('id', id)
  if (error) throw new Error(`Scan update failed: ${error.message}`)
}

export async function listUserScans(uid: string, limitCount = 60): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase
    .from('scans')
    .select('*')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(limitCount)
  if (error) throw new Error(`Scan list failed: ${error.message}`)
  return ((data ?? []) as Record<string, unknown>[]).map(fromRow)
}

/* ------------------------------------------------------------------ */
/* Products                                                             */
/* ------------------------------------------------------------------ */

export async function findProductByBarcode(barcode: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.from('products').select('*').eq('barcode', barcode).limit(1).maybeSingle()
  if (error) throw new Error(`Product lookup failed: ${error.message}`)
  return (data as Record<string, unknown> | null) ?? null
}

export async function upsertProduct(data: Record<string, unknown>): Promise<{ id: string; created: boolean }> {
  const barcode = String(data.barcode ?? '')
  const existing = barcode ? await findProductByBarcode(barcode) : null
  const now = new Date().toISOString()
  if (existing && typeof existing.id === 'string') {
    const { error } = await supabase.from('products').update({ ...data, updated_at: now }).eq('id', existing.id)
    if (error) throw new Error(`Product update failed: ${error.message}`)
    return { id: existing.id, created: false }
  }
  const id = randomUUID()
  const { error } = await supabase.from('products').insert({ ...data, id, created_at: now, updated_at: now })
  if (error) throw new Error(`Product creation failed: ${error.message}`)
  return { id, created: true }
}

export async function deleteProductRow(id: string): Promise<string | null> {
  const { data, error } = await supabase.from('products').select('barcode').eq('id', id).maybeSingle()
  if (error) throw new Error(`Product lookup failed: ${error.message}`)
  if (!data) return null
  const { error: delError } = await supabase.from('products').delete().eq('id', id)
  if (delError) throw new Error(`Product delete failed: ${delError.message}`)
  return String((data as Record<string, unknown>).barcode ?? '')
}

/* ------------------------------------------------------------------ */
/* Activity log (best-effort)                                           */
/* ------------------------------------------------------------------ */

export async function logActivity(entry: Record<string, unknown>): Promise<void> {
  try {
    await supabase.from('activity_logs').insert({
      user_id: (entry.user_id as string) ?? null,
      actor_id: (entry.actor_id as string) ?? null,
      actor_name: String(entry.actor_name ?? ''),
      action: String(entry.action ?? ''),
      target_type: String(entry.target_type ?? ''),
      target_id: String(entry.target_id ?? ''),
      details: (entry.details ?? {}) as Record<string, unknown>,
      created_at: new Date().toISOString(),
    })
  } catch {
    /* audit must never break the primary mutation */
  }
}

/** Insert a user notification (best-effort). */
export async function pushNotification(entry: {
  user_id: string; type: string; title: string; body: string; link?: string; data?: Record<string, unknown>
}): Promise<void> {
  try {
    await supabase.from('notifications').insert({
      user_id: entry.user_id,
      type: entry.type,
      title: entry.title,
      body: entry.body,
      link: entry.link ?? '',
      read: false,
      read_at: null,
      data: entry.data ?? {},
      created_at: new Date().toISOString(),
    })
  } catch {
    /* non-fatal */
  }
}

/* ------------------------------------------------------------------ */
/* Photo storage (bucket `scans`, public read)                          */
/* ------------------------------------------------------------------ */

const SCANS_BUCKET = 'scans'

/** Normalize legacy Firebase-style paths (`scans/<uid>/…`) to object keys (`<uid>/…`). */
export function photoObjectKey(pathOrKey: string): string {
  const v = String(pathOrKey ?? '').trim().replace(/^\/+/, '')
  return v.startsWith('scans/') ? v.slice('scans/'.length) : v
}

export async function uploadPhoto(key: string, buffer: Buffer, contentType: string): Promise<void> {
  const { error } = await supabase.storage.from(SCANS_BUCKET).upload(photoObjectKey(key), buffer, {
    contentType,
    upsert: true,
  })
  if (error) throw new Error(`Photo upload failed: ${error.message}`)
}

export async function downloadPhoto(key: string): Promise<Buffer> {
  const { data, error } = await supabase.storage.from(SCANS_BUCKET).download(photoObjectKey(key))
  if (error || !data) throw new Error(`Photo download failed: ${error?.message ?? 'not found'}`)
  return Buffer.from(await data.arrayBuffer())
}

export function publicPhotoUrl(key: string): string {
  return supabase.storage.from(SCANS_BUCKET).getPublicUrl(photoObjectKey(key)).data.publicUrl
}
