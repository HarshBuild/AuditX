/**
 * Rule-based assistant briefing for an inspection result (deterministic, no
 * LLM call). Every conclusion is derived from the compliance findings and the
 * OCR confidence — the user sees where each statement comes from.
 */

import type { Briefing, ComplianceResult, InspectionStatus } from './types.js'

const HEADLINE: Record<InspectionStatus, string> = {
  needs_review: 'Some label details could not be read confidently — a quick manual look is enough to finish the check.',
  compliant: 'The declared label information satisfies the checks run on it.',
  violation: 'One or more mandatory declarations appear to be missing or invalid.',
  critical: 'A critical issue was found (for example an expired product or missing mandatory declarations).',
}

const PURPOSE =
  'Consumer product-label compliance assistant — reads the label you photographed and checks it against the applicable Indian labelling requirements (Legal Metrology Packaged Commodities Rules, 2011 and FSSAI labelling regulations for food).'

export function buildBriefing(
  compliance: ComplianceResult,
  opts: { provider: string; demo: boolean; categoryOutcome: string | null; missingCategories?: string },
): Briefing {
  const { findings, status, overall_score } = compliance
  const failed = findings.filter((f) => f.status === 'failed' || f.status === 'critical_failed')
  const review = findings.filter((f) => f.status === 'needs_review')

  const keyPoints: string[] = []
  for (const f of failed.slice(0, 3)) {
    keyPoints.push(`${f.label}: ${f.explanation ?? 'not detected.'}${f.hint ? ` (${f.hint})` : ''}`)
  }
  for (const f of review.slice(0, 2)) {
    if (keyPoints.length >= 4) break
    keyPoints.push(`${f.label}: ${f.explanation ?? 'could not be verified.'}${f.hint ? ` (${f.hint})` : ''}`)
  }
  if (keyPoints.length === 0) {
    keyPoints.push(`All ${findings.length} applicable label checks passed.`)
  }

  const recommendations: string[] = []
  if (failed.some((f) => f.status === 'critical_failed')) {
    recommendations.push('Do not consume/use this product until the date check is verified on the physical label.')
  }
  if (status === 'violation' || status === 'critical') {
    recommendations.push('Keep the label photo and consider reporting it to the platform inspector for a formal review.')
  }
  if (review.length > 0) {
    recommendations.push('Re-photograph the unclear areas (or retake with better lighting) so every field can be verified.')
  }
  recommendations.push('This is an automated summary of the visible label text — it is not a legal certification.')
  if (opts.demo) {
    recommendations.unshift('Demo mode: the analysis runs on the details you typed, not real OCR. Set OCR_PROVIDER=gemini (or paddle) on the backend and retry for a real label reading.')
  }

  const summary = `${compliance.summary} ${
    opts.demo
      ? '(Demo provider — values echo your typed details.)'
      : opts.categoryOutcome
        ? `Category: ${opts.categoryOutcome}`
        : ''
  }`.trim()

  return {
    purpose: PURPOSE,
    summary: `${overall_score}/100 — ${HEADLINE[status]}`,
    key_points: keyPoints,
    recommendations,
    assistant_status: opts.demo ? 'demo' : 'ok',
    provider: opts.provider,
  }
}