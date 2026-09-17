import { AlertTriangle, ClipboardList, LayoutDashboard, Plus, ScanLine, Settings, ShieldCheck, UserCircle2, Users } from 'lucide-react'
import { cn } from '../../utils/format'
import { type Role } from '../../lib/rbac'
import { useLanguage } from '../../i18n/LanguageContext'
import type { DictKey } from '../../i18n/en'

interface MobileItem {
  path: string
  labelKey: DictKey
  icon: typeof LayoutDashboard
}

const USER_ITEMS: MobileItem[] = [
  { path: '/user-dashboard', labelKey: 'nav.home', icon: LayoutDashboard },
  { path: '/scan-product', labelKey: 'nav.scan', icon: ScanLine },
  { path: '/scan-history', labelKey: 'nav.history', icon: ClipboardList },
  { path: '/settings', labelKey: 'nav.settings', icon: Settings },
]

const SUPER_ADMIN_ITEMS: MobileItem[] = [
  { path: '/super-admin-dashboard', labelKey: 'nav.home', icon: LayoutDashboard },
  { path: '/admin/scans', labelKey: 'nav.scans', icon: ClipboardList },
  { path: '/admin/violations', labelKey: 'nav.violations', icon: AlertTriangle },
  { path: '/users', labelKey: 'nav.users', icon: Users },
  { path: '/admin-requests', labelKey: 'nav.requests', icon: ShieldCheck },
  { path: '/profile', labelKey: 'nav.profile', icon: UserCircle2 },
]

interface MobileNavProps {
  path: string
  onNavigate: (p: string) => void
  onAdd: () => void
  role: Role
}

export default function MobileNav({ path, onNavigate, onAdd, role }: MobileNavProps) {
  const { t } = useLanguage()
  const items = role === 'super_admin' ? SUPER_ADMIN_ITEMS : USER_ITEMS

  // Consumers get the floating scan button; super admins navigate to scan from the drawer.
  const showAdd = role !== 'super_admin'
  const centerAction = () => {
    if (role === 'super_admin') onNavigate('/scan-product')
    else onAdd()
  }
  const first = showAdd ? items.slice(0, 2) : items
  const rest = showAdd ? items.slice(2) : []

  const renderItem = (item: MobileItem) => {
    const Icon = item.icon
    const active = path === item.path
    return (
      <button
        key={item.path}
        onClick={() => onNavigate(item.path)}
        aria-current={active ? 'page' : undefined}
        className="relative flex min-w-0 flex-1 flex-col items-center gap-1 py-1.5"
      >
        {active && (
          <span
            aria-hidden="true"
            className="absolute left-1/2 top-0 h-[3px] w-8 -translate-x-1/2 rounded-b-full bg-gradient-to-r from-accent-500 to-brand-600 shadow-bar"
          />
        )}
        <span
          className={cn(
            'flex w-full flex-col items-center gap-1 rounded-xl py-1 text-[10px] font-semibold transition-all duration-150',
            active
              ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
              : 'text-slate-400 dark:text-slate-500',
          )}
        >
          <Icon className={cn('h-5 w-5', active && 'scale-105')} />
          <span className="max-w-full truncate">{t(item.labelKey)}</span>
        </span>
      </button>
    )
  }

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around gap-0.5 border-t border-line bg-surface/90 px-1 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1.5 backdrop-blur-xl lg:hidden dark:border-navy-700/60 dark:bg-navy-950/90"
    >
      {first.map(renderItem)}
      {showAdd ? (
        <button
          onClick={centerAction}
          aria-label={t('nav.scanProductAction')}
          className="relative -mt-5 flex h-12 w-12 shrink-0 items-center justify-center self-start rounded-full bg-gradient-to-br from-brand-500 via-brand-600 to-brand-800 text-white shadow-glow shadow-inset-top ring-4 ring-surface-bg transition-transform active:scale-95 dark:ring-navy-950"
        >
          <Plus className="h-6 w-6" />
        </button>
      ) : null}
      {rest.map(renderItem)}
    </nav>
  )
}