"""
AuditX OCR microservice — multi-image merge layer (port of Misa lib/ocr/merge.ts).

Several label photos (front/back/sides) are OCR'd independently. This module
combines them into ONE inspection exactly like Misa's mergeResults:

  * first non-empty value wins per field (source image recorded as evidence),
  * per-field normalizers hide trivial OCR/format differences (case, currency
    spelling, units, date formats, barcode separators),
  * fields whose normalized values disagree across images are flagged as
    CONFLICTS (both readings kept for human review — nothing is overwritten),
  * per-field confidence and evidence (source image, matching line text,
    confidence, bounding box) are returned so the UI can show traceability.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

# Result-field order (our schema — mirrors repayment); labels used in conflicts.
FIELD_LABELS: List[Tuple[str, str]] = [
    ("commodity_name", "Generic/commodity name"),
    ("mrp", "MRP"),
    ("net_quantity", "Net quantity"),
    ("unit_sale_price", "Unit sale price"),
    ("manufacturer", "Manufacturer"),
    ("packer", "Packer"),
    ("importer", "Importer"),
    ("mfg_date", "Manufacturing date"),
    ("best_before", "Best before / expiry"),
    ("country_of_origin", "Country of origin"),
    ("consumer_care", "Consumer care"),
    ("fssai_license", "FSSAI licence"),
    ("address", "Address"),
    ("veg_nonveg", "Veg / non-veg mark"),
    ("lot_no", "Batch / lot number"),
]


# ---------------------------------------------------------------------------
# Normalizers (port of Misa lib/change/normalize.ts)
# ---------------------------------------------------------------------------

def norm_text(v: Optional[str]) -> Optional[str]:
    if not v:
        return None
    return " ".join(str(v).strip().lower().split()) or None


def _strip_tag(v: str) -> str:
    return re.sub(r"\s+#\d+\s*$", "", v).strip()


def norm_name(v: Optional[str]) -> Optional[str]:
    return norm_text(_strip_tag(str(v or "")))


def norm_money(v: Optional[str]) -> Optional[str]:
    t = str(v or "").lower().replace(",", "")
    m = re.search(r"(\d+(?:\.\d+)?)", t)
    if not m:
        return norm_text(v) or None
    cur = "₹" if re.search(r"₹|rs\.?|inr", t) else ""
    try:
        return f"{cur}{float(m.group(1)):g}"
    except ValueError:
        return norm_text(v) or None


_UNIT_FAMILY: Dict[str, Tuple[float, str]] = {
    "mg": (0.001, "g"),
    "g": (1, "g"),
    "kg": (1000, "g"),
    "ml": (1, "ml"),
    "l": (1000, "ml"),
}


def norm_qty(v: Optional[str]) -> Optional[str]:
    m = re.search(r"(\d+(?:\.\d+)?)\s*(mg|kg|ml|g|l)\b", str(v or "").lower().replace(",", ""))
    if not m:
        return norm_text(v) or None
    factor, base = _UNIT_FAMILY[m.group(2)]
    try:
        return f"{float(m.group(1)) * factor:g} {base}"
    except ValueError:
        return norm_text(v) or None


def norm_date(v: Optional[str]) -> Optional[str]:
    m = re.search(r"\d{4}-\d{2}-\d{2}|\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}", str(v or ""))
    if not m:
        return norm_text(v) or None
    parts = re.split(r"[/\-.]", m.group(0))
    try:
        if len(parts) == 3:
            if len(parts[0]) == 4:  # yyyy-mm-dd
                y, mo, d = int(parts[0]), int(parts[1]), int(parts[2])
            else:                   # dd-mm-yyyy
                d, mo, y = int(parts[0]), int(parts[1]), int(parts[2])
                if y < 100:
                    y += 2000
            return f"{y:04d}-{mo:02d}-{d:02d}"
    except ValueError:
        pass
    return norm_text(v) or None


def norm_barcode(v: Optional[str]) -> Optional[str]:
    if not v:
        return None
    t = re.sub(r"[\s\-]", "", str(v)).upper()
    return t or None


NORMALIZERS: Dict[str, Any] = {
    "commodity_name": norm_name,
    "manufacturer": norm_text,
    "packer": norm_text,
    "importer": norm_text,
    "address": norm_text,
    "mrp": norm_money,
    "net_quantity": norm_qty,
    "unit_sale_price": norm_money,
    "mfg_date": norm_date,
    "best_before": norm_date,
    "country_of_origin": norm_text,
    "consumer_care": norm_text,
    "fssai_license": norm_barcode,
    "veg_nonveg": norm_text,
    "lot_no": norm_barcode,
}


def _val(v: Any) -> Optional[str]:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def normalize_field(key: str, value: Any) -> Optional[str]:
    n = NORMALIZERS.get(key, norm_text)(value)
    return n if n is not None else _val(value)


# ---------------------------------------------------------------------------
# Merge
# ---------------------------------------------------------------------------

PerImage = Dict[str, Any]  # {index, text, language, confidence, fields, blocks}


def merge_results(per_images: List[PerImage]) -> Dict[str, Any]:
    """Merge per-image extractions into one inspection (Misa mergeResults).

    Returns fields, sources, conflicts, text, regions (with image index),
    field_confidence and field_evidence.
    """
    fields: Dict[str, Any] = {}
    sources: Dict[str, int] = {}
    for pi in per_images:
        for key, _ in FIELD_LABELS:
            if _val(fields.get(key)):
                continue
            v = _val(pi.get("fields", {}).get(key))
            if v:
                fields[key] = v
                sources[key] = pi["index"] + 1

    conflicts: List[Dict[str, Any]] = []
    for key, label in FIELD_LABELS:
        seen: Dict[str, Dict[str, Any]] = {}
        for pi in per_images:
            raw = _val(pi.get("fields", {}).get(key))
            if not raw:
                continue
            n = normalize_field(key, raw)
            if n not in seen:
                seen[n] = {"image": pi["index"] + 1, "value": raw}
        if len(seen) > 1:
            conflicts.append({"field": key, "label": label, "values": list(seen.values())})

    field_confidence: Dict[str, Optional[float]] = {}
    field_evidence: Dict[str, Dict[str, Any]] = {}
    for key in sources:
        for pi in per_images:
            if _val(pi.get("fields", {}).get(key)):
                ev = pi.get("field_evidence", {}).get(key)
                field_confidence[key] = pi.get("field_confidence", {}).get(key)
                field_evidence[key] = {
                    "image": pi["index"] + 1,
                    "text": (ev or {}).get("text") or _val(pi.get("fields", {}).get(key)) or "",
                    "confidence": (ev or {}).get("confidence"),
                    "bbox": (ev or {}).get("bbox"),
                }
                break

    regions: List[Dict[str, Any]] = []
    for pi in per_images:
        for r in (pi.get("regions") or []):
            regions.append({**r, "image": pi["index"] + 1})

    parts: List[str] = []
    for i, pi in enumerate(per_images):
        t = pi.get("text") or ""
        parts.append(f"--- Image {i + 1} ---\n{t}" if len(per_images) > 1 else t)

    return {
        "fields": fields,
        "sources": sources,
        "conflicts": conflicts,
        "text": "\n".join(parts),
        "language": per_images[0].get("language") or "und" if per_images else "und",
        "regions": regions[:1000],
        "field_confidence": field_confidence,
        "field_evidence": field_evidence,
    }