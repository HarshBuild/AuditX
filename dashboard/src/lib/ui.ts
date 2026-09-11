/*
 * AuditX v3.0 — UI tone helpers for severity / workflow status badges.
 */

import type { BadgeTone } from '../components/ui/Badge'
import type { Severity, ViolationStatus, ReportStatus } from './types2'

export function severityTone(sev: string): BadgeTone {
  switch (sev.toLowerCase()) {
    case 'critical': return 'rose'
    case 'high': return 'amber'
    case 'medium': return 'cyan'
    default: return 'slate'
  }
}

export function severityValue(sev: string): Severity {
  const s = sev.toLowerCase()
  if (s === 'critical' || s === 'high' || s === 'medium' || s === 'low') return s
  return 'medium'
}

export function scanStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'analyzed': return 'cyan'
    case 'flagged': return 'amber'
    case 'manual_review': return 'brand'
    case 'resolved': return 'emerald'
    default: return 'slate'
  }
}

export function violationStatusTone(status: ViolationStatus): BadgeTone {
  switch (status) {
    case 'Detected': return 'rose'
    case 'Reviewing': return 'amber'
    case 'Investigating': return 'cyan'
    case 'Escalated': return 'rose'
    case 'Resolved': return 'emerald'
    case 'Rejected': return 'slate'
    default: return 'slate'
  }
}

export function reportStatusTone(status: ReportStatus): BadgeTone {
  switch (status) {
    case 'Pending': return 'amber'
    case 'Reviewing': return 'cyan'
    case 'Investigating': return 'brand'
    case 'Resolved': return 'emerald'
    case 'Rejected': return 'rose'
    default: return 'slate'
  }
}

export function priorityTone(p: string): BadgeTone {
  switch (p) {
    case 'Critical': return 'rose'
    case 'High': return 'amber'
    case 'Medium': return 'cyan'
    default: return 'slate'
  }
}