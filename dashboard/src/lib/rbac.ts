import type { AuthUser } from './firebase'

/**
 * AuditX role model — exactly two roles.
 *   user        → Consumer  (scan products, history, reports, profile, settings)
 *   super_admin → Super Admin (owner: staff access, users, scans, compliance
 *                              rules, analytics, audit, system settings)
 *
 * `user` keeps its Firestore value for backward compatibility with existing data;
 * the UI labels it "Consumer". Legacy `inspector`/`admin` documents are mapped to
 * `super_admin` on read so pre-migration accounts keep full access.
 */
export type Role = 'user' | 'super_admin'
export type AccountStatus = 'active' | 'pending' | 'blocked'

export interface UserPrefs {
  density: 'comfortable' | 'compact'
  notifications: boolean
}

export function defaultPrefs(): UserPrefs {
  return { density: 'comfortable', notifications: true }
}

export interface UserProfile {
  uid: string
  name: string
  email: string
  role: Role
  status: AccountStatus
  createdAt?: string | null
  lastLogin?: string | null
  organization?: string
  prefs?: UserPrefs
}

export const ROLE_LABELS: Record<Role, string> = {
  user: 'Consumer',
  super_admin: 'Super Admin',
}

export const STATUS_LABELS: Record<AccountStatus, string> = {
  active: 'Active',
  pending: 'Pending Approval',
  blocked: 'Blocked',
}

export const ALLOWED_ROLES: Role[] = ['user', 'super_admin']
export const ALLOWED_STATUSES: AccountStatus[] = ['active', 'pending', 'blocked']

export function isRole(value: string | undefined | null): value is Role {
  return !!value && (ALLOWED_ROLES as string[]).includes(value)
}

export function isStatus(value: string | undefined | null): value is AccountStatus {
  return !!value && (ALLOWED_STATUSES as string[]).includes(value)
}

/** Backward-compatible default profile for any authenticated user without one. */
export function defaultProfileForUser(user: AuthUser): UserProfile {
  const meta = user.user_metadata ?? {}
  const name = typeof meta.full_name === 'string' && meta.full_name.trim()
    ? meta.full_name.trim()
    : (user.email ?? 'User').split('@')[0]
  return {
    uid: user.id,
    name,
    email: user.email ?? '',
    role: 'user',
    status: 'active',
    organization: typeof meta.organization === 'string' ? meta.organization : '',
    createdAt: user.created_at ?? null,
    prefs: defaultPrefs(),
  }
}

/** Where a user should land after login, based on role + status. */
export function homePath(profile: Pick<UserProfile, 'role' | 'status'>): string {
  if (profile.status === 'blocked') return '/blocked'
  if (profile.role === 'super_admin') return profile.status === 'active' ? '/super-admin-dashboard' : '/admin-pending'
  return '/user-dashboard'
}

/** Human-friendly label shown in the header / sidebar. */
export function roleLabel(role: Role): string {
  return ROLE_LABELS[role] ?? 'Consumer'
}

export function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2) || 'U'
}