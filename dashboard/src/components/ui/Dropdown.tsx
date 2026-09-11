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
            'absolute z-40 mt-2 origin-top-right animate-slide-in overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lifted dark:border-slate-800 dark:bg-slate-900',
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
          ? 'text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10'
          : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800',
      )}
    >
      {icon}
      <span className="flex-1">{children}</span>
    </button>
  )
}

export function MenuHeader({ children }: { children: ReactNode }) {
  return (
    <div className="border-b border-slate-100 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800">
      {children}
    </div>
  )
}

export function MenuDivider() {
  return <div className="my-1 h-px bg-slate-100 dark:bg-slate-800" />
}