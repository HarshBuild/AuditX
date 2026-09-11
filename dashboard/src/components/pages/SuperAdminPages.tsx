import { useState } from 'react'
import { Check, ShieldCheck, X } from 'lucide-react'
import { useFirebaseQuery } from '../../hooks/useFirebaseQuery'
import { useAuth } from '../../lib/auth'
import { useToast } from '../ui/Toast'
import AnalyticsCard from '../dashboard/AnalyticsCard'
import DataTable, { type DataColumn } from '../table/DataTable'
import Button from '../ui/Button'
import Input from '../ui/Input'
import { ToneBadge } from '../ui/Badge'
import { EmptyState, ErrorState, LoadingState } from '../ui/States'
import { formatDateTime } from '../../utils/format'
import {
  listActivityLogs,
  listAdminRequests,
  listAdmins,
  listComplianceRules,
  listProfiles,
} from '../../lib/db'
import {
  addComplianceRule,
  approveAdminRequest,
  setAdminStatus,
  setUserStatus,
  toggleComplianceRule,
} from '../../lib/services'

const statusTone: Record<string, 'amber' | 'emerald' | 'rose' | 'cyan'> = {
  pending: 'amber',
  active: 'emerald',
  approved: 'emerald',
  blocked: 'rose',
  rejected: 'rose',
}

interface AdminRequestRow {
  id: string
  user_id: string
  created_at: string
  full_name: string
  email: string
  organization: string
  status: string
  reviewed_by: string | null
  reviewed_at: string | null
}

function UpdateStatusButton({
  busy,
  onClick,
  children,
}: {
  busy: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      {children}
    </button>
  )
}

/** Wrap a Firestore service promise into the hook's { data, error } contract. */
async function wrap<T>(promise: Promise<T[]>): Promise<{ data: T[] | null; error: { message: string } | null }> {
  try {
    return { data: await promise, error: null }
  } catch (e) {
    return { data: null, error: { message: (e as Error).message } }
  }
}

export function AdminRequestsPage() {
  const { toast } = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)

  const { data, loading, error, refresh } = useFirebaseQuery<AdminRequestRow>(
    () => wrap<AdminRequestRow>(listAdminRequests(100)),
    [],
  )
  const pending = data.filter((r) => r.status === 'pending')

  const act = async (id: string, approve: boolean, okMessage: string) => {
    setBusyId(id)
    try {
      await approveAdminRequest(id, approve)
      toast('success', okMessage)
      refresh()
    } catch (e) {
      toast('error', 'Action failed', (e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const columns: Array<DataColumn<AdminRequestRow>> = [
    { key: 'full_name', label: 'Applicant', render: (r) => (
      <div>
        <p className="font-semibold text-slate-800 dark:text-slate-100">{r.full_name || '—'}</p>
        <p className="text-xs text-slate-400">{r.email || '—'}</p>
      </div>
    ) },
    { key: 'organization', label: 'Organization', render: (r) => <span className="text-slate-500 dark:text-slate-400">{r.organization || '—'}</span> },
    { key: 'created_at', label: 'Requested', render: (r) => <span className="whitespace-nowrap text-slate-500 dark:text-slate-400">{formatDateTime(r.created_at)}</span> },
    { key: 'status', label: 'Status', render: (r) => <ToneBadge tone={statusTone[r.status] ?? 'slate'}>{r.status}</ToneBadge> },
    {
      key: 'actions',
      label: '',
      className: 'text-right',
      render: (r) =>
        r.status === 'pending' ? (
          <div className="flex items-center justify-end gap-1.5">
            <Button size="sm" variant="outline" loading={busyId === r.user_id} onClick={() => void act(r.user_id, true, 'Admin approved')}>
              <Check className="h-3.5 w-3.5" /> Approve
            </Button>
            <Button size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10" onClick={() => void act(r.user_id, false, 'Request rejected')}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : null,
    },
  ]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Admin Requests</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {pending.length} pending request{pending.length === 1 ? '' : 's'} awaiting your review.
        </p>
      </div>
      <AnalyticsCard title="Access requests" subtitle="Admin sign-ups are pending until approved" bodyClassName="p-0">
        {loading ? (
          <LoadingState label="Loading requests…" />
        ) : error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : data.length === 0 ? (
          <EmptyState title="No requests" message="New admin sign-ups will appear here for approval." />
        ) : (
          <DataTable columns={columns} rows={data} rowKey={(r) => r.id} />
        )}
      </AnalyticsCard>
    </div>
  )
}

interface ProfileAdminRow {
  id: string
  full_name: string
  organization: string
  status: string
  created_at: string
  last_login: string | null
}

export function AdminManagementPage() {
  const { toast } = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)

  const { data, loading, error, refresh } = useFirebaseQuery<ProfileAdminRow>(
    () => wrap<ProfileAdminRow>(listAdmins()),
    [],
  )

  const setStatus = async (id: string, status: string) => {
    setBusyId(id)
    try {
      await setAdminStatus(id, status as 'active' | 'blocked' | 'pending')
      toast('success', `Admin account ${status}`)
      refresh()
    } catch (e) {
      toast('error', 'Update failed', (e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const columns: Array<DataColumn<ProfileAdminRow>> = [
    { key: 'full_name', label: 'Admin', render: (r) => <span className="font-semibold text-slate-800 dark:text-slate-100">{r.full_name || '—'}</span> },
    { key: 'organization', label: 'Organization', render: (r) => <span className="text-slate-500 dark:text-slate-400">{r.organization || '—'}</span> },
    { key: 'status', label: 'Status', render: (r) => <ToneBadge tone={statusTone[r.status] ?? 'slate'}>{r.status}</ToneBadge> },
    { key: 'last_login', label: 'Last login', render: (r) => <span className="whitespace-nowrap text-slate-500 dark:text-slate-400">{r.last_login ? formatDateTime(r.last_login) : 'Never'}</span> },
    {
      key: 'actions',
      label: '',
      className: 'text-right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          {r.status === 'pending' && (
            <UpdateStatusButton busy={busyId === r.id} onClick={() => void setStatus(r.id, 'active')}>
              Approve
            </UpdateStatusButton>
          )}
          {r.status === 'active' && (
            <UpdateStatusButton busy={busyId === r.id} onClick={() => void setStatus(r.id, 'blocked')}>
              Block
            </UpdateStatusButton>
          )}
          {r.status === 'blocked' && (
            <UpdateStatusButton busy={busyId === r.id} onClick={() => void setStatus(r.id, 'active')}>
              Activate
            </UpdateStatusButton>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Admin Management</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Review and control every admin account in the system.</p>
      </div>
      <AnalyticsCard title="Admin accounts" subtitle="Only active admins can access admin areas" bodyClassName="p-0">
        {loading ? (
          <LoadingState label="Loading admins…" />
        ) : error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : data.length === 0 ? (
          <EmptyState title="No admins yet" message="Approved admin accounts appear here." />
        ) : (
          <DataTable columns={columns} rows={data} rowKey={(r) => r.id} />
        )}
      </AnalyticsCard>
    </div>
  )
}

interface ProfileUserRow {
  id: string
  full_name: string
  organization: string
  status: string
  created_at: string
  last_login: string | null
}

export function UsersPage() {
  const { toast } = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)

  const { data, loading, error, refresh } = useFirebaseQuery<ProfileUserRow>(
    () => wrap<ProfileUserRow>(listProfiles('user', 500)),
    [],
  )

  const setStatus = async (id: string, status: string) => {
    setBusyId(id)
    try {
      await setUserStatus(id, status as 'active' | 'blocked')
      toast('success', `User set to ${status}`)
      refresh()
    } catch (e) {
      toast('error', 'Update failed', (e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const columns: Array<DataColumn<ProfileUserRow>> = [
    { key: 'full_name', label: 'User', render: (r) => <span className="font-semibold text-slate-800 dark:text-slate-100">{r.full_name || '—'}</span> },
    { key: 'organization', label: 'Organization', render: (r) => <span className="text-slate-500 dark:text-slate-400">{r.organization || '—'}</span> },
    { key: 'status', label: 'Status', render: (r) => <ToneBadge tone={statusTone[r.status] ?? 'slate'}>{r.status}</ToneBadge> },
    { key: 'created_at', label: 'Joined', render: (r) => <span className="whitespace-nowrap text-slate-500 dark:text-slate-400">{formatDateTime(r.created_at)}</span> },
    {
      key: 'actions',
      label: '',
      className: 'text-right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          {r.status === 'active' ? (
            <UpdateStatusButton busy={busyId === r.id} onClick={() => void setStatus(r.id, 'blocked')}>
              Block
            </UpdateStatusButton>
          ) : (
            <UpdateStatusButton busy={busyId === r.id} onClick={() => void setStatus(r.id, 'active')}>
              Activate
            </UpdateStatusButton>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Users</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Manage standard user accounts and access.</p>
      </div>
      <AnalyticsCard title="Standard users" subtitle="User accounts across the platform" bodyClassName="p-0">
        {loading ? (
          <LoadingState label="Loading users…" />
        ) : error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : data.length === 0 ? (
          <EmptyState title="No users yet" message="User accounts appear here once they sign up." />
        ) : (
          <DataTable columns={columns} rows={data} rowKey={(r) => r.id} />
        )}
      </AnalyticsCard>
    </div>
  )
}

interface ComplianceRuleRow {
  id: string
  rule_key: string
  title: string
  description: string
  category: string
  is_active: boolean
  created_at: string
}

export function ComplianceRulesPage() {
  const { toast } = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [titleInput, setTitleInput] = useState('')
  const [descInput, setDescInput] = useState('')
  const [catInput, setCatInput] = useState('')

  const { data, loading, error, refresh } = useFirebaseQuery<ComplianceRuleRow>(
    () => wrap<ComplianceRuleRow>(listComplianceRules()),
    [],
  )

  const toggle = async (r: ComplianceRuleRow) => {
    setBusyId(r.id)
    try {
      await toggleComplianceRule(r.id, !r.is_active)
      refresh()
    } catch (e) {
      toast('error', 'Update failed', (e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const add = async () => {
    if (!keyInput.trim() || !titleInput.trim()) {
      toast('error', 'Missing fields', 'Rule key and title are required.')
      return
    }
    try {
      await addComplianceRule({
        rule_key: keyInput.trim(),
        title: titleInput.trim(),
        description: descInput.trim(),
        category: catInput.trim() || 'General',
        severity: 'medium',
        required: true,
      })
      toast('success', 'Rule added')
      setKeyInput('')
      setTitleInput('')
      setDescInput('')
      setCatInput('')
      setShowForm(false)
      refresh()
    } catch (e) {
      toast('error', 'Could not add rule', (e as Error).message)
    }
  }

  const columns: Array<DataColumn<ComplianceRuleRow>> = [
    { key: 'rule_key', label: 'Key', render: (r) => <span className="font-mono text-xs font-semibold text-brand-600 dark:text-brand-400">{r.rule_key}</span> },
    { key: 'title', label: 'Title', render: (r) => <span className="font-semibold text-slate-800 dark:text-slate-100">{r.title}</span> },
    { key: 'category', label: 'Category', render: (r) => <span className="text-slate-500 dark:text-slate-400">{r.category}</span> },
    { key: 'is_active', label: 'Status', render: (r) => <ToneBadge tone={r.is_active ? 'emerald' : 'slate'}>{r.is_active ? 'Active' : 'Disabled'}</ToneBadge> },
    {
      key: 'actions',
      label: '',
      className: 'text-right',
      render: (r) => (
        <UpdateStatusButton busy={busyId === r.id} onClick={() => void toggle(r)}>
          {r.is_active ? 'Disable' : 'Enable'}
        </UpdateStatusButton>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Compliance Rules</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Maintain the 10-point Legal Metrology rule set used by scans.</p>
        </div>
        <Button variant="outline" onClick={() => setShowForm((v) => !v)}>
          Add rule
        </Button>
      </div>

      {showForm && (
        <AnalyticsCard title="New compliance rule" subtitle="Only active rules are enforced">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Rule key *" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="e.g. rule-6-net-qty" />
            <Input label="Title *" value={titleInput} onChange={(e) => setTitleInput(e.target.value)} placeholder="e.g. Net quantity declaration" />
            <Input label="Category" value={catInput} onChange={(e) => setCatInput(e.target.value)} placeholder="General" />
            <div className="sm:col-span-2">
              <Input label="Description" value={descInput} onChange={(e) => setDescInput(e.target.value)} placeholder="What must be declared under this rule…" />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button onClick={() => void add()}>Save rule</Button>
          </div>
        </AnalyticsCard>
      )}

      <AnalyticsCard title="Rule set" subtitle={`${data.length} rules configured`} bodyClassName="p-0">
        {loading ? (
          <LoadingState label="Loading rules…" />
        ) : error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : data.length === 0 ? (
          <EmptyState title="No rules yet" message="Add the first compliance rule to get started." />
        ) : (
          <DataTable columns={columns} rows={data} rowKey={(r) => r.id} />
        )}
      </AnalyticsCard>
    </div>
  )
}

interface ActivityLogRow {
  id: string
  created_at: string
  user_id: string | null
  actor_id: string | null
  actor_name?: string
  action: string
  details: Record<string, unknown>
}

export function ActivityLogsPage() {
  const { data, loading, error, refresh } = useFirebaseQuery<ActivityLogRow>(
    () => wrap<ActivityLogRow>(listActivityLogs(undefined, 100)),
    [],
  )

  const columns: Array<DataColumn<ActivityLogRow>> = [
    { key: 'created_at', label: 'Time', render: (r) => <span className="whitespace-nowrap font-mono text-xs text-slate-500 dark:text-slate-400">{formatDateTime(r.created_at)}</span> },
    { key: 'action', label: 'Action', render: (r) => (
      <ToneBadge tone={r.action.includes('login') ? 'cyan' : r.action.includes('approved') ? 'emerald' : r.action.includes('blocked') || r.action.includes('rejected') ? 'rose' : 'brand'}>
        {r.action}
      </ToneBadge>
    ) },
    { key: 'actor_id', label: 'Actor', render: (r) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{r.actor_id?.slice(0, 8)}</span> },
    { key: 'details', label: 'Details', render: (r) => <span className="font-mono text-[11px] text-slate-400">{JSON.stringify(r.details ?? {})}</span> },
  ]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Activity Logs</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Audit trail of authentication and account events (last 100).</p>
      </div>
      <AnalyticsCard title="System activity" subtitle="Server-side audit trail" bodyClassName="p-0">
        {loading ? (
          <LoadingState label="Loading logs…" />
        ) : error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : data.length === 0 ? (
          <EmptyState title="No activity yet" message="Logins, approvals and status changes will be recorded here." />
        ) : (
          <DataTable columns={columns} rows={data} rowKey={(r) => r.id} />
        )}
      </AnalyticsCard>
    </div>
  )
}

export function SystemSettingsPage() {
  const { profile } = useAuth()
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">System Settings</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Global platform configuration.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <AnalyticsCard title="Platform" subtitle="Reference">
          <dl className="space-y-2.5 text-sm">
            {[
              ['Current role', profile?.role === 'super_admin' ? 'Super Admin' : profile?.role],
              ['Environment', 'Firebase (managed)'],
              ['Auth provider', 'Firebase Auth — email & password'],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3">
                <dt className="text-slate-500 dark:text-slate-400">{k}</dt>
                <dd className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-100">
                  <ShieldCheck className="h-3.5 w-3.5 text-brand-500" /> {v}
                </dd>
              </div>
            ))}
          </dl>
        </AnalyticsCard>

        <AnalyticsCard title="Coming soon" subtitle="Expanded in Part 2">
          <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            Email templates, notification channels, scan-completion heuristics, password policies and regional metrology
            configurations will be managed here in the next update.
          </p>
        </AnalyticsCard>
      </div>
    </div>
  )
}