import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { UserRound } from 'lucide-react'
import AuthShell from '../auth/AuthShell'
import Input from '../ui/Input'
import Button from '../ui/Button'
import { FormAlert } from '../auth/FormAlert'
import { useAuth } from '../../lib/auth'
import { homePath } from '../../lib/rbac'
import { cn } from '../../utils/format'

const EMAIL_RE = /^\S+@\S+\.\S+$/

export default function SignupPage() {
  const { signUp } = useAuth()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [org, setOrg] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [terms, setTerms] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const checks = {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  }
  const strength = [checks.length, checks.upper, checks.number, checks.special].filter(Boolean).length

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setNotice('')

    if (!name.trim()) return setError('Please enter your full name.')
    if (!EMAIL_RE.test(email)) return setError('Please enter a valid email address.')
    if (strength < 4)
      return setError('Password is too weak. Use 8+ characters with uppercase, number and special character.')
    if (password !== confirm) return setError('Passwords do not match.')
    if (!terms) return setError('Please accept the Terms of Service to continue.')

    setBusy(true)
    const result = await signUp({ name: name.trim(), email, password, role: 'user', organization: org.trim() })
    setBusy(false)

    if (result.error) return setError(result.error)
    if (result.needsEmailConfirm) {
      setNotice('Account created! We sent a confirmation link to your inbox. Please verify and then sign in.')
      return
    }
    const target = result.profile ? homePath(result.profile) : '/user-dashboard'
    navigate(target, { replace: true })
  }

  return (
    <AuthShell>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Create account</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Join AuditX — a regular account lets you scan products and check compliance.</p>
      </div>

      {error && (
        <div className="mb-4">
          <FormAlert tone="error" message={error} />
        </div>
      )}
      {notice && (
        <div className="mb-4">
          <FormAlert tone="success" message={notice} />
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/60 p-3 dark:border-brand-500/20 dark:bg-brand-500/10">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-brand-600 dark:bg-brand-500/20 dark:text-brand-300">
            <UserRound className="h-5 w-5" />
          </span>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            You are signing up as a <b>Consumer</b>. Admin &amp; operator accounts are created separately — use your credentials to sign in.
          </p>
        </div>

        <Input
          label="Full name *"
          name="name"
          autoComplete="name"
          placeholder="Your full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          label="Email address *"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label="Organization (optional)"
          name="organization"
          autoComplete="organization"
          placeholder="Company / Dept."
          value={org}
          onChange={(e) => setOrg(e.target.value)}
        />
        <div>
          <Input
            label="Password *"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="Create a strong password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="mt-2 flex gap-1.5" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={cn(
                  'h-1 flex-1 rounded-full transition-all duration-300',
                  i < strength
                    ? strength <= 1
                      ? 'bg-rose-500'
                      : strength === 2
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                    : 'bg-slate-200 dark:bg-slate-800',
                )}
              />
            ))}
          </div>
          <p
            className={cn(
              'mt-1.5 text-[11px]',
              strength === 4 ? 'text-emerald-600' : strength >= 2 ? 'text-amber-600' : 'text-rose-600',
            )}
          >
            {strength <= 1 ? 'Weak — add more variety.' : strength === 2 ? 'Fair — nearly there.' : strength === 3 ? 'Good — one more check!' : 'Strong password.'}
          </p>
        </div>
        <Input
          label="Confirm password *"
          name="confirm"
          type="password"
          autoComplete="new-password"
          placeholder="Re-enter your password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />

        <label className="flex cursor-pointer select-none items-start gap-2.5">
          <input
            type="checkbox"
            checked={terms}
            onChange={(e) => setTerms(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded accent-brand-600"
          />
          <span className="text-xs text-slate-600 dark:text-slate-400">
            I agree to the <span className="font-semibold text-brand-600 dark:text-brand-400">Terms of Service</span> and{' '}
            <span className="font-semibold text-brand-600 dark:text-brand-400">Privacy Policy</span>
          </span>
        </label>

        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Create Account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
          Sign in
        </Link>
      </p>
    </AuthShell>
  )
}