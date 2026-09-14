/*
 * AuditX v3.0 — Firestore data layer.
 *
 * Migration map (Supabase table → Firestore collection):
 *   profiles           → users
 *   scans              → scans
 *   violations         → violations
 *   reports            → reports
 *   notifications      → notifications
 *   activity_logs      → activityLogs
 *   compliance_rules   → complianceRules
 *   admin_requests     → adminRequests
 *   inspection_reviews → inspectionReviews
 *
 * Document field names keep the original snake_case names so existing
 * components read the same shapes as before (id = Firestore document id).
 *
 * Query strategy: bounded recent-fetch + client-side filter/pagination keeps
 * the app index-free and honours the original UI contracts (page/pageSize,
 * ilike search, risk bands, date ranges).
 *
 * Authorization: reads/writes are enforced by Firestore security rules
 * (backend/firebase/firestore.rules) on top of Firebase custom claims.
 * The client-side role pre-checks in services.ts are a UX fail-fast, not
 * the security boundary.
 */

import {
  collection,
  doc,
  getDoc,
  getCountFromServer,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  type DocumentData,
} from 'firebase/firestore'
import { auth, db } from './firebase'
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
/* Collections + shared helpers                                        */
/* ------------------------------------------------------------------ */

export const COLLECTIONS = {
  USERS: 'users',
  SCANS: 'scans',
  VIOLATIONS: 'violations',
  REPORTS: 'reports',
  NOTIFICATIONS: 'notifications',
  ACTIVITY_LOGS: 'activityLogs',
  COMPLIANCE_RULES: 'complianceRules',
  ADMIN_REQUESTS: 'adminRequests',
  INSPECTION_REVIEWS: 'inspectionReviews',
  PRODUCTS: 'products',
} as const

interface SnapshotDoc {
  id: string
  data(): DocumentData
}

function normalize(value: unknown): unknown {
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString()
  }
  return value
}

export function docToRow<T>(snap: SnapshotDoc): T {
  const data = snap.data() ?? {}
  const row: Record<string, unknown> = { id: snap.id }
  for (const k of Object.keys(data)) row[k] = normalize(data[k])
  return row as T
}

function rowsFrom<T>(snapshot: { docs: SnapshotDoc[] }): T[] {
  return snapshot.docs.map((d) => docToRow<T>(d))
}

async function recentRows<T>(collectionName: string, cap = 1000): Promise<T[]> {
  const ref = collection(db, collectionName)
  const snapshot = await getDocs(query(ref, orderBy('created_at', 'desc'), limit(cap)))
  return rowsFrom<T>(snapshot)
}

function matchesAny(haystack: string, needle: string): boolean {
  const n = needle.toLowerCase()
  return haystack.toLowerCase().includes(n)
}

/** One day window used by analytics date filters. */
export function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400_000).toISOString()
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
  const ref = collection(db, COLLECTIONS.SCANS)
  const c = from
    ? await getCountFromServer(query(ref, where('created_at', '>=', from)))
    : await getCountFromServer(ref)
  return c.data().count
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
    const ref = collection(db, COLLECTIONS.SCANS)
    const snapshot = await getDocs(query(ref, where('user_id', '==', uid), limit(cap)))
    cloud = rowsFrom<ScanRow>(snapshot)
  } catch {
    // Rules may deny the collection query in this release; the user's own
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

export async function fetchViolationsForScan(scanId: string): Promise<ViolationRow[]> {
  const ref = collection(db, COLLECTIONS.VIOLATIONS)
  const snapshot = await getDocs(query(ref, where('scan_id', '==', scanId), limit(200)))
  return rowsFrom<ViolationRow>(snapshot)
}

export async function fetchReportsForScan(scanId: string): Promise<ReportRow[]> {
  const ref = collection(db, COLLECTIONS.REPORTS)
  const snapshot = await getDocs(query(ref, where('scan_id', '==', scanId), limit(200)))
  return rowsFrom<ReportRow>(snapshot)
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
  await updateDoc(doc(db, COLLECTIONS.VIOLATIONS, violationId), {
    status,
    updated_at: new Date().toISOString(),
  })
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
  await updateDoc(doc(db, COLLECTIONS.REPORTS, reportId), patch)
}

/* ------------------------------------------------------------------ */
/* Users / profiles                                                    */
/* ------------------------------------------------------------------ */

export async function fetchUserDoc(uid: string): Promise<Record<string, unknown> | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.USERS, uid))
  if (!snap.exists()) return null
  const row: Record<string, unknown> = { id: snap.id }
  for (const k of Object.keys(snap.data())) row[k] = normalize(snap.data()[k])
  return row
}

export async function listProfiles(role: string, limit = 500): Promise<ProfileAdminRow[]> {
  const rows = await recentRows<ProfileAdminRow>(COLLECTIONS.USERS, limit)
  return rows.filter((p) => p.role === role)
}

/** Super admins (includes legacy admin/inspector docs mapped to super_admin). */
export async function listAdmins(): Promise<ProfileAdminRow[]> {
  const rows = await recentRows<ProfileAdminRow>(COLLECTIONS.USERS, 500)
  return rows.filter((p) => p.role === 'admin' || p.role === 'super_admin' || p.role === 'inspector')
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

export async function listMyNotifications(max = 100): Promise<NotificationRow[]> {
  const uid = auth.currentUser?.uid
  if (!uid) return []
  const ref = collection(db, COLLECTIONS.NOTIFICATIONS)
  const snapshot = await getDocs(query(ref, where('user_id', '==', uid), limit(max)))
  return rowsFrom<NotificationRow>(snapshot).sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
}

export async function unreadNotificationCount(): Promise<number> {
  const uid = auth.currentUser?.uid
  if (!uid) return 0
  const ref = collection(db, COLLECTIONS.NOTIFICATIONS)
  const snapshot = await getDocs(query(ref, where('user_id', '==', uid), limit(300)))
  return rowsFrom<NotificationRow>(snapshot).filter((n) => !n.read).length
}

/* ------------------------------------------------------------------ */
/* Generic counts (dashboard stat cards)                               */
/* ------------------------------------------------------------------ */

export async function countCollection(collectionName: string): Promise<number> {
  const ref = collection(db, collectionName)
  const c = await getCountFromServer(ref)
  return c.data().count
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
  const ref = collection(db, COLLECTIONS.PRODUCTS)
  const snapshot = await getDocs(query(ref, where('barcode', '==', barcode), limit(1)))
  if (snapshot.empty) return null
  return docToRow<ProductRow>(snapshot.docs[0])
}

/**
 * Realtime subscription over the product database (most recent 2000 docs).
 * Products created by scans or other managers appear live on the admin panel
 * without a manual reload. Returns an unsubscribe function.
 */
export function subscribeProducts(
  onChange: (rows: ProductRow[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const ref = query(collection(db, COLLECTIONS.PRODUCTS), orderBy('created_at', 'desc'), limit(2000))
  return onSnapshot(
    ref,
    (snap) => {
      onChange(snap.docs.map((d) => docToRow<ProductRow>(d)))
    },
    (err) => {
      onError?.(err as Error)
    },
  )
}