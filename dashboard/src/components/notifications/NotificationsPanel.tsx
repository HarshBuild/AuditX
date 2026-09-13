import { BellRing, CheckCheck, ClipboardList, FileText, Info, AlertTriangle } from 'lucide-react'
import type { AppNotification } from '../../types'
import { cn } from '../../utils/format'

const typeIcon = {
  record: <ClipboardList className="h-4 w-4 text-brand-600 dark:text-brand-400" />,
  report: <FileText className="h-4 w-4 text-violet-600 dark:text-violet-400" />,
  action: <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />,
  system: <Info className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />,
}

interface NotificationsPanelProps {
  notifications: AppNotification[]
  onMarkAll: () => void
  onMarkOne: (id: string) => void
}

export default function NotificationsPanel({ notifications, onMarkAll, onMarkOne }: NotificationsPanelProps) {
  const unread = notifications.filter((n) => n.unread).length
  return (
    <div className="max-h-96 overflow-y-auto">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-white/10">
        <p className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
          <BellRing className="h-4 w-4 text-brand-600 dark:text-brand-400" />
          Notifications
          {unread > 0 && (
            <span className="rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold text-brand-700 dark:bg-brand-500/20 dark:text-brand-300">
              {unread} new
            </span>
          )}
        </p>
        <button
          onClick={onMarkAll}
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
        >
          <CheckCheck className="h-3.5 w-3.5" /> Mark all read
        </button>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {notifications.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-slate-400">You're all caught up.</p>
        )}
        {notifications.map((n) => (
          <button
            key={n.id}
            onClick={() => onMarkOne(n.id)}
            className={cn(
              'relative flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60',
              n.unread && 'bg-brand-50/40 dark:bg-brand-500/5',
            )}
          >
            <span className="mt-0.5 shrink-0">{typeIcon[n.type]}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{n.title}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {n.message}
              </span>
              <span className="mt-1 block text-[11px] font-medium text-slate-400">{n.time}</span>
            </span>
            {n.unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" aria-label="Unread" />}
          </button>
        ))}
      </div>
    </div>
  )
}