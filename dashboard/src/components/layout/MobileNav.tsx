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
        className={cn(
          'flex min-w-14 flex-col items-center gap-0.5 rounded-lg py-1 text-[10px] font-medium transition-colors',
          active ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400',
        )}
      >
        <Icon className="h-5 w-5" />
        {item.label}
      </button>
    )
  }

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-slate-200 bg-white/95 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur lg:hidden dark:border-slate-800 dark:bg-slate-900/95"
    >
      {first.map(renderItem)}
      {showAdd ? (
        <button
          onClick={centerAction}
          aria-label="Scan product"
          className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg shadow-brand-600/30 transition-transform active:scale-95"
        >
          <Plus className="h-6 w-6" />
        </button>
      ) : null}
      {rest.map(renderItem)}
    </nav>
  )
}