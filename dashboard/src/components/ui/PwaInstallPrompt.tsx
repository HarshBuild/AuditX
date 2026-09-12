import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, MonitorSmartphone, X } from 'lucide-react'
import { AuditXMark } from '../brand/AuditXMark'
import { useToast } from './Toast'

/**
 * PWA install prompt — a professional bottom-sheet shown once to eligible,
 * first-time mobile visitors. Listens for the browser's `beforeinstallprompt`
 * event (Chrome/Edge/Android), defers to an appropriate moment (after the
 * user has engaged with the page), and remembers dismissals so the notice
 * never nags returning users. Respects `prefers-reduced-motion`.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const DISMISSED_KEY = 'auditx_pwa_install_dismissed'
const INSTALLED_KEY = 'auditx_pwa_install_installed'
const SEEN_KEY = 'auditx_pwa_install_seen'

export default function PwaInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [open, setOpen] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [installed, setInstalled] = useState(false)
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null)
  const timerRef = useRef<number | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Browser must advertise installability (Chrome/Edge/Android).
    const hasSupport = 'onbeforeinstallprompt' in window
    if (!hasSupport) return

    // Already installed as a PWA → no need to ask.
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as { standalone?: boolean }).standalone === true
    if (isStandalone) return

    // Remembered dismissals (and a permanent flag once installed).
    if (localStorage.getItem(INSTALLED_KEY) === '1') return
    if (localStorage.getItem(DISMISSED_KEY) === '1') return

    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      const evt = e as BeforeInstallPromptEvent
      deferredRef.current = evt
      setDeferred(evt)
    }
    const onAppInstalled = () => {
      localStorage.setItem(INSTALLED_KEY, '1')
      setInstalled(true)
      setOpen(false)
      deferredRef.current = null
      setDeferred(null)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onAppInstalled)

    // Trigger at an appropriate moment — a few seconds after a real gesture,
    // never on the raw page load. Only surface when the browser actually
    // fired the install event (i.e. eligibility has been confirmed).
    const onFirstGesture = () => {
      window.removeEventListener('pointerdown', onFirstGesture)
      window.removeEventListener('touchend', onFirstGesture)
      timerRef.current = window.setTimeout(() => {
        if (
          deferredRef.current &&
          localStorage.getItem(SEEN_KEY) !== '1' &&
          localStorage.getItem(DISMISSED_KEY) !== '1' &&
          localStorage.getItem(INSTALLED_KEY) !== '1'
        ) {
          localStorage.setItem(SEEN_KEY, '1')
          setOpen(true)
        }
      }, 6000)
    }
    window.addEventListener('pointerdown', onFirstGesture, { once: true })
    // Touch-only fallback for older engines that don't fire pointerdown.
    window.addEventListener('touchend', onFirstGesture, { once: true })

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onAppInstalled)
      window.removeEventListener('pointerdown', onFirstGesture)
      window.removeEventListener('touchend', onFirstGesture)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [toast])

  const close = () => {
    setOpen(false)
    localStorage.setItem(DISMISSED_KEY, '1')
    deferredRef.current = null
    setDeferred(null)
  }

  const install = async () => {
    const evt = deferredRef.current ?? deferred
    if (!evt) return
    setInstalling(true)
    try {
      await evt.prompt()
      const choice = await evt.userChoice
      if (choice.outcome === 'accepted') {
        localStorage.setItem(INSTALLED_KEY, '1')
        setInstalled(true)
        setOpen(false)
        toast('success', 'AuditX installed', 'Launch it from your home screen for faster access.')
      } else {
        close()
      }
    } catch {
      // Prompt threw (user aborted / browser changed its mind) — treat as dismissal.
      close()
    } finally {
      setInstalling(false)
      setDeferred(null)
      deferredRef.current = null
    }
  }

  if (!open || installed) return null

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px] animate-fade-in"
        onClick={close}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Install AuditX App"
        className="relative w-full max-w-md overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl animate-slide-in sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="bg-gradient-to-br from-brand-800 via-brand-700 to-brand-600 px-5 py-5 text-white">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <AuditXMark size="md" />
              <div>
                <h2 className="text-lg font-bold tracking-tight">Install AuditX App</h2>
                <p className="mt-0.5 text-sm text-brand-100">
                  Get faster access to Legal Metrology inspections.
                </p>
              </div>
            </div>
            <button
              onClick={close}
              aria-label="Close install prompt"
              className="rounded-lg p-1.5 text-brand-100 transition-colors hover:bg-white/15 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="px-5 py-4">
          <ul className="space-y-2.5 text-sm text-slate-600 dark:text-slate-300">
            <li className="flex items-center gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
                <MonitorSmartphone className="h-4 w-4" />
              </span>
              Open AuditX with one tap from your home screen
            </li>
            <li className="flex items-center gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
                <Download className="h-4 w-4" />
              </span>
              Works offline — photos and scans are never blocked by a slow connection
            </li>
            <li className="flex items-center gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
                <X className="h-4 w-4" />
              </span>
              No account changes — your inspections stay in the same secure workspace
            </li>
          </ul>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row">
            <button
              onClick={close}
              className="inline-flex h-11 flex-1 items-center justify-center rounded-lg border border-slate-300 px-5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Not Now
            </button>
            <button
              onClick={() => void install()}
              disabled={installing}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {installing ? 'Installing…' : 'Install App'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}