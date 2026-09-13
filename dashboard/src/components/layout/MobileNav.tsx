import { AlertTriangle, ClipboardList, LayoutDashboard, Plus, ScanLine, Settings, ShieldCheck, UserCircle2, Users } from 'lucide-react'
import { cn } from '../../utils/format'
import { type Role } from '../../lib/rbac'

interface MobileItem {
  path: string
  label: string
  icon: typeof LayoutDashboard
}

const USER_ITEMS: MobileItem[] = [
  { path: '/user-dashboard', label: 'Home', icon: LayoutDashboard },
  { path: '/scan-product', label: 'Scan', icon: ScanLine },
  { path: '/scan-history', label: 'History', icon: ClipboardList },
  { path: '/settings', label: 'Settings', icon: Settings },
]

const SUPER_ADMIN_ITEMS: MobileItem[] = [
  { path: '/super-admin-dashboard', label: 'Home', icon: LayoutDashboard },
  { path: '/admin/scans', label: 'Scans', icon: ClipboardList },
  { path: '/admin/violations', label: 'Violations', icon: AlertTriangle },
  { path: '/users', label: 'Users', icon: Users },
  { path: '/admin-requests', label: 'Requests', icon: ShieldCheck },
  { path: '/profile', label: 'Profile', icon: UserCircle2 },
]

interface MobileNavProps {
  path: string
  onNavigate: (p: string) => void
  onAdd: () => void
  role: Role
}

export default function MobileNav({ path, onNavigate, onAdd, role }: MobileNavProps) {
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
        className="flex min-w-0 flex-1 flex-col items-center gap-1 py-1.5"
      >
        <span
          className={cn(
            'flex w-full flex-col items-center gap-1 rounded-xl py-1 text-[10px] font-semibold transition-colors',
            active ? 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400' : 'text-slate-400',
          )}
        >
          <Icon className="h-5 w-5" />
          <span className="max-w-full truncate">{item.label}</span>
        </span>
      </button>
    )
  }

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around gap-0.5 border-t border-slate-200 bg-white/95 px-1 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1.5 backdrop-blur lg:hidden dark:border-slate-800 dark:bg-slate-900/95"
    >
      {first.map(renderItem)}
      {showAdd ? (
        <button
          onClick={centerAction}
          aria-label="Scan product"
          className="relative -mt-5 flex h-12 w-12 shrink-0 items-center justify-center self-start rounded-full bg-brand-600 text-white shadow-lg shadow-brand-600/30 ring-4 ring-slate-100 transition-transform active:scale-95 dark:ring-slate-900"
        >
          <Plus className="h-6 w-6" />
        </button>
      ) : null}
      {rest.map(renderItem)}
    </nav>
  )
}