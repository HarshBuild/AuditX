import { useCallback, useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate, useOutletContext } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import MobileNav from './MobileNav'
import { useToast } from '../ui/Toast'
import { useTheme, type ThemeMode } from '../../hooks/useTheme'
import { useNotifications } from '../../hooks/useNotifications'
import { useAuth } from '../../lib/auth'
import type { AppNotification } from '../../types'

export interface WorkspaceContextValue {
  globalQuery: string
  onGlobalQuery: (q: string) => void
  notifications: AppNotification[]
  onMarkAll: () => void
  onMarkOne: (id: string) => void
  themeMode: ThemeMode
  setThemeMode: (m: ThemeMode) => void
  openScanner: () => void
}

export function useWorkspace(): WorkspaceContextValue {
  return useOutletContext<WorkspaceContextValue>()
}

export default function Workspace() {
  const { toast } = useToast()
  const theme = useTheme()
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [globalQuery, setGlobalQuery] = useState('')

  // Apply the user's content-density preference app-wide.
  useEffect(() => {
    const density = (profile?.prefs ?? { density: 'comfortable' }).density
    document.documentElement.dataset.density = density
    return () => {
      delete document.documentElement.dataset.density
    }
  }, [profile?.prefs])

  const realtimeNotifications = useNotifications({ enabled: profile?.prefs?.notifications !== false })

  const markOne = useCallback((id: string) => {
    realtimeNotifications.markOne(id)
  }, [realtimeNotifications])

  const markAll = useCallback(() => {
    realtimeNotifications.markAll()
  }, [realtimeNotifications])

  // Firestore (realtime) notification feed.
  const feed = realtimeNotifications.items

  const openScanner = useCallback(() => {
    navigate('/scan-product')
  }, [navigate])

  const trip = useCallback(
    (p: string) => {
      navigate(p)
      setMobileOpen(false)
    },
    [navigate],
  )

  const ctx = useMemo<WorkspaceContextValue>(
    () => ({
      globalQuery,
      onGlobalQuery: setGlobalQuery,
      notifications: feed,
      onMarkAll: markAll,
      onMarkOne: markOne,
      themeMode: theme.mode,
      setThemeMode: theme.setMode,
      openScanner,
    }),
    [globalQuery, feed, markAll, markOne, theme.mode, theme.setMode, openScanner],
  )

  const logout = useCallback(async () => {
    await signOut()
  }, [signOut])

  void toast

  return (
    <div className="flex min-h-screen">
      <div aria-hidden="true" className="animated-bg" />
      <Sidebar
        path={pathname}
        onNavigate={trip}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        role={profile?.role ?? 'user'}
        onLogout={() => void logout()}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          path={pathname}
          onMenu={() => setMobileOpen(true)}
          theme={theme.mode}
          resolvedDark={theme.resolved === 'dark'}
          onCycleTheme={theme.toggle}
          notifications={feed}
          onMarkAll={markAll}
          onMarkOne={markOne}
          onNavigate={trip}
          globalQuery={globalQuery}
          onGlobalQuery={setGlobalQuery}
          profile={profile}
          onLogout={() => void logout()}
        />

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
          <div key={pathname} className="animate-page-in">
            <Outlet context={ctx} />
          </div>
        </main>

        <footer className="px-3 pb-24 pt-4 text-center text-xs text-ink-text-faint sm:px-6 lg:px-8 lg:pb-6 dark:text-white/35">
          AuditX · Legal Metrology compliance dashboard · Role-Based Edition
        </footer>
      </div>

      <MobileNav
        path={pathname}
        onNavigate={trip}
        onAdd={openScanner}
        role={profile?.role ?? 'user'}
      />
    </div>
  )
}