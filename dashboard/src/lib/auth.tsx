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
  getRedirectResult,
  GoogleAuthProvider,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  updateProfile as fbUpdateProfile,
  type User as FirebaseUser,
  type UserCredential,
} from 'firebase/auth'
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { useToast } from '../components/ui/Toast'
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

interface GoogleSignInResult {
  error?: string
  /** Popup was closed without completing sign-in — not an error. */
  cancelled?: boolean
  /** Popup was blocked and the flow switched to redirect (page navigates). */
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
  const { toast } = useToast()

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
    // Pick up errors from a redirect-based Google sign-in (popup-blocked
    // fallback) so users land back on /login with a clean message instead of
    // silent failure. A successful redirect is handled by onIdTokenChanged below.
    void getRedirectResult(auth).catch((e) => {
      const code = (e as { code?: string } | null)?.code ?? ''
      if (!code || code === 'auth/redirect-cancelled-by-user' || code === 'auth/popup-closed-by-user') return
      toast('error', 'Unable to sign in with Google', friendlyAuthError(e))
    })

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

  const signInWithGoogle = useCallback(
    async (): Promise<GoogleSignInResult> => {
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      try {
        let credential: UserCredential
        try {
          credential = await signInWithPopup(auth, provider)
        } catch (e) {
          const code = (e as { code?: string } | null)?.code ?? ''
          // Popups can be blocked inside installed PWAs / embedded webviews; the
          // redirect flow is the reliable fallback there.
          if (
            code === 'auth/popup-blocked' ||
            code === 'auth/popup-iframe-initialization-failed' ||
            code === 'auth/popup-iframe-not-ready' ||
            code === 'auth/popup-request-timeout' ||
            code === 'auth/operation-not-supported-in-this-environment'
          ) {
            await signInWithRedirect(auth, provider)
            return { redirecting: true }
          }
          throw e
        }

        // Force an ID-token refresh so freshly minted custom claims (role/status)
        // are present the moment the dashboard loads.
        await credential.user.getIdToken(true)
        const mapped = mapUser(credential.user)
        if (!mapped) return { error: 'Sign in failed. Please try again.' }
        // Keep the Firebase display name in sync with Google's (best-effort).
        if (credential.user.displayName) {
          void fbUpdateProfile(credential.user, { displayName: credential.user.displayName }).catch(() => {})
        }
        setUser(mapped)
        await loadProfile(mapped)
        void updateDoc(doc(db, COLLECTIONS.USERS, mapped.id), {
          email: credential.user.email ?? '',
          last_login: new Date().toISOString(),
        }).catch(() => {})
        return { profile: await readCurrentProfile(mapped) }
      } catch (e) {
        const code = (e as { code?: string } | null)?.code ?? ''
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
          return { cancelled: true }
        }
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
    try {
      await fbSignOut(auth)
    } catch (e) {
      // Still clear local session state — the user asked to sign out.
      console.error('Firebase signOut failed', e)
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
    () => ({ user, profile, loading, signIn, signInWithGoogle, signUp, signOut, refreshProfile, updateProfile }),
    [user, profile, loading, signIn, signInWithGoogle, signUp, signOut, refreshProfile, updateProfile],
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
      return 'This sign-in method isn\u2019t enabled for the project yet. Ask the administrator to switch it on in Firebase Authentication.'
    case 'auth/unauthorized-domain':
      return 'This domain isn\u2019t authorized for Google sign-in. Ask the administrator to add it in Firebase Console \u2192 Authentication \u2192 Settings \u2192 Authorized domains.'
    case 'auth/unauthorized-continue-uri':
      return 'This sign-in link isn\u2019t allowed for the current domain. Contact the administrator.'
    case 'auth/app-not-authorized':
      return 'This app is not authorized to use the Authentication service. Contact the administrator.'
    case 'auth/operation-not-supported-in-this-environment':
      return 'This device blocks the Google sign-in window. Use a regular desktop browser, or sign in with your email and password.'
    case 'auth/invalid-oauth-client-id':
    case 'auth/invalid-oauth-provider':
    case 'auth/invalid-oauth-token':
      return 'Google sign-in is misconfigured in the project. Contact the administrator.'
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
      return 'An account already exists with this Google email. If it was created with a password, sign in with that email and password instead — or use "Forgot password?" to reset it.'
    case 'auth/session-expired':
      return 'Your session expired. Please sign in again.'
    case 'auth/credential-already-in-use':
      return 'This sign-in method is already linked to another account. Try signing in with a different Google account.'
    case 'auth/invalid-recaptcha-token':
      return 'Google\u2019s safety check failed. Refresh the page and try again.'
    default:
      return 'Sign in failed with an unexpected error. Please try again — if this keeps happening, contact the administrator.'
  }
}