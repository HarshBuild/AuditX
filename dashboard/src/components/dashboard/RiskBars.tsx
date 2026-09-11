import type { RiskDistribution } from '../../lib/db'

const BANDS = [
  { key: 'Critical' as const, bar: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400' },
  { key: 'High' as const, bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  { key: 'Medium' as const, bar: 'bg-cyan-500', text: 'text-cyan-600 dark:text-cyan-400' },
  { key: 'Low' as const, bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
]

export default function RiskBars({ distribution, total }: { distribution: RiskDistribution; total: number }) {
  return (
    <div className="space-y-3">
      {BANDS.map((b) => {
        const n = distribution[b.key]
        const pct = total === 0 ? 0 : Math.round((n / total) * 100)
        return (
          <div key={b.key}>
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className={b.text}>{b.key}</span>
              <span className="text-slate-500 dark:text-slate-400">
                {n} · {pct}%
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div className={`h-full rounded-full ${b.bar}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}