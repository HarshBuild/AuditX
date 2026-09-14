import { useState } from 'react'
import { ChevronDown, GraduationCap, Keyboard, LifeBuoy, Mail, MessageSquareText } from 'lucide-react'
import AnalyticsCard from '../dashboard/AnalyticsCard'
import { cn } from '../../utils/format'

const faqs = [
  {
    q: 'How do I scan a product label?',
    a: 'Open the "Scan Product" page, then add up to 6 photos of the label (front, back and sides) — drag & drop or tap to upload. You can optionally enter the price / net quantity details, barcode or manufacturer. Tap "Analyze label" and the report opens with the compliance score, rule-by-rule checks and evidence.',
  },
  {
    q: 'How does the AI label scan work?',
    a: 'Each photo is sharpened and read field-by-field across every image, then checked against legal metrology rules. The scanner tries the fastest OCR path first and falls back through the AI engine to a free on-device OCR engine when the server is unreachable, so a scan always completes. High-accuracy Gemini reading can be enabled with your own API key in Settings.',
  },
  {
    q: 'Can I export my inspection report?',
    a: 'Yes. The inspection report has a Download button that exports a formatted PDF, plus Copy and Share options. Report exports are also available from your scan history.',
  },
  {
    q: 'How is my data stored and secured?',
    a: 'All data (scans, violations, reports, users, products) lives in Firestore with role-based security rules. Every write is authorized by the Firebase security rules — the dashboard only pre-checks roles for a better UX.',
  },
  {
    q: 'Does the dashboard support dark mode?',
    a: 'Yes — use the sun/moon button in the top header to cycle Light, Dark and System themes. Your choice is remembered in localStorage.',
  },
]

const shortcuts = [
  { keys: '⌘K / Ctrl+K', action: 'Focus global search' },
  { keys: 'Esc', action: 'Close dialogs and dropdowns' },
  { keys: 'Tab', action: 'Move through interactive elements' },
  { keys: 'Enter', action: 'Activate focused button' },
]

export default function HelpPage() {
  const [open, setOpen] = useState<number | null>(0)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Help & Support</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Answers, shortcuts and human help when you need it.</p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AnalyticsCard title="Frequently asked questions" subtitle="Click a question to expand the answer" bodyClassName="p-0">
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {faqs.map((f, i) => (
                <div key={i}>
                  <button
                    onClick={() => setOpen(open === i ? null : i)}
                    aria-expanded={open === i}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{f.q}</span>
                    <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open === i && 'rotate-180')} />
                  </button>
                  {open === i && (
                    <p className="animate-fade-in px-5 pb-4 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{f.a}</p>
                  )}
                </div>
              ))}
            </div>
          </AnalyticsCard>
        </div>

        <div className="space-y-5">
          <AnalyticsCard title="Keyboard shortcuts" subtitle="Move fast without the mouse">
            <ul className="space-y-2.5">
              {shortcuts.map((s) => (
                <li key={s.keys} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
                  <span className="flex min-w-0 items-center gap-2 text-slate-500 dark:text-slate-400">
                    <Keyboard className="h-4 w-4 shrink-0 text-slate-400" /> {s.action}
                  </span>
                  <kbd className="shrink-0 whitespace-nowrap rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 dark:border-white/15 dark:bg-slate-800 dark:text-slate-300">
                    {s.keys}
                  </kbd>
                </li>
              ))}
            </ul>
          </AnalyticsCard>

          <AnalyticsCard title="Get in touch" subtitle="We usually reply within one business day">
            <div className="space-y-2.5">
              <a href="mailto:support@auditx.example" className="flex items-center gap-2.5 text-sm font-medium text-slate-600 transition-colors hover:text-brand-600 dark:text-slate-300 dark:hover:text-brand-400">
                <Mail className="h-4 w-4 text-slate-400" /> support@auditx.example
              </a>
              <a href="#" className="flex items-center gap-2.5 text-sm font-medium text-slate-600 transition-colors hover:text-brand-600 dark:text-slate-300 dark:hover:text-brand-400">
                <MessageSquareText className="h-4 w-4 text-slate-400" /> Live chat
              </a>
              <a href="#" className="flex items-center gap-2.5 text-sm font-medium text-slate-600 transition-colors hover:text-brand-600 dark:text-slate-300 dark:hover:text-brand-400">
                <GraduationCap className="h-4 w-4 text-slate-400" /> Documentation
              </a>
              <a href="#" className="flex items-center gap-2.5 text-sm font-medium text-slate-600 transition-colors hover:text-brand-600 dark:text-slate-300 dark:hover:text-brand-400">
                <LifeBuoy className="h-4 w-4 text-slate-400" /> Status page
              </a>
            </div>
          </AnalyticsCard>
        </div>
      </div>
    </div>
  )
}