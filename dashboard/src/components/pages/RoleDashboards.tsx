import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ClipboardCheck,
  FileCheck2,
  FileText,
  FileWarning,
  Gauge,
  ScanLine,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react'
import AnalyticsCard from '../dashboard/AnalyticsCard'
import StatCard from '../dashboard/StatCard'
import RiskBars from '../dashboard/RiskBars'
import DataTable, { type DataColumn } from '../table/DataTable'
import { ToneBadge } from '../ui/Badge'
import { LoadingState, ErrorState, EmptyState } from '../ui/States'
import Button from '../ui/Button'
import { useAuth } from '../../lib/auth'
import {
  countCollection,
  listActivityLogs,
  listAdminRequests,
  listAdmins,
  listReports,
  listScans,
  listViolations,
  scanRiskDistribution,
  type RiskDistribution,
} from '../../lib/db'
import { generateInsights, riskBand, riskTone, severityLabel } from '../../lib/risk'
import { scanStatusTone, severityTone, violationStatusTone } from '../../lib/ui'
import type { ActivityLogRow, AdminRequestRow, ReportRow, ScanRow, ViolationRow } from '../../lib/types2'
import { COLLECTIONS } from '../../lib/db'
import { timeAgo } from '../../utils/format'
import { displayProductName, displayText } from '../../lib/textnorm'
import type { StatDefinition } from '../../types'

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function RiskBadge({ score }: { score: number | null }) {
  const band = riskBand(score ?? 100)
  return <ToneBadge tone={riskTone(band)}>{band}</ToneBadge>
}

function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): { data: T | null; loading: boolean; error: string | null; refetch: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cb = useCallback(fn, [...deps, tick])
  const refetch = useCallback(() => setTick((t) => t + 1), [])
  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    void cb().then(
      (d) => {
        if (!active) return
        setData(d)
        setLoading(false)
      },
      (e) => {
        if (!active) return
        setError((e as Error).message)
        setLoading(false)
      },
    )
    return () => {
      active = false
    }
  }, [cb])
  return { data, loading, error, refetch }
}

/* ------------------------------------------------------------------ */
/* Admin dashboard                                                     */
/* ------------------------------------------------------------------ */

export function AdminDashboardPage() {
  const { profile } = useAuth()
  const { data: scansData, loading, error, refetch } = useLoad<ScanRow[]>(
    async () => (await listScans({ page: 1, pageSize: 100 })).data,
    [],
  )
  const { data: violationsData } = useLoad<ViolationRow[]>(
    async () => (await listViolations({ page: 1, pageSize: 200 })).data,
    [],
  )
  const { data: reportsData } = useLoad<ReportRow[]>(
    async () => (await listReports({ page: 1, pageSize: 100 })).data,
    [],
  )
  const scans = scansData ?? []
  const violations = violationsData ?? []
  const reports = reportsData ?? []
  const [distribution, setDistribution] = useState<RiskDistribution>({ Low: 0, Medium: 0, High: 0, Critical: 0 })
  useEffect(() => {
    void scanRiskDistribution(scans).then(setDistribution)
  }, [scans])

  const highRisk = scans.filter((s) => (s.risk_score ?? 100 - s.overall_score) >= 51).length
  const openViolations = violations.filter((v) => !['Resolved', 'Rejected'].includes(v.status))
  const pendingReports = reports.filter((r) => r.status === 'Pending')
  const insights = generateInsights(scans, violations).slice(0, 4)

  const stats: StatDefinition[] = [
    { id: 'total', title: 'Total scans', value: scans.length, icon: ScanLine, accent: 'brand', hint: 'recent 100' },
    { id: 'high', title: 'High / critical risk', value: highRisk, icon: AlertTriangle, accent: 'rose', hint: 'risk score ≥ 51' },
    { id: 'viol', title: 'Violations open', value: openViolations.length, icon: FileWarning, accent: 'amber', hint: 'not resolved' },
    { id: 'reports', title: 'Reports pending', value: pendingReports.length, icon: ClipboardCheck, accent: 'cyan', hint: 'awaiting triage' },
  ]

  const scanColumns: Array<DataColumn<ScanRow>> = [
    {
      key: 'product',
      label: 'Product',
      render: (s) => (
        <div>
          <p className="font-semibold text-slate-800 dark:text-slate-100">{s.product_name?.trim() ? displayProductName(s.product_name) : 'Untitled'}</p>
          <p className="text-xs text-slate-400">{displayText(s.manufacturer || s.brand) || '—'}</p>
        </div>
      ),
    },
    { key: 'score', label: 'Score', className: 'text-right', render: (s) => <span className="font-bold text-slate-700 dark:text-slate-200">{s.overall_score ?? '—'}</span> },
    { key: 'risk', label: 'Risk', className: 'hidden sm:table-cell', render: (s) => <RiskBadge score={s.risk_score} /> },
    { key: 'status', label: 'Status', className: 'hidden md:table-cell', render: (s) => <ToneBadge tone={scanStatusTone(s.status)}>{s.status}</ToneBadge> },
    { key: 'date', label: 'When', className: 'hidden lg:table-cell', render: (s) => <span className="text-slate-500 dark:text-slate-400">{timeAgo(s.created_at)}</span> },
  ]

  const violationColumns: Array<DataColumn<ViolationRow>> = [
    { key: 'product', label: 'Product', render: (v) => <span className="font-medium text-slate-800 dark:text-slate-100">{v.product_name?.trim() ? displayProductName(v.product_name) : 'Untitled'}</span> },
    { key: 'type', label: 'Violation', render: (v) => <span className="text-slate-500 dark:text-slate-400">{v.type || '—'}</span> },
    { key: 'severity', label: 'Severity', className: 'hidden sm:table-cell', render: (v) => <ToneBadge tone={severityTone(v.severity)}>{severityLabel(v.severity)}</ToneBadge> },
    { key: 'status', label: 'Status', className: 'hidden md:table-cell', render: (v) => <ToneBadge tone={violationStatusTone(v.status)}>{v.status}</ToneBadge> },
  ]

  const links = [
    { path: '/admin/scans', label: 'Product Scans', icon: FileText, desc: 'Every compliance scan across the system' },
    { path: '/admin/violations', label: 'Violations', icon: ClipboardCheck, desc: 'Non-compliant items needing attention' },
    { path: '/admin/manufacturers', label: 'Manufacturers', icon: ShieldCheck, desc: 'Manufacturer profiles and performance' },
    { path: '/admin/analytics', label: 'Analytics', icon: Gauge, desc: 'Trends, distributions and compliance health' },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-emerald-200/70 bg-gradient-to-r from-emerald-50 to-transparent p-4 sm:flex-row sm:items-center sm:justify-between dark:border-emerald-500/20 dark:from-emerald-500/10">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Admin Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Welcome, {profile?.name?.split(' ')[0] ?? 'Admin'}. Active admin access confirmed.
          </p>
        </div>
        <Link to="/admin/scans">
          <Button variant="secondary" icon={<FileText className="h-4 w-4" />}>View all scans</Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.id} stat={stat} />
        ))}
      </div>

      {loading ? (
        <LoadingState label="Loading compliance overview…" />
      ) : error ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <AnalyticsCard
              title="Recent scans"
              subtitle="Latest product-label compliance checks"
              action={
                <Link to="/admin/scans" className="text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400">
                  View all →
                </Link>
              }
              bodyClassName="p-0"
            >
              {scans.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="No scans recorded" message="Product scans submitted by users will appear here." />
                </div>
              ) : (
                <DataTable columns={scanColumns} rows={scans.slice(0, 6)} rowKey={(s) => s.id} compact />
              )}
            </AnalyticsCard>
          </div>

          <div className="space-y-5">
            <AnalyticsCard title="Risk distribution" subtitle="Scans by risk band" bodyClassName="p-5">
              {scans.length === 0 ? <p className="py-8 text-center text-sm text-slate-400">No data yet</p> : <RiskBars distribution={distribution} total={scans.length} />}
            </AnalyticsCard>
            <AnalyticsCard title="AI insights" subtitle="Derived from live scan & violation data" bodyClassName="p-5">
              {insights.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">No signals yet — keep scanning.</p>
              ) : (
                <ul className="space-y-3">
                  {insights.map((ins) => (
                    <li key={ins.id} className="flex gap-3">
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                          ins.severity === 'critical' ? 'bg-rose-500' : ins.severity === 'high' ? 'bg-amber-500' : 'bg-cyan-500'
                        }`}
                      />
                      <div>
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{ins.title}</p>
                        <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{ins.detail}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </AnalyticsCard>
          </div>

          <div className="lg:col-span-2">
            <AnalyticsCard
              title="Recent violations"
              subtitle="Non-compliant items surfaced from reviews"
              action={
                <Link to="/admin/violations" className="text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400">
                  View all →
                </Link>
              }
              bodyClassName="p-0"
            >
              {violations.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="No violations recorded" message="Violations captured during manual reviews will appear here." />
                </div>
              ) : (
                <DataTable columns={violationColumns} rows={violations.slice(0, 6)} rowKey={(v) => v.id} compact />
              )}
            </AnalyticsCard>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:sticky lg:top-24 lg:self-start">
            {links.map((l) => {
              const Icon = l.icon
              return (
                <Link
                  key={l.path}
                  to={l.path}
                  className="group rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card transition-colors hover:border-brand-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-500/40"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
                    <Icon className="h-5 w-5" />
                  </span>
                  <p className="mt-3 text-sm font-bold text-slate-800 dark:text-slate-100">{l.label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">{l.desc}</p>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Super admin dashboard                                               */
/* ------------------------------------------------------------------ */

const SUPER_LINKS = [
  { path: '/admin-requests', label: 'Admin Requests', icon: ClipboardCheck, desc: 'Approve or reject pending admin access' },
  { path: '/admin-management', label: 'Admin Management', icon: ShieldCheck, desc: 'Manage admin accounts and status' },
  { path: '/users', label: 'Users', icon: Users, desc: 'Manage standard user accounts' },
  { path: '/compliance-rules', label: 'Compliance Rules', icon: FileCheck2, desc: 'Maintain the compliance rule set' },
  { path: '/activity-logs', label: 'Activity Logs', icon: Activity, desc: 'Audit trail of system activity' },
  { path: '/system-settings', label: 'System Settings', icon: Settings, desc: 'Global platform configuration' },
]

export function SuperAdminDashboardPage() {
  const { profile } = useAuth()
  const { data: counts, loading, error, refetch } = useLoad(
    async () => {
      const [users, admins, requests, logs, rules] = await Promise.all([
        countCollection(COLLECTIONS.USERS),
        listAdmins(),
        listAdminRequests(100),
        listActivityLogs('', 12),
        countCollection(COLLECTIONS.COMPLIANCE_RULES),
      ])
      const pendingRequests = requests.filter((r) => r.status === 'pending' || r.status === 'Pending')
      return {
        users,
        admins: admins.length,
        pending: pendingRequests.length,
        logs,
        pendingRequests,
        rules,
      }
    },
    [],
  )

  const stats: StatDefinition[] = [
    { id: 'users', title: 'Users', value: counts?.users ?? 0, icon: Users, accent: 'brand', hint: 'registered accounts' },
    { id: 'admins', title: 'Admins', value: counts?.admins ?? 0, icon: ShieldCheck, accent: 'violet', hint: 'active staff' },
    { id: 'pending', title: 'Admin request', value: counts?.pending ?? 0, icon: ClipboardCheck, accent: 'amber', hint: 'awaiting review' },
    { id: 'rules', title: 'Compliance rules', value: counts?.rules ?? 0, icon: FileCheck2, accent: 'emerald', hint: 'active rule set' },
  ]

  const requestColumns: Array<DataColumn<AdminRequestRow>> = [
    { key: 'name', label: 'Requester', render: (r) => <span className="font-medium text-slate-800 dark:text-slate-100">{r.full_name}</span> },
    { key: 'org', label: 'Organization', render: (r) => <span className="text-slate-500 dark:text-slate-400">{r.organization || '—'}</span> },
    { key: 'date', label: 'Requested', className: 'hidden md:table-cell', render: (r) => <span className="text-slate-500 dark:text-slate-400">{timeAgo(r.created_at)}</span> },
  ]

  const logColumns: Array<DataColumn<ActivityLogRow>> = [
    {
      key: 'actor',
      label: 'Actor',
      render: (l) => <span className="font-medium text-slate-800 dark:text-slate-100">{l.actor_name || 'system'}</span>,
    },
    { key: 'action', label: 'Action', render: (l) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{l.action}</span> },
    { key: 'date', label: 'When', className: 'hidden md:table-cell', render: (l) => <span className="text-slate-500 dark:text-slate-400">{timeAgo(l.created_at)}</span> },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-brand-200/70 bg-gradient-to-r from-brand-50 to-transparent p-4 sm:flex-row sm:items-center sm:justify-between dark:border-brand-500/20 dark:from-brand-500/10">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Super Admin Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Welcome, {profile?.name?.split(' ')[0] ?? 'Administrator'}. Full system control enabled.
          </p>
        </div>
        <Link to="/admin-requests">
          <Button icon={<ClipboardCheck className="h-4 w-4" />}>Review admin requests</Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.id} stat={stat} />
        ))}
      </div>

      {loading ? (
        <LoadingState label="Loading platform overview…" />
      ) : error ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <AnalyticsCard
              title="Pending admin requests"
              subtitle="People waiting for staff access"
              action={
                <Link to="/admin-requests" className="text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400">
                  Review →
                </Link>
              }
              bodyClassName="p-0"
            >
              {!counts?.pendingRequests.length ? (
                <div className="p-5">
                  <EmptyState title="No pending requests" message="New admin requests appear here for approval." />
                </div>
              ) : (
                <DataTable columns={requestColumns} rows={counts.pendingRequests.slice(0, 5)} rowKey={(r) => r.id} compact />
              )}
            </AnalyticsCard>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:sticky lg:top-24 lg:self-start">
            {SUPER_LINKS.map((l) => {
              const Icon = l.icon
              return (
                <Link
                  key={l.path}
                  to={l.path}
                  className="group rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card transition-colors hover:border-brand-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-500/40"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
                    <Icon className="h-5 w-5" />
                  </span>
                  <p className="mt-3 text-sm font-bold text-slate-800 dark:text-slate-100">{l.label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">{l.desc}</p>
                </Link>
              )
            })}
          </div>

          <div className="lg:col-span-3">
            <AnalyticsCard
              title="Recent activity"
              subtitle="Audit trail of staff and system actions"
              action={
                <Link to="/activity-logs" className="text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400">
                  Full log →
                </Link>
              }
              bodyClassName="p-0"
            >
              {!counts?.logs.length ? (
                <div className="p-5">
                  <EmptyState title="No activity yet" message="Staff actions and admin-request reviews will be logged here." />
                </div>
              ) : (
                <DataTable columns={logColumns} rows={counts.logs} rowKey={(l) => l.id} compact />
              )}
            </AnalyticsCard>
          </div>
        </div>
      )}
    </div>
  )
}