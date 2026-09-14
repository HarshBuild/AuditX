import type { LucideIcon } from 'lucide-react'
import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'

interface ActionTileProps {
  to: string
  icon: LucideIcon
  label: string
  desc: string
}

/** Quick-action tile: destination card with icon chip + arrow affordance. */
export default function ActionTile({ to, icon: Icon, label, desc }: ActionTileProps) {
  return (
    <Link to={to} className="panel-interactive group relative flex flex-col overflow-hidden p-5">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-brand-500/40 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      />
      <div className="flex flex-1 items-start justify-between gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card bg-brand-50 text-brand-600 shadow-sm ring-1 ring-inset ring-brand-500/10 transition-all duration-200 group-hover:-rotate-3 group-hover:scale-110 dark:bg-brand-500/15 dark:text-brand-400 dark:ring-white/10">
          <Icon className="h-5 w-5" />
        </span>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-ink-text-faint transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-600 dark:text-navy-500 dark:group-hover:text-brand-400" />
      </div>
      <p className="mt-4 text-sm font-bold text-ink-text dark:text-navy-50">{label}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-text-soft dark:text-navy-400">{desc}</p>
    </Link>
  )
}