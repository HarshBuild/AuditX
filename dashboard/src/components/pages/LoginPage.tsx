import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { LogIn } from 'lucide-react'
import AuthShell from '../auth/AuthShell'
import Input from '../ui/Input'
import Button from '../ui/Button'
import { FormAlert } from '../auth/FormAlert'
import { useAuth } from '../../lib/auth'
import { homePath } from '../../lib/rbac'
import { auth } from '../../lib/firebase'
import { sendPasswordResetEmail } from 'firebase/auth'

const EMAIL_RE = /^\S+@\S+\.\S+$/

export default function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!EMAIL_RE.test(email)) {
      setError('Please enter a valid email address.')
      return
    }
    if (!password) {
      setError('Please enter your password.')
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

  const handleForgot = async () => {
    setError('')
    if (!EMAIL_RE.test(email)) {
      setError('Enter your email address above, then click "Forgot password?".')
      return
    }
    setResetBusy(true)
    try {
      await sendPasswordResetEmail(auth, email)
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
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Welcome back</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Sign in to AuditX — Legal Metrology compliance scanning.</p>
      </div>

      {error && <div className="mb-4"><FormAlert tone="error" message={error} /></div>}
      {resetSent && (
        <div className="mb-4"><FormAlert tone="success" message="Reset link sent! Please check your inbox (and spam folder)." /></div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Password
            </label>
            <button
              type="button"
              onClick={handleForgot}
              disabled={resetBusy}
              className="text-xs font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-60 dark:text-brand-400"
            >
              {resetBusy ? 'Sending…' : 'Forgot password?'}
            </button>
          </div>
          <Input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <Button type="submit" size="lg" className="w-full" loading={busy} icon={<LogIn className="h-4 w-4" />}>
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
        Don't have an account?{' '}
        <Link to="/signup" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
          Create one
        </Link>
      </p>
    </AuthShell>
  )
}