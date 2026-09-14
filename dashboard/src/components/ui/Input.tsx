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
          <label
            htmlFor={inputId}
            className="mb-1.5 block text-sm font-medium text-ink-text dark:text-navy-200"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          className={cn(
            'h-10 w-full rounded-field border bg-white px-3 text-sm text-ink-text placeholder:text-ink-text-faint transition-colors focus:outline-none focus:ring-2 dark:bg-navy-950 dark:text-navy-100 dark:placeholder:text-navy-400',
            error
              ? 'border-danger-500 focus:border-transparent focus:ring-danger-500'
              : 'border-line focus:border-transparent focus:ring-brand-500 dark:border-white/15',
            className,
          )}
          {...props}
        />
        {hint && !error && (
          <p className="mt-1 text-xs text-ink-text-faint dark:text-navy-400">{hint}</p>
        )}
        {error && <p className="mt-1 text-xs font-medium text-danger-600">{error}</p>}
      </div>
    )
  },
)

Input.displayName = 'Input'

export default Input