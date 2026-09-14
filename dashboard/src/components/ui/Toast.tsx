import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { cn } from '../../utils/format'

type ToastKind = 'success' | 'error' | 'info'

interface ToastData {
  id: number
  kind: ToastKind
  title: string
  message?: string
}

interface ToastContextValue {
  toast: (kind: ToastKind, title: string, message?: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

const icons: Record<ToastKind, ReactNode> = {
  success: <CheckCircle2 className="h-5 w-5 text-success-600" />,
  error: <XCircle className="h-5 w-5 text-danger-600" />,
  info: <Info className="h-5 w-5 text-brand-600" />,
}

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (kind: ToastKind, title: string, message?: string) => {
      const id = nextId++
      setToasts((list) => [...list.slice(-3), { id, kind, title, message }])
      window.setTimeout(() => dismiss(id), 4500)
    },
    [dismiss],
  )

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-4 z-toast flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-xl border border-line bg-surface/95 p-3.5 shadow-lg ring-1 ring-line/80 backdrop-blur-xl dark:border-navy-700 dark:bg-navy-900/95 dark:ring-white/5"
          >
            <div className="mt-0.5 shrink-0">{icons[t.kind]}</div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink-text dark:text-navy-50">{t.title}</p>
              {t.message && (
                <p className="mt-0.5 text-xs leading-relaxed text-ink-text-soft dark:text-navy-300">
                  {t.message}
                </p>
              )}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className={cn(
                'shrink-0 rounded-control p-1 text-ink-text-faint transition-colors hover:bg-slate-100 hover:text-ink-text dark:text-navy-400 dark:hover:bg-white/10 dark:hover:text-navy-200',
              )}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}