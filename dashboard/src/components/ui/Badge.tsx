import {
  BadgeCheck,
  AlertTriangle,
  CircleAlert,
  CircleDot,
  CircleOff,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '../../utils/format'

export type BadgeTone = 'emerald' | 'brand' | 'cyan' | 'amber' | 'rose' | 'slate'

const tones: Record<BadgeTone, string> = {
  emerald:
    'bg-success-50 text-success-700 ring-1 ring-inset ring-success-600/20 dark:bg-success-500/10 dark:text-success-500 dark:ring-success-500/20',
  brand:
    'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-600/20 dark:bg-brand-500/10 dark:text-brand-400 dark:ring-brand-500/20',
  cyan: 'bg-info-50 text-info-700 ring-1 ring-inset ring-info-600/20 dark:bg-info-500/10 dark:text-info-400 dark:ring-info-500/20',
  amber:
    'bg-warning-50 text-warning-700 ring-1 ring-inset ring-warning-600/20 dark:bg-warning-500/10 dark:text-warning-500 dark:ring-warning-500/20',
  rose: 'bg-danger-50 text-danger-700 ring-1 ring-inset ring-danger-600/20 dark:bg-danger-500/10 dark:text-danger-500 dark:ring-danger-500/20',
  slate:
    'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/20 dark:bg-navy-800 dark:text-navy-300 dark:ring-navy-700',
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

/**
 * Verification verdict chip — icon + label + subtle ring, spec §12.
 * Use in inspection reports, evidence lists, trust cards.
 */
export type Verdict = 'verified' | 'review' | 'conflict' | 'processing' | 'unreadable' | 'neutral'

const verdictStyles: Record<Verdict, { label: string; icon: LucideIcon; cls: string }> = {
  verified: {
    label: 'Verified',
    icon: BadgeCheck,
    cls: 'bg-success-50 text-success-700 ring-1 ring-inset ring-success-600/20 dark:bg-success-500/10 dark:text-success-500 dark:ring-success-500/20',
  },
  review: {
    label: 'Needs review',
    icon: AlertTriangle,
    cls: 'bg-warning-50 text-warning-700 ring-1 ring-inset ring-warning-600/20 dark:bg-warning-500/10 dark:text-warning-500 dark:ring-warning-500/20',
  },
  conflict: {
    label: 'Conflict',
    icon: CircleAlert,
    cls: 'bg-danger-50 text-danger-700 ring-1 ring-inset ring-danger-600/20 dark:bg-danger-500/10 dark:text-danger-500 dark:ring-danger-500/20',
  },
  processing: {
    label: 'Processing',
    icon: CircleDot,
    cls: 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-600/20 dark:bg-brand-500/10 dark:text-brand-400 dark:ring-brand-500/20',
  },
  unreadable: {
    label: 'Unable to read',
    icon: CircleOff,
    cls: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/20 dark:bg-navy-800 dark:text-navy-300 dark:ring-navy-700',
  },
  neutral: {
    label: 'Unverified',
    icon: CircleDot,
    cls: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/20 dark:bg-navy-800 dark:text-navy-300 dark:ring-navy-700',
  },
}

export function VerdictBadge({
  verdict,
  label,
  className,
}: {
  verdict: Verdict
  label?: string
  className?: string
}) {
  const v = verdictStyles[verdict]
  const Icon = v.icon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        v.cls,
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {label ?? v.label}
    </span>
  )
}