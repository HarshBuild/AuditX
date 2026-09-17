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
  FlaskConical,
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
import { useLanguage } from '../../i18n/LanguageContext'
import type { DictKey } from '../../i18n/en'
import { LogoMark } from '../auth/guards'
import Tooltip from '../ui/Tooltip'

export interface NavItem {
  path: string
  labelKey: DictKey
  icon: LucideIcon
}

export const USER_NAV: NavItem[] = [
  { path: '/user-dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { path: '/scan-product', labelKey: 'nav.scanProduct', icon: ScanLine },
  { path: '/scan-history', labelKey: 'nav.scanHistory', icon: ClipboardList },
  { path: '/my-reports', labelKey: 'nav.myReports', icon: FileText },
  { path: '/accuracy', labelKey: 'nav.accuracy', icon: FlaskConical },
  { path: '/profile', labelKey: 'nav.profile', icon: UserCircle2 },
  { path: '/settings', labelKey: 'nav.settings', icon: Settings },
]

/** Super Admin — the ONLY operator role (inspector/admin capabilities merged). */
export const SUPER_ADMIN_NAV: NavItem[] = [
  { path: '/super-admin-dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { path: '/scan-product', labelKey: 'nav.scanProduct', icon: ScanLine },
  { path: '/admin/scans', labelKey: 'nav.productScans', icon: ClipboardList },
  { path: '/admin/violations', labelKey: 'nav.violations', icon: AlertTriangle },
  { path: '/admin/reports', labelKey: 'nav.reports', icon: FileText },
  { path: '/admin/evidence', labelKey: 'nav.evidence', icon: Camera },
  { path: '/admin/manufacturers', labelKey: 'nav.manufacturers', icon: Factory },
  { path: '/admin/products', labelKey: 'nav.productDb', icon: Package },
  { path: '/admin/analytics', labelKey: 'nav.analytics', icon: BarChart3 },
  { path: '/admin-requests', labelKey: 'nav.staffRequests', icon: ClipboardCheck },
  { path: '/admin-management', labelKey: 'nav.adminMgmt', icon: ShieldCheck },
  { path: '/users', labelKey: 'nav.users', icon: Users },
  { path: '/compliance-rules', labelKey: 'nav.complianceRules', icon: FileCheck2 },
  { path: '/accuracy', labelKey: 'nav.accuracy', icon: FlaskConical },
  { path: '/activity-logs', labelKey: 'nav.activityLogs', icon: Activity },
  { path: '/system-settings', labelKey: 'nav.systemSettings', icon: Settings },
  { path: '/profile', labelKey: 'nav.profile', icon: UserCircle2 },
  { path: '/settings', labelKey: 'nav.settings', icon: Settings },
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
  const { t } = useLanguage()
  const label = t(item.labelKey)
  const Icon = item.icon
  const button = (
    <button
      onClick={() => onNavigate(item.path)}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 focus-visible:outline-none',
        collapsed && 'justify-center px-0',
        active
          ? 'bg-white/10 text-white shadow-inset-top'
          : 'text-white/55 hover:bg-white/[0.06] hover:text-white',
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-to-b from-accent-400 to-brand-600 shadow-bar-lg"
        />
      )}
      <Icon
        className={cn(
          'h-[18px] w-[18px] shrink-0 transition-transform duration-150',
          active ? 'text-accent-300' : 'text-white/45 group-hover:text-white/80',
          !collapsed && active && 'scale-110',
        )}
      />
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  )
  return collapsed ? (
    <Tooltip content={label} side="right" className="w-full">
      {button}
    </Tooltip>
  ) : (
    button
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
  const { t } = useLanguage()
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
      <div className="space-y-1 border-t border-white/10 p-3">
        {collapsed ? (
          <Tooltip content={t('header.logout')} side="right" className="w-full">
            <button
              onClick={onLogout}
              className="flex w-full items-center justify-center rounded-lg px-3 py-2 text-sm font-medium text-rose-300/90 transition-colors hover:bg-rose-500/10 hover:text-rose-200"
            >
              <LogOut className="h-[18px] w-[18px] shrink-0" />
            </button>
          </Tooltip>
        ) : (
          <button
            onClick={onLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-rose-300/90 transition-colors hover:bg-rose-500/10 hover:text-rose-200"
          >
            <LogOut className="h-[18px] w-[18px] shrink-0" />
            <span className="truncate">{t('header.logout')}</span>
          </button>
        )}
        <button
          onClick={onToggleCollapsed}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white',
            collapsed && 'justify-center px-0',
          )}
          title={collapsed ? t('nav.expand') : t('nav.collapse')}
        >
          <Braces className="h-[18px] w-[18px] rotate-90" />
          {!collapsed && <span>{t('nav.collapse')}</span>}
        </button>
      </div>
    </>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 flex-col bg-gradient-to-b from-navy-900 via-navy-950 to-ink transition-[width] duration-200 lg:flex',
          collapsed ? 'w-[72px]' : 'w-60',
        )}
      >
        <div className={cn('flex h-16 items-center gap-2.5 border-b border-white/10 px-4', collapsed && 'justify-center px-0')}>
          <LogoMark size={collapsed ? 'sm' : 'md'} />
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-sm font-extrabold tracking-tight text-white">
                Audit<span className="text-accent-400">X</span>
              </p>
              <p className="text-[10px] font-medium uppercase tracking-widest text-white/40">Compliance Suite</p>
            </div>
          )}
        </div>
        {navBody}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-navy-950/60 backdrop-blur-[2px]" onClick={onMobileClose} aria-hidden="true" />
          <aside className="absolute inset-y-0 left-0 flex w-64 animate-drawer-in flex-col border-r border-white/10 bg-gradient-to-b from-navy-900 via-navy-950 to-ink">
            <div className="flex h-16 items-center justify-between border-b border-white/10 px-4">
              <div className="flex items-center gap-2.5">
                <LogoMark size="sm" />
                <div className="min-w-0">
                  <p className="text-sm font-extrabold tracking-tight text-white">
                    Audit<span className="text-accent-400">X</span>
                  </p>
                  <p className="text-[10px] font-medium uppercase tracking-widest text-white/40">Compliance Suite</p>
                </div>
              </div>
              <button
                onClick={onMobileClose}
                aria-label={t('nav.closeNav')}
                className="rounded-lg p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
              {items.map((item) => (
                <NavLink key={item.path} item={item} active={path === item.path} collapsed={false} onNavigate={navigate} />
              ))}
            </nav>
            <div className="border-t border-white/10 p-3">
              <button
                onClick={onLogout}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-rose-300/90 transition-colors hover:bg-rose-500/10 hover:text-rose-200"
              >
                <LogOut className="h-[18px] w-[18px] shrink-0" />
                <span>{t('header.logout')}</span>
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  )
}