import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { supabase, mapSupabaseUser, type AuthUser } from './supabase'
import { useToast } from '../components/ui/Toast'
import {
  defaultProfileForUser,
  defaultPrefs,
  type AccountStatus,
  type Role,
  type UserPrefs,
  type UserProfile,
} from './rbac'

interface SignUpInput {
  name: string
  email: string
  password: string
  role: Role
  organization?: string
}

interface SignUpResult {
  error?: string
  needsEmailConfirm?: boolean
  profile?: UserProfile
}

interface GoogleSignInResult {
  error?: string
  /** Popup was closed without completing sign-in — not an error. */
  cancelled?: boolean
  /** OAuth always redirects (page navigates). */
  redirecting?: boolean
  profile?: UserProfile
}

interface AuthContextValue {
  user: AuthUser | null
  profile: UserProfile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error?: string; profile?: UserProfile }>
  signInWithGoogle: () => Promise<GoogleSignInResult>
  signUp: (input: SignUpInput) => Promise<SignUpResult>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  updateProfile: (patch: { name?: string; organization?: string; prefs?: Partial<UserPrefs> }) => Promise<{ error?: string }>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

/** Map a profiles row to our normalized UserProfile. */
function rowPrefs(row: Record<string, unknown>): UserPrefs {
  const raw = row.prefs && typeof row.prefs === 'object' ? (row.prefs as Record<string, unknown>) : {}
  const density = raw.density === 'compact' ? 'compact' : raw.density === 'comfortable' ? 'comfortable' : defaultPrefs().density
  return {
    density,
    notifications: typeof raw.notifications === 'boolean' ? raw.notifications : defaultPrefs().notifications,
  }
}

function rowToProfile(row: Record<string, unknown>, user: AuthUser): UserProfile {
  const roleVal = String(row.role ?? '')
  const statusVal = String(row.status ?? '')
  // Legacy 'admin'/'inspector' rows keep full operator access as super_admin.
  const role: Role = roleVal === 'super_admin' || roleVal === 'admin' || roleVal === 'inspector' ? 'super_admin' : 'user'
  const status: AccountStatus =
    statusVal === 'pending' ? 'pending' : statusVal === 'blocked' ? 'blocked' : 'active'
  const meta = user.user_metadata ?? {}
  const name =
    typeof row.full_name === 'string' && row.full_name.trim()
      ? row.full_name.trim()
      : ((meta.full_name as string | undefined) ?? 'User')
  return {
    uid: user.id,
    name,
    email: user.email ?? '',
    role,
    status,
    organization: typeof row.organization === 'string' ? row.organization : '',
    createdAt: row.created_at ? String(row.created_at) : null,
    lastLogin: row.last_login ? String(row.last_login) : null,
    prefs: rowPrefs(row),
  }
}

async function readProfileRow(uid: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as Record<string, unknown> | null) ?? null
}

async function upsertProfileRow(uid: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('profiles').upsert(
    { id: uid, ...patch, updated_at: new Date().toISOString() },
    { onConflict: 'id' },
  )
  if (error) throw new Error(error.message)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const lastLoginDone = useRef(false)
  const { toast } = useToast()

  const loadProfile = useCallback(async (currentUser: AuthUser) => {
    let row: Record<string, unknown> | null = null
    try {
      row = await readProfileRow(currentUser.id)
    } catch {
      row = null
    }

    if (row) {
      setProfile(rowToProfile(row, currentUser))
      return
    }

    // Backward-compatible fallback: an authenticated user without a row is
    // treated as an active standard user. Best-effort backfill.
    const fallback = defaultProfileForUser(currentUser)
    setProfile(fallback)
    try {
      await upsertProfileRow(currentUser.id, {
        full_name: fallback.name,
        email: currentUser.email ?? '',
        organization: fallback.organization,
        role: 'user',
        status: 'active',
        created_at: new Date().toISOString(),
        last_login: null,
      })
    } catch {
      /* non-critical */
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    const { data } = await supabase.auth.getUser()
    const mapped = mapSupabaseUser(data.user ?? null)
    setUser(mapped)
    if (!mapped) {
      setProfile(null)
      return
    }
    await loadProfile(mapped)
  }, [loadProfile])

  // Initial session + profile load + realtime auth changes.
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession()
        const mapped = mapSupabaseUser(data.session?.user ?? null)
        if (!active) return
        setUser(mapped)
        if (mapped) {
          await loadProfile(mapped)
          if (!lastLoginDone.current) {
            lastLoginDone.current = true
            void upsertProfileRow(mapped.id, { last_login: new Date().toISOString() }).catch(() => {})
          }
        }
      } catch (e) {
        if (active) toast('error', 'Unable to restore session', (e as Error)?.message ?? 'Please sign in again.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      const mapped = mapSupabaseUser(session?.user ?? null)
      setUser(mapped)
      if (!mapped) {
        setProfile(null)
        return
      }
      void loadProfile(mapped)
    })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [loadProfile, toast])

  const signIn = useCallback(
    async (email: string, password: string) => {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) return { error: friendlyAuthError(error) }
        const mapped = mapSupabaseUser(data.user ?? null)
        if (!mapped) return { error: 'Sign in failed. Please try again.' }
        setUser(mapped)
        await loadProfile(mapped)
        void upsertProfileRow(mapped.id, { last_login: new Date().toISOString() }).catch(() => {})
        return { profile: await readCurrentProfile(mapped) }
      } catch (e) {
        return { error: friendlyAuthError(e) }
      }
    },
    [loadProfile],
  )

  const signInWithGoogle = useCallback(
    async (): Promise<GoogleSignInResult> => {
      try {
        // Supabase Google OAuth is redirect-based (enable the provider in
        // Supabase Dashboard → Authentication → Providers → Google).
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: window.location.origin,
            queryParams: { prompt: 'select_account' },
          },
        })
        if (error) return { error: friendlyAuthError(error) }
        return { redirecting: true }
      } catch (e) {
        return { error: friendlyAuthError(e) }
      }
    },
    [],
  )

  const signUp = useCallback(
    async (input: SignUpInput): Promise<SignUpResult> => {
      try {
        const { data, error } = await supabase.auth.signUp({
          email: input.email,
          password: input.password,
          options: { data: { full_name: input.name } },
        })
        if (error) return { error: friendlyAuthError(error) }
        const mapped = mapSupabaseUser(data.user ?? null)
        if (!mapped) return { error: 'Sign up failed. Please try again.' }

        // All self-service signups are active consumer accounts. Operator
        // (super_admin) accounts are assigned their role separately.
        await upsertProfileRow(mapped.id, {
          full_name: input.name,
          email: input.email,
          organization: input.organization ?? '',
          role: 'user',
          status: 'active',
          created_at: new Date().toISOString(),
          last_login: new Date().toISOString(),
        }).catch(() => {})
        await loadProfile(mapped)
        const profile = await readCurrentProfile(mapped).catch(() => undefined)
        // Email confirmation on → no session yet; user must confirm first.
        if (!data.session) return { needsEmailConfirm: true, profile }
        return { profile }
      } catch (e) {
        return { error: friendlyAuthError(e) }
      }
    },
    [loadProfile],
  )

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut()
    } catch (e) {
      // Still clear local session state — the user asked to sign out.
      console.error('Supabase signOut failed', e)
    } finally {
      setUser(null)
      setProfile(null)
    }
  }, [])

  const updateProfile = useCallback(
    async (patch: { name?: string; organization?: string; prefs?: Partial<UserPrefs> }) => {
      if (!user) return { error: 'Not authenticated' }
      try {
        const updates: Record<string, unknown> = {}
        if (patch.name !== undefined) updates.full_name = patch.name
        if (patch.organization !== undefined) updates.organization = patch.organization
        if (patch.prefs !== undefined) {
          updates.prefs = { ...defaultPrefs(), ...profile?.prefs, ...patch.prefs }
        }
        await upsertProfileRow(user.id, updates)
        if (patch.name) {
          void supabase.auth.updateUser({ data: { full_name: patch.name } }).catch(() => {})
        }
        await loadProfile(user)
        return {}
      } catch (e) {
        return { error: (e as Error).message }
      }
    },
    [user, profile, loadProfile],
  )

  const value = useMemo<AuthContextValue>(
    () => ({ user, profile, loading, signIn, signInWithGoogle, signUp, signOut, refreshProfile, updateProfile }),
    [user, profile, loading, signIn, signInWithGoogle, signUp, signOut, refreshProfile, updateProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

async function readCurrentProfile(currentUser: AuthUser): Promise<UserProfile | undefined> {
  try {
    const row = await readProfileRow(currentUser.id)
    if (row) return rowToProfile(row, currentUser)
  } catch {
    /* fall through */
  }
  return defaultProfileForUser(currentUser)
}

/** Map Supabase auth errors to safe, actionable messages (never leak account existence). */
function friendlyAuthError(e: unknown): string {
  const raw = `${(e as { message?: string })?.message ?? ''}`.toLowerCase()
  if (!raw) return 'Sign in failed with an unexpected error. Please try again — if this keeps happening, contact the administrator.'
  if (raw.includes('invalid login credentials') || raw.includes('invalid email or password') || raw.includes('email not confirmed')) {
    if (raw.includes('email not confirmed')) return 'Please confirm your email address first — check your inbox for the confirmation link.'
    return 'Incorrect email or password. Check your credentials and try again.'
  }
  if (raw.includes('user already registered') || raw.includes('already exists') || raw.includes('duplicate')) {
    return 'An account with this email already exists. Try signing in instead.'
  }
  if (raw.includes('password') && (raw.includes('weak') || raw.includes('short') || raw.includes('length'))) {
    return 'Password is too weak. Use at least 6 characters with a mix of letters and numbers.'
  }
  if (raw.includes('invalid email') || raw.includes('email address') && raw.includes('invalid')) {
    return 'Please enter a valid email address.'
  }
  if (raw.includes('rate limit') || raw.includes('too many') || raw.includes('429')) {
    return 'Too many attempts. Wait a minute and try again.'
  }
  if (raw.includes('network') || raw.includes('fetch failed') || raw.includes('timeout')) {
    return 'Network error. Check your connection and try again.'
  }
  if (raw.includes('provider') && (raw.includes('disabled') || raw.includes('not enabled') || raw.includes('not supported'))) {
    return 'Google sign-in isn\u2019t enabled for this project yet. Ask the administrator to switch it on in Supabase Authentication → Providers.'
  }
  if (raw.includes('redirect') && raw.includes('not allowed')) {
    return 'This domain isn\u2019t in the redirect allow-list. Ask the administrator to add it in Supabase Authentication → URL Configuration.'
  }
  if (raw.includes('signup') && raw.includes('disabled')) {
    return 'New sign-ups are disabled. Contact the administrator.'
  }
  return 'Sign in failed with an unexpected error. Please try again — if this keeps happening, contact the administrator.'
}
