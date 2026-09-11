import { CheckCheck, ClipboardList, FileText, Info, AlertTriangle } from 'lucide-react'
import AnalyticsCard from '../dashboard/AnalyticsCard'
import Button from '../ui/Button'
import { useToast } from '../ui/Toast'
import type { AppNotification } from '../../types'
import { cn } from '../../utils/format'

const typeIcon = {
  record: <ClipboardList className="h-4 w-4 text-brand-600 dark:text-brand-400" />,
  report: <FileText className="h-4 w-4 text-violet-600 dark:text-violet-400" />,
  action: <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />,
  system: <Info className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />,
}

interface NotificationsPageProps {
  notifications: AppNotification[]
  onMarkAll: () => void
  onMarkOne: (id: string) => void
}

export default function NotificationsPage({ notifications, onMarkAll, onMarkOne }: NotificationsPageProps) {
  const { toast } = useToast()
  const unread = notifications.filter((n) => n.unread).length

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Notifications</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {unread > 0 ? `${unread} unread notification${unread > 1 ? 's' : ''} waiting for you.` : 'You’re all caught up.'}
          </p>
        </div>
        <Button variant="outline" icon={<CheckCheck className="h-4 w-4" />} onClick={() => { onMarkAll(); toast('info', 'Marked all as read') }}>
          Mark all as read
        </Button>
      </div>

      <AnalyticsCard title="Inbox" subtitle={`${notifications.length} notifications`} bodyClassName="p-0">
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {notifications.length === 0 && (
            <p className="px-5 py-12 text-center text-sm text-slate-400">You're all caught up. Nothing new here.</p>
          )}
          {notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                onMarkOne(n.id)
                if (n.unread) toast('info', 'Marked as read', n.title)
              }}
              className={cn(
                'flex w-full items-start gap-4 px-5 py-4 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40',
                n.unread && 'bg-brand-50/40 dark:bg-brand-500/5',
              )}
            >
              <span className="mt-0.5 shrink-0">{typeIcon[n.type]}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{n.title}</span>
                <span className="mt-0.5 block text-sm leading-relaxed text-slate-500 dark:text-slate-400">{n.message}</span>
                <span className="mt-1 block text-xs font-medium text-slate-400">{n.time}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-2">
                {n.unread && <span className="h-2 w-2 rounded-full bg-brand-500" aria-label="Unread" />}
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  {n.type}
                </span>
              </span>
            </button>
          ))}
        </div>
      </AnalyticsCard>
    </div>
  )
}