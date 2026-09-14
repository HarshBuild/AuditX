import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '../../utils/format'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

const sizes = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-modal flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-navy-950/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Dialog'}
        tabIndex={-1}
        className={cn(
          'relative w-full rounded-t-modal bg-surface shadow-overlay-lg ring-1 ring-line/80 animate-slide-in outline-none sm:rounded-modal dark:bg-navy-900 dark:ring-white/10',
          sizes[size],
          'max-h-[92vh] flex flex-col overflow-hidden',
        )}
      >
        {(title || description) && (
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6 dark:border-navy-700/60">
            <div className="min-w-0">
              {title && <h2 className="text-lg font-bold text-ink-text dark:text-navy-50">{title}</h2>}
              {description && (
                <p className="mt-0.5 text-sm text-ink-text-soft dark:text-navy-300">{description}</p>
              )}
            </div>
            <button
              onClick={onClose}
              aria-label="Close dialog"
              className="rounded-control p-1.5 text-ink-text-faint transition-colors hover:bg-slate-100 hover:text-ink-text dark:text-navy-400 dark:hover:bg-white/10 dark:hover:text-navy-200"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-3 border-t border-line bg-surface-secondary px-5 py-4 sm:px-6 dark:border-navy-700/60 dark:bg-navy-950/60">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}