/**
 * AuditX — brand logomark + wordmark.
 *
 * The mark is a gradient rounded tile carrying a bold check (a completed
 * audit) with a subtle "X" formed by the crossing strokes. Pair with the
 * "AuditX" wordmark for a full lockup.
 */

export type AuditXSize = 'sm' | 'md' | 'lg'

const TILE: Record<AuditXSize, string> = {
  sm: 'h-8 w-8 rounded-lg',
  md: 'h-11 w-11 rounded-xl',
  lg: 'h-14 w-14 rounded-2xl',
}

const MARK: Record<AuditXSize, { w: string; h: string }> = {
  sm: { w: 'w-4', h: 'h-4' },
  md: { w: 'w-5', h: 'h-5' },
  lg: { w: 'w-7', h: 'h-7' },
}

/** The gradient check-tile mark itself. */
export function AuditXMark({ size = 'md', className = '' }: { size?: AuditXSize; className?: string }) {
  const { w, h } = MARK[size]
  return (
    <div
      aria-hidden="true"
      className={`flex ${TILE[size]} shrink-0 items-center justify-center bg-gradient-to-br from-brand-400 via-brand-600 to-indigo-800 text-white shadow-md ring-1 ring-brand-700/40 ${className}`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={`${w} ${h}`}>
        {/* check mark — the completed audit */}
        <path d="M5 13 L10 18 L19 7" />
        {/* X accent extension from the check vertex */}
        <path d="M14 5.5 C16 5 18 5 18.5 6.5 C19 8 17.5 9.5 16 10.5" className="text-brand-200" />
      </svg>
    </div>
  )
}

/** Full lockup: mark + "AuditX" wordmark (+ optional tagline). */
export function AuditXLockup({
  size = 'md',
  tagline,
  className = '',
}: {
  size?: AuditXSize
  tagline?: string
  className?: string
}) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <AuditXMark size={size} />
      <div className="min-w-0 leading-tight">
        <p className={`px text-slate-900 dark:text-slate-50 ${size === 'sm' ? 'text-sm' : size === 'md' ? 'text-base' : 'text-xl'}`}>
          <span className="font-extrabold tracking-tight">Audit</span>
          <span className={`font-extrabold tracking-tight text-brand-600 dark:text-brand-400 ${size === 'sm' ? 'text-base' : size === 'md' ? 'text-lg' : 'text-2xl'}`}>X</span>
        </p>
        {tagline && <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{tagline}</p>}
      </div>
    </div>
  )
}