import { useEffect, useState } from 'react'
import { Mail, Save, ShieldCheck, Sparkles } from 'lucide-react'
import AnalyticsCard from '../dashboard/AnalyticsCard'
import Button from '../ui/Button'
import Input from '../ui/Input'
import { StatusBadge, ToneBadge } from '../ui/Badge'
import { useAuth } from '../../lib/auth'
import { roleLabel, initialsOf } from '../../lib/rbac'
import { formatDate } from '../../utils/format'
import { useToast } from '../ui/Toast'
import { fetchScansForUser } from '../../lib/db'

export default function ProfilePage() {
  const { profile, user, updateProfile } = useAuth()
  const { toast } = useToast()
  const [name, setName] = useState(profile?.name ?? '')
  const [org, setOrg] = useState(profile?.organization ?? '')
  const [saving, setSaving] = useState(false)
  const [stats, setStats] = useState<{ count: number; avg: number; compliant: number } | null>(null)

  useEffect(() => {
    setName(profile?.name ?? '')
    setOrg(profile?.organization ?? '')
  }, [profile?.name, profile?.organization])

  useEffect(() => {
    if (!user?.id) return
    let active = true
    fetchScansForUser(user.id, 200)
      .then((rows) => {
        if (!active) return
        setStats({
          count: rows.length,
          avg: rows.length ? Math.round(rows.reduce((a, s) => a + (s.overall_score ?? 0), 0) / rows.length) : 0,
          compliant: rows.filter((s) => s.verdict === 'COMPLIANT').length,
        })
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [user?.id])

  if (!profile) return null

  const save = async () => {
    setSaving(true)
    const { error } = await updateProfile({ name: name.trim(), organization: org.trim() })
    setSaving(false)
    if (error) toast('error', 'Could not save profile', error)
    else toast('success', 'Profile saved', 'Your profile details have been updated.')
  }

  const rows: Array<[string, React.ReactNode]> = [
    ['Email', profile.email || '—'],
    ['Role', roleLabel(profile.role)],
    ['Account status', <StatusBadge key="st" status={profile.status} />],
    ['Member since', profile.createdAt ? formatDate(profile.createdAt) : '—'],
    ['Last login', profile.lastLogin ? formatDate(profile.lastLogin) : '—'],
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">My Profile</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Your account information is managed by role-based access control.</p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <AnalyticsCard title="Account" subtitle="Identity & role">
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xl font-bold text-white">
              {initialsOf(profile.name)}
            </span>
            <div>
              <p className="text-lg font-bold text-slate-900 dark:text-slate-100">{profile.name || 'User'}</p>
              <p className="flex items-center justify-center gap-1.5 text-sm text-slate-400">
                <Mail className="h-3.5 w-3.5" /> {profile.email || '—'}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
              <ShieldCheck className="h-3.5 w-3.5" /> {roleLabel(profile.role)}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-center dark:border-white/10 dark:bg-navy-950/40">
              <p className="text-xl font-extrabold text-slate-900 dark:text-slate-100">{stats?.count ?? '—'}</p>
              <p className="text-[10px] font-semibold uppercase tracking-normal text-slate-400">Scans</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-center dark:border-white/10 dark:bg-navy-950/40">
              <p className="text-xl font-extrabold text-slate-900 dark:text-slate-100">{stats?.avg ?? '—'}</p>
              <p className="text-[10px] font-semibold uppercase tracking-normal text-slate-400">Avg score</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-center dark:border-white/10 dark:bg-navy-950/40">
              <p className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400">{stats?.compliant ?? '—'}</p>
              <p className="text-[10px] font-semibold uppercase tracking-normal text-slate-400">Compliant</p>
            </div>
          </div>
        </AnalyticsCard>

        <div className="space-y-5 lg:col-span-2">
          <AnalyticsCard title="Edit profile" subtitle="Saved to your account document">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Full name" value={name} onChange={(e) => setName(e.target.value)} />
              <Input label="Organization" value={org} onChange={(e) => setOrg(e.target.value)} />
            </div>
            <div className="mt-4 flex justify-end">
              <Button icon={<Save className="h-4 w-4" />} onClick={() => void save()} loading={saving}>
                Save changes
              </Button>
            </div>
          </AnalyticsCard>

          <AnalyticsCard title="Details" subtitle="Stored server-side in your profile">
            <dl className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                  <dt className="text-slate-500 dark:text-slate-400">{k}</dt>
                  <dd className="text-right font-semibold text-slate-800 dark:text-slate-100">{v}</dd>
                </div>
              ))}
              <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <dt className="text-slate-500 dark:text-slate-400">Report language</dt>
                <dd className="flex items-center gap-1.5 text-right font-semibold text-slate-800 dark:text-slate-100">
                  <ToneBadge tone="brand"><Sparkles className="h-3 w-3" /> Multi-language AI</ToneBadge>
                </dd>
              </div>
            </dl>
          </AnalyticsCard>
        </div>
      </div>
    </div>
  )
}