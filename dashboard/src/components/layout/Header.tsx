import { useEffect, useRef, useState } from 'react'
import { Bell, BellRing, HelpCircle, LogOut, Menu, Search, SlidersHorizontal, Sun, Moon } from 'lucide-react'
import Dropdown, { MenuDivider, MenuHeader, MenuItem } from '../ui/Dropdown'
import ConfirmDialog from '../ui/ConfirmDialog'
import NotificationsPanel from '../notifications/NotificationsPanel'
import { cn } from '../../utils/format'
import { useToast } from '../ui/Toast'
import { initialsOf, roleLabel, homePath, type Role, type UserProfile } from '../../lib/rbac'
import { AuditXMark } from '../brand/AuditXMark'

export const PAGE_TITLES: Record<string, string> = {
  '/user-dashboard': 'Dashboard',
  '/scan-product': 'Scan Product',
  '/scan-history': 'Scan History',
  '/my-reports': 'My Reports',
  '/profile': 'Profile',
  '/settings': 'Settings',
  '/notifications': 'Notifications',
  '/help': 'Help & Support',
  '/inspector-dashboard': 'Inspector Dashboard',
  '/admin/scans': 'Product Scans',
  '/admin/violations': 'Violations',
  '/admin/reports': 'Reports',
  '/admin/evidence': 'Evidence Gallery',
  '/admin/manufacturers': 'Manufacturers',
  '/admin/products': 'Product Database',
  '/admin/users': 'Users',
  '/admin/analytics': 'Analytics',
  '/admin/settings': 'Settings',
  '/admin-dashboard': 'Admin Dashboard',
  '/super-admin-dashboard': 'Super Admin Dashboard',
  '/admin-requests': 'Staff Requests',
  '/admin-management': 'Admin Management',
  '/users': 'Users',
  '/compliance-rules': 'Compliance Rules',
  '/activity-logs': 'Activity Logs',
  '/system-settings': 'System Settings',
}

export function recordsPath(role: Role): string | null {
  if (role === 'super_admin') return '/admin/scans'
  return '/scan-history'
}

export function profilePath(role: Role): string {
  void role
  return '/profile'
}

export function pageTitle(path: string): string {
  return PAGE_TITLES[path] ?? 'Dashboard'
}

interface HeaderProps {
  path: string
  onMenu: () => void
  theme: 'light' | 'dark' | 'system'
  resolvedDark: boolean
  onCycleTheme: () => void
  notifications: Parameters<typeof NotificationsPanel>[0]['notifications']
  onMarkAll: () => void
  onMarkOne: (id: string) => void
  onNavigate: (p: string) => void
  globalQuery: string
  onGlobalQuery: (q: string) => void
  profile: UserProfile | null
  onLogout: () => void
}

export default function Header({
  path,
  onMenu,
  theme,
  resolvedDark,
  onCycleTheme,
  notifications,
  onMarkAll,
  onMarkOne,
  onNavigate,
  globalQuery,
  onGlobalQuery,
  profile,
  onLogout,
}: HeaderProps) {
  const { toast } = useToast()
  const [logoutOpen, setLogoutOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const unread = notifications.filter((n) => n.unread).length

  const title = pageTitle(path)
  const role: Role = profile?.role ?? 'user'
  const recPath = recordsPath(role)
  const initials = profile ? initialsOf(profile.name) : 'U'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <header className="sticky top-0 z-30 flex h-12 items-center gap-1.5 border-b border-slate-200/70 bg-white/70 px-3 backdrop-blur-xl sm:h-14 sm:gap-3 sm:px-6 dark:border-white/[0.06] dark:bg-navy-950/70">

      <button
        onClick={onMenu}
        aria-label="Open navigation menu"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 lg:hidden dark:text-slate-400 dark:hover:bg-white/10"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={() => onNavigate(homePath({ role, status: profile?.status ?? 'active' }))}
          aria-label="AuditX home"
          title="AuditX"
          className="shrink-0 rounded-lg transition-opacity hover:opacity-90"
        >
          <AuditXMark size="sm" />
        </button>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-100" title={title}>{title}</p>
          <p className="hidden text-xs text-slate-400 sm:block">Legal Metrology Suite</p>
        </div>
      </div>

{recPath && (
        <div className="relative ml-auto hidden max-w-sm flex-1 md:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input
            ref={searchRef}
            type="search"
            value={globalQuery}
            onChange={(e) => {
              const v = e.target.value
              onGlobalQuery(v)
              onNavigate(`${recPath}${v.trim() ? `?q=${encodeURIComponent(v.trim())}` : ''}`)
            }}
            placeholder="Search records…"
            aria-label="Global search"
            className="h-9 w-full rounded-lg border border-slate-200 bg-slate-100/70 pl-9 pr-12 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition-all focus:border-transparent focus:bg-white focus:shadow-glow-sm focus:ring-2 focus:ring-accent-500 dark:border-white/10 dark:bg-navy-900/70 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:bg-navy-900"
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-400 lg:block dark:border-white/10 dark:bg-navy-900">
            ⌘K
          </kbd>
        </div>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <button
          onClick={onCycleTheme}
          aria-label={`Switch theme (currently ${resolvedDark ? 'dark' : 'light'})`}
          title={`Theme: ${theme} (${resolvedDark ? 'dark' : 'light'})`}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/10"
        >
          {resolvedDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>

        <Dropdown
          width="w-[min(20rem,calc(100vw-2rem))]"
          trigger={
            <button
              aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
              className={cn(
                'relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/10',
                unread > 0 && 'text-brand-600 dark:text-brand-300',
              )}
            >
              {unread > 0 ? <BellRing className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-rose-600 px-1 text-[10px] font-bold text-white shadow-sm">
                  {unread}
                </span>
              )}
            </button>
          }
        >
          <NotificationsPanel notifications={notifications} onMarkAll={onMarkAll} onMarkOne={onMarkOne} />
        </Dropdown>

        <Dropdown
          width="w-[min(16rem,calc(100vw-2rem))]"
          trigger={
            <button
              aria-label={`Account menu for ${profile?.name ?? 'user'}`}
              className="flex h-9 items-center gap-2 rounded-lg pr-1.5 transition-colors hover:bg-slate-100 dark:hover:bg-white/10 sm:pr-2"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 via-brand-600 to-brand-800 text-xs font-bold text-white shadow-sm ring-1 ring-white/40 dark:ring-white/10">
                {initials}
              </span>
              <span className="hidden text-left sm:block">
                <span className="block max-w-[140px] truncate text-sm font-semibold leading-tight text-slate-900 dark:text-slate-100">
                  {profile?.name ?? 'User'}
                </span>
                <span className="block text-[11px] leading-tight text-slate-400">{roleLabel(role)}</span>
              </span>
            </button>
          }
        >
          <MenuHeader>Signed in as {profile?.email ?? '—'}</MenuHeader>
          <MenuItem icon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => onNavigate(profilePath(role))}>
            Profile & account
          </MenuItem>
          <MenuItem icon={<HelpCircle className="h-4 w-4" />} onClick={() => onNavigate('/help')}>
            Help & support
          </MenuItem>
          <MenuDivider />
          <MenuItem icon={<LogOut className="h-4 w-4" />} danger onClick={() => setLogoutOpen(true)}>
            Log out
          </MenuItem>
        </Dropdown>
      </div>

      <ConfirmDialog
        open={logoutOpen}
        onClose={() => setLogoutOpen(false)}
        title="Log out"
        message="You will be signed out of AuditX."
        confirmLabel="Log out"
        onConfirm={() => {
          setLogoutOpen(false)
          onLogout()
          toast('info', 'Signed out', 'See you soon!')
        }}
      />
    </header>
  )
}