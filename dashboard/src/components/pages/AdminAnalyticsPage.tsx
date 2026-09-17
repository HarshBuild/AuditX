import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend } from 'recharts'
import AnalyticsCard from '../dashboard/AnalyticsCard'
import { ErrorState } from '../ui/States'
import { supabase } from '../../lib/supabase'
import { mergeRow } from '../../lib/db'

interface ScanDoc {
  created_at: string
  overall_score: number
  risk_score?: number
  category: string
  manufacturer: string
  status: string
  verdict?: string
}

const PIE_COLORS = ['#16A34A', '#D97706', '#EA580C', '#DC2626']
const GRID = '#E5E7EB'
const BRAND = '#4F46E5'
const SUCCESS = '#22C55E'
const VIOLET = '#8B5CF6'

export default function AdminAnalyticsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [totalScans, setTotalScans] = useState(0)
  const [avgScore, setAvgScore] = useState(0)
  const [riskData, setRiskData] = useState<{ name: string; value: number }[]>([])
  const [categoryData, setCategoryData] = useState<{ name: string; count: number }[]>([])
  const [trendData, setTrendData] = useState<{ date: string; scans: number; avgScore: number }[]>([])
  const [manufacturerData, setManufacturerData] = useState<{ name: string; scans: number; avgScore: number }[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { data: rows, error } = await supabase
          .from('scans')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(2000)
        if (error) throw new Error(error.message)
        if (cancelled) return
        const scans: ScanDoc[] = ((rows ?? []) as Record<string, unknown>[]).map(
          (r) => mergeRow<ScanDoc>('scans', r),
        )
        setTotalScans(scans.length)

        if (scans.length === 0) {
          setLoading(false)
          return
        }

        const avg = Math.round(scans.reduce((s, c) => s + (c.overall_score ?? 0), 0) / scans.length)
        setAvgScore(avg)

        // Risk distribution
        const risk = { Low: 0, Medium: 0, High: 0, Critical: 0 }
        for (const s of scans) {
          const r = s.risk_score ?? 100 - (s.overall_score ?? 0)
          if (r <= 25) risk.Low++
          else if (r <= 50) risk.Medium++
          else if (r <= 75) risk.High++
          else risk.Critical++
        }
        setRiskData([
          { name: 'Low', value: risk.Low },
          { name: 'Medium', value: risk.Medium },
          { name: 'High', value: risk.High },
          { name: 'Critical', value: risk.Critical },
        ])

        // Category breakdown
        const catMap = new Map<string, number>()
        for (const s of scans) catMap.set(s.category || 'Other', (catMap.get(s.category || 'Other') ?? 0) + 1)
        setCategoryData(Array.from(catMap.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10))

        // Trend (last 30 days)
        const trendMap = new Map<string, { count: number; scoreSum: number }>()
        for (let i = 29; i >= 0; i--) {
          const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10)
          trendMap.set(d, { count: 0, scoreSum: 0 })
        }
        for (const s of scans) {
          const day = (s.created_at ?? '').slice(0, 10)
          const entry = trendMap.get(day)
          if (entry) {
            entry.count++
            entry.scoreSum += s.overall_score ?? 0
          }
        }
        setTrendData(Array.from(trendMap.entries()).map(([date, v]) => ({
          date: date.slice(5),
          scans: v.count,
          avgScore: v.count > 0 ? Math.round(v.scoreSum / v.count) : 0,
        })))

        // Top manufacturers
        const mfrMap = new Map<string, { count: number; scoreSum: number }>()
        for (const s of scans) {
          const m = s.manufacturer || 'Unknown'
          const e = mfrMap.get(m) ?? { count: 0, scoreSum: 0 }
          e.count++
          e.scoreSum += s.overall_score ?? 0
          mfrMap.set(m, e)
        }
        setManufacturerData(
          Array.from(mfrMap.entries())
            .map(([name, v]) => ({ name, scans: v.count, avgScore: Math.round(v.scoreSum / v.count) }))
            .sort((a, b) => b.scans - a.scans)
            .slice(0, 10),
        )
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [tick])

  if (loading) return <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
    {[1,2,3,4].map((i) => <div key={i} className="h-48 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />)}
  </div>

  if (error) {
    return (
      <AnalyticsCard title="Analytics unavailable" subtitle="Could not load scan analytics">
        <ErrorState
          message={`${error} — refresh or sign out & back in if this persists.`}
          onRetry={() => setTick((t) => t + 1)}
        />
      </AnalyticsCard>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <AnalyticsCard title="Total Scans" subtitle="All platform scans">
          <p className="mt-2 text-3xl font-extrabold text-slate-900 dark:text-slate-100">{totalScans}</p>
        </AnalyticsCard>
        <AnalyticsCard title="Average Score" subtitle="Platform-wide compliance">
          <p className="mt-2 text-3xl font-extrabold text-brand-600">{avgScore}%</p>
        </AnalyticsCard>
        <AnalyticsCard title="Non-Compliant" subtitle="Scans below 50%">
          <p className="mt-2 text-3xl font-extrabold text-rose-600">
            {riskData.find((r) => r.name === 'Critical')?.value ?? 0}
          </p>
        </AnalyticsCard>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Risk Pie */}
        <AnalyticsCard title="Risk Distribution" subtitle="Low / Medium / High / Critical">
          <div className="flex h-64 items-center justify-center">
            {riskData.every((r) => r.value === 0) ? (
              <p className="text-sm text-slate-400">No scan data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={riskData} cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={4} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                    {riskData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </AnalyticsCard>

        {/* Category Bar */}
        <AnalyticsCard title="Scans by Category" subtitle="Top product categories">
          <div className="h-64">
            {categoryData.length === 0 ? (
              <p className="flex h-full items-center justify-center text-sm text-slate-400">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill={BRAND} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </AnalyticsCard>

        {/* Trend Line */}
        <AnalyticsCard title="Scan Trend" subtitle="Last 30 days">
          <div className="h-64">
            {trendData.every((t) => t.scans === 0) ? (
              <p className="flex h-full items-center justify-center text-sm text-slate-400">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="scans" stroke={BRAND} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="avgScore" stroke={SUCCESS} strokeWidth={2} dot={false} yAxisId={0} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </AnalyticsCard>

        {/* Top Manufacturers */}
        <AnalyticsCard title="Top Manufacturers" subtitle="By scan volume">
          <div className="h-64">
            {manufacturerData.length === 0 ? (
              <p className="flex h-full items-center justify-center text-sm text-slate-400">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={manufacturerData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="scans" fill={VIOLET} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </AnalyticsCard>
      </div>
    </div>
  )
}
