import { useState } from 'react'
import { CheckCircle2, FlaskConical, Loader2, Play, XCircle } from 'lucide-react'
import Button from '../ui/Button'
import PageHeader from '../ui/PageHeader'
import { EmptyState } from '../ui/States'
import { useToast } from '../ui/Toast'
import { useLanguage } from '../../i18n/LanguageContext'
import { accessToken } from '../../lib/supabase'
import { CONFIG } from '../../lib/config'
import { fetchWithTimeout } from '../../lib/net'
import { cn } from '../../utils/format'

interface EvalCase {
  id: string
  label: string
  pass: boolean
  expected: string
  actual: string
  detail: string
  ms: number
}

interface EvalSuite {
  name: string
  total: number
  passed: number
  failed: number
  cases: EvalCase[]
}

interface EvalResult {
  ok: boolean
  summary: { total: number; passed: number; failed: number; ms: number }
  suites: EvalSuite[]
  error?: string
}

export default function AccuracyPage() {
  const { t } = useLanguage()
  const { toast } = useToast()
  const [result, setResult] = useState<EvalResult | null>(null)
  const [running, setRunning] = useState(false)
  const [outdatedBackend, setOutdatedBackend] = useState(false)

  const run = async () => {
    setRunning(true)
    setOutdatedBackend(false)
    try {
      const token = await accessToken(true)
      if (!token) throw new Error('Not signed in')
      const base = CONFIG.AUDITX_API_URL.replace(/\/+$/, '')
      const res = await fetchWithTimeout(
        `${base}/api/evaluate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: '{}',
        },
        60_000,
      )
      const data = (await res.json().catch(() => ({}))) as EvalResult
      if (res.status === 404 || /not found/i.test(data.error ?? '')) {
        // The live backend predates the evaluation endpoint — actionable, not cryptic.
        setOutdatedBackend(true)
        setResult(null)
        return
      }
      if (!res.ok || !data.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
      setResult(data)
    } catch (e) {
      toast('error', t('acc.loadFail'), (e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const s = result?.summary

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('acc.title')}
        subtitle={t('acc.subtitle')}
        actions={
          <Button icon={running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} onClick={() => void run()} loading={running} disabled={running}>
            {running ? t('acc.running') : t('acc.run')}
          </Button>
        }
      />

      {!result ? (
        <div className="panel p-6">
          {outdatedBackend ? (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-center">
              <p className="text-sm font-bold text-amber-700 dark:text-amber-300">{t('acc.backendOld')}</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-amber-700/80 dark:text-amber-300/80">
                {t('acc.backendOldMsg')}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                icon={<Play className="h-4 w-4" />}
                onClick={() => void run()}
                loading={running}
              >
                {t('acc.retry')}
              </Button>
            </div>
          ) : (
          <EmptyState
            title={t('acc.title')}
            message={t('acc.runFirst')}
            action={
              <Button icon={<FlaskConical className="h-4 w-4" />} onClick={() => void run()} loading={running}>
                {t('acc.run')}
              </Button>
            }
          />
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: t('acc.total'), value: s?.total ?? 0, cls: 'text-slate-600 dark:text-slate-300' },
              { label: t('acc.passed'), value: s?.passed ?? 0, cls: 'text-emerald-600 dark:text-emerald-400' },
              { label: t('acc.failed'), value: s?.failed ?? 0, cls: (s?.failed ?? 0) > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400' },
              { label: t('acc.took'), value: `${s?.ms ?? 0}ms`, cls: 'text-slate-600 dark:text-slate-300' },
            ].map((c) => (
              <div key={c.label} className="panel p-4 text-center">
                <div className={cn('text-2xl font-extrabold', c.cls)}>{c.value}</div>
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-ink-text-soft dark:text-navy-300">{c.label}</div>
              </div>
            ))}
          </div>

          {result.suites.map((suite) => (
            <div key={suite.name} className="panel overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-line p-4 dark:border-navy-700/60">
                <h2 className="text-sm font-bold text-ink-text dark:text-white">
                  {suite.name === 'compliance' ? t('acc.suiteCompliance') : t('acc.suiteAdjudication')}
                </h2>
                <span className={cn('text-xs font-bold', suite.failed > 0 ? 'text-rose-500' : 'text-emerald-500')}>
                  {suite.passed}/{suite.total}
                </span>
              </div>
              <ul className="divide-y divide-line dark:divide-white/5">
                {suite.cases.map((c) => (
                  <li key={c.id} className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      {c.pass ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                      ) : (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-sm font-semibold text-ink-text dark:text-slate-100">{c.label}</span>
                          <span className="font-mono text-[11px] text-slate-400">{c.id}</span>
                          <span className={cn('ml-auto text-[11px] font-bold', c.pass ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                            {c.pass ? t('acc.pass') : t('acc.fail')}
                          </span>
                        </div>
                        <div className="mt-1 grid gap-1 text-xs sm:grid-cols-3">
                          <div className="text-slate-500 dark:text-navy-300">
                            <span className="font-semibold">{t('acc.colExpected')}: </span>
                            <span className="font-mono">{c.expected}</span>
                          </div>
                          <div className="text-slate-500 dark:text-navy-300">
                            <span className="font-semibold">{t('acc.colActual')}: </span>
                            <span className="font-mono">{c.actual}</span>
                          </div>
                          <div className="text-slate-400">
                            <span className="font-semibold">{t('acc.colTime')}: </span>{c.ms}ms
                          </div>
                        </div>
                        {c.detail && (
                          <p className="mt-1 truncate text-[11px] text-slate-400" title={c.detail}>{c.detail}</p>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
