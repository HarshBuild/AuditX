/*
 * AuditX — Supabase bootstrap (replaces Firebase).
 * Single import for the Supabase client (Auth + Postgres + Storage).
 * The publishable key is public by design; authorization is enforced
 * server-side by RLS policies + the Express backend (service role).
 */

import { createClient, type SupabaseClient, type User as SupabaseUser } from '@supabase/supabase-js'
import { CONFIG, isSupabaseConfigured } from './config'

// createClient requires non-empty args at import time. When .env is missing
// we use a dummy placeholder so the app can boot and show an actionable
// "Supabase is not configured" error instead of crashing or hitting DNS NXDOMAIN.
const SUPABASE_URL = CONFIG.SUPABASE_URL.trim() || 'https://placeholder.supabase.co'
const SUPABASE_ANON_KEY = CONFIG.SUPABASE_ANON_KEY.trim() || 'placeholder-anon-key'

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

export { isSupabaseConfigured }

/*
 * Normalized authenticated-user shape kept identical to the previous
 * `User` contract so guards, RBAC and components compile unchanged.
 */
export interface AuthUser {
  id: string
  email: string | null
  user_metadata: Record<string, unknown>
  created_at: string | null
}

/** Map a Supabase user to the normalized user shape. */
export function mapSupabaseUser(u: SupabaseUser | null): AuthUser | null {
  if (!u) return null
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>
  return {
    id: u.id,
    email: u.email ?? null,
    user_metadata: {
      full_name: typeof meta.full_name === 'string' ? meta.full_name : (typeof meta.name === 'string' ? meta.name : ''),
      ...meta,
    },
    created_at: u.created_at ?? null,
  }
}

/** Current session access token for backend API calls (null when signed out). */
export async function accessToken(refresh = false): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  let session = data.session
  if (!session) return null
  if (refresh) {
    const { data: refreshed } = await supabase.auth.refreshSession()
    session = refreshed.session ?? session
  }
  return session?.access_token ?? null
}

/** Current signed-in user id (null when signed out). */
export async function currentUid(): Promise<string | null> {
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}
