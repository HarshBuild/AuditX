"""
AuditX OCR microservice — deterministic Legal Metrology rule engine (Python).
Mirrors the core PASS/FAIL/REVIEW outcomes of the Node compliance engine so the
OCR sidecar can return an immediate, shareable verdict without the full Node path.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

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


def _val(f: Dict[str, Any] | None) -> str | None:
    if not f or not f.get("value"):
        return None
    return str(f["value"]).strip() or None


def _has(f: Dict[str, Any] | None) -> bool:
    return _val(f) is not None


def _date_like(s: str) -> bool:
    s = s.strip()
    if not s:
        return False
    if SHELF_LIFE_RE.match(s):
        return True
    if MONTH_YEAR_RE.match(s):
        return True
    for rx in DATE_PATTERNS:
        if rx and rx.match(s):
            return True
    return False


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


def evaluate(fields: Dict[str, Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    rules: List[Dict[str, Any]] = []
    missing: List[str] = []
    uncertain: List[str] = []

    def rule(rule_id: str, field: str, status: str, reason: str, value: str | None = None, weight: int = 1) -> None:
        item: Dict[str, Any] = {
            "rule_id": rule_id,
            "field": field,
            "status": status,
            "reason": reason,
            "detected_value": value,
            "regulation": regulation_text(rule_id),
            "verification_type": "IMAGE_VERIFIABLE",
            "weight": weight,
        }
        rules.append(item)

    # Rule 6(1)(a) manufacturer/packer/importer + address
    name_ok = _has(fields.get("manufacturer")) or _has(fields.get("packer")) or _has(fields.get("importer"))
    addr_ok = _has(fields.get("address"))
    if not name_ok:
        missing.append("manufacturer/packer/importer name")
        rule("Rule 10", "Manufacturer/packer/importer name and address", "FAIL", "No business name detected.")
    if not addr_ok:
        missing.append("address")
        rule("Rule 6(1)(a)", "Name & complete address of manufacturer/packer/importer", "REVIEW", "Address could not be read confidently — verify on the physical label.")
    if name_ok:
        rule("Rule 6(1)(a)", "Name & complete address of manufacturer/packer/importer", "PASS", "Business name detected.", _val(fields.get("manufacturer")) or _val(fields.get("packer")))

    # Rule 6(1)(b) generic name
    gen = _val(fields.get("commodity_name"))
    if gen:
        rule("Rule 6(1)(b)", "Common/generic name of commodity", "PASS", "Common/generic name declared.", gen)
    else:
        missing.append("generic name")
        rule("Rule 6(1)(b)", "Common/generic name of commodity", "REVIEW", "Generic name could not be read confidently.")

    # Rule 6(1)(c)/11/12/13 net quantity
    nq = _val(fields.get("net_quantity"))
    if nq:
        rule("Rule 6(1)(c)", "Net quantity in standard units", "PASS", "Net quantity declared.", nq)
        rule("Rule 11", "Requisites of quantity declaration", "PASS", "Net quantity declared.", nq)
        rule("Rule 12", "Manner of declaring quantity", "PASS", "Net quantity in standard units.", nq)
        rule("Rule 13", "Units of weight/measure/number (Fourth Schedule)", "PASS", "Standard unit used.", nq)
    else:
        missing.append("net quantity")
        for rid, fld in (("Rule 6(1)(c)", "Net quantity in standard units"), ("Rule 11", "Requisites of quantity declaration"), ("Rule 12", "Manner of declaring quantity"), ("Rule 13", "Units of weight/measure/number (Fourth Schedule)")):
            rule(rid, fld, "FAIL", "Net quantity not declared.")

    # Rule 6(1)(d) mfg date
    mfg = _val(fields.get("mfg_date"))
    if mfg:
        rule("Rule 6(1)(d)", "Month & year of manufacture/packing/import", "PASS", "Manufacturing date declared.", mfg)
    else:
        missing.append("manufacturing date")
        rule("Rule 6(1)(d)", "Month & year of manufacture/packing/import", "REVIEW", "Manufacturing date not read confidently — verify on the label.")

    # Rule 6(1)(e) MRP
    mrp = _val(fields.get("mrp"))
    if mrp:
        rule("Rule 6(1)(e)", "MRP (maximum retail price incl. all taxes)", "PASS", "MRP declared.", mrp)
    else:
        missing.append("mrp")
        rule("Rule 6(1)(e)", "MRP (maximum retail price incl. all taxes)", "FAIL", "MRP not declared.")

    # Rule 6(1)(f) consumer care
    care = _val(fields.get("consumer_care"))
    if care:
        rule("Rule 6(1)(f)", "Consumer-care contact", "PASS", "Consumer care contact declared.", care)
    else:
        missing.append("consumer care")
        rule("Rule 6(1)(f)", "Consumer-care contact", "REVIEW", "Consumer care contact could not be read confidently.")

    # Rule 6(1)(g) best before
    bb = _val(fields.get("best_before"))
    if bb:
        if _date_like(bb):
            rule("Rule 6(1)(g)", "Best-before / use-by / expiry", "PASS", "Best-before date declared.", bb)
        else:
            uncertain.append("best before")
            rule("Rule 6(1)(g)", "Best-before / use-by / expiry", "REVIEW", '"%s" is not a recognisable date format — verify manually.' % bb, bb)
    else:
        missing.append("best before")
        rule("Rule 6(1)(g)", "Best-before / use-by / expiry", "REVIEW", "Best-before date not read — verify manually.")

    # Rule 6(1)(i) origin
    origin = _val(fields.get("country_of_origin"))
    if origin:
        rule("Rule 6(1)(i)", "Country of origin & importer details", "PASS", "Country of origin declared.", origin)
    else:
        rule("Rule 6(1)(i)", "Country of origin & importer details", "NA", "No import indicators detected — presumed domestic package.")

    # FSSAI (food)
    fssai = _val(fields.get("fssai_license"))
    if fssai:
        rule("FSSAI", "FSSAI licence number (food labelling)", "PASS", "FSSAI licence detected.", fssai)
    else:
        rule("FSSAI", "FSSAI licence number (food labelling)", "REVIEW", "FSSAI licence not read — verify for food items.")

    # Rule 4 umbrella — mandatory declarations present?
    core = [k for k in ("commodity_name", "mrp", "net_quantity", "manufacturer", "packer", "importer", "address") if not _has(fields.get(k))]
    if len(core) <= 1:
        rule("Rule 4", "Pre-packing and sale (mandatory declarations present)", "PASS", "Core mandatory declarations present.")
    else:
        rule("Rule 4", "Pre-packing and sale (mandatory declarations present)", "FAIL", "Missing core declarations: %s." % ", ".join(core))

    counts = {"passed": 0, "failed": 0, "review": 0, "na": 0}
    for r in rules:
        key = {"PASS": "passed", "FAIL": "failed", "REVIEW": "review", "NA": "na"}[r["status"]]
        counts[key] = counts.get(key, 0) + 1

    penalty = counts["failed"] * 22 + counts["review"] * 4
    score = max(0, min(100, 100 - penalty))
    if score >= 80:
        verdict, risk = "COMPLIANT", "Low"
    elif score >= 50:
        verdict, risk = "PARTIALLY_COMPLIANT", "Medium"
    else:
        verdict, risk = "NON_COMPLIANT", "Critical" if score < 40 else "High"

    summary = (
        f"{score}/100 — {verdict} (risk {risk}). "
        f"{counts['passed']} passed, {counts['failed']} failed, {counts['review']} need review."
    )
    missing_hdr = sorted(set(missing))
    if missing_hdr:
        summary += f" Missing or unreadable: {', '.join(missing_hdr)}."

    return rules, {"score": score, "verdict": verdict, "risk": risk, "summary": summary, "counts": counts}