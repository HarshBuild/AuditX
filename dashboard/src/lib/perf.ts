/*
 * AuditX — per-scan performance instrumentation.
 *
 * Measures the wall-clock duration of every pipeline stage at its real seam:
 *   preprocessing → upload → OCR → AI analysis → validation → database save
 * and prints actual durations to the console (dev logs) so the targets in the
 * performance budget can be verified. There are no artificial delays or fake
 * progress counts — every number comes from performance.now() around the real
 * work, and the per-stage logs are printed on the console immediately so a
 * single scan shows its per-stage and total durations.
 */

export interface PerfStamp {
  label: string
  ms: number
}

export function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`
}

export class PerfRun {
  private readonly stamps: PerfStamp[] = []
  private readonly marks: Record<string, number> = {}
  readonly name: string

  constructor(name: string) {
    this.name = name
  }

  /** Record a wall-clock mark (used with `segment` for elapsed spans). */
  mark(label: string): void {
    this.marks[label] = performance.now()
  }

  /** Record the elapsed time between two marks as a named stage. */
  segment(from: string, to: string, label: string): void {
    const a = this.marks[from]
    const b = this.marks[to]
    if (a == null || b == null || b < a) return
    this.add(label, b - a)
  }

  add(label: string, ms: number): void {
    this.stamps.push({ label, ms })
    console.info(`[perf] ${this.name} · ${label} ${fmtMs(ms)}`)
  }

  async timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now()
    try {
      return await fn()
    } finally {
      this.add(label, performance.now() - t0)
    }
  }

  timedSync<T>(label: string, fn: () => T): T {
    const t0 = performance.now()
    try {
      return fn()
    } finally {
      this.add(label, performance.now() - t0)
    }
  }

  /** Print the consolidated summary, every stage plus the measured total. */
  summary(): void {
    const totalMs = this.stamps.reduce((sum, m) => sum + m.ms, 0)
    const body = this.stamps.length
      ? this.stamps.map((m) => `${m.label}=${fmtMs(m.ms)}`).join(' → ')
      : '(no stages measured)'
    console.info(`[perf] ${this.name} · stages ${this.stamps.length} · time ${fmtMs(totalMs)} | ${body}`)
  }
}

/** Time a stage through a PerfRun when one is available, otherwise run bare. */
export function tim<T>(perf: PerfRun | null | undefined, label: string, fn: () => Promise<T>): Promise<T> {
  return perf ? perf.timed(label, fn) : fn()
}

/** Sync twin of `tim` for CPU-bound stages (e.g. the compliance engine). */
export function timSync<T>(perf: PerfRun | null | undefined, label: string, fn: () => T): T {
  return perf ? perf.timedSync(label, fn) : fn()
}