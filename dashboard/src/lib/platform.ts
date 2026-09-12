/*
 * AuditX — platform detection.
 *
 * Safely classifies where the app is running so the UI can adapt without
 * creating separate designs (ONE design system across desktop web, mobile web,
 * installed PWA and the Windows desktop shell).
 *
 *   - Desktop browser  : large viewport, no installability
 *   - Mobile browser   : small viewport
 *   - Installed PWA    : standalone display-mode (Android/iOS/desktop web app)
 *   - Windows app      : Electron / Tauri desktop shell (userAgent or bridge)
 *
 * Detection is best-effort and defensive: every check is optional and fails
 * closed, never throwing.
 */

export type PlatformKind = 'desktop-web' | 'mobile-web' | 'pwa' | 'windows-desktop'

export interface PlatformInfo {
  kind: PlatformKind
  /** True when running inside the packaged Windows desktop shell. */
  isDesktop: boolean
  /** True on small-screen browsers (mobile/tablet). */
  isMobileWeb: boolean
  /** True when installed as a standalone PWA (any OS). */
  isPwa: boolean
  /** True when the browser can host camera capture. */
  canUseCamera: boolean
}

function sniffWindow(): boolean {
  if (typeof window === 'undefined') return false
  const bridge = (window as unknown as { auditxDesktop?: { isDesktop?: boolean } }).auditxDesktop
  if (bridge?.isDesktop) return true
  const ua = navigator.userAgent.toLowerCase()
  // Electron sets a process bridge + userAgent; Tauri sets its own UA.
  const hasTauriBridge = typeof window !== 'undefined' && (
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== undefined ||
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined
  )
  const hasElectronBridge =
    typeof (window as unknown as { process?: { versions?: Record<string, string> } }).process
      ?.versions?.electron === 'string' ||
    navigator.userAgent.includes('Electron')
  return hasElectronBridge || hasTauriBridge || ua.includes('tauri') || ua.includes('auditx-desktop')
}

function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false
  return window.innerWidth < 768
}

/** Singleton computed once — platform characteristics cannot change mid-session. */
let cached: PlatformInfo | null = null

export function platform(): PlatformInfo {
  if (cached) return cached

  const desktopShell = sniffWindow()
  const pwa = isStandalonePwa()
  const mobile = isMobileViewport()
  const kind: PlatformKind = desktopShell ? 'windows-desktop' : pwa ? 'pwa' : mobile ? 'mobile-web' : 'desktop-web'

  cached = {
    kind,
    isDesktop: desktopShell,
    isMobileWeb: mobile && !desktopShell && !pwa,
    isPwa: pwa && !desktopShell,
    canUseCamera: typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function',
  }
  return cached
}

/** Tag <html data-platform="..."> once (used by CSS hooks if ever needed). */
export function applyPlatformTag(): void {
  if (typeof document === 'undefined') return
  const info = platform()
  document.documentElement.dataset.platform = info.kind
}

/** Semantic label for UI copy (no debug strings). */
export function platformLabel(info: PlatformInfo): string {
  switch (info.kind) {
    case 'windows-desktop':
      return 'Windows App'
    case 'pwa':
      return 'App'
    case 'mobile-web':
      return 'Mobile'
    default:
      return 'Web'
  }
}