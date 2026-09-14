import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../utils/format'

interface DropdownProps {
  trigger: ReactNode
  children: ReactNode
  align?: 'left' | 'right'
  width?: string
  panelClassName?: string
}

export default function Dropdown({
  trigger,
  children,
  align = 'right',
  width = 'w-64',
  panelClassName,
}: DropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((v) => !v)}>{trigger}</div>
      {open && (
        <div
          role="menu"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('[role="menuitem"]')) setOpen(false)
          }}
          className={cn(
            'absolute z-dropdown mt-2 origin-top-right animate-slide-in overflow-hidden rounded-xl border border-line bg-surface/95 shadow-overlay-lg ring-1 ring-line/80 backdrop-blur-xl dark:border-navy-700 dark:bg-navy-900/95 dark:ring-white/5',
            align === 'right' ? 'right-0' : 'left-0',
            width,
            panelClassName,
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}

export function MenuItem({
  icon,
  children,
  onClick,
  danger,
}: {
  icon?: ReactNode
  children: ReactNode
  onClick?: () => void
  danger?: boolean
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium transition-colors',
        danger
          ? 'text-danger-600 hover:bg-danger-50 dark:text-danger-500 dark:hover:bg-danger-500/10'
          : 'text-ink-text hover:bg-slate-100 dark:text-navy-200 dark:hover:bg-white/10',
      )}
    >
      {icon}
      <span className="flex-1">{children}</span>
    </button>
  )
}

export function MenuHeader({ children }: { children: ReactNode }) {
  return (
    <div className="border-b border-slate-100 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-text-faint dark:border-navy-700/60">
      {children}
    </div>
  )
}

export function MenuDivider() {
  return <div className="my-1 h-px bg-slate-100 dark:bg-navy-700/60" />
}