import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Camera,
  CheckCircle2,
  FileText,
  Gauge,
  Lock,
  Play,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react'
import { AuditXLockup } from '../brand/AuditXMark'

const features = [
  {
    icon: ScanLine,
    title: 'Label OCR engine',
    body: 'Extracts MRP, net quantity, manufacturer, barcode and more straight from a photo of the package.',
  },
  {
    icon: ShieldCheck,
    title: '10-rule compliance check',
    body: 'Every printed detail is audited against Legal Metrology Act, 2009 rules with clear pass / fail verdicts.',
  },
  {
    icon: Gauge,
    title: 'Instant risk score',
    body: 'A single 0–100 compliance score with per-rule confidence, so you know exactly what needs attention.',
  },
  {
    icon: FileText,
    title: 'Audit-ready reports',
    body: 'Export a clean, shareable PDF inspection report with image evidence — inspector-approved.',
  },
]

const steps = [
  {
    num: '01',
    icon: Camera,
    title: 'Snap a photo',
    body: 'Upload a clear photo of the product label — front or barcode side.',
  },
  {
    num: '02',
    icon: Sparkles,
    title: 'AI reads & checks',
    body: 'OCR extracts every printed detail, then the rule engine audits each one in seconds.',
  },
  {
    num: '03',
    icon: FileText,
    title: 'Get your report',
    body: 'Receive a scored report with pass / fail details and one-click PDF export.',
  },
]

const stats = [
  { icon: CheckCircle2, label: '10 rule checks', detail: 'per scan' },
  { icon: Zap, label: '< 60 seconds', detail: 'to a result' },
  { icon: FileText, label: '1-click export', detail: 'PDF report' },
]

const mockRows = [
  { key: 'MRP', value: '₹99', status: 'PASS', tone: 'text-emerald-300 bg-emerald-500/15' },
  { key: 'Net Quantity', value: '500 g', status: 'PASS', tone: 'text-emerald-300 bg-emerald-500/15' },
  { key: 'Manufacturer', value: 'Miles Inc.', status: 'PASS', tone: 'text-emerald-300 bg-emerald-500/15' },
  { key: 'Barcode', value: '8901 2345 6789', status: 'REVIEW', tone: 'text-amber-300 bg-amber-500/15' },
]

const DIAL_DEG = 303

function useCountUp(target: number, duration = 1000) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target)
      return
    }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(eased * target))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return value
}

function scrollToHowItWorks() {
  document.getElementById('how-it-works')?.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  })
}

export default function LandingPage() {
  const score = useCountUp(84)
  return (
    <div className="min-h-screen bg-white dark:bg-navy-950">
      <header className="sticky top-0 z-40 border-b border-slate-200/60 bg-white/70 backdrop-blur-xl dark:border-white/[0.06] dark:bg-navy-950/70">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link to="/" aria-label="AuditX home" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
            <AuditXLockup size="sm" tagline="Legal Metrology Scanner" />
          </Link>
          <nav className="flex items-center gap-2" aria-label="Account">
            <Link
              to="/login"
              className="inline-flex h-10 items-center rounded-lg px-4 text-sm font-semibold text-slate-700 ring-1 ring-slate-900/10 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-white/80 dark:ring-white/15 dark:hover:bg-white/10 dark:hover:text-white"
            >
              Sign in
            </Link>
            <Link
              to="/signup"
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-gradient-to-br from-brand-500 via-brand-600 to-brand-700 px-4 text-sm font-semibold text-white shadow-glow-sm transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-navy-950"
            >
              Get started
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden bg-gradient-to-br from-navy-900 via-navy-950 to-[#070d1d] text-white">
          <div aria-hidden="true" className="absolute inset-0 bg-dots opacity-[0.08]" />
          <div aria-hidden="true" className="absolute -top-40 left-1/2 h-[30rem] w-[30rem] -translate-x-1/2 animate-float rounded-full bg-brand-500/20 blur-3xl" />
          <div aria-hidden="true" className="absolute -bottom-32 -left-24 h-96 w-96 animate-float rounded-full bg-indigo-500/15 blur-3xl [animation-delay:1.1s]" />
          <div aria-hidden="true" className="absolute -bottom-24 -right-20 h-80 w-80 animate-float rounded-full bg-accent-500/15 blur-3xl [animation-delay:0.6s]" />

          <div className="relative z-10 mx-auto max-w-7xl px-4 pb-24 pt-20 text-center sm:px-6 lg:pb-32 lg:pt-28">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-accent-200 ring-1 ring-white/15 backdrop-blur">
              <Sparkles className="h-3.5 w-3.5 text-accent-300" aria-hidden="true" />
              AI-Powered Inspection
            </span>

            <h1 className="mx-auto mt-6 max-w-4xl text-4xl font-black leading-[1.08] tracking-tight sm:text-6xl lg:text-7xl">
              AI-Powered{' '}
              <span className="text-gradient">Product Intelligence</span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-base text-white/70 sm:text-lg">
              Snap a photo of any packaged product. AuditX reads every label, checks it against Legal Metrology rules, and delivers a compliance score — in under a minute.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                to="/signup"
                className="group inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-accent-400 via-brand-600 to-brand-700 px-7 text-sm font-bold text-white shadow-glow transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-950"
              >
                <ScanLine className="h-4 w-4" aria-hidden="true" />
                Analyze a Product
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
              <button
                type="button"
                onClick={scrollToHowItWorks}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white/10 px-7 text-sm font-bold text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                View Demo
              </button>
            </div>

            <dl className="mx-auto mt-14 grid max-w-3xl grid-cols-1 gap-6 sm:grid-cols-3 sm:divide-x sm:divide-white/10">
              {stats.map((s) => (
                <div key={s.label} className="flex items-center justify-center gap-3 sm:justify-start sm:px-6 first:sm:pl-0">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/20 text-accent-300 ring-1 ring-white/10">
                    <s.icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="text-left">
                    <dt className="text-sm font-bold text-white">{s.label}</dt>
                    <dd className="text-xs text-white/50">{s.detail}</dd>
                  </div>
                </div>
              ))}
            </dl>

            <div className="mx-auto mt-16 max-w-2xl overflow-hidden rounded-2xl bg-white/[0.06] text-left shadow-navy-lg ring-1 ring-white/10 backdrop-blur-xl">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
                <div className="flex items-center gap-1.5" aria-hidden="true">
                  <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                  <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                  <span className="h-2.5 w-2.5 rounded-full bg-accent-300" />
                </div>
                <span className="text-xs font-bold uppercase tracking-wider text-white/50">Inspection Report</span>
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">PASS</span>
              </div>
              <div className="flex flex-col items-center gap-6 px-6 py-6 sm:flex-row">
                <div
                  className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full p-1.5"
                  style={{ background: `conic-gradient(from 90deg, #4f9bff, #818cf8 ${DIAL_DEG}deg, rgba(255,255,255,0.08) ${DIAL_DEG}deg)` }}
                >
                  <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-navy-950/95">
                    <span className="text-3xl font-black tabular-nums text-white">{score}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-white/45">Compliance</span>
                  </div>
                </div>
                <ul className="grid w-full flex-1 gap-2 sm:grid-cols-2">
                  {mockRows.map((r) => (
                    <li
                      key={r.key}
                      className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.04] px-3 py-2 ring-1 ring-white/10"
                    >
                      <span className="text-xs text-white/60">{r.key}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">{r.value}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${r.tone}`}>{r.status}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex items-center justify-between border-t border-white/10 px-5 py-2.5 text-[11px] text-white/45">
                <span>OCR + 10-rule compliance engine</span>
                <span className="flex items-center gap-1">
                  <Zap className="h-3 w-3" aria-hidden="true" />
                  Scanned in ~42s
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-slate-200/70 bg-slate-50 py-20 dark:border-white/[0.06] dark:bg-navy-950" id="features">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-bold uppercase tracking-widest text-brand-600 dark:text-accent-400">Why AuditX</p>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-4xl">
                Compliance scanning, minus the manual work
              </h2>
              <p className="mt-4 text-slate-500 dark:text-white/55">
                Everything a field inspector or consumer needs to verify packaged goods — reading, checking and reporting all handled by AI.
              </p>
            </div>
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {features.map((f) => (
                <div
                  key={f.title}
                  className="group rounded-2xl border border-slate-200/80 bg-white p-6 ring-1 ring-slate-900/[0.03] transition hover:-translate-y-1 hover:border-brand-500/30 hover:shadow-glow-sm dark:border-white/[0.08] dark:bg-white/[0.03] dark:ring-white/[0.02]"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-indigo-700 text-white shadow-glow-sm">
                    <f.icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h3 className="mt-4 text-base font-bold text-slate-900 dark:text-white">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-white/55">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-slate-200/70 bg-white py-20 dark:border-white/[0.06] dark:bg-navy-900" id="how-it-works">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-bold uppercase tracking-widest text-brand-600 dark:text-accent-400">How it works</p>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-4xl">
                From photo to verdict in three steps
              </h2>
            </div>
            <ol className="mt-12 grid gap-8 sm:grid-cols-3">
              {steps.map((s) => (
                <li key={s.num} className="relative">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-navy-800 to-navy-950 text-accent-300 shadow-navy-lg ring-1 ring-white/10 sm:h-14 sm:w-14">
                    <s.icon className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <span className="absolute -right-1 -top-3 text-4xl font-black text-slate-200/70 dark:text-white/[0.06]">{s.num}</span>
                  <h3 className="mt-5 text-lg font-bold text-slate-900 dark:text-white">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-white/55">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="px-4 py-20 sm:px-6 dark:bg-navy-950">
          <div className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl bg-gradient-to-br from-navy-900 via-navy-950 to-[#070d1d] px-6 py-16 text-center text-white shadow-navy-lg ring-1 ring-white/10">
            <div aria-hidden="true" className="absolute inset-0 bg-dots opacity-[0.07]" />
            <div aria-hidden="true" className="absolute -top-24 right-0 h-72 w-72 animate-float rounded-full bg-brand-500/20 blur-3xl" />
            <div className="relative z-10">
              <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
                Ready to scan your first product?
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-white/60">
                Create a free account and get an AI compliance report on any packaged product within a minute.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
                <Link
                  to="/signup"
                  className="group inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-accent-400 via-brand-600 to-brand-700 px-7 text-sm font-bold text-white shadow-glow transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-950"
                >
                  Analyze a Product
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
                <Link
                  to="/login"
                  className="inline-flex h-12 items-center justify-center rounded-xl bg-white/10 px-7 text-sm font-bold text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  Sign in
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200/70 bg-white dark:border-white/[0.06] dark:bg-navy-950">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-5 px-4 py-10 sm:flex-row sm:px-6">
          <AuditXLockup size="sm" />
          <p className="text-xs text-slate-400 dark:text-white/40">Aligned with the Legal Metrology Act, 2009</p>
          <p className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-white/40">
            <Lock className="h-3 w-3" aria-hidden="true" />
            Secured with Firebase Auth
          </p>
        </div>
      </footer>
    </div>
  )
}