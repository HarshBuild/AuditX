"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeCompliance = computeCompliance;
exports.buildAssistant = buildAssistant;
const isApplicable = (s) => s === 'PASS' || s === 'FAIL' || s === 'WARNING' || s === 'NOT_DETECTED';
function computeCompliance(rules, uncertainCount) {
    const applicable = rules.filter((r) => isApplicable(r.status));
    let sum = 0;
    let total = 0;
    for (const r of applicable) {
        const s = r.status === 'PASS' ? 1 : r.status === 'WARNING' ? 0.5 : 0;
        sum += s * r.weight;
        total += r.weight;
    }
    const score = total > 0 ? Math.max(0, Math.min(100, Math.round((100 * sum) / total))) : 0;
    const counts = {
        passed: rules.filter((r) => r.status === 'PASS').length,
        failed: rules.filter((r) => r.status === 'FAIL').length,
        warnings: rules.filter((r) => r.status === 'WARNING').length,
        not_detected: rules.filter((r) => r.status === 'NOT_DETECTED').length,
        not_verifiable: rules.filter((r) => r.status === 'NOT_VERIFIABLE').length,
        requires_physical_inspection: rules.filter((r) => r.status === 'REQUIRES_PHYSICAL_INSPECTION').length,
        not_applicable: rules.filter((r) => r.status === 'NOT_APPLICABLE').length,
        uncertain: uncertainCount,
    };
    // Verdict.
    let verdict = 'COMPLIANT';
    if (counts.failed > 0) {
        verdict = 'NON_COMPLIANT';
    }
    else {
        const criticalUnverifiable = applicable.filter((r) => r.weight >= 2 && r.status === 'NOT_VERIFIABLE');
        if (criticalUnverifiable.length > 0) {
            verdict = 'REQUIRES_PHYSICAL_INSPECTION';
        }
        else if (counts.warnings > 0 || applicable.some((r) => r.status === 'NOT_DETECTED' && r.weight >= 2)) {
            verdict = 'PARTIALLY_COMPLIANT';
        }
        else if (applicable.some((r) => r.status === 'NOT_DETECTED')) {
            verdict = 'PARTIALLY_COMPLIANT';
        }
    }
    const byStatus = (st) => rules.filter((r) => r.status === st);
    const ai_insights = rules
        .filter((r) => r.status === 'FAIL' || r.status === 'WARNING')
        .map((r) => ({ rule_id: r.rule_id, field: r.requirement, status: r.status, issue: r.reason }));
    return {
        overall_score: score,
        verdict,
        risk_score: 100 - score,
        counts,
        detected: {
            passed: counts.passed,
            failed: counts.failed,
            warnings: counts.warnings,
            not_verifiable: counts.not_verifiable,
            not_applicable: counts.not_applicable,
            missing: counts.failed,
            uncertain: uncertainCount,
        },
        ai_insights,
        passed: byStatus('PASS').map((r) => r.requirement),
        failed: byStatus('FAIL').map((r) => r.requirement),
        warnings: byStatus('WARNING').map((r) => r.requirement),
        requires_physical_inspection: byStatus('REQUIRES_PHYSICAL_INSPECTION').map((r) => `${r.rule_id} — ${r.requirement}`),
        evidence_chain: rules
            .filter((r) => isApplicable(r.status))
            .map((r) => ({
            rule_id: r.rule_id,
            requirement: r.requirement,
            status: r.status,
            detected_value: r.detected_value,
            source_image: r.evidence.source_image,
            ocr_text: r.evidence.ocr_text,
        })),
    };
}
/** Human readable, explained summary + next actions (all deterministic). */
function buildAssistant(c, ex, productName, languages) {
    const name = productName ?? 'the scanned product';
    let summary = '';
    switch (c.verdict) {
        case 'COMPLIANT':
            summary = `All applicable image-verifiable declarations for ${name} are present on the label. A physical check is still required to confirm net quantities, MPE and dealer obligations.`;
            break;
        case 'PARTIALLY_COMPLIANT':
            summary = `${name} meets most main declarations but needs a manual look: ${c.warnings.length} warning${c.warnings.length > 1 ? 's' : ''} and ${c.counts.not_detected || c.counts.uncertain ? `${c.counts.not_detected ? c.counts.not_detected + ' missing' : ''}${c.counts.not_detected && c.counts.uncertain ? ', ' : ''}${c.counts.uncertain ? c.counts.uncertain + ' unreadable' : ''}` : 'no missing values'} from the label photo.`;
            break;
        case 'REQUIRES_PHYSICAL_INSPECTION':
            summary = `${name}: the mandatory declarations could not be read reliably from the photo — at least one core declaration requires on-package human verification before a compliance view can be given.`;
            break;
        case 'NON_COMPLIANT':
            summary = `${name} is missing ${c.failed.length} mandatory declaration${c.failed.length > 1 ? 's' : ''} (${c.failed.join(', ')}). Repeated/supplier-batch non-compliance is actionable by the Legal Metrology office.`;
            break;
    }
    const suggestions = [];
    const all = { ...ex };
    if (all.net_quantity)
        suggestions.push(`Physically weigh/measure the package — the label declares "${all.net_quantity}".`);
    if (all.mrp)
        suggestions.push('Spot-check the MRP against the GST invoice and confirm "incl. of all taxes" wording.');
    if (all.best_before)
        suggestions.push('Verify the best-before/use-by line against the physical package and its shelf state.');
    if (all.consumer_care)
        suggestions.push('Check that the consumer-care contact is operational.');
    if (all.manufacturer || all.packer || all.importer)
        suggestions.push('Cross-verify the printed business name/address against company registration.');
    if (languages.length > 0)
        suggestions.push('Confirm the mandatory declarations are printed in Hindi/English (Rule 6(2)).');
    if (c.failed.length > 0)
        suggestions.push(`Resolve the missing declarations: ${c.failed.join(', ')}.`);
    if (c.counts.not_verifiable > 0)
        suggestions.push(`${c.counts.not_verifiable} value${c.counts.not_verifiable > 1 ? 's' : ''} could not be read confidently — a human inspector should verify them on the physical label.`);
    if (c.counts.requires_physical_inspection > 0)
        suggestions.push(`Physical inspection is required for: ${c.requires_physical_inspection.join('; ')}.`);
    if (suggestions.length === 0)
        suggestions.push('Retake closer, well-lit photos of the back label for a more complete reading.');
    return {
        summary,
        suggestions,
    };
}
