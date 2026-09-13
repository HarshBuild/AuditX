import { type ReactNode } from 'react'
import { CheckCircle2, Lock } from 'lucide-react'
import { AuditXMark } from '../brand/AuditXMark'

const highlights = [
  'AI-powered label scanning',
  '10-rule compliance check',
  'Instant PDF reports',
  'Barcode + GPS tracking',
]

export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-navy-950">
      {/* Brand panel */}
      <aside className="relative hidden w-[45%] overflow-hidden bg-gradient-to-br from-navy-900 via-navy-950 to-[#070d1d] lg:block dark:lg:block">
        <div aria-hidden="true" className="absolute inset-0 bg-dots opacity-[0.07]" />
        <div aria-hidden="true" className="absolute -right-24 -top-24 h-96 w-96 animate-float rounded-full bg-brand-500/20 blur-3xl" />
        <div aria-hidden="true" className="absolute -bottom-28 -left-20 h-[28rem] w-[28rem] animate-float rounded-full bg-indigo-500/15 blur-3xl [animation-delay:1.2s]" />
        <div className="relative z-10 flex h-full flex-col items-center justify-center gap-8 p-12 text-center">
          <div className="flex h-16 w-16 animate-float items-center justify-center rounded-2xl bg-white/10 text-white shadow-glow backdrop-blur [animation-delay:0.6s]">
            <AuditXMark size="lg" />
          </div>
          <div>
            <h1 className="text-5xl font-black tracking-tight text-white">
              Audit<span className="text-accent-400">X</span>
            </h1>
            <p className="mt-2 text-lg text-white/60">Legal Metrology Compliance Scanner</p>
          </div>
          <div className="h-px w-16 bg-white/20" />
          <ul className="space-y-3 text-left">
            {highlights.map((h) => (
              <li key={h} className="flex items-center gap-2.5 text-sm text-white/85">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500/25 text-accent-300">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </span>
                {h}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-xs text-white/30">Aligned with Legal Metrology Act, 2009</p>
        </div>
      </aside>

      {/* Form panel */}
      <main className="flex flex-1 items-center justify-center p-4 md:p-8">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center justify-center gap-2 lg:hidden">
            <AuditXMark size="md" />
            <span className="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100">
              Audit<span className="text-brand-600 dark:text-accent-400">X</span>
            </span>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card ring-1 ring-slate-900/[0.03] dark:border-white/[0.07] dark:bg-navy-900 dark:ring-white/[0.02] sm:p-8">
            {children}
          </div>
          <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-slate-400 dark:text-white/35">
            <Lock className="h-3 w-3" aria-hidden="true" />
            Secured with Firebase Auth
          </p>
        </div>
      </main>
    </div>
  )
}