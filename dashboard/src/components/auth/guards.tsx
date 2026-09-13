import { type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { AuditXMark } from '../brand/AuditXMark'
import { homePath, type Role } from '../../lib/rbac'
import { useAuth } from '../../lib/auth'

export function LogoMark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return <AuditXMark size={size} />
}

export function FullPageLoader({ label = 'Verifying your session…' }: { label?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-100 dark:bg-navy-950" role="status">
      <LogoMark size="lg" />
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600 dark:border-white/15 dark:border-t-brand-400" />
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  )
}

/**
 * Gate for every protected route. Handles:
 *  - authentication loading state
 *  - unauthenticated users  -> /login
 *  - missing profile        -> /login
 *  - blocked accounts       -> /blocked
 *  - pending admins         -> /admin-pending
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, profile, loading } = useAuth()
  if (loading) return <FullPageLoader />
  if (!user || !profile) return <Navigate to="/login" replace />
  if (profile.status === 'blocked') return <Navigate to="/blocked" replace />
  if (profile.status === 'pending' && profile.role === 'super_admin') return <Navigate to="/admin-pending" replace />
  if (profile.status === 'pending') return <Navigate to="/blocked" replace />
  return <>{children}</>
}

/** Gate a specific path for a set of roles (inside RequireAuth). */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { profile } = useAuth()
  if (!profile) return <Navigate to="/login" replace />
  if (profile.status === 'blocked') return <Navigate to="/blocked" replace />
  if (profile.status === 'pending' && profile.role === 'super_admin') return <Navigate to="/admin-pending" replace />
  if (!roles.includes(profile.role)) return <Navigate to={homePath(profile)} replace />
  return <>{children}</>
}

/** Public-only pages (login/signup): bounce authenticated users to their home. */
export function PublicOnly({ children }: { children: ReactNode }) {
  const { user, profile, loading } = useAuth()
  if (loading) return <FullPageLoader />
  if (user && profile) return <Navigate to={homePath(profile)} replace />
  return <>{children}</>
}