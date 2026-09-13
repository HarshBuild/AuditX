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
    <div className="flex min-h-screen bg-slate-100 dark:bg-slate-950">
      {/* Brand panel */}
      <aside className="relative hidden w-[45%] overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 lg:block dark:lg:block">
        <div className="absolute -right-20 -top-20 h-80 w-80 rounded-full bg-white/5" aria-hidden="true" />
        <div className="absolute -bottom-24 -left-16 h-96 w-96 rounded-full bg-white/10" aria-hidden="true" />
        <div className="relative z-10 flex h-full flex-col items-center justify-center gap-8 p-12 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 text-white backdrop-blur">
            <AuditXMark size="lg" />
          </div>
          <div>
            <h1 className="text-5xl font-black tracking-tight text-white">
              Audit<span className="text-brand-200">X</span>
            </h1>
            <p className="mt-2 text-lg text-white/70">Legal Metrology Compliance Scanner</p>
          </div>
          <div className="h-px w-16 bg-white/30" />
          <ul className="space-y-3 text-left">
            {highlights.map((h) => (
              <li key={h} className="flex items-center gap-2.5 text-sm text-white/90">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-white/80" /> {h}
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
              Audit<span className="text-brand-600 dark:text-brand-400">X</span>
            </span>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card dark:border-slate-800 dark:bg-slate-900 sm:p-8">
            {children}
          </div>
          <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
            <Lock className="h-3 w-3" aria-hidden="true" />
            Secured with Firebase Auth
          </p>
        </div>
      </main>
    </div>
  )
}