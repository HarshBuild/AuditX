import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageContext'
import { CONFIG } from '../../lib/config'
import { fetchWithTimeout } from '../../lib/net'
import { formatDateTime } from '../../utils/format'
import { AuditXMark } from '../brand/AuditXMark'

interface Verification {
  id: string
  product_name: string
  brand: string
  manufacturer: string
  category: string | null
  overall_score: number
  verdict: string
  status: string
  scanned_at: string
  verified_by: string
}

export default function VerifyPage() {
  const { id } = useParams<{ id: string }>()
  const { t } = useLanguage()
  const [data, setData] = useState<Verification | null>(null)
  const [loading, setLoading] = useState(true)
  const [failKind, setFailKind] = useState<'missing' | 'incomplete' | 'network' | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        if (!id) throw new Error('missing id')
        const base = CONFIG.AUDITX_API_URL.replace(/\/+$/, '')
        let res: Response
        try {
          res = await fetchWithTimeout(`${base}/api/verify/${encodeURIComponent(id)}`, {}, 30_000)
        } catch (e) {
          if (live) setFailKind('network')
          throw e
        }
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; verification?: Verification; error?: string }
        if (!res.ok || !json.ok || !json.verification) {
          if (live) setFailKind(String(json.error ?? '').startsWith('INCOMPLETE:') ? 'incomplete' : 'missing')
          return
        }
        if (live) setData(json.verification)
      } catch {
        if (live) setFailKind((k) => k ?? 'missing')
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => {
      live = false
    }
  }, [id])

  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10 dark:bg-navy-950">
      <div className="w-full max-w-md">
        <div className="mb-5 flex items-center justify-center gap-2">
          <AuditXMark size="md" />
          <span className="text-xl font-black tracking-tight text-slate-900 dark:text-slate-100">
            Audit<span className="text-brand-600 dark:text-accent-400">X</span>
          </span>
        </div>
        <div className="tiranga-hairline rounded-t-2xl" aria-hidden="true" />
        <div className="rounded-b-2xl border border-slate-200/80 border-t-0 bg-white p-6 shadow-card dark:border-white/10 dark:bg-navy-900">
          <h1 className="text-center text-lg font-bold text-ink-text dark:text-white">{t('verify.title')}</h1>
          <p className="mt-1 text-center text-xs text-slate-500 dark:text-slate-400">{t('verify.subtitle')}</p>

          {loading ? (
            <div className="grid place-items-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
              <p className="mt-3 text-sm text-slate-500">{t('verify.loading')}</p>
            </div>
          ) : failKind || !data ? (
            <div className="py-8 text-center">
              <AlertCircle className="mx-auto h-10 w-10 text-rose-500" />
              <p className="mt-3 font-bold text-ink-text dark:text-white">
                {failKind === 'incomplete' ? t('verify.incomplete') : failKind === 'network' ? t('verify.unreachable') : t('verify.notFound')}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {failKind === 'incomplete' ? t('verify.incompleteMsg') : failKind === 'network' ? t('verify.unreachableMsg') : t('verify.notFoundMsg')}
              </p>
            </div>
          ) : (
            <div className="mt-5">
              <div className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2.5">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">{t('verify.verifiedBy')}</span>
              </div>
              <dl className="mt-4 space-y-2.5 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">{t('verify.product')}</dt>
                  <dd className="text-right font-semibold text-ink-text dark:text-slate-100">{data.product_name || '—'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">{t('verify.brand')}</dt>
                  <dd className="text-right font-semibold text-ink-text dark:text-slate-100">{data.brand || '—'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">{t('verify.score')}</dt>
                  <dd className="text-right font-extrabold text-ink-text dark:text-white">{data.overall_score}/100</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">{t('history.colVerdict')}</dt>
                  <dd className="text-right font-semibold text-ink-text dark:text-slate-100">{data.verdict || data.status}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">{t('verify.scannedOn')}</dt>
                  <dd className="text-right text-ink-text dark:text-slate-200">{data.scanned_at ? formatDateTime(data.scanned_at) : '—'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">{t('verify.reportId')}</dt>
                  <dd className="font-mono text-xs text-slate-500">{data.id.slice(0, 13)}</dd>
                </div>
              </dl>
              <div className="mt-5 flex items-center justify-center gap-1.5 text-xs text-slate-400">
                <ShieldCheck className="h-3.5 w-3.5" />
                <Link to="/" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
                  {t('verify.openApp')}
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
