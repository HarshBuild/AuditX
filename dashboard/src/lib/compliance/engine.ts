/**
 * Deterministic Legal Metrology compliance engine.
 *
 * Pipeline: scanner -> OCR/Gemini (extraction.ts) -> structured data ->
 * context detection (context.ts) -> rule applicability (rules.ts) ->
 * per-rule evaluation -> verdict + evidence (result.ts).
 *
 * The LLM is never the decision-maker here.
 */
import { detectContext as detect, type PackageContext } from './context'
import { runAllRules, RULES } from './rules'
import { computeCompliance, buildAssistant } from './result'
import type { ComplianceSummary, EngineInputs, RuleCheck } from './types'

export * from './types'
export { RULES }
export { detectContext } from './context'

export interface ComplianceOutcome {
  context: PackageContext
  rules: RuleCheck[]
  summary: ComplianceSummary
  assistant: { summary: string; suggestions: string[] }
}

export function runComplianceEngine(d: EngineInputs): ComplianceOutcome {
  const context = detect(d)
  const rules = runAllRules(context, d)
  const summary = computeCompliance(rules, d.uncertain.length)
  const assistant = buildAssistant(summary, exToRecord(d.ex), d.userProductName, d.languages)
  return { context, rules, summary, assistant }
}

function exToRecord(ex: EngineInputs['ex']): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const k of Object.keys(ex) as Array<keyof typeof ex>) out[k] = ex[k]
  return out
}