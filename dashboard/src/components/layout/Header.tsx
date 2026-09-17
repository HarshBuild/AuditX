import { useEffect, useRef, useState } from 'react'
import { Bell, BellRing, HelpCircle, LogOut, Menu, Search, SlidersHorizontal, Sun, Moon } from 'lucide-react'
import Dropdown, { MenuDivider, MenuHeader, MenuItem } from '../ui/Dropdown'
import ConfirmDialog from '../ui/ConfirmDialog'
import NotificationsPanel from '../notifications/NotificationsPanel'
import { cn } from '../../utils/format'
import { useToast } from '../ui/Toast'
import { useLanguage } from '../../i18n/LanguageContext'
import type { DictKey } from '../../i18n/en'
import { roleLabel, homePath, type Role, type UserProfile } from '../../lib/rbac'
import { AuditXMark } from '../brand/AuditXMark'
import Avatar from '../ui/Avatar'

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

/** Route path → translatable title key (falls back to PAGE_TITLES English). */
const PAGE_TITLE_KEYS: Record<string, DictKey> = {
  '/user-dashboard': 'title.dashboard',
  '/scan-product': 'title.scanProduct',
  '/scan-history': 'title.scanHistory',
  '/my-reports': 'title.myReports',
  '/profile': 'title.profile',
  '/settings': 'title.settings',
  '/notifications': 'title.notifications',
  '/help': 'title.help',
  '/inspector-dashboard': 'title.inspector',
  '/admin/scans': 'title.adminScans',
  '/admin/violations': 'title.adminViolations',
  '/admin/reports': 'title.adminReports',
  '/admin/evidence': 'title.adminEvidence',
  '/admin/manufacturers': 'title.adminManufacturers',
  '/admin/products': 'title.adminProducts',
  '/admin/users': 'title.users',
  '/admin/analytics': 'title.adminAnalytics',
  '/admin/settings': 'title.adminSettings',
  '/admin-dashboard': 'title.adminDashboard',
  '/super-admin-dashboard': 'title.superAdmin',
  '/admin-requests': 'title.adminRequests',
  '/admin-management': 'title.adminManagement',
  '/users': 'title.users',
  '/compliance-rules': 'title.complianceRules',
  '/activity-logs': 'title.activityLogs',
  '/system-settings': 'title.systemSettings',
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
  const { lang, setLang, t } = useLanguage()
  const [logoutOpen, setLogoutOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const navTimer = useRef<number | null>(null)
  const unread = notifications.filter((n) => n.unread).length

  const titleKey = PAGE_TITLE_KEYS[path]
  const title = titleKey ? t(titleKey) : pageTitle(path)
  const role: Role = profile?.role ?? 'user'
  const recPath = recordsPath(role)

  useEffect(() => {
    return () => {
      if (navTimer.current) window.clearTimeout(navTimer.current)
    }
  }, [])

  /** Update the search field instantly, but debounce the URL navigation so
   * typing doesn't spam history entries or re-trigger list loads per key. */
  const onSearchChange = (v: string) => {
    onGlobalQuery(v)
    if (navTimer.current) window.clearTimeout(navTimer.current)
    const target = `${recPath}${v.trim() ? `?q=${encodeURIComponent(v.trim())}` : ''}`
    navTimer.current = window.setTimeout(() => onNavigate(target), 350)
  }

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
    <header className="sticky top-0 z-header flex h-12 items-center gap-1.5 border-b border-line bg-surface/80 px-3 backdrop-blur-xl sm:h-14 sm:gap-3 sm:px-6 dark:border-navy-700/60 dark:bg-navy-950/70">

      <button
        onClick={onMenu}
        aria-label="Open navigation menu"
        className="flex h-9 w-9 items-center justify-center rounded-control text-ink-text-soft transition-colors hover:bg-slate-100 lg:hidden dark:text-navy-300 dark:hover:bg-white/10"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={() => onNavigate(homePath({ role, status: profile?.status ?? 'active' }))}
          aria-label="AuditX home"
          title="AuditX"
          className="shrink-0 rounded-control transition-opacity hover:opacity-90"
        >
          <AuditXMark size="sm" />
        </button>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-bold text-ink-text dark:text-navy-50" title={title}>{title}</p>
          <p className="hidden text-xs text-ink-text-faint sm:block dark:text-navy-400">{t('header.suite')}</p>
        </div>
      </div>

{recPath && (
        <div className="relative ml-auto hidden max-w-sm flex-1 md:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-text-faint dark:text-navy-400" />
          <input
            ref={searchRef}
            type="search"
            value={globalQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('header.searchPlaceholder')}
            aria-label={t('header.searchLabel')}
            className="h-10 w-full rounded-field border border-line bg-surface-secondary pl-9 pr-12 text-sm text-ink-text placeholder:text-ink-text-faint shadow-sm transition-all focus:border-transparent focus:bg-white focus:shadow-glow-sm focus:ring-2 focus:ring-brand-500 dark:border-white/10 dark:bg-navy-900/70 dark:text-navy-100 dark:placeholder:text-navy-400 dark:focus:bg-navy-900"
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-control border border-line bg-surface px-1.5 py-0.5 text-2xs font-medium text-ink-text-faint lg:block dark:border-white/10 dark:bg-navy-900 dark:text-navy-400">
            ⌘K
          </kbd>
        </div>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <div
          role="group"
          aria-label={t('header.langLabel')}
          className="flex h-9 items-center rounded-control border border-line text-xs font-bold dark:border-white/10"
        >
          {(['en', 'hi'] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              aria-pressed={lang === l}
              title={t('header.langLabel')}
              className={`h-full rounded-control px-2 transition-colors ${
                lang === l
                  ? 'bg-brand-500 text-white'
                  : 'text-ink-text-soft hover:bg-slate-100 dark:text-navy-300 dark:hover:bg-white/10'
              }`}
            >
              {l === 'en' ? 'EN' : 'हिं'}
            </button>
          ))}
        </div>
        <button
          onClick={onCycleTheme}
          aria-label={`Switch theme (currently ${resolvedDark ? 'dark' : 'light'})`}
          title={`Theme: ${theme} (${resolvedDark ? 'dark' : 'light'})`}
          className="flex h-9 w-9 items-center justify-center rounded-control text-ink-text-soft transition-colors hover:bg-slate-100 dark:text-navy-300 dark:hover:bg-white/10"
        >
          {resolvedDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>

        <Dropdown
          width="w-[min(20rem,calc(100vw-2rem))]"
          trigger={
            <button
              aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
              className={cn(
                'relative flex h-9 w-9 items-center justify-center rounded-control text-ink-text-soft transition-colors hover:bg-slate-100 dark:text-navy-300 dark:hover:bg-white/10',
                unread > 0 && 'text-brand-600 dark:text-brand-300',
              )}
            >
              {unread > 0 ? <BellRing className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gradient-to-br from-danger-500 to-danger-600 px-1 text-2xs font-bold text-white shadow-sm">
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
              className="flex h-9 items-center gap-2 rounded-control pr-1.5 transition-colors hover:bg-slate-100 dark:hover:bg-white/10 sm:pr-2"
            >
              <Avatar name={profile?.name ?? 'User'} size="md" ring />
              <span className="hidden text-left sm:block">
                <span className="block max-w-[140px] truncate text-sm font-semibold leading-tight text-ink-text dark:text-navy-50">
                  {profile?.name ?? 'User'}
                </span>
                <span className="block text-[11px] leading-tight text-ink-text-faint">{roleLabel(role)}</span>
              </span>
            </button>
          }
        >
          <MenuHeader>{t('header.signedInAs')} {profile?.email ?? '—'}</MenuHeader>
          <MenuItem icon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => onNavigate(profilePath(role))}>
            {t('header.profileAccount')}
          </MenuItem>
          <MenuItem icon={<HelpCircle className="h-4 w-4" />} onClick={() => onNavigate('/help')}>
            {t('header.helpSupport')}
          </MenuItem>
          <MenuDivider />
          <MenuItem icon={<LogOut className="h-4 w-4" />} danger onClick={() => setLogoutOpen(true)}>
            {t('header.logout')}
          </MenuItem>
        </Dropdown>
      </div>

      <ConfirmDialog
        open={logoutOpen}
        onClose={() => setLogoutOpen(false)}
        title={t('header.logoutTitle')}
        message={t('header.logoutMsg')}
        confirmLabel={t('header.logout')}
        onConfirm={() => {
          setLogoutOpen(false)
          onLogout()
          toast('info', t('header.signedOut'), t('header.signedOutMsg'))
        }}
      />
    </header>
  )
}