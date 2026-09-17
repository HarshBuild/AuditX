import { Navigate, Route, Routes, Outlet, useOutletContext } from 'react-router-dom'
import { PublicOnly, RequireAuth, RequireRole, FullPageLoader } from '../components/auth/guards'
import Workspace from '../components/layout/Workspace'
import LandingPage from '../components/pages/LandingPage'
import LoginPage from '../components/pages/LoginPage'
import SignupPage from '../components/pages/SignupPage'
import ProfilePage from '../components/pages/ProfilePage'
import SettingsPage from '../components/pages/SettingsPage'
import HelpPage from '../components/pages/HelpPage'
import NotificationsPage from '../components/pages/NotificationsPage'
import UserDashboardPage from '../components/pages/UserDashboardPage'
import ScanProductPage from '../components/pages/ScanProductPage'
import ScanResultPage from '../components/pages/ScanResultPage'
import AccuracyPage from '../components/pages/AccuracyPage'
import RecordsPage from '../components/pages/RecordsPage'
import ReportsPage from '../components/pages/ReportsPage'
import {
  AdminPendingPage,
  BlockedPage,
  NotFoundPage,
  UnauthorizedPage,
} from '../components/pages/StatusPages'
import {
  AdminDashboardPage,
  SuperAdminDashboardPage,
} from '../components/pages/RoleDashboards'
import InspectorDashboardPage from '../components/pages/InspectorDashboardPage'
import AdminScansPage from '../components/pages/AdminScansPage'
import { ViolationsPage, ManufacturersPage } from '../components/pages/AdminPages'
import AdminAnalyticsPage from '../components/pages/AdminAnalyticsPage'
import AdminReportsPage from '../components/pages/AdminReportsPage'
import ProductDatabasePage from '../components/pages/ProductDatabasePage'
import EvidencePage from '../components/pages/EvidencePage'
import {
  AdminRequestsPage,
  AdminManagementPage,
  UsersPage,
  ComplianceRulesPage,
  ActivityLogsPage,
  SystemSettingsPage,
} from '../components/pages/SuperAdminPages'
import { useAuth } from '../lib/auth'
import { homePath } from '../lib/rbac'
import { useWorkspace } from '../components/layout/Workspace'

/* ------------------------------------------------------------------ */
/* View wrappers — bridge workspace context into existing pages        */
/* ------------------------------------------------------------------ */

function UserDashboardView() {
  return <UserDashboardPage />
}

function ScanHistoryView() {
  return <RecordsPage />
}

function MyReportsView() {
  return <ReportsPage />
}

function ProfileView() {
  return <ProfilePage />
}

function NotificationsView() {
  const { notifications, onMarkAll, onMarkOne } = useWorkspace()
  return <NotificationsPage notifications={notifications} onMarkAll={onMarkAll} onMarkOne={onMarkOne} />
}

function SettingsView() {
  const { themeMode, setThemeMode } = useWorkspace()
  return <SettingsPage mode={themeMode} setMode={setThemeMode} />
}

function HelpView() {
  return <HelpPage />
}

function AdminScansView() {
  return <AdminScansPage />
}

function AdminViolationsView() {
  return <ViolationsPage />
}

function AdminReportsView() {
  return <AdminReportsPage />
}

function AdminManufacturersView() {
  return <ManufacturersPage />
}

function AdminProductsView() {
  return <ProductDatabasePage />
}

function AdminUsersView() {
  return <UsersPage />
}

function AdminAnalyticsView() {
  return <AdminAnalyticsPage />
}

function AdminSettingsView() {
  const { themeMode, setThemeMode } = useWorkspace()
  return <SettingsPage mode={themeMode} setMode={setThemeMode} />
}

function InspectorDashboardView() {
  return <InspectorDashboardPage />
}

function InspectorEvidenceView() {
  return <EvidencePage />
}

function SuperAdminDashboardView() {
  return <SuperAdminDashboardPage />
}

function AdminRequestsView() {
  return <AdminRequestsPage />
}

function AdminManagementView() {
  return <AdminManagementPage />
}

function UsersView() {
  return <UsersPage />
}

function ComplianceRulesView() {
  return <ComplianceRulesPage />
}

function ActivityLogsView() {
  return <ActivityLogsPage />
}

function SystemSettingsView() {
  return <SystemSettingsPage />
}

/* ------------------------------------------------------------------ */
/* Role-based home redirect + 404                                      */
/* ------------------------------------------------------------------ */

function RoleHome() {
  const { profile } = useAuth()
  const home = profile ? homePath(profile) : '/login'
  return <Navigate to={home} replace />
}

function NotFoundView() {
  return <NotFoundPage />
}

function UnauthorizedView() {
  return <UnauthorizedPage />
}

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

function PublicGate() {
  return (
    <PublicOnly>
      <Outlet />
    </PublicOnly>
  )
}

/** Public home — premium hero landing; authenticated users go to their home path. */
function LandingGate() {
  const { user, profile, loading } = useAuth()
  if (loading) return <FullPageLoader />
  if (user && profile) return <Navigate to={homePath(profile)} replace />
  return <LandingPage />
}

function AuthGate({ children }: { children?: React.ReactNode }) {
  return <RequireAuth>{children ?? <Outlet />}</RequireAuth>
}

function UserGate() {
  const ctx = useOutletContext()
  return (
    <RequireRole roles={['user']}>
      <Outlet context={ctx} />
    </RequireRole>
  )
}

/** Super Admin — the ONLY operator role (staff + admin + super admin merged). */
function SuperAdminGate() {
  const ctx = useOutletContext()
  return (
    <RequireRole roles={['super_admin']}>
      <Outlet context={ctx} />
    </RequireRole>
  )
}

function SharedGate() {
  const ctx = useOutletContext()
  return (
    <RequireRole roles={['user', 'super_admin']}>
      <Outlet context={ctx} />
    </RequireRole>
  )
}

/* ------------------------------------------------------------------ */
/* Route tree                                                          */
/* ------------------------------------------------------------------ */

export default function AppRoutes() {
  return (
    <Routes>
      {/* Public landing + auth */}
      <Route path="/" element={<LandingGate />} />
      <Route element={<PublicGate />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
      </Route>

      {/* Authenticated, account-status gates (no app shell) */}
      <Route element={<AuthGate />}>
        <Route path="/blocked" element={<BlockedPage />} />
        <Route path="/admin-pending" element={<AdminPendingPage />} />
      </Route>

      {/* Authenticated, full app shell (sidebar/header/mobile nav) */}
      <Route
        element={
          <AuthGate>
            <Workspace />
          </AuthGate>
        }
      >
        <Route index element={<RoleHome />} />

        {/* USER (Consumer) */}
        <Route element={<UserGate />}>
          <Route path="/user-dashboard" element={<UserDashboardView />} />
          <Route path="/scan-history" element={<ScanHistoryView />} />
          <Route path="/my-reports" element={<MyReportsView />} />
        </Route>

        {/* SUPER ADMIN — the ONLY operator role (inspector + admin + super admin merged) */}
        <Route element={<SuperAdminGate />}>
          <Route path="/super-admin-dashboard" element={<SuperAdminDashboardView />} />
          <Route path="/inspector-dashboard" element={<InspectorDashboardView />} />
          <Route path="/admin/scans" element={<AdminScansView />} />
          <Route path="/admin/violations" element={<AdminViolationsView />} />
          <Route path="/admin/evidence" element={<InspectorEvidenceView />} />
          <Route path="/admin-dashboard" element={<AdminDashboardPage />} />
          <Route path="/admin/reports" element={<AdminReportsView />} />
          <Route path="/admin/manufacturers" element={<AdminManufacturersView />} />
          <Route path="/admin/products" element={<AdminProductsView />} />
          <Route path="/admin/users" element={<AdminUsersView />} />
          <Route path="/admin/analytics" element={<AdminAnalyticsView />} />
          <Route path="/admin/settings" element={<AdminSettingsView />} />
          <Route path="/admin-requests" element={<AdminRequestsView />} />
          <Route path="/admin-management" element={<AdminManagementView />} />
          <Route path="/users" element={<UsersView />} />
          <Route path="/compliance-rules" element={<ComplianceRulesView />} />
          <Route path="/activity-logs" element={<ActivityLogsView />} />
          <Route path="/system-settings" element={<SystemSettingsView />} />
        </Route>

        {/* SHARED (any active account) */}
        <Route element={<SharedGate />}>
          <Route path="/notifications" element={<NotificationsView />} />
          <Route path="/help" element={<HelpView />} />
          <Route path="/scan-product" element={<ScanProductPage />} />
          <Route path="/scan-result/:id" element={<ScanResultPage />} />
          <Route path="/accuracy" element={<AccuracyPage />} />
          <Route path="/profile" element={<ProfileView />} />
          <Route path="/settings" element={<SettingsView />} />
        </Route>

        <Route path="/unauthorized" element={<UnauthorizedView />} />
        <Route path="*" element={<NotFoundView />} />
      </Route>

      <Route path="*" element={<NotFoundView />} />
    </Routes>
  )
}
