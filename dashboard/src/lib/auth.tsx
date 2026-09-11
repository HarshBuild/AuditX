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
import {
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile as fbUpdateProfile,
  type User as FirebaseUser,
} from 'firebase/auth'
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { auth, db, type AuthUser } from './firebase'
import { COLLECTIONS } from './db'
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

interface AuthContextValue {
  user: AuthUser | null
  profile: UserProfile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error?: string; profile?: UserProfile }>
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

/** Map a Firebase user to the pre-migration normalized user shape. */
function mapUser(u: FirebaseUser | null): AuthUser | null {
  if (!u) return null
  return {
    id: u.uid,
    email: u.email,
    user_metadata: {
      full_name: u.displayName ?? '',
    },
    created_at: u.metadata?.creationTime ?? null,
  }
}

/** Map a users document to our normalized UserProfile. */
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
  // Legacy 'admin'/'inspector' documents keep full operator access as super_admin.
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

async function readUserProfileDoc(uid: string): Promise<Record<string, unknown> | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.USERS, uid))
  if (!snap.exists()) return null
  const row: Record<string, unknown> = { id: snap.id }
  for (const k of Object.keys(snap.data())) row[k] = snap.data()[k]
  return row
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const lastLoginDone = useRef(false)
  const tokenRefreshed = useRef(false)

  const loadProfile = useCallback(async (currentUser: AuthUser) => {
    const row = await readUserProfileDoc(currentUser.id)

    if (row) {
      setProfile(rowToProfile(row, currentUser))
      return
    }

    // Backward-compatible fallback: an authenticated user without a doc is
    // treated as an active standard user. Best-effort backfill.
    const fallback = defaultProfileForUser(currentUser)
    setProfile(fallback)
    try {
      await setDoc(doc(db, COLLECTIONS.USERS, fallback.uid), {
        full_name: fallback.name,
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
    const current = auth.currentUser
    if (!current) {
      setUser(null)
      setProfile(null)
      return
    }
    const mapped = mapUser(current)
    setUser(mapped)
    if (!mapped) {
      setProfile(null)
      return
    }
    await loadProfile(mapped)
  }, [loadProfile])

  // Initial session + profile load + realtime auth changes (token refresh picks
  // up freshly minted custom claims, so status/role changes take effect here).
  useEffect(() => {
    let active = true
    const unsubscribe = onIdTokenChanged(auth, (fbUser) => {
      const mapped = mapUser(fbUser)
      if (!active) return
      setUser(mapped)
      if (!mapped) {
        setProfile(null)
        if (active) setLoading(false)
        return
      }
      const m = mapped
      void (async () => {
        // Force one ID-token refresh per session so freshly minted custom
        // claims (role/status) reach the security rules immediately instead of
        // waiting up to an hour for Firebase's background refresh.
        if (!tokenRefreshed.current) {
          tokenRefreshed.current = true
          try {
            await auth.currentUser?.getIdToken(true)
          } catch {
            /* non-critical */
          }
        }
        await loadProfile(m)
        // Touch last_login once per browser session (best-effort).
        if (!lastLoginDone.current) {
          lastLoginDone.current = true
          void updateDoc(doc(db, COLLECTIONS.USERS, m.id), {
            last_login: new Date().toISOString(),
          }).catch(() => {})
        }
        if (active) setLoading(false)
      })()
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [loadProfile])

  const signIn = useCallback(
    async (email: string, password: string) => {
      try {
        const credential = await signInWithEmailAndPassword(auth, email, password)
        // Force an immediate ID-token refresh so freshly minted custom claims
        // (role/status) are present the moment the dashboard loads.
        await credential.user.getIdToken(true)
        const mapped = mapUser(credential.user)
        if (!mapped) return { error: 'Sign in failed. Please try again.' }
        setUser(mapped)
        await loadProfile(mapped)
        void updateDoc(doc(db, COLLECTIONS.USERS, mapped.id), {
          last_login: new Date().toISOString(),
        }).catch(() => {})
        return { profile: await readCurrentProfile(mapped) }
      } catch (e) {
        return { error: friendlyAuthError(e) }
      }
    },
    [loadProfile],
  )

  const signUp = useCallback(
    async (input: SignUpInput): Promise<SignUpResult> => {
      try {
        const credential = await createUserWithEmailAndPassword(auth, input.email, input.password)
        await fbUpdateProfile(credential.user, { displayName: input.name })
        const mapped = mapUser(credential.user)
        if (!mapped) return { error: 'Sign up failed. Please try again.' }

        // All self-service signups are active consumer accounts. Operator
        // (super_admin) accounts are created separately (e.g. bootstrap-super-admin.mjs)
        // and assigned their role on the users document.
        const role: Role = 'user'
        const status: AccountStatus = 'active'
        await setDoc(doc(db, COLLECTIONS.USERS, mapped.id), {
          full_name: input.name,
          email: input.email,
          organization: input.organization ?? '',
          role,
          status,
          created_at: new Date().toISOString(),
          last_login: new Date().toISOString(),
        })
        await loadProfile(mapped)
        const profile = await readCurrentProfile(mapped)
        return { profile }
      } catch (e) {
        return { error: friendlyAuthError(e) }
      }
    },
    [loadProfile],
  )

  const signOut = useCallback(async () => {
    await fbSignOut(auth)
    setUser(null)
    setProfile(null)
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
        await updateDoc(doc(db, COLLECTIONS.USERS, user.id), updates)
        if (patch.name && auth.currentUser) {
          void fbUpdateProfile(auth.currentUser, { displayName: patch.name }).catch(() => {})
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
    () => ({ user, profile, loading, signIn, signUp, signOut, refreshProfile, updateProfile }),
    [user, profile, loading, signIn, signUp, signOut, refreshProfile, updateProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

async function readCurrentProfile(currentUser: AuthUser): Promise<UserProfile | undefined> {
  const row = await readUserProfileDoc(currentUser.id)
  if (row) return rowToProfile(row, currentUser)
  return defaultProfileForUser(currentUser)
}

/** Map Firebase auth errors to safe, actionable messages (never leak account existence). */
function friendlyAuthError(e: unknown): string {
  const code = (e as { code?: string } | null)?.code ?? ''
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password. Check your credentials and try again.'
    case 'auth/invalid-email':
      return 'Please enter a valid email address.'
    case 'auth/user-disabled':
      return 'This account has been blocked. Contact the administrator.'
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Wait a minute and try again.'
    case 'auth/network-request-failed':
    case 'auth/network-error':
      return 'Network error. Check your connection and try again.'
    case 'auth/timeout':
      return 'Sign-in timed out. Check your connection and try again.'
    case 'auth/operation-not-allowed':
      return 'Email/password sign-in is not enabled for this project.'
    case 'auth/invalid-api-key':
      return 'Sign-in is unavailable (bad API key). Contact the administrator.'
    case 'auth/internal-error':
      return 'Unexpected sign-in error. Try again — if it persists, sign out and back in.'
    case 'auth/quota-exceeded':
      return 'Temporary sign-in limit reached. Wait a minute and try again.'
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try signing in instead.'
    case 'auth/weak-password':
      return 'Password is too weak. Use at least 6 characters with a mix of letters and numbers.'
    case 'auth/invalid-password':
      return 'Password is incorrect or too weak. Try again.'
    case 'auth/expired-action-code':
      return 'This sign-in link has expired. Request a new one.'
    case 'auth/account-exists-with-different-credential':
      return 'An account exists with this email but a different sign-in method. Try the original method.'
    case 'auth/session-expired':
      return 'Your session expired. Please sign in again.'
    default:
      return 'Sign in failed. Please try again. If this keeps happening, check your internet connection and confirm the account exists.'
  }
}