import { type CSSProperties } from 'react'
import { cn } from '../../utils/format'

const sizes = {
  sm: 'h-7 w-7 text-2xs',
  md: 'h-9 w-9 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-16 w-16 text-lg',
}

const gradients = [
  'from-brand-500 via-brand-600 to-brand-800',
  'from-indigo-500 via-brand-600 to-accent-700',
  'from-accent-500 via-brand-600 to-brand-900',
  'from-brand-400 via-brand-600 to-indigo-800',
]

function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return '?'
  const letters = words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '')
  return letters.join('')
}

export interface AvatarProps {
  name: string
  src?: string
  size?: keyof typeof sizes
  ring?: boolean
  className?: string
  style?: CSSProperties
  'aria-label'?: string
}

export default function Avatar({
  name,
  src,
  size = 'md',
  ring = true,
  className,
  style,
  'aria-label': ariaLabel,
}: AvatarProps) {
  const gradIndex = Array.from(name).reduce((acc, ch) => acc + (ch.charCodeAt(0) || 0), 0) % gradients.length
  return (
    <span
      aria-label={ariaLabel ?? name}
      style={style}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold',
        sizes[size],
        ring && 'ring-1 ring-white/40 dark:ring-white/10',
        src ? 'bg-navy-800 dark:bg-navy-700' : cn('bg-gradient-to-br text-white', gradients[gradIndex]),
        className,
      )}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        initialsOf(name)
      )}
    </span>
  )
}