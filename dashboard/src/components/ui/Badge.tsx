import { cn } from '../../utils/format'

export type BadgeTone = 'emerald' | 'brand' | 'cyan' | 'amber' | 'rose' | 'slate'

const tones: Record<BadgeTone, string> = {
  emerald:
    'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-400/20',
  brand:
    'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-600/20 dark:bg-brand-500/10 dark:text-brand-400 dark:ring-brand-400/20',
  cyan: 'bg-cyan-50 text-cyan-700 ring-1 ring-inset ring-cyan-600/20 dark:bg-cyan-500/10 dark:text-cyan-400 dark:ring-cyan-400/20',
  amber:
    'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-400/20',
  rose: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-400/20',
  slate:
    'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
}

const statusTone: Record<string, BadgeTone> = {
  Compliant: 'emerald',
  'In Progress': 'cyan',
  Pending: 'amber',
  Rejected: 'rose',
  Active: 'emerald',
  active: 'emerald',
  pending: 'amber',
  blocked: 'rose',
  approved: 'emerald',
  rejected: 'rose',
  Approved: 'emerald',
}

export function ToneBadge({
  tone = 'slate',
  className,
  children,
}: {
  tone?: BadgeTone
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function StatusBadge({ status }: { status: string }) {
  return <ToneBadge tone={statusTone[status] ?? 'slate'}>{status}</ToneBadge>
}