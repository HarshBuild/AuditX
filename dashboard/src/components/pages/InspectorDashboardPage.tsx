import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Camera, ScanLine } from 'lucide-react'
import AnalyticsCard from '../dashboard/AnalyticsCard'
import Button from '../ui/Button'
import { ErrorState } from '../ui/States'
import { useAuth } from '../../lib/auth'
import { countScans, fetchScansForUser, scanRiskDistribution, listViolations, type RiskDistribution } from '../../lib/db'
import { riskBand } from '../../lib/risk'
import { ToneBadge } from '../ui/Badge'
import { timeAgo } from '../../utils/format'

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

  if (loading) return <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
    {[1,2,3,4].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />)}
  </div>

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
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AnalyticsCard title="My Scans" subtitle="Products I've inspected">
          <p className="mt-2 text-3xl font-extrabold text-slate-900 dark:text-slate-100">{stats.myScans}</p>
        </AnalyticsCard>
        <AnalyticsCard title="Open Violations" subtitle="Awaiting resolution">
          <p className="mt-2 text-3xl font-extrabold text-amber-600">{stats.unreviewed}</p>
        </AnalyticsCard>
        <AnalyticsCard title="Critical Risk" subtitle="Highest risk band">
          <p className="mt-2 text-3xl font-extrabold text-rose-600">{risk.Critical}</p>
        </AnalyticsCard>
        <AnalyticsCard title="Platform Scans" subtitle="All scans on the platform">
          <p className="mt-2 text-3xl font-extrabold text-slate-900 dark:text-slate-100">{stats.totalScans}</p>
        </AnalyticsCard>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3">
        <Button icon={<ScanLine className="h-4 w-4" />} onClick={() => navigate('/scan-product')}>
          Scan Product
        </Button>
        <Button variant="secondary" icon={<Camera className="h-4 w-4" />} onClick={() => navigate('/admin/evidence')}>
          Evidence Gallery
        </Button>
        <Button variant="secondary" icon={<AlertTriangle className="h-4 w-4" />} onClick={() => navigate('/admin/violations')}>
          Violations
        </Button>
      </div>

      {/* Recent scans */}
      <AnalyticsCard title="Recent Inspections" subtitle="Your latest scans">
        {recentScans.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No scans yet. Start by scanning a product.</p>
        ) : (
          <div className="space-y-2">
            {recentScans.map((s) => {
              const risk = 100 - s.overall_score
              const band = riskBand(risk)
              return (
                <button
                  key={s.id}
                  onClick={() => navigate(`/scan-history?open=${s.id}`)}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-left transition-colors hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950/40 dark:hover:bg-slate-800/70"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{s.product_name || 'Untitled scan'}</p>
                    <p className="text-xs text-slate-400">{timeAgo(s.created_at)}</p>
                  </div>
                  <ToneBadge tone={band === 'Low' ? 'emerald' : band === 'Medium' ? 'amber' : band === 'High' ? 'rose' : 'rose'}>{band} risk</ToneBadge>
                </button>
              )
            })}
          </div>
        )}
      </AnalyticsCard>
    </div>
  )
}
