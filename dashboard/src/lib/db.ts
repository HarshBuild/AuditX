/*
 * AuditX — Supabase data layer (replaces Firestore).
 *
 * Table map:
 *   profiles           ← users
 *   scans              ← scans
 *   violations         ← violations
 *   reports            ← reports
 *   notifications      ← notifications
 *   activity_logs      ← activityLogs
 *   compliance_rules   ← complianceRules
 *   admin_requests     ← adminRequests
 *   inspection_reviews ← inspectionReviews
 *   products           ← products
 *
 * All functions keep their previous signatures so pages, admin panels and
 * services compile and behave unchanged. Rows are merged from queryable
 * columns + the flexible `data` jsonb catch-all, so both old and new field
 * shapes read identically.
 *
 * Authorization: Supabase RLS policies (see
 * supabase/migrations/0001_auditx_core.sql). The backend service-role key
 * bypasses RLS; this client uses the anon key and stays inside RLS.
 */

import { supabase } from './supabase'
import { getLocalScans } from './localStore'
import type {
  ActivityLogRow,
  AdminRequestRow,
  ComplianceRuleRow,
  NotificationRow,
  ProductRow,
  ProfileAdminRow,
  ReportRow,
  ScanRow,
  ViolationRow,
} from './types2'

export interface Paged<T> {
  data: T[]
  count: number
}

export interface ListOptions {
  page: number
  pageSize: number
  query?: string
  from?: string | null
  to?: string | null
}

/* ------------------------------------------------------------------ */
/* Tables + flexible row mapping                                        */
/* ------------------------------------------------------------------ */

/** Legacy collection-name constants (kept so existing imports compile). */
export const COLLECTIONS = {
  USERS: 'profiles',
  SCANS: 'scans',
  VIOLATIONS: 'violations',
  REPORTS: 'reports',
  NOTIFICATIONS: 'notifications',
  ACTIVITY_LOGS: 'activity_logs',
  COMPLIANCE_RULES: 'compliance_rules',
  ADMIN_REQUESTS: 'admin_requests',
  INSPECTION_REVIEWS: 'inspection_reviews',
  PRODUCTS: 'products',
} as const

/** Opaque pagination cursor (replaces the Firestore document snapshot). */
export interface PageCursor {
  created_at: string
  id: string
}

/** Queryable columns per table — everything else rides in `data` jsonb. */
const COLUMNS: Record<string, string[]> = {
  profiles: ['id', 'email', 'full_name', 'organization', 'role', 'status', 'prefs', 'created_at', 'last_login', 'updated_at'],
  scans: ['id', 'user_id', 'status', 'verdict', 'overall_score', 'risk_score', 'product_name', 'brand', 'manufacturer', 'barcode', 'category', 'ocr_status', 'photo_path', 'created_at', 'updated_at'],
  products: ['id', 'barcode', 'name', 'brand', 'manufacturer', 'category', 'net_quantity', 'mrp', 'consumer_care', 'country_of_origin', 'best_before_label', 'created_at', 'updated_at'],
  violations: ['id', 'scan_id', 'product_name', 'manufacturer', 'category', 'type', 'description', 'severity', 'status', 'created_at', 'updated_at'],
  reports: ['id', 'scan_id', 'title', 'description', 'product_name', 'manufacturer', 'category', 'status', 'priority', 'created_at', 'updated_at'],
  notifications: ['id', 'user_id', 'type', 'title', 'body', 'link', 'read', 'read_at', 'created_at'],
  activity_logs: ['id', 'user_id', 'actor_id', 'actor_name', 'action', 'target_type', 'target_id', 'details', 'created_at'],
  compliance_rules: ['id', 'title', 'created_at'],
  admin_requests: ['id', 'user_id', 'status', 'created_at'],
  inspection_reviews: ['id', 'scan_id', 'created_at'],
}

/** Split a write object into queryable columns + flexible `data` jsonb extras. */
export function splitRow(table: string, obj: Record<string, unknown>): { cols: Record<string, unknown>; data: Record<string, unknown> } {
  const known = COLUMNS[table] ?? []
  const cols: Record<string, unknown> = {}
  const data: Record<string, unknown> = { ...(obj.data && typeof obj.data === 'object' ? (obj.data as Record<string, unknown>) : {}) }
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'data' || k === 'id') continue
    if (known.includes(k)) cols[k] = v
    else data[k] = v
  }
  return { cols, data }
}

/** Merge flat columns + data jsonb back into one row (columns win). */
export function mergeRow<T>(_table: string, row: Record<string, unknown>): T {
  void _table
  const { data: _drop, ...cols } = row
  void _drop
  const extras = row.data && typeof row.data === 'object' ? (row.data as Record<string, unknown>) : {}
  return { ...extras, ...cols } as T
}

function matchesAny(haystack: string, needle: string): boolean {
  const n = needle.toLowerCase()
  return haystack.toLowerCase().includes(n)
}

/** One day window used by analytics date filters. */
export function daysAgo(n: string | number): string {
  const days = typeof n === 'string' ? Number(n) : n
  return new Date(Date.now() - days * 86400_000).toISOString()
}

async function recentRows<T>(table: string, cap = 1000): Promise<T[]> {
  const { data, error } = await supabase.from(table).select('*').order('created_at', { ascending: false }).limit(cap)
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => mergeRow<T>(table, r))
}

/* ------------------------------------------------------------------ */
/* Scans                                                               */
/* ------------------------------------------------------------------ */

/** Score-based in-memory search across product/brand/manufacturer/barcode. */
function scanSearchable(s: ScanRow): string {
  return [s.product_name, s.brand, s.manufacturer, s.category, s.barcode].join(' | ')
}

const scanRisk = (s: ScanRow) => {
  const direct = Number(s.risk_score)
  const fallback = 100 - Number(s.overall_score)
  const risk = Number.isFinite(direct) && direct >= 0 ? direct : Number.isFinite(fallback) ? fallback : 100
  return Math.max(0, Math.min(100, risk))
}

export async function listScans(
  opts: ListOptions & { status?: string; risk?: string; category?: string },
): Promise<Paged<ScanRow>> {
  let filtered = await recentRows<ScanRow>(COLLECTIONS.SCANS, 2000)
  const q = (opts.query ?? '').trim()
  if (q) filtered = filtered.filter((s) => matchesAny(scanSearchable(s), q))
  if (opts.status) filtered = filtered.filter((s) => s.status === opts.status)
  if (opts.risk === 'Critical') filtered = filtered.filter((s) => scanRisk(s) >= 76)
  else if (opts.risk === 'High') filtered = filtered.filter((s) => scanRisk(s) >= 51 && scanRisk(s) < 76)
  else if (opts.risk === 'Medium') filtered = filtered.filter((s) => scanRisk(s) >= 26 && scanRisk(s) < 51)
  else if (opts.risk === 'Low') filtered = filtered.filter((s) => scanRisk(s) < 26)
  if (opts.category) filtered = filtered.filter((s) => s.category === opts.category)
  if (opts.from) filtered = filtered.filter((s) => s.created_at >= opts.from!)
  if (opts.to) filtered = filtered.filter((s) => s.created_at <= opts.to!)

  const start = (opts.page - 1) * opts.pageSize
  return { data: filtered.slice(start, start + opts.pageSize), count: filtered.length }
}

export async function countScans(from?: string | null): Promise<number> {
  let q = supabase.from(COLLECTIONS.SCANS).select('id', { count: 'exact', head: true })
  if (from) q = q.gte('created_at', from)
  const { count, error } = await q
  if (error) throw new Error(error.message)
  return count ?? 0
}

export interface RiskDistribution {
  Low: number
  Medium: number
  High: number
  Critical: number
}

export async function scanRiskDistribution(scans: ScanRow[]): Promise<RiskDistribution> {
  const band: RiskDistribution = { Low: 0, Medium: 0, High: 0, Critical: 0 }
  for (const s of scans) {
    const r = scanRisk(s)
    if (r <= 25) band.Low += 1
    else if (r <= 50) band.Medium += 1
    else if (r <= 75) band.High += 1
    else band.Critical += 1
  }
  return band
}

export async function fetchScansForUser(uid: string, cap = 200): Promise<ScanRow[]> {
  const local = getLocalScans(uid)
  let cloud: ScanRow[] = []
  try {
    const { data, error } = await supabase
      .from(COLLECTIONS.SCANS)
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(cap)
    if (error) throw new Error(error.message)
    cloud = ((data ?? []) as Record<string, unknown>[]).map((r) => mergeRow<ScanRow>(COLLECTIONS.SCANS, r))
  } catch {
    // RLS may deny the query in this release; the user's own
    // locally-persisted scans still render the history/reports.
    cloud = []
  }
  const merged: ScanRow[] = []
  const seen = new Set<string>()
  for (const s of [...cloud, ...local]) {
    if (!seen.has(s.id)) { seen.add(s.id); merged.push(s) }
  }
  merged.sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
  return merged
}

export interface ScanPageResult {
  data: ScanRow[]
  /** Opaque cursor suitable for the next page load. */
  lastDoc: PageCursor | null
  hasMore: boolean
}

/**
 * Cursor-paginated scan history for a single user. Newest-first (created_at
 * desc). The cursor continues from the previous page's last row.
 */
export async function fetchScansForUserPage(uid: string, pageSize = 50, lastDoc: PageCursor | null = null): Promise<ScanPageResult> {
  const paged = lastDoc !== null
  let q = supabase
    .from(COLLECTIONS.SCANS)
    .select('*')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(pageSize + 1)
  if (lastDoc) {
    q = q.or(`created_at.lt.${lastDoc.created_at},and(created_at.eq.${lastDoc.created_at},id.lt.${lastDoc.id})`)
  }
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => mergeRow<ScanRow>(COLLECTIONS.SCANS, r))
  const hasMore = rows.length > pageSize
  const page = hasMore ? rows.slice(0, pageSize) : rows
  const tail = page[page.length - 1]
  const cursor: PageCursor | null = tail ? { created_at: tail.created_at, id: tail.id } : null
  if (!paged) {
    // First page also prepends any locally-persisted scans (offline cub).
    const local = getLocalScans(uid)
    const seen = new Set<string>()
    const merged: ScanRow[] = []
    for (const s of [...page, ...local]) {
      if (!seen.has(s.id)) { seen.add(s.id); merged.push(s) }
    }
    merged.sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
    return { data: merged, lastDoc: cursor, hasMore }
  }
  return {
    data: page,
    lastDoc: cursor,
    hasMore,
  }
}

/** Fetch a single scan by id, local first then Supabase. Powers deep links
 *  (?open=<id>) so a shared result URL survives refresh/back/forward. */
export async function fetchScanById(id: string, uid: string | null): Promise<ScanRow | null> {
  if (!id) return null
  const local = getLocalScans(uid).find((s) => s.id === id)
  if (local) return local
  try {
    const { data, error } = await supabase.from(COLLECTIONS.SCANS).select('*').eq('id', id).maybeSingle()
    if (error || !data) return null
    return mergeRow<ScanRow>(COLLECTIONS.SCANS, data as Record<string, unknown>)
  } catch {
    return null
  }
}

export async function fetchViolationsForScan(scanId: string): Promise<ViolationRow[]> {
  const { data, error } = await supabase.from(COLLECTIONS.VIOLATIONS).select('*').eq('scan_id', scanId).limit(200)
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => mergeRow<ViolationRow>(COLLECTIONS.VIOLATIONS, r))
}

export async function fetchReportsForScan(scanId: string): Promise<ReportRow[]> {
  const { data, error } = await supabase.from(COLLECTIONS.REPORTS).select('*').eq('scan_id', scanId).limit(200)
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => mergeRow<ReportRow>(COLLECTIONS.REPORTS, r))
}

/* ------------------------------------------------------------------ */
/* Violations                                                          */
/* ------------------------------------------------------------------ */

export async function listViolations(
  opts: ListOptions & { severity?: string; status?: string },
): Promise<Paged<ViolationRow>> {
  let filtered = await recentRows<ViolationRow>(COLLECTIONS.VIOLATIONS, 2000)
  const q = (opts.query ?? '').trim()
  if (q) {
    filtered = filtered.filter((v) =>
      matchesAny([v.product_name, v.manufacturer, v.category, v.type, v.description].join(' | '), q),
    )
  }
  if (opts.severity) filtered = filtered.filter((v) => v.severity === opts.severity!.toLowerCase())
  if (opts.status) filtered = filtered.filter((v) => v.status === opts.status)
  if (opts.from) filtered = filtered.filter((v) => v.created_at >= opts.from!)
  if (opts.to) filtered = filtered.filter((v) => v.created_at <= opts.to!)

  const start = (opts.page - 1) * opts.pageSize
  return { data: filtered.slice(start, start + opts.pageSize), count: filtered.length }
}

export async function setViolationStatus(violationId: string, status: ViolationRow['status']) {
  const { data: current } = await supabase.from(COLLECTIONS.VIOLATIONS).select('data').eq('id', violationId).maybeSingle()
  const prev = (current as { data?: Record<string, unknown> } | null)?.data ?? {}
  const { cols, data } = splitRow(COLLECTIONS.VIOLATIONS, { status, updated_at: new Date().toISOString() })
  const { error } = await supabase.from(COLLECTIONS.VIOLATIONS).update({ ...cols, data: { ...prev, ...data } }).eq('id', violationId)
  if (error) throw new Error(error.message)
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

export async function listReports(
  opts: ListOptions & { status?: string; priority?: string },
): Promise<Paged<ReportRow>> {
  let filtered = await recentRows<ReportRow>(COLLECTIONS.REPORTS, 1000)
  const q = (opts.query ?? '').trim()
  if (q) {
    filtered = filtered.filter((r) =>
      matchesAny([r.title, r.description, r.product_name, r.manufacturer, r.category].join(' | '), q),
    )
  }
  if (opts.status) filtered = filtered.filter((r) => r.status === opts.status)
  if (opts.priority) filtered = filtered.filter((r) => r.priority === opts.priority)
  if (opts.from) filtered = filtered.filter((r) => r.created_at >= opts.from!)
  if (opts.to) filtered = filtered.filter((r) => r.created_at <= opts.to!)

  const start = (opts.page - 1) * opts.pageSize
  return { data: filtered.slice(start, start + opts.pageSize), count: filtered.length }
}

export async function updateReportStatus(
  reportId: string,
  status: ReportRow['status'],
  priority?: ReportRow['priority'],
) {
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
  if (priority) patch.priority = priority
  const { data: current } = await supabase.from(COLLECTIONS.REPORTS).select('data').eq('id', reportId).maybeSingle()
  const prev = (current as { data?: Record<string, unknown> } | null)?.data ?? {}
  const { cols, data } = splitRow(COLLECTIONS.REPORTS, patch)
  const { error } = await supabase.from(COLLECTIONS.REPORTS).update({ ...cols, data: { ...prev, ...data } }).eq('id', reportId)
  if (error) throw new Error(error.message)
}

/* ------------------------------------------------------------------ */
/* Users / profiles                                                    */
/* ------------------------------------------------------------------ */

export async function fetchUserDoc(uid: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.from(COLLECTIONS.USERS).select('*').eq('id', uid).maybeSingle()
  if (error || !data) return null
  return mergeRow<Record<string, unknown>>(COLLECTIONS.USERS, data as Record<string, unknown>)
}

export async function listProfiles(role: string, limit = 500): Promise<ProfileAdminRow[]> {
  const { data, error } = await supabase.from(COLLECTIONS.USERS).select('*').order('created_at', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)
  return (((data ?? []) as Record<string, unknown>[]).map((r) => mergeRow<ProfileAdminRow>(COLLECTIONS.USERS, r)))
    .filter((p) => p.role === role)
}

/** Super admins (includes legacy admin/inspector rows mapped to super_admin). */
export async function listAdmins(): Promise<ProfileAdminRow[]> {
  const { data, error } = await supabase.from(COLLECTIONS.USERS).select('*').order('created_at', { ascending: false }).limit(500)
  if (error) throw new Error(error.message)
  return (((data ?? []) as Record<string, unknown>[]).map((r) => mergeRow<ProfileAdminRow>(COLLECTIONS.USERS, r)))
    .filter((p) => p.role === 'admin' || p.role === 'super_admin' || p.role === 'inspector')
}

/* ------------------------------------------------------------------ */
/* Admin requests                                                      */
/* ------------------------------------------------------------------ */

export async function listAdminRequests(limit = 100): Promise<AdminRequestRow[]> {
  return recentRows<AdminRequestRow>(COLLECTIONS.ADMIN_REQUESTS, limit)
}

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

export async function listComplianceRules(): Promise<ComplianceRuleRow[]> {
  return recentRows<ComplianceRuleRow>(COLLECTIONS.COMPLIANCE_RULES, 200)
}

/* ------------------------------------------------------------------ */
/* Activity logs                                                       */
/* ------------------------------------------------------------------ */

export async function listActivityLogs(queryText?: string, limit = 200): Promise<ActivityLogRow[]> {
  let rows = await recentRows<ActivityLogRow>(COLLECTIONS.ACTIVITY_LOGS, limit)
  if (queryText && queryText.trim()) {
    const q = queryText.trim()
    rows = rows.filter((r) =>
      matchesAny(
        [r.action, r.actor_name, r.target_type, r.target_id, JSON.stringify(r.details ?? {})].join(' | '),
        q,
      ),
    )
  }
  return rows
}

/* ------------------------------------------------------------------ */
/* Notifications (current user's inbox)                                */
/* ------------------------------------------------------------------ */

async function myUid(): Promise<string | null> {
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

export async function listMyNotifications(max = 100): Promise<NotificationRow[]> {
  const uid = await myUid()
  if (!uid) return []
  const { data, error } = await supabase
    .from(COLLECTIONS.NOTIFICATIONS)
    .select('*')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(max)
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => mergeRow<NotificationRow>(COLLECTIONS.NOTIFICATIONS, r))
}

export async function unreadNotificationCount(): Promise<number> {
  const uid = await myUid()
  if (!uid) return 0
  const { data, error } = await supabase
    .from(COLLECTIONS.NOTIFICATIONS)
    .select('id,read')
    .eq('user_id', uid)
    .eq('read', false)
    .limit(300)
  if (error) throw new Error(error.message)
  return (data ?? []).length
}

/* ------------------------------------------------------------------ */
/* Generic counts (dashboard stat cards)                               */
/* ------------------------------------------------------------------ */

const COUNT_TABLES: Record<string, string> = {
  scans: 'scans',
  users: 'profiles',
  profiles: 'profiles',
  violations: 'violations',
  reports: 'reports',
  notifications: 'notifications',
  activityLogs: 'activity_logs',
  activity_logs: 'activity_logs',
  complianceRules: 'compliance_rules',
  adminRequests: 'admin_requests',
  products: 'products',
}

export async function countCollection(collectionName: string): Promise<number> {
  const table = COUNT_TABLES[collectionName] ?? collectionName
  const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true })
  if (error) throw new Error(error.message)
  return count ?? 0
}

/* ------------------------------------------------------------------ */
/* Products (barcode → product info database)                          */
/* ------------------------------------------------------------------ */

function productSearchable(p: ProductRow): string {
  return [p.name, p.brand, p.manufacturer, p.barcode, p.category].join(' | ')
}

export async function listProducts(
  opts: ListOptions,
): Promise<Paged<ProductRow>> {
  let filtered = await recentRows<ProductRow>(COLLECTIONS.PRODUCTS, 2000)
  const q = (opts.query ?? '').trim()
  if (q) filtered = filtered.filter((p) => matchesAny(productSearchable(p), q))

  const start = (opts.page - 1) * opts.pageSize
  return { data: filtered.slice(start, start + opts.pageSize), count: filtered.length }
}

export async function findProductByBarcode(barcode: string): Promise<ProductRow | null> {
  const { data, error } = await supabase.from(COLLECTIONS.PRODUCTS).select('*').eq('barcode', barcode).limit(1).maybeSingle()
  if (error || !data) return null
  return mergeRow<ProductRow>(COLLECTIONS.PRODUCTS, data as Record<string, unknown>)
}

/**
 * Live subscription over the product database (most recent rows).
 * Products created by scans or other managers appear on the admin panel
 * without a manual reload. Returns an unsubscribe function.
 */
export function subscribeProducts(
  onChange: (rows: ProductRow[]) => void,
  onError?: (err: Error) => void,
): () => void {
  let stopped = false
  void (async () => {
    try {
      const { data, error } = await supabase
        .from(COLLECTIONS.PRODUCTS)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(2000)
      if (error) throw new Error(error.message)
      if (!stopped) {
        onChange(((data ?? []) as Record<string, unknown>[]).map((r) => mergeRow<ProductRow>(COLLECTIONS.PRODUCTS, r)))
      }
    } catch (e) {
      onError?.(e as Error)
    }
  })()
  const channel = supabase
    .channel('products-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: COLLECTIONS.PRODUCTS }, () => {
      if (stopped) return
      void (async () => {
        try {
          const { data, error } = await supabase
            .from(COLLECTIONS.PRODUCTS)
            .select('*')
            .order('created_at', { ascending: false })
            .limit(2000)
          if (error) throw new Error(error.message)
          if (!stopped) {
            onChange(((data ?? []) as Record<string, unknown>[]).map((r) => mergeRow<ProductRow>(COLLECTIONS.PRODUCTS, r)))
          }
        } catch (e) {
          onError?.(e as Error)
        }
      })()
    })
    .subscribe()
  return () => {
    stopped = true
    void supabase.removeChannel(channel)
  }
}
