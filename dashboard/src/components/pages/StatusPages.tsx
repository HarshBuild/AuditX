import { Link } from 'react-router-dom'
import { Ban, Clock4, LogOut, ShieldAlert, FileQuestion } from 'lucide-react'
import { LogoMark } from '../auth/guards'
import Button from '../ui/Button'
import { useAuth } from '../../lib/auth'
import { homePath } from '../../lib/rbac'

function StatusPage({
  icon,
  tone,
  title,
  message,
  children,
}: {
  icon: React.ReactNode
  tone: 'amber' | 'rose' | 'brand'
  title: string
  message: string
  children?: React.ReactNode
}) {
  const toneCls =
    tone === 'amber'
      ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400'
      : tone === 'rose'
        ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400'
        : 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400'

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-100 px-4 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-8 text-center shadow-card dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white">
          {icon}
        </div>
        <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">{title}</h1>
        <div className={`mx-auto mt-3 h-1 w-10 rounded-full ${toneCls.split(' ')[0]}`} aria-hidden="true" />
        <p className="mt-4 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{message}</p>
        {children}
      </div>
      <p className="mt-6 flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
        <LogoMark size="sm" /> AuditX · Legal Metrology Suite
      </p>
    </div>
  )
}

export function AdminPendingPage() {
  const { user, signOut } = useAuth()
  const email = user?.email ?? ''
  return (
    <StatusPage
      icon={<Clock4 className="h-7 w-7" />}
      tone="amber"
      title="Approval pending"
      message="Your Admin access request has been submitted and is currently awaiting approval. You will gain access to the Admin Dashboard once a Super Admin activates your account."
    >
      <div className="mx-auto mt-5 w-full max-w-xs">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          Pending admin · {email || 'no email on file'}
        </div>
      </div>
      <div className="mt-5 flex justify-center">
        <Button variant="outline" icon={<LogOut className="h-4 w-4" />} onClick={() => void signOut()}>
          Log out
        </Button>
      </div>
    </StatusPage>
  )
}

export function BlockedPage() {
  const { signOut } = useAuth()
  return (
    <StatusPage
      icon={<Ban className="h-7 w-7" />}
      tone="rose"
      title="Account restricted"
      message="Your account has been restricted. Please contact the system administrator to restore access."
    >
      <div className="mt-5 flex justify-center">
        <Button variant="outline" icon={<LogOut className="h-4 w-4" />} onClick={() => void signOut()}>
          Log out
        </Button>
      </div>
    </StatusPage>
  )
}

export function UnauthorizedPage() {
  const { profile } = useAuth()
  const home = profile ? homePath(profile) : '/login'
  return (
    <StatusPage
      icon={<ShieldAlert className="h-7 w-7" />}
      tone="amber"
      title="Unauthorized access"
      message="You do not have permission to access this page. If you believe this is a mistake, contact your administrator."
    >
      <div className="mt-5 flex justify-center">
        <Link to={home}>
          <Button>Go to my dashboard</Button>
        </Link>
      </div>
    </StatusPage>
  )
}

export function NotFoundPage() {
  const { profile } = useAuth()
  const home = profile ? homePath(profile) : '/login'
  return (
    <StatusPage
      icon={<FileQuestion className="h-7 w-7" />}
      tone="brand"
      title="Page not found"
      message="The page you are looking for does not exist or has been moved."
    >
      <div className="mt-5 flex justify-center">
        <Link to={home}>
          <Button>Back to my dashboard</Button>
        </Link>
      </div>
    </StatusPage>
  )
}