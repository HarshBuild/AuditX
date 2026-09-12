import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bell,
  KeyRound,
  Loader2,
  LogOut,
  Monitor,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  UserCircle2,
} from 'lucide-react'
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth'
import AnalyticsCard from '../dashboard/AnalyticsCard'
import Input from '../ui/Input'
import Button from '../ui/Button'
import { ToneBadge } from '../ui/Badge'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../lib/auth'
import { auth } from '../../lib/firebase'
import { roleLabel, defaultPrefs, type UserPrefs } from '../../lib/rbac'
import type { ThemeMode } from '../../hooks/useTheme'
import { cn } from '../../utils/format'

interface SettingsPageProps {
  mode: ThemeMode
  setMode: (m: ThemeMode) => void
}

const themeOptions: Array<{ key: ThemeMode; label: string; sub: string; icon: typeof Sun }> = [
  { key: 'light', label: 'Light', sub: 'Always use the light theme', icon: Sun },
  { key: 'dark', label: 'Dark', sub: 'Always use the dark theme', icon: Moon },
  { key: 'system', label: 'System', sub: 'Follow your operating system', icon: Monitor },
]

const roleTone: Record<string, 'brand' | 'emerald' | 'cyan'> = {
  user: 'brand',
  super_admin: 'cyan',
}

export default function SettingsPage({ mode, setMode }: SettingsPageProps) {
  const { toast } = useToast()
  const { profile, updateProfile, signOut } = useAuth()
  const [prefs, setPrefs] = useState<UserPrefs>(profile?.prefs ?? defaultPrefs())
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [changingPw, setChangingPw] = useState(false)

  useEffect(() => {
    if (profile?.prefs) setPrefs((p) => ({ ...p, ...profile.prefs }))
  }, [profile?.prefs])

  const initials = (profile?.name ?? 'U')
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2)

  const savePrefs = async () => {
    setSavingPrefs(true)
    const { error } = await updateProfile({ prefs })
    setSavingPrefs(false)
    if (error) {
      toast('error', 'Could not save preferences', error)
    } else {
      toast('success', 'Preferences saved', 'Your preferences apply to every dashboard page.')
    }
  }

  const changePassword = async () => {
    if (!auth.currentUser?.email) {
      toast('error', 'No session', 'You must be signed in to change your password.')
      return
    }
    if (newPw.length < 8) {
      toast('error', 'Weak password', 'Your new password must be at least 8 characters.')
      return
    }
    if (newPw !== confirmPw) {
      toast('error', 'Passwords differ', 'The confirmation does not match the new password.')
      return
    }
    setChangingPw(true)
    try {
      const cred = EmailAuthProvider.credential(auth.currentUser.email, currentPw)
      await reauthenticateWithCredential(auth.currentUser, cred)
      await updatePassword(auth.currentUser, newPw)
      setCurrentPw('')
      setNewPw('')
      setConfirmPw('')
      toast('success', 'Password updated', 'Use your new password on your next sign-in.')
    } catch (e) {
      const msg = (e as { code?: string; message?: string }).message ?? 'Could not change password.'
      toast('error', 'Could not change password', msg)
    } finally {
      setChangingPw(false)
    }
  }

  const refreshSession = async () => {
    setRefreshing(true)
    try {
      await auth.currentUser?.getIdToken(true)
      toast('success', 'Session refreshed', 'Your access token has been refreshed.')
    } catch {
      toast('error', 'Could not refresh session', 'Please sign out and sign back in.')
    } finally {
      setRefreshing(false)
    }
  }

  const handleSignOut = async () => {
    setLoggingOut(true)
    await signOut()
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Settings</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Manage your profile, appearance, preferences and account security.</p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <AnalyticsCard title="Profile" subtitle="Managed from the profile page">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white">
              {initials}
            </div>
            <div className="min-w-0 break-words">
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{profile?.name ?? 'User'}</p>
              <div className="mt-0.5 flex items-center gap-2">
                <ToneBadge tone={roleTone[profile?.role ?? 'user'] ?? 'brand'}>
                  <ShieldCheck className="h-3 w-3" /> {roleLabel(profile?.role ?? 'user')}
                </ToneBadge>
              </div>
              <p className="mt-1 text-xs text-slate-400">{profile?.email ?? ''}</p>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/40">
            <p className="text-slate-500 dark:text-slate-400">
              Edit your name, organization and account details on your profile page.
            </p>
            <Link
              to="/profile"
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
            >
              <UserCircle2 className="h-4 w-4" /> Open profile
            </Link>
          </div>
        </AnalyticsCard>

        <AnalyticsCard title="Appearance & preferences" subtitle="How AuditX looks and behaves on your device">
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {themeOptions.map((opt) => {
              const Icon = opt.icon
              const active = mode === opt.key
              return (
                <button
                  key={opt.key}
                  role="radio"
                  aria-checked={active}
                  onClick={() => setMode(opt.key)}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition-all',
                    active
                      ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10'
                      : 'border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700',
                  )}
                >
                  <Icon className={cn('h-6 w-6', active ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400')} />
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{opt.label}</span>
                  <span className="text-[11px] leading-tight text-slate-400">{opt.sub}</span>
                </button>
              )
            })}
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Content density</label>
              <select
                value={prefs.density}
                onChange={(e) => setPrefs((p) => ({ ...p, density: e.target.value as UserPrefs['density'] }))}
                className="h-9 w-full cursor-pointer appearance-none rounded-lg border border-slate-300 bg-white px-3 pr-8 text-sm text-slate-900 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Notifications</span>
              <button
                type="button"
                onClick={() => setPrefs((p) => ({ ...p, notifications: !p.notifications }))}
                className="flex h-9 items-center justify-between rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800/60"
              >
                <span className="flex items-center gap-2">
                  <Bell className="h-4 w-4 text-slate-400" />
                  {prefs.notifications ? 'Enabled' : 'Disabled'}
                </span>
                <span
                  className={cn(
                    'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                    prefs.notifications ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-600',
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                      prefs.notifications ? 'translate-x-4' : 'translate-x-0.5',
                    )}
                  />
                </span>
              </button>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="outline" onClick={() => void savePrefs()} loading={savingPrefs}>
              Save preferences
            </Button>
          </div>
        </AnalyticsCard>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <AnalyticsCard title="Account security" subtitle="Keep your sign-in protected">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Change your password</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            You will be asked for your current password to confirm the change.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input label="Current password" type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="••••••••" />
            <Input label="New password" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="8+ characters" />
            <Input label="Confirm new password" type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="Repeat it" />
          </div>
          <div className="mt-4 flex justify-end">
            <Button
              icon={changingPw ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              onClick={() => void changePassword()}
              loading={changingPw}
            >
              Update password
            </Button>
          </div>
          <p className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-400 dark:border-slate-800">
            Passwords are stored hashed by Firebase Auth — never in your profile document. Sign-in attempts are rate
            limited per IP by Firebase.
          </p>
        </AnalyticsCard>

        <AnalyticsCard title="Session" subtitle="Devices and access control for this account">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="text-sm">
              <p className="font-semibold text-slate-800 dark:text-slate-100">Signed in as {profile?.email ?? 'you'}</p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Role: {roleLabel(profile?.role ?? 'user')} · Status: {profile?.status ?? 'active'}
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => void refreshSession()} loading={refreshing}>
              <RefreshCw className="h-4 w-4" /> Refresh session token
            </Button>
            <Button variant="danger" onClick={() => void handleSignOut()} loading={loggingOut}>
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </div>
          <p className="mt-4 text-xs text-slate-400">
            Your access token is a short-lived encrypted JWT issued by Firebase Auth. Refreshing it re-reads your
            current role and account status.
          </p>
        </AnalyticsCard>
      </div>
    </div>
  )
}