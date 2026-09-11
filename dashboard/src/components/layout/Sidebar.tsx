import {
  Activity,
  AlertTriangle,
  BarChart3,
  Braces,
  Camera,
  ClipboardCheck,
  ClipboardList,
  Factory,
  FileCheck2,
  FileText,
  LayoutDashboard,
  LogOut,
  Package,
  ScanLine,
  Settings,
  ShieldCheck,
  UserCircle2,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '../../utils/format'
import { type Role } from '../../lib/rbac'
import { LogoMark } from '../auth/guards'

export interface NavItem {
  path: string
  label: string
  icon: LucideIcon
}

export const USER_NAV: NavItem[] = [
  { path: '/user-dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/scan-product', label: 'Scan Product', icon: ScanLine },
  { path: '/scan-history', label: 'Scan History', icon: ClipboardList },
  { path: '/my-reports', label: 'My Reports', icon: FileText },
  { path: '/profile', label: 'Profile', icon: UserCircle2 },
  { path: '/settings', label: 'Settings', icon: Settings },
]

/** Super Admin — the ONLY operator role (inspector/admin capabilities merged). */
export const SUPER_ADMIN_NAV: NavItem[] = [
  { path: '/super-admin-dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/scan-product', label: 'Scan Product', icon: ScanLine },
  { path: '/admin/scans', label: 'Product Scans', icon: ClipboardList },
  { path: '/admin/violations', label: 'Violations', icon: AlertTriangle },
  { path: '/admin/reports', label: 'Reports', icon: FileText },
  { path: '/admin/evidence', label: 'Evidence', icon: Camera },
  { path: '/admin/manufacturers', label: 'Manufacturers', icon: Factory },
  { path: '/admin/products', label: 'Product Database', icon: Package },
  { path: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
  { path: '/admin-requests', label: 'Staff Requests', icon: ClipboardCheck },
  { path: '/admin-management', label: 'Admin Management', icon: ShieldCheck },
  { path: '/users', label: 'Users', icon: Users },
  { path: '/compliance-rules', label: 'Compliance Rules', icon: FileCheck2 },
  { path: '/activity-logs', label: 'Activity Logs', icon: Activity },
  { path: '/system-settings', label: 'System Settings', icon: Settings },
  { path: '/profile', label: 'Profile', icon: UserCircle2 },
  { path: '/settings', label: 'Settings', icon: Settings },
]

export function sidebarItems(role: Role): NavItem[] {
  if (role === 'super_admin') return SUPER_ADMIN_NAV
  return USER_NAV
}

function NavLink({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: NavItem
  active: boolean
  collapsed: boolean
  onNavigate: (p: string) => void
}) {
  const Icon = item.icon
  return (
    <button
      onClick={() => onNavigate(item.path)}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none',
        collapsed && 'justify-center px-0',
        active
          ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-200',
      )}
    >
      <Icon className={cn('h-[18px] w-[18px] shrink-0', active && 'text-brand-600 dark:text-brand-400')} />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {active && !collapsed && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-500" />}
      {collapsed && (
        <span className="pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 lg:block dark:bg-slate-800">
          {item.label}
        </span>
      )}
    </button>
  )
}

interface SidebarProps {
  path: string
  onNavigate: (p: string) => void
  collapsed: boolean
  onToggleCollapsed: () => void
  mobileOpen: boolean
  onMobileClose: () => void
  role: Role
  onLogout: () => void
}

export default function Sidebar({
  path,
  onNavigate,
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onMobileClose,
  role,
  onLogout,
}: SidebarProps) {
  const items = sidebarItems(role)
  const navigate = (p: string) => {
    onNavigate(p)
    onMobileClose()
  }

  const navBody = (
    <>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {items.map((item) => (
          <NavLink key={item.path} item={item} active={path === item.path} collapsed={collapsed} onNavigate={navigate} />
        ))}
      </nav>
      <div className="space-y-1 border-t border-slate-100 p-3 dark:border-slate-800">
        <button
          onClick={onLogout}
          className={cn(
            'group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10',
            collapsed && 'justify-center px-0',
          )}
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && <span className="truncate">Logout</span>}
          {collapsed && (
            <span className="pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 lg:block dark:bg-slate-800">
              Logout
            </span>
          )}
        </button>
        <button
          onClick={onToggleCollapsed}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-200',
            collapsed && 'justify-center px-0',
          )}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Braces className="h-[18px] w-[18px] rotate-90" />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 lg:flex dark:border-slate-800 dark:bg-slate-900',
          collapsed ? 'w-[72px]' : 'w-60',
        )}
      >
        <div className={cn('flex h-16 items-center border-b border-slate-100 px-4 dark:border-slate-800', collapsed && 'justify-center px-0')}>
          <LogoMark size={collapsed ? 'sm' : 'md'} />
          {!collapsed && (
            <div className="ml-2.5 min-w-0">
              <p className="text-sm font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
                Audit<span className="text-brand-600 dark:text-brand-400">X</span>
              </p>
              <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">Compliance Suite</p>
            </div>
          )}
        </div>
        {navBody}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-slate-950/50" onClick={onMobileClose} aria-hidden="true" />
          <aside className="absolute inset-y-0 left-0 flex w-64 animate-drawer-in flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="flex h-16 items-center justify-between border-b border-slate-100 px-4 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <LogoMark size="sm" />
                <div className="min-w-0">
                  <p className="text-sm font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
                    Audit<span className="text-brand-600 dark:text-brand-400">X</span>
                  </p>
                  <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">Compliance Suite</p>
                </div>
              </div>
              <button
                onClick={onMobileClose}
                aria-label="Close navigation"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
              {items.map((item) => (
                <NavLink key={item.path} item={item} active={path === item.path} collapsed={false} onNavigate={navigate} />
              ))}
            </nav>
            <div className="border-t border-slate-100 p-3 dark:border-slate-800">
              <button
                onClick={onLogout}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
              >
                <LogOut className="h-[18px] w-[18px] shrink-0" />
                <span>Logout</span>
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  )
}