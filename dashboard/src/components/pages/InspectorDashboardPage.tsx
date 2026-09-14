import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowUpRight, Camera, ScanLine, ShieldAlert, FileWarning } from 'lucide-react'
import AnalyticsCard from '../dashboard/AnalyticsCard'
import StatCard from '../dashboard/StatCard'
import Button from '../ui/Button'
import PageHeader from '../ui/PageHeader'
import { ErrorState } from '../ui/States'
import { useAuth } from '../../lib/auth'
import { countScans, fetchScansForUser, scanRiskDistribution, listViolations, type RiskDistribution } from '../../lib/db'
import { riskBand, riskTone } from '../../lib/risk'
import { ToneBadge } from '../ui/Badge'
import { timeAgo } from '../../utils/format'
import { displayProductName } from '../../lib/textnorm'
import type { StatDefinition } from '../../types'

export default function InspectorDashboardPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [stats, setStats] = useState({ totalScans: 0, myScans: 0, totalViolations: 0, unreviewed: 0 })
  const [risk, setRisk] = useState<RiskDistribution>({ Low: 0, Medium: 0, High: 0, Critical: 0 })
  const [recentScans, setRecentScans] = useState<{ id: string; product_name: string; created_at: string; overall_score: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const uid = profile?.uid ?? ''
        const [totalScans, myScans, vulnPaged, riskDist] = await Promise.all([
          countScans(),
          fetchScansForUser(uid, 500).then((s) => s.length),
          listViolations({ page: 1, pageSize: 1000 }),
          fetchScansForUser(uid, 200).then(scanRiskDistribution),
        ])
        if (cancelled) return
        const scans = await fetchScansForUser(uid, 10)
        if (cancelled) return
        setStats({
          totalScans,
          myScans,
          totalViolations: vulnPaged.count,
          unreviewed: vulnPaged.data.filter((v) => v.status === 'Detected').length,
        })
        setRisk(riskDist)
        setRecentScans(scans.map((s) => ({ id: s.id, product_name: s.product_name, created_at: s.created_at, overall_score: s.overall_score })))
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [profile?.uid, tick])

  const metricCards: StatDefinition[] = [
    { id: 'my', title: 'My Scans', value: stats.myScans, icon: ScanLine, accent: 'brand', hint: 'products I inspected' },
    { id: 'viol', title: 'Open Violations', value: stats.unreviewed, icon: FileWarning, accent: 'amber', hint: 'awaiting resolution' },
    { id: 'crit', title: 'Critical Risk', value: risk.Critical, icon: ShieldAlert, accent: 'rose', hint: 'highest risk band' },
    { id: 'platform', title: 'Platform Scans', value: stats.totalScans, icon: AlertTriangle, accent: 'cyan', hint: 'all scans on the platform' },
  ]

  if (loading) {
    return (
      <div className="space-y-5">
        <PageHeader title="Inspector Dashboard" subtitle="Compliance inspection overview" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton h-28 rounded-card" />
          ))}
        </div>
        <div className="skeleton h-64 rounded-card" />
      </div>
    )
  }

  if (error) {
    return (
      <AnalyticsCard title="Dashboard unavailable" subtitle="Could not load inspection overview">
        <ErrorState
          message={`${error} — refresh or sign out & back in if this persists.`}
          onRetry={() => setTick((t) => t + 1)}
        />
      </AnalyticsCard>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Inspector Dashboard"
        subtitle="Compliance inspection overview"
        actions={
          <Button icon={<ScanLine className="h-4 w-4" />} onClick={() => navigate('/scan-product')}>
            Scan Product
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:gap-4">
        {metricCards.map((stat) => (
          <StatCard key={stat.id} stat={stat} prominent={stat.id === 'my'} />
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" icon={<Camera className="h-4 w-4" />} onClick={() => navigate('/admin/evidence')}>
          Evidence Gallery
        </Button>
        <Button variant="secondary" icon={<AlertTriangle className="h-4 w-4" />} onClick={() => navigate('/admin/violations')}>
          Violations
        </Button>
      </div>

      <AnalyticsCard title="Recent Inspections" subtitle="Your latest scans" bodyClassName="p-0">
        {recentScans.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">No scans yet. Start by scanning a product.</p>
        ) : (
          <ul className="divide-y divide-line dark:divide-navy-700/60">
            {recentScans.map((s) => {
              const riskScore = 100 - s.overall_score
              const band = riskBand(riskScore)
              return (
                <li key={s.id}>
                  <button
                    onClick={() => navigate(`/scan-history?open=${s.id}`)}
                    className="group flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-secondary sm:px-5 dark:hover:bg-navy-950/40"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
                        <ScanLine className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink-text dark:text-navy-50">
                          {s.product_name?.trim() ? displayProductName(s.product_name) : 'Untitled scan'}
                        </p>
                        <p className="text-xs text-ink-text-soft dark:text-navy-400">{timeAgo(s.created_at)}</p>
                      </div>
                    </div>
                    <span className="flex shrink-0 items-center gap-2">
                      <ToneBadge tone={riskTone(band)}>{band} risk</ToneBadge>
                      <ArrowUpRight className="h-4 w-4 text-ink-text-faint transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-600 dark:text-navy-500 dark:group-hover:text-brand-400" />
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </AnalyticsCard>
    </div>
  )
}