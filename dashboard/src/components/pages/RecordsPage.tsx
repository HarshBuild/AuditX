import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowUpRight, ChevronDown, RefreshCw, ScanLine, Search } from 'lucide-react'
import type { QueryDocumentSnapshot } from 'firebase/firestore'
import Button from '../ui/Button'
import DataTable, { type DataColumn } from '../table/DataTable'
import { ToneBadge } from '../ui/Badge'
import { EmptyState, LoadingState } from '../ui/States'
import { useToast } from '../ui/Toast'
import PageHeader from '../ui/PageHeader'
import Tabs, { type TabItem } from '../ui/Tabs'
import { useAuth } from '../../lib/auth'
import { fetchScansForUserPage } from '../../lib/db'
import { photoUrl } from '../../lib/inspection'
import { scanStatusTone } from '../../lib/ui'
import { formatDateTime } from '../../utils/format'
import { displayProductName, displayText } from '../../lib/textnorm'
import type { ScanRow } from '../../lib/types2'

function verdictTone(s: ScanRow): 'emerald' | 'amber' | 'rose' | 'cyan' {
  if (s.verdict === 'COMPLIANT') return 'emerald'
  if (s.verdict === 'PARTIALLY_COMPLIANT') return 'amber'
  if (s.verdict === 'NON_COMPLIANT') return 'rose'
  return 'cyan'
}

/** Thumbnail that resolves Firebase Storage paths to download URLs. */
function ScanThumb({ path, name }: { path: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    setUrl(null)
    setFailed(false)
    const p = photoUrl(path)
    if (!p) {
      setFailed(true)
      return
    }
    void p
      .then((u) => {
        if (live) setUrl(u)
      })
      .catch(() => {
        if (live) setFailed(true)
      })
    return () => {
      live = false
    }
  }, [path])
  if (!url || failed) {
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-xs font-bold text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
        {displayProductName(name).slice(0, 2).toUpperCase()}
      </span>
    )
  }
  return (
    <img
      src={url}
      alt=""
      onError={() => setFailed(true)}
      className="h-10 w-10 shrink-0 rounded-lg object-cover"
      loading="lazy"
    />
  )
}

/** Cursor-paginated batch size for the scan-history list. */
const PAGE_SIZE = 50

export default function RecordsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const [scans, setScans] = useState<ScanRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const seenIds = useRef(new Set<string>())
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '')
  const [status, setStatus] = useState('all')

  /* The header's global search writes the query into the URL (?q=). Keep this
     page's filter in sync so typing in the header (or navigating with a query
     already set) actually filters the list. Only the URL → local direction is
     synced; the page's own input never overwrites the URL. */
  useEffect(() => {
    setQuery(searchParams.get('q') ?? '')
  }, [searchParams])

  const load = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!user?.id) return
    if (!silent) setLoading(true)
    seenIds.current.clear()
    try {
      const page = await fetchScansForUserPage(user.id, PAGE_SIZE)
      page.data.forEach((s) => seenIds.current.add(s.id))
      setScans(page.data)
      setLastDoc(page.lastDoc)
      setHasMore(page.hasMore)
    } catch (e) {
      toast('error', 'Could not load scans', (e as Error).message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [user?.id, toast])

  const loadMore = useCallback(async () => {
    if (!user?.id || !lastDoc) return
    setLoadingMore(true)
    try {
      const page = await fetchScansForUserPage(user.id, PAGE_SIZE, lastDoc)
      const fresh = page.data.filter((s) => !seenIds.current.has(s.id))
      fresh.forEach((s) => seenIds.current.add(s.id))
      setScans((prev) => [...prev, ...fresh])
      setLastDoc(page.lastDoc)
      setHasMore(page.hasMore)
    } catch (e) {
      toast('error', 'Could not load more scans', (e as Error).message)
    } finally {
      setLoadingMore(false)
    }
  }, [user?.id, lastDoc, toast])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = async () => {
    setRefreshing(true)
    await load({ silent: true })
    setRefreshing(false)
  }

  const haystack = (s: ScanRow) => [s.product_name, s.brand, s.manufacturer, s.category, s.barcode].join(' | ').toLowerCase()
  const filtered = scans.filter(
    (s) =>
      (status === 'all' || s.status === status) &&
      (query.trim() === '' || haystack(s).includes(query.trim().toLowerCase())),
  )

  const statusTabs: TabItem[] = [
    { key: 'all', label: 'All', count: scans.length },
    { key: 'compliant', label: 'Compliant', count: scans.filter((s) => s.status === 'compliant').length },
    { key: 'needs_review', label: 'Needs review', count: scans.filter((s) => s.status === 'needs_review').length },
    { key: 'violation', label: 'Violation', count: scans.filter((s) => s.status === 'violation').length },
    { key: 'critical', label: 'Critical', count: scans.filter((s) => s.status === 'critical').length },
  ]

  const columns: Array<DataColumn<ScanRow>> = [
    {
      key: 'product',
      label: 'Product',
      render: (s) => (
        <div className="flex min-w-[220px] items-center gap-3">
          <ScanThumb path={s.image_url} name={s.product_name} />
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-800 dark:text-slate-100">{s.product_name?.trim() ? displayProductName(s.product_name) : 'Untitled'}</p>
            <p className="truncate text-xs text-slate-400">{displayText(s.brand || s.manufacturer) || '—'}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      label: 'Category',
      className: 'hidden lg:table-cell',
      render: (s) => <span className="text-slate-500 dark:text-slate-400">{s.category || '—'}</span>,
    },
    {
      key: 'score',
      label: 'Score',
      className: 'text-right',
      render: (s) => <span className="font-bold text-slate-700 dark:text-slate-200">{s.overall_score ?? '—'}</span>,
    },
    {
      key: 'verdict',
      label: 'Verdict',
      render: (s) => <ToneBadge tone={verdictTone(s)}>{s.verdict || 'Pending'}</ToneBadge>,
    },
    {
      key: 'status',
      label: 'Status',
      className: 'hidden sm:table-cell',
      render: (s) => <ToneBadge tone={scanStatusTone(s.status)}>{s.status.replace('_', ' ')}</ToneBadge>,
    },
    {
      key: 'created_at',
      label: 'Scanned',
      className: 'hidden md:table-cell',
      render: (s) => <span className="whitespace-nowrap text-slate-500 dark:text-slate-400">{formatDateTime(s.created_at)}</span>,
    },
    {
      key: 'open',
      label: '',
      className: 'text-right',
      render: () => <ArrowUpRight className="ml-auto h-4 w-4 text-slate-300 dark:text-slate-600" />,
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Scan History"
        subtitle={`${scans.length} inspections · ${filtered.length} matching filters`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              icon={<RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />}
              loading={refreshing}
              onClick={() => void refresh()}
              disabled={refreshing}
            >
              Refresh
            </Button>
            <Button icon={<ScanLine className="h-4 w-4" />} onClick={() => navigate('/scan-product')}>
              New scan
            </Button>
          </div>
        }
      />

      {loading ? (
        <div className="panel p-6">
          <LoadingState label="Loading your scans…" />
        </div>
      ) : scans.length === 0 ? (
        <div className="panel p-6">
          <EmptyState
            title="No scans yet"
            message="Scan your first product label — the AI inspection takes under a minute."
            action={
              <Button icon={<ScanLine className="h-4 w-4" />} onClick={() => navigate('/scan-product')}>
                Scan a product
              </Button>
            }
          />
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:flex-wrap sm:items-center dark:border-navy-700/60">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-text-faint dark:text-navy-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search product, brand, barcode…"
                className="h-10 w-full rounded-field border border-line bg-surface-secondary pl-9 pr-3 text-sm text-ink-text placeholder:text-ink-text-faint shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-white/15 dark:bg-navy-950 dark:text-navy-100 dark:placeholder:text-navy-400"
              />
            </div>
            <Tabs
              tabs={statusTabs}
              value={status}
              onChange={setStatus}
              size="sm"
              aria-label="Filter scans by status"
              className="sm:ml-auto"
            />
          </div>
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(s) => s.id}
            onRowClick={(s) => navigate(`/scan-result/${s.id}`)}
            empty={<EmptyState title="Nothing matches" message="Try a different search or status filter." />}
          />
          {hasMore && (
            <div className="flex justify-center border-t border-line p-3 dark:border-navy-700/60">
              <Button variant="outline" icon={loadingMore ? undefined : <ChevronDown className="h-4 w-4" />} onClick={() => void loadMore()} loading={loadingMore} disabled={loadingMore}>
                {loadingMore ? 'Loading more…' : 'Load more'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}