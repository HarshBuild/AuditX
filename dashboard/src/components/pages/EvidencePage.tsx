import { useEffect, useState } from 'react'
import { Camera, RefreshCw, Search } from 'lucide-react'
import AnalyticsCard from '../dashboard/AnalyticsCard'
import { ToneBadge } from '../ui/Badge'
import { ErrorState } from '../ui/States'
import { db, auth } from '../../lib/firebase'
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore'
import { photoUrl } from '../../lib/inspection'
import { timeAgo } from '../../utils/format'
import { displayProductName, displayText } from '../../lib/textnorm'

interface EvidenceItem {
  id: string
  scan_id: string
  user_id: string
  user_name: string
  image_url: string
  product_name: string
  manufacturer: string
  location_name: string
  created_at: string
  overall_score: number
}

export default function EvidencePage() {
  const [items, setItems] = useState<EvidenceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'critical' | 'non_compliant'>('all')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const uid = auth.currentUser?.uid
        if (!uid) {
          if (!cancelled) {
            setItems([])
            setError('Sign in to view the evidence gallery.')
          }
          return
        }
        const q = query(
          collection(db, 'scans'),
          orderBy('created_at', 'desc'),
          limit(200),
        )
        const snap = await getDocs(q)
        if (cancelled) return
        const evidence: EvidenceItem[] = []
        for (const d of snap.docs) {
          const data = d.data()
          const urls = (data.image_urls as string[] | undefined) ?? (data.image_url ? [data.image_url as string] : [])
          if (!urls || urls.length === 0) continue
          for (let i = 0; i < urls.length; i++) {
            const maybe = photoUrl(urls[i])
            const resolved = maybe ? await maybe.catch(() => null) : null
            evidence.push({
              id: `${d.id}_${i}`,
              scan_id: d.id,
              user_id: data.user_id ?? '',
              user_name: data.user_name ?? '',
              image_url: resolved ?? urls[i],
              product_name: data.product_name ?? '',
              manufacturer: data.manufacturer ?? '',
              location_name: data.location_name ?? '',
              created_at: data.created_at ?? '',
              overall_score: data.overall_score ?? 0,
            })
          }
        }
        setItems(evidence)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [tick])

  const filtered = items.filter((e) => {
    if (search) {
      const s = search.toLowerCase()
      if (!e.product_name.toLowerCase().includes(s) && !e.manufacturer.toLowerCase().includes(s) && !e.location_name.toLowerCase().includes(s)) return false
    }
    if (filter === 'critical') return e.overall_score < 40
    if (filter === 'non_compliant') return e.overall_score < 60
    return true
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-white/10 dark:bg-navy-900">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search evidence by product, manufacturer, location..."
            className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-white/15 dark:bg-navy-950 dark:text-slate-100"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {(['all', 'critical', 'non_compliant'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                filter === f
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400'
              }`}
            >
              {f === 'all' ? 'All' : f === 'critical' ? 'Critical' : 'Non-Compliant'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : error ? (
        <AnalyticsCard title="Evidence Gallery" subtitle="Scanned product images from inspectors">
          <ErrorState
            message={`${error} — refresh or sign out & back in if this persists.`}
            onRetry={() => setTick((t) => t + 1)}
          />
        </AnalyticsCard>
      ) : filtered.length === 0 ? (
        <AnalyticsCard title="Evidence Gallery" subtitle="Scanned product images from inspectors">
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Camera className="h-12 w-12 text-slate-300 dark:text-slate-600" />
            <p className="mt-4 text-sm font-medium text-slate-500">
              {search || filter !== 'all' ? 'No matching evidence' : 'No evidence found'}
            </p>
            <p className="mt-1 text-xs text-slate-400">Scanned product images will appear here.</p>
            {(search || filter !== 'all') && (
              <button
                onClick={() => { setSearch(''); setFilter('all') }}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/15 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Clear filters
              </button>
            )}
          </div>
        </AnalyticsCard>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {filtered.map((e) => (
            <div key={e.id} className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white transition-shadow hover:shadow-md dark:border-white/10 dark:bg-navy-900">
              <div className="aspect-square overflow-hidden bg-slate-100 dark:bg-slate-800">
                <img
                  src={e.image_url}
                  alt={e.product_name?.trim() ? displayProductName(e.product_name) : 'Label evidence'}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  loading="lazy"
                />
              </div>
              <div className="p-2.5">
                <p className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{e.product_name?.trim() ? displayText(e.product_name) : 'Untitled'}</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-[10px] text-slate-400">{timeAgo(e.created_at)}</span>
                  <ToneBadge tone={e.overall_score >= 80 ? 'emerald' : e.overall_score >= 50 ? 'amber' : 'rose'}>
                    {e.overall_score}%
                  </ToneBadge>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
