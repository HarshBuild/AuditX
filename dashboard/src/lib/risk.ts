/*
 * AuditX v3.0 — Risk engine & AI-style insights.
 *
 * Risk score (0–100) bands:
 *   0–25   Low
 *   26–50  Medium
 *   51–75  High
 *   76–100 Critical
 *
 * When the AI service is unavailable the UI falls back to this rule-based
 * engine, which derives risks purely from stored scan/violation data.
 */

import type { RiskBand, ScanRow, ViolationRow } from './types2'

export interface RiskInsight {
  id: string
  kind: 'product' | 'manufacturer' | 'category' | 'score' | 'violation' | 'trend'
  title: string
  detail: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  link?: string
}

export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, n))
}

/** Compliance score 0–100 → risk score 0–100 (inverse). */
export function complianceToRisk(score: number): number {
  return 100 - clampScore(score)
}

/** Risk score → band label. */
export function riskBand(score: number): RiskBand {
  const s = clampScore(score)
  if (s <= 25) return 'Low'
  if (s <= 50) return 'Medium'
  if (s <= 75) return 'High'
  return 'Critical'
}

/** Add violation-severity penalty on top of the inverse compliance score. */
export function computeRiskScore(score: number, violations: ViolationRow[] = []): number {
  let base = complianceToRisk(score)
  let penalty = 0
  for (const v of violations) {
    if (v.status === 'Rejected' || v.status === 'Resolved') continue
    if (v.severity === 'critical') penalty += 12
    else if (v.severity === 'high') penalty += 8
    else if (v.severity === 'medium') penalty += 5
    else penalty += 2
  }
  const repeated = Math.max(0, violations.length - 2) * 3
  return clampScore(base + penalty + repeated)
}

export function riskTone(band: RiskBand): 'emerald' | 'amber' | 'rose' {
  if (band === 'Low') return 'emerald'
  if (band === 'Medium') return 'amber'
  return 'rose'
}

export function severityNumber(sev: string): number {
  if (sev === 'critical') return 4
  if (sev === 'high') return 3
  if (sev === 'medium') return 2
  return 1
}

export function severityLabel(sev: string): string {
  switch (sev) {
    case 'critical': return 'Critical'
    case 'high': return 'High'
    case 'medium': return 'Medium'
    default: return 'Low'
  }
}

export function severityValue(sev: string): 'low' | 'medium' | 'high' | 'critical' {
  if (sev === 'critical' || sev === 'high' || sev === 'medium') return sev
  return 'low'
}

/**
 * Rule-based fallback insights produced from real stored data.
 * This is what the admin "AI Insights" panel renders when Gemini is offline.
 */
export function generateInsights(scans: ScanRow[], violations: ViolationRow[]): RiskInsight[] {
  const insights: RiskInsight[] = []

  // 1. High-risk products (risk >= High OR compliance score < 50)
  const highRiskScans = scans
    .filter((s) => riskBand(s.risk_score ?? complianceToRisk(s.overall_score)) === 'Critical')
    .slice(0, 4)
  if (highRiskScans.length > 0) {
    insights.push({
      id: 'high-risk-products',
      kind: 'product',
      title: `${highRiskScans.length} critical-risk product${highRiskScans.length > 1 ? 's' : ''} detected`,
      detail: `${highRiskScans.map((s) => s.product_name).slice(0, 3).join(', ')}${highRiskScans.length > 3 ? '…' : ''} require immediate inspection.`,
      severity: highRiskScans.length >= 3 ? 'critical' : 'high',
      link: '/admin/scans?risk=Critical',
    })
  }

  // 2. Manufacturers with repeated violations
  const byManufacturer = new Map<string, number>()
  for (const v of violations) {
    if (v.status === 'Rejected') continue
    const m = v.manufacturer || v.product_name || 'Unknown'
    byManufacturer.set(m, (byManufacturer.get(m) ?? 0) + 1)
  }
  const repeatOffenders = [...byManufacturer.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 4)
  if (repeatOffenders.length > 0) {
    insights.push({
      id: 'repeat-offenders',
      kind: 'manufacturer',
      title: `${repeatOffenders.length} manufacturer${repeatOffenders.length > 1 ? 's' : ''} with repeated violations`,
      detail: repeatOffenders.map(([m, n]) => `${m} (${n}×)`).join(', '),
      severity: repeatOffenders.some(([, n]) => n >= 4) ? 'critical' : 'high',
      link: '/admin/manufacturers',
    })
  }

  // 3. High-risk categories
  const byCategory = new Map<string, { risk: number; n: number }>()
  for (const s of scans) {
    const r = s.risk_score ?? complianceToRisk(s.overall_score)
    const cur = byCategory.get(s.category) ?? { risk: 0, n: 0 }
    cur.risk += r
    cur.n += 1
    byCategory.set(s.category, cur)
  }
  const riskyCategories = [...byCategory.entries()]
    .filter(([, c]) => c.n > 0)
    .map(([c, v]) => ({ category: c, avg: v.risk / v.n }))
    .filter((c) => c.avg > 60)
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 3)
  if (riskyCategories.length > 0) {
    insights.push({
      id: 'high-risk-categories',
      kind: 'category',
      title: 'High-risk categories flagged',
      detail: riskyCategories.map((c) => `${c.category} (avg risk ${Math.round(c.avg)})`).join(', '),
      severity: riskyCategories.some((c) => c.avg > 75) ? 'high' : 'medium',
      link: '/admin/analytics',
    })
  }

  // 4. Low compliance scores
  const lowScores = scans.filter((s) => s.overall_score < 50)
  if (lowScores.length >= 3) {
    insights.push({
      id: 'low-compliance',
      kind: 'score',
      title: `${lowScores.length} scans scored below 50/100`,
      detail: 'A large share of recent inspections are non-compliant. Consider reviewing packaging guidance for common failures.',
      severity: 'medium',
      link: '/admin/scans',
    })
  }

  // 5. Unresolved critical violations
  const openCritical = violations.filter(
    (v) => v.severity === 'critical' && !['Resolved', 'Rejected'].includes(v.status),
  ).length
  if (openCritical > 0) {
    insights.push({
      id: 'open-critical',
      kind: 'violation',
      title: `${openCritical} critical violation${openCritical > 1 ? 's' : ''} still open`,
      detail: 'Critical violations are unresolved. Escalate or begin an investigation to reduce consumer risk.',
      severity: 'critical',
      link: '/admin/violations?severity=critical',
    })
  }

  // 6. Recent activity spike
  if (violations.length >= 5) {
    const last = violations.filter((v) => Date.now() - new Date(v.created_at).getTime() < 7 * 86400_000).length
    if (last >= 5) {
      insights.push({
        id: 'recent-spike',
        kind: 'trend',
        title: `${last} violations in the last 7 days`,
        detail: 'Violation volume is elevated. Consider a targeted market-surveillance drive.',
        severity: 'high',
        link: '/admin/analytics',
      })
    }
  }

  return insights
}

export function topManufacturers(scans: ScanRow[], violations: ViolationRow[]) {
  const map = new Map<
    string,
    { manufacturer: string; products: Set<string>; scans: number; nonCompliant: number; violations: number }
  >()
  for (const s of scans) {
    const name = s.manufacturer || s.brand || 'Unknown'
    const cur = map.get(name) ?? {
      manufacturer: name,
      products: new Set<string>(),
      scans: 0,
      nonCompliant: 0,
      violations: 0,
    }
    cur.scans += 1
    cur.products.add(s.product_name)
    if ((s.overall_score ?? 0) < 80) cur.nonCompliant += 1
    map.set(name, cur)
  }
  for (const v of violations) {
    if (v.status === 'Rejected') continue
    const name = v.manufacturer || 'Unknown'
    const cur = map.get(name) ?? {
      manufacturer: name,
      products: new Set<string>(),
      scans: 0,
      nonCompliant: 0,
      violations: 0,
    }
    cur.violations += 1
    map.set(name, cur)
  }
  return [...map.values()]
    .map((m) => ({
      manufacturer: m.manufacturer,
      products: m.products.size,
      scans: m.scans,
      complianceRate: m.scans === 0 ? 0 : Math.round(((m.scans - m.nonCompliant) / m.scans) * 100),
      violations: m.violations,
      risk: 0,
    }))
    .sort((a, b) => b.violations - a.violations)
}