/*
 * AuditX — local scan history store.
 *
 * Scans whose cloud write fails (or that run fully on-device) get a `local-*`
 * id and are persisted here so the user's scan history and reports survive
 * page reloads even without Firestore connectivity. Records are namespaced per
 * user and capped to keep localStorage small.
 */

import type { ScanRow } from './types2'

const KEY = 'auditx.localScans.v1'
const MAX_SCANS = 60

interface LocalStore {
  [uidOrAnon: string]: ScanRow[]
}

function readStore(): LocalStore {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as LocalStore
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeStore(store: LocalStore) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    // Quota exceeded or private mode — history is best-effort.
  }
}

function namespace(uid: string | null): string {
  return uid && uid.length > 0 ? uid : 'anonymous'
}

/** Persist a scan row to the local history. Cloud-scans can opt-in too. */
export function saveLocalScan(scan: ScanRow): void {
  const store = readStore()
  const ns = namespace(scan.user_id)
  const list = store[ns] ?? []
  const idx = list.findIndex((s) => s.id === scan.id && s.created_at === scan.created_at)
  if (idx >= 0) list[idx] = scan
  else list.unshift(scan)
  store[ns] = list.slice(0, MAX_SCANS)
  writeStore(store)
}

/** All locally-persisted scans for a user (newest first). */
export function getLocalScans(uid: string | null): ScanRow[] {
  const store = readStore()
  const list = store[namespace(uid)] ?? []
  return [...list].sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
}

/** Remove a locally-persisted scan (e.g. after it was saved to the cloud). */
export function removeLocalScan(id: string, uid: string | null): void {
  const store = readStore()
  const ns = namespace(uid)
  store[ns] = (store[ns] ?? []).filter((s) => s.id !== id)
  writeStore(store)
}