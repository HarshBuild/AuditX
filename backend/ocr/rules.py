"""
AuditX OCR microservice — deterministic Legal Metrology rule engine (Python).

Port of the engine *structure* from Misa (lib/compliance/engine.ts + rules.ts)
onto our Indian Legal Metrology rule domain:

  * rules carry a category set ("edible" / "non_edible") — a rule listing BOTH
    runs when the inspection category is unknown,
  * each check returns a status ("pass" | "needs_review" | "fail") + a finding
    (detected/evidence/confidence) — never a legal verdict, only what the text
    supports,
  * verdict tiers follow Misa: 90+ compliant, 75+ needs_review, 50+ violation,
    below critical; ANY failed check floors the verdict at violation.

The top-level wire contract the dashboard already consumes (score / verdict /
risk / summary / counts / rules[]) is preserved; the Misa-shaped findings are
exposed under result["compliance"].
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

FIELD_LABELS = {
    "commodity_name": "generic name",
    "mrp": "MRP",
    "net_quantity": "net quantity",
    "unit_sale_price": "unit sale price (USP)",
    "manufacturer": "manufacturer",
    "packer": "packer",
    "importer": "importer",
    "address": "address",
    "country_of_origin": "country of origin",
    "mfg_date": "manufacturing date",
    "best_before": "best before / expiry date",
    "consumer_care": "consumer care",
    "lot_no": "batch / lot number",
    "fssai_license": "FSSAI licence number",
}

DATE_PATTERNS = [
    re.compile(r"^\d{1,2}/\d{1,2}/\d{2,4}$"),
    re.compile(r"^\d{1,2}\s+[a-z]{3,9}\s*\d{2,4}$", re.I),
    re.compile(r"^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[\s.-]*\d{2,4}$", re.I),
]
MONTH_YEAR_RE = re.compile(r"^(?:0?[1-9]|1[0-2])/(?:19|20)?\d{2}$")
SHELF_LIFE_RE = re.compile(r"^\d{1,3}\s*(?:month|months|day|days|year|years)", re.I)

Category = str  # "edible" | "non_edible" | "general"

# AN ALIAS MAP of the FSSAI/legal-metrology rule ids (kept for the legacy wire)
# to the MISA-style labels used in findings.
RULE_IDS = [
    "Rule 6(1)(a)", "Rule 6(1)(b)", "Rule 6(1)(c)", "Rule 6(1)(d)", "Rule 6(1)(e)",
    "Rule 6(1)(f)", "Rule 6(1)(g)", "Rule 6(1)(i)", "Rule 4", "Rule 10",
    "Rule 11", "Rule 12", "Rule 13", "FSSAI",
]


def _val(f: Optional[Dict[str, Any]]) -> Optional[str]:
    if not f or not f.get("value"):
        return None
    return str(f["value"]).strip() or None


def _has(f: Optional[Dict[str, Any]]) -> bool:
    return _val(f) is not None


def _date_like(s: str) -> bool:
    s = s.strip()
    if not s:
        return False
    if SHELF_LIFE_RE.match(s) or MONTH_YEAR_RE.match(s):
        return True
    return any(rx and rx.match(s) for rx in DATE_PATTERNS)


def regulation_text(rule_id: str) -> str:
    """Share REAL regulation wording with the user (Legal Metrology Packaged Commodities Rules 2011)."""
    T = {
        "Rule 6(1)(a)": "Every package shall bear a label showing the name and address of the manufacturer, packer or importer.",
        "Rule 6(1)(b)": "Every package shall bear a label showing the common or generic name of the commodity contained.",
        "Rule 6(1)(c)": "Every package shall bear a label showing the net quantity in terms of standard unit of weight or measure.",
        "Rule 6(1)(d)": "The month and year in which the commodity is manufactured or packed or imported shall be shown.",
        "Rule 6(1)(e)": "The maximum retail price at which the packaged commodity shall be sold is to be shown inclusive of all taxes.",
        "Rule 6(1)(f)": "Consumer care details (contact) of the manufacturer or packer or importer shall appear on the label.",
        "Rule 6(1)(g)": "For packaged commodities the best-before or use-by / expiry date shall be declared.",
        "Rule 6(1)(h)": "The unit sale price shall be declared for specified retail packages.",
        "Rule 6(1)(i)": "Country of origin and importer details shall be declared where applicable.",
        "Rule 6(2)": "The mandatory declarations shall be printed in Hindi or English and, where required, in the regional language.",
        "Rule 4": "Pre-packing and sale of commodities requires the mandatory declarations present on every pre-packed package.",
        "Rule 10": "Name and complete address of the manufacturer/packer/importer are mandatory declarations.",
        "Rule 11": "The net quantity shall be declared in the manner prescribed on the label.",
        "Rule 12": "The manner of declaring quantity shall follow the prescribed format and standard units.",
        "Rule 13": "Units of weight/measure/number shall conform to the Fourth Schedule of the Rules.",
        "BARCODE": "A barcode/GTIN is a traceability aid; not itself a Rule 6 mandate.",
    }
    return T.get(rule_id, "")


# MISA-style check result: status + finding.
def _pass(detected: Optional[str], evidence: Optional[str]) -> Dict[str, Any]:
    return {"status": "pass", "detected": detected, "evidence": evidence or detected, "confidence": "high"}


def _review(detected: Optional[str], evidence: Optional[str], confidence: str = "high") -> Dict[str, Any]:
    return {"status": "needs_review", "detected": detected, "evidence": evidence or detected, "confidence": confidence}


def _fail(detected: Optional[str], evidence: str, confidence: str = "high") -> Dict[str, Any]:
    return {"status": "fail", "detected": detected, "evidence": evidence, "confidence": confidence}


def _find_item(rule_id: str, finding: Dict[str, Any], field: str, legacy_status: str,
               reason: str, weight: int = 1) -> Dict[str, Any]:
    """Assemble one rule row: legacy wire fields + Misa finding fields."""
    return {
        "rule_id": rule_id,
        "field": field,
        "status": legacy_status,
        "reason": reason,
        "detected_value": finding.get("detected"),
        "regulation": regulation_text(rule_id),
        "verification_type": "IMAGE_VERIFIABLE",
        "weight": weight,
        "status_label": finding.get("status"),
        "detected": finding.get("detected"),
        "evidence": finding.get("evidence"),
        "confidence": finding.get("confidence"),
    }


def evaluate(fields: Dict[str, Dict[str, Any]], category: Optional[str] = None) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Evaluate applicable rules for the given fields.

    category: "edible" | "non_edible" | None. Rules listing BOTH categories
    always run (identical to Misa's engine when the category is unknown).
    """
    applicable = _applicable_rules(category)
    findings: List[Dict[str, Any]] = []
    missing: List[str] = []
    uncertain: List[str] = []

    def add(rule_id: str, field: str, finding: Dict[str, Any]) -> None:
        legacy = {
            "pass": "PASS", "needs_review": "REVIEW", "fail": "FAIL",
        }.get(finding["status"], "REVIEW")
        reason = {
            "pass": f"{field} declared.",
            "needs_review": field + " could not be read confidently — verify on the physical label.",
            "fail": field + " not declared.",
        }.get(finding["status"], field + " unresolved.")
        findings.append(_find_item(rule_id, finding, field, legacy, reason))

    if "Rule 6(1)(a)" in applicable:
        name_ok = _has(fields.get("manufacturer")) or _has(fields.get("packer")) or _has(fields.get("importer"))
        addr_ok = _has(fields.get("address"))
        if not name_ok and not addr_ok:
            missing.append("manufacturer/packer/importer name")
            add("Rule 10", "Manufacturer/packer/importer name and address",
                _fail(None, "No business name detected."))
            add("Rule 6(1)(a)", "Name & complete address of manufacturer/packer/importer",
                _review(None, "No business name or address detected — verify on the label."))
        else:
            if name_ok:
                add("Rule 6(1)(a)", "Name & complete address of manufacturer/packer/importer",
                    _pass(_val(fields.get("manufacturer")) or _val(fields.get("packer")) or _val(fields.get("importer")),
                          "Business name detected."))
            else:
                missing.append("manufacturer/packer/importer name")
                add("Rule 6(1)(a)", "Name & complete address of manufacturer/packer/importer",
                    _review(None, "Business name not detected — verify on the label."))
            if addr_ok:
                add("Rule 10", "Manufacturer/packer/importer name and address",
                    _pass(_val(fields.get("address")), "Address detected."))
            else:
                missing.append("address")
                add("Rule 10", "Manufacturer/packer/importer name and address",
                    _review(None, "Address could not be read confidently — verify on the physical label."))

    if "Rule 6(1)(b)" in applicable:
        gen = _val(fields.get("commodity_name"))
        if gen:
            add("Rule 6(1)(b)", "Common/generic name of commodity", _pass(gen, "Generic name declared."))
        else:
            missing.append("generic name")
            add("Rule 6(1)(b)", "Common/generic name of commodity",
                _review(None, "Generic name could not be read confidently."))

    if {"Rule 6(1)(c)", "Rule 11", "Rule 12", "Rule 13"} & applicable:
        nq = _val(fields.get("net_quantity"))
        if nq:
            if "Rule 6(1)(c)" in applicable:
                add("Rule 6(1)(c)", "Net quantity in standard units", _pass(nq, "Net quantity declared."))
            if "Rule 11" in applicable:
                add("Rule 11", "Requisites of quantity declaration", _pass(nq, "Net quantity declared."))
            if "Rule 12" in applicable:
                add("Rule 12", "Manner of declaring quantity", _pass(nq, "Net quantity in standard units."))
            if "Rule 13" in applicable:
                add("Rule 13", "Units of weight/measure/number (Fourth Schedule)", _pass(nq, "Standard unit used."))
        else:
            missing.append("net quantity")
            for rid, fld in (("Rule 6(1)(c)", "Net quantity in standard units"), ("Rule 11", "Requisites of quantity declaration"),
                             ("Rule 12", "Manner of declaring quantity"), ("Rule 13", "Units of weight/measure/number (Fourth Schedule)")):
                if rid in applicable:
                    add(rid, fld, _fail(None, "Net quantity not declared."))

    if "Rule 6(1)(d)" in applicable:
        mfg = _val(fields.get("mfg_date"))
        if mfg:
            add("Rule 6(1)(d)", "Month & year of manufacture/packing/import", _pass(mfg, "Manufacturing date declared."))
        else:
            missing.append("manufacturing date")
            add("Rule 6(1)(d)", "Month & year of manufacture/packing/import",
                _review(None, "Manufacturing date not read confidently — verify on the label."))

    if "Rule 6(1)(e)" in applicable:
        mrp = _val(fields.get("mrp"))
        if mrp:
            add("Rule 6(1)(e)", "MRP (maximum retail price incl. all taxes)", _pass(mrp, "MRP declared."))
        else:
            missing.append("mrp")
            add("Rule 6(1)(e)", "MRP (maximum retail price incl. all taxes)", _fail(None, "MRP not declared."))

    if "Rule 6(1)(f)" in applicable:
        care = _val(fields.get("consumer_care"))
        if care:
            add("Rule 6(1)(f)", "Consumer-care contact", _pass(care, "Consumer care contact declared."))
        else:
            missing.append("consumer care")
            add("Rule 6(1)(f)", "Consumer-care contact",
                _review(None, "Consumer care contact could not be read confidently."))

    if "Rule 6(1)(g)" in applicable:
        bb = _val(fields.get("best_before"))
        if bb:
            if _date_like(bb):
                add("Rule 6(1)(g)", "Best-before / use-by / expiry", _pass(bb, "Best-before date declared."))
            else:
                uncertain.append("best before")
                add("Rule 6(1)(g)", "Best-before / use-by / expiry",
                    _review(bb, '"%s" is not a recognisable date format — verify manually.' % bb, "low"))
        else:
            missing.append("best before")
            add("Rule 6(1)(g)", "Best-before / use-by / expiry",
                _review(None, "Best-before date not read — verify manually."))

    if "Rule 6(1)(i)" in applicable:
        origin = _val(fields.get("country_of_origin"))
        if origin:
            add("Rule 6(1)(i)", "Country of origin & importer details", _pass(origin, "Country of origin declared."))
        else:
            add("Rule 6(1)(i)", "Country of origin & importer details", {
                "status": "needs_review", "detected": None,
                "evidence": "No import indicators detected — presumed domestic package.", "confidence": "low",
            })

    if "FSSAI" in applicable:
        fssai = _val(fields.get("fssai_license"))
        if fssai:
            add("FSSAI", "FSSAI licence number (food labelling)", _pass(fssai, "FSSAI licence detected."))
        else:
            missing.append("fssai licence")
            add("FSSAI", "FSSAI licence number (food labelling)",
                _review(None, "FSSAI licence not read — verify for food items."))

    if "Rule 4" in applicable:
        core = [k for k in ("commodity_name", "mrp", "net_quantity", "manufacturer", "packer", "importer", "address") if not _has(fields.get(k))]
        if len(core) <= 1:
            add("Rule 4", "Pre-packing and sale (mandatory declarations present)", _pass(None, "Core mandatory declarations present."))
        else:
            add("Rule 4", "Pre-packing and sale (mandatory declarations present)",
                _fail(None, "Missing core declarations: %s." % ", ".join(core)))

    # ---- MISA-style verdict (score formula + tiers, any fail floors) ---------
    passed = sum(1 for f in findings if f["status_label"] == "pass")
    review = sum(1 for f in findings if f["status_label"] == "needs_review")
    failed = sum(1 for f in findings if f["status_label"] == "fail")
    total = max(1, len(findings))
    score = max(0, round(100 * (passed + 0.7 * review) / total - 15 * failed))

    if failed:
        tier = "violation" if score >= 50 else "critical"
    elif score >= 90:
        tier = "compliant"
    elif score >= 75:
        tier = "needs_review"
    elif score >= 50:
        tier = "violation"
    else:
        tier = "critical"

    # Legacy wire mapping keeps dashboard badges working.
    if tier == "compliant":
        verdict, risk, score_display = "COMPLIANT", "Low", score
    elif tier in ("needs_review", "violation"):
        verdict, risk = "PARTIALLY_COMPLIANT", "Medium"
        score_display = score
    else:
        verdict, risk = "NON_COMPLIANT", "Critical"
        score_display = score

    counts = {"passed": passed, "failed": failed, "review": review,
              "na": sum(1 for f in findings if f.get("status_label") in ("not_applicable", None))}
    summary = (
        f"{score}/100 — {tier} (risk {risk}). "
        f"{passed} passed, {failed} failed, {review} need review."
    )
    missing_hdr = sorted(set(missing))
    if missing_hdr:
        summary += f" Missing or unreadable: {', '.join(missing_hdr)}."
    if uncertain:
        summary += " Uncertain: %s." % ", ".join(sorted(set(uncertain)))

    result: Dict[str, Any] = {
        "score": score,
        "verdict": verdict,
        "display_verdict": tier,
        "risk": risk,
        "summary": summary,
        "counts": counts,
        "compliance": {
            "status": tier,
            "findings": findings,
            "score": score,
        },
    }
    return findings, result


def _applicable_rules(category: Optional[str]) -> set:
    """Rules that run for the given category (Misa RULES.categories semantics).

    All FSSAI/legal-metrology declarations here apply to both edible and
    non-edible prepacked commodities, so every rule runs for either category;
    an unknown category runs the same full set (recommendation for review).
    """
    if category in ("edible", "non_edible", "general", None):
        return set(RULE_IDS)
    return set(RULE_IDS)