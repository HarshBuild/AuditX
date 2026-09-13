import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../../utils/format'

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
}

const base =
  'inline-flex items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap transition-all duration-150 focus-visible:outline-none disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]'

const variants: Record<Variant, string> = {
  primary:
    'bg-gradient-to-br from-brand-500 via-brand-600 to-brand-700 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.15),0_4px_14px_-4px_rgb(37_99_235/0.5)] hover:from-brand-500 hover:via-brand-600 hover:to-brand-800 hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.15),0_6px_22px_-4px_rgb(37_99_235/0.6)] active:from-brand-600 active:via-brand-700 active:to-brand-800',
  secondary:
    'bg-navy-900 text-white shadow-sm hover:bg-navy-800 active:bg-navy-950 dark:bg-white/[0.92] dark:text-navy-950 dark:hover:bg-white',
  outline:
    'border border-slate-300 bg-white/70 text-slate-700 shadow-sm hover:border-slate-400 hover:bg-white dark:border-white/15 dark:bg-transparent dark:text-slate-200 dark:hover:border-white/25 dark:hover:bg-white/[0.06]',
  ghost:
    'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-white/10',
  danger: 'bg-gradient-to-br from-rose-500 to-rose-600 text-white shadow-sm hover:from-rose-600 hover:to-rose-700 active:from-rose-700 active:to-rose-800',
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-11 px-5 text-sm',
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  ),
)

Button.displayName = 'Button'

export default Button