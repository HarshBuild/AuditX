import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../../utils/format'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className, id, ...props }, ref) => {
    const inputId = id ?? props.name
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          className={cn(
            'h-9 w-full rounded-lg border bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500',
            error
              ? 'border-rose-400 focus:border-transparent focus:ring-rose-500'
              : 'border-slate-300 focus:border-transparent focus:ring-brand-500 dark:border-slate-700',
            className,
          )}
          {...props}
        />
        {hint && !error && <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{hint}</p>}
        {error && <p className="mt-1 text-xs font-medium text-rose-500">{error}</p>}
      </div>
    )
  },
)

Input.displayName = 'Input'

export default Input