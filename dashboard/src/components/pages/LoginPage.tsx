import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Loader2, LogIn } from 'lucide-react'
import AuthShell from '../auth/AuthShell'
import Input from '../ui/Input'
import Button from '../ui/Button'
import { FormAlert } from '../auth/FormAlert'
import { useAuth } from '../../lib/auth'
import { homePath } from '../../lib/rbac'
import { supabase } from '../../lib/supabase'
import { useLanguage } from '../../i18n/LanguageContext'

const EMAIL_RE = /^\S+@\S+\.\S+$/

/** Official Google "G" mark — inline SVG (no image asset, crisp at any size). */
function GoogleG() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29A7.14 7.14 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.62H1.29A11.86 11.86 0 0 0 0 12c0 1.92.46 3.76 1.29 5.38l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.46-3.46A11.9 11.9 0 0 0 12 0 11.86 11.86 0 0 0 1.29 6.62l3.98 3.09C6.95 6.86 9.6 4.75 12 4.75z"
      />
    </svg>
  )
}

export default function LoginPage() {
  const { signIn, signInWithGoogle } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || googleBusy) return
    setError('')
    if (!EMAIL_RE.test(email)) {
      setError(t('login.badEmail'))
      return
    }
    if (!password) {
      setError(t('login.noPassword'))
      return
    }
    setBusy(true)
    const result = await signIn(email, password)
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    navigate(homePath(result.profile ?? { role: 'user', status: 'active' }), { replace: true })
  }

  const handleGoogle = async () => {
    if (busy || googleBusy) return
    setError('')
    setGoogleBusy(true)
    const result = await signInWithGoogle()
    setGoogleBusy(false)
    if (result.redirecting) return // page is navigating to the Google redirect flow
    if (result.cancelled) return // user closed the popup — treat as a non-error
    if (result.error) {
      setError(result.error)
      return
    }
    navigate(homePath(result.profile ?? { role: 'user', status: 'active' }), { replace: true })
  }

  const handleForgot = async () => {
    setError('')
    if (!EMAIL_RE.test(email)) {
      setError(t('login.resetHint'))
      return
    }
    setResetBusy(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email)
      if (error) throw new Error(error.message)
      setResetSent(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setResetBusy(false)
    }
  }

  return (
    <AuthShell>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">{t('login.title')}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('login.subtitle')}</p>
      </div>

      {error && <div className="mb-4"><FormAlert tone="error" message={error} /></div>}
      {resetSent && (
        <div className="mb-4"><FormAlert tone="success" message={t('login.resetSent')} /></div>
      )}

      <button
        type="button"
        onClick={() => void handleGoogle()}
        disabled={busy || googleBusy}
        aria-label={t('login.google')}
        className="flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-400 hover:bg-slate-50 hover:shadow-md active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:bg-slate-700/60 dark:focus-visible:ring-offset-slate-900"
      >
        {googleBusy ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
            <span>{t('login.signingIn')}</span>
          </>
        ) : (
          <>
            <GoogleG />
            <span>{t('login.google')}</span>
          </>
        )}
      </button>

      <div className="my-5 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
        <span className="text-xs font-medium text-slate-400 dark:text-slate-500">{t('login.orEmail')}</span>
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label={t('login.email')}
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          disabled={googleBusy}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('login.password')}
            </label>
            <button
              type="button"
              onClick={handleForgot}
              disabled={resetBusy || googleBusy}
              className="text-xs font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-60 dark:text-brand-400"
            >
              {resetBusy ? t('login.sending') : t('login.forgot')}
            </button>
          </div>
          <Input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            disabled={googleBusy}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={googleBusy} icon={<LogIn className="h-4 w-4" />}>
          {t('login.signIn')}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
        {t('login.noAccount')}{' '}
        <Link to="/signup" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
          {t('login.createOne')}
        </Link>
      </p>
    </AuthShell>
  )
}