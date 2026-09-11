import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Award, ClipboardCheck, ScanLine, ShieldAlert, TrendingUp } from 'lucide-react'
import AnalyticsCard from '../dashboard/AnalyticsCard'
import StatCard from '../dashboard/StatCard'
import RiskBars from '../dashboard/RiskBars'
import DataTable, { type DataColumn } from '../table/DataTable'
import { ToneBadge } from '../ui/Badge'
import { LoadingState, ErrorState, EmptyState } from '../ui/States'
import Button from '../ui/Button'
import { useAuth } from '../../lib/auth'
import { fetchScansForUser, scanRiskDistribution, type RiskDistribution } from '../../lib/db'
import { riskBand, riskTone } from '../../lib/risk'
import { scanStatusTone } from '../../lib/ui'
import type { ScanRow } from '../../lib/types2'
import { timeAgo } from '../../utils/format'
import type { StatDefinition } from '../../types'

export default function UserDashboardPage() {
  const { user, profile } = useAuth()
  const uid = user?.id ?? ''
  const [scans, setScans] = useState<ScanRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)

  const load = useCallback(async () => {
    if (!uid) return
    setLoading(true)
    setError(null)
    try {
      setScans(await fetchScansForUser(uid, 100))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [uid, refresh])

  useEffect(() => {
    void load()
  }, [load])

  const [distribution, setDistribution] = useState<RiskDistribution>({ Low: 0, Medium: 0, High: 0, Critical: 0 })
  useEffect(() => {
    void scanRiskDistribution(scans).then(setDistribution)
  }, [scans])

  const openScans = scans.filter((s) => s.status === 'flagged' || s.status === 'manual_review' || s.status === 'pending_review')
  const avgScore = scans.length === 0 ? 0 : Math.round(scans.reduce((sum, s) => sum + (s.overall_score ?? 0), 0) / scans.length)

  const stats: StatDefinition[] = [
    { id: 'scans', title: 'Products scanned', value: scans.length, icon: ScanLine, accent: 'brand', hint: 'your scan history' },
    { id: 'score', title: 'Avg compliance score', value: avgScore, icon: TrendingUp, accent: 'emerald', hint: 'out of 100' },
    { id: 'open', title: 'Needs attention', value: openScans.length, icon: ShieldAlert, accent: 'amber', hint: 'flagged / pending review' },
    { id: 'compliant', title: 'Compliant scans', value: scans.filter((s) => (s.overall_score ?? 0) >= 80).length, icon: Award, accent: 'cyan', hint: 'score ≥ 80' },
  ]

  const columns: Array<DataColumn<ScanRow>> = [
    {
      key: 'product',
      label: 'Product',
      render: (s) => (
        <div>
          <p className="font-semibold text-slate-800 dark:text-slate-100">{s.product_name}</p>
          <p className="text-xs text-slate-400">{s.manufacturer || s.brand || '—'}</p>
        </div>
      ),
    },
    { key: 'score', label: 'Score', className: 'text-right', render: (s) => <span className="font-bold text-slate-700 dark:text-slate-200">{s.overall_score ?? '—'}</span> },
    {
      key: 'risk',
      label: 'Risk',
      className: 'hidden sm:table-cell',
      render: (s) => {
        const band = riskBand(s.risk_score ?? 100 - s.overall_score)
        return <ToneBadge tone={riskTone(band)}>{band}</ToneBadge>
      },
    },
    { key: 'status', label: 'Status', className: 'hidden md:table-cell', render: (s) => <ToneBadge tone={scanStatusTone(s.status)}>{s.status}</ToneBadge> },
    { key: 'date', label: 'Scanned', className: 'hidden lg:table-cell', render: (s) => <span className="text-slate-500 dark:text-slate-400">{timeAgo(s.created_at)}</span> },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-brand-200/70 bg-gradient-to-r from-brand-50 to-transparent p-4 sm:flex-row sm:items-center sm:justify-between dark:border-brand-500/20 dark:from-brand-500/10">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
            Welcome back, {profile?.name?.split(' ')[0] ?? 'User'}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Scan product labels, review compliance and track your history.
          </p>
        </div>
        <Link to="/scan-product" className="shrink-0">
          <Button icon={<ScanLine className="h-4 w-4" />}>Scan a product</Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.id} stat={stat} />
        ))}
      </div>

      {loading ? (
        <LoadingState label="Loading your scans…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setRefresh((x) => x + 1)} />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <AnalyticsCard
              title="Recent scans"
              subtitle="Your latest product-label checks"
              action={
                <Link to="/scan-history" className="text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400">
                  View all →
                </Link>
              }
              bodyClassName="p-0"
            >
              {scans.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    icon={<ScanLine className="h-6 w-6 text-slate-400" />}
                    title="No scans yet"
                    message="Scan your first product label to see compliance results here."
                    action={
                      <Link to="/scan-product" className="mt-1">
                        <Button size="sm">Scan a product</Button>
                      </Link>
                    }
                  />
                </div>
              ) : (
                <DataTable columns={columns} rows={scans.slice(0, 6)} rowKey={(s) => s.id} compact />
              )}
            </AnalyticsCard>
          </div>

          <div className="space-y-5">
            <AnalyticsCard title="Risk distribution" subtitle="Your scans by risk band" bodyClassName="p-5">
              {scans.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">No data yet</p>
              ) : (
                <RiskBars distribution={distribution} total={scans.length} />
              )}
            </AnalyticsCard>
            <AnalyticsCard title="Keep reporting" subtitle="Spot a non-compliant product?">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 dark:bg-rose-500/15">
                  <ClipboardCheck className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                  Your reports and scans help inspectors act faster on non-compliant products.
                </p>
              </div>
            </AnalyticsCard>
          </div>
        </div>
      )}
    </div>
  )
}