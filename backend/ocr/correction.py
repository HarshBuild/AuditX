"""
AuditX OCR microservice — OCR correction layer (RapidFuzz + dictionary + regex).
Noisy PaddleOCR output is cleaned: character confusions fixed, canonical label
keywords matched with fuzzy distance, and values normalized.
"""
from __future__ import annotations

import re
from typing import Dict, List, Any, Tuple

from rapidfuzz import fuzz, process

CURRENCY = r"(?:rs\.?\s*|inr\s*|₹|`|" r")\s*"

# label keyword -> field key
LABEL_DICT: Dict[str, str] = {
    "MRP": "mrp",
    "M.R.P.": "mrp",
    "maximum retail price": "mrp",
    "net quantity": "net_quantity",
    "net wt": "net_quantity",
    "net qty": "net_quantity",
    "net weight": "net_quantity",
    "net contents": "net_quantity",
    "unit sale price": "unit_sale_price",
    "manufactured by": "manufacturer",
    "marketed by": "manufacturer",
    "packed by": "packer",
    "packed at": "packer",
    "imported by": "importer",
    "mfg date": "mfg_date",
    "mfg": "mfg_date",
    "manufacturing date": "mfg_date",
    "best before": "best_before",
    "best-before": "best_before",
    "use by": "best_before",
    "expiry": "best_before",
    "expires": "best_before",
    "exp date": "best_before",
    "country of origin": "country_of_origin",
    "made in": "country_of_origin",
    "product of": "country_of_origin",
    "consumer care": "consumer_care",
    "customer care": "consumer_care",
    "helpline": "consumer_care",
    "batch": "lot_no",
    "lot no": "lot_no",
    "b.no": "lot_no",
    "fssai": "fssai_license",
    "lic no": "fssai_license",
    "veg": "veg_nonveg",
    "address": "address",
    "regd office": "address",
    "registered office": "address",
    "ingredients": "ingredients",
    "allergen": "allergens",
}

CHAR_FIXES = {
    "0": "O", "O": "0",  # contextual — handled below, don't hard-map globally
}
CURRENCY_RE = re.compile(r"(?i)rs\.?|inr|rupees|rps|\u20b9")
GARBAGE_RE = re.compile(r"[\x00-\x1f\x7f\u200b-\u200f]")

_DIGIT_SUSPECTS = {"0": "O", "1": "l", "1": "I", "8": "B", "5": "S", "6": "G", "2": "Z", "9": "g"}


def clean_text(raw: str) -> str:
    t = str(raw or "")
    t = GARBAGE_RE.sub("", t)
    t = t.replace("''", '"').replace("..", ".").replace("--", "-")
    t = re.sub(r"\s+", " ", t).strip()
    return t


def collapse_whitespace(lines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    for ln in lines:
        ln["text"] = clean_text(ln.get("text", ""))
    return [ln for ln in lines if ln["text"]]


def fuzzy_label(text: str, threshold: int = 82) -> Tuple[str | None, float]:
    """Match a cleaned OCR line to a canonical label keyword."""
    low = text.lower()
    # direct contains first (fast path)
    for kw, key in LABEL_DICT.items():
        if kw.lower() in low:
            return key, 100.0
    best = process.extractOne(low, list(LABEL_DICT.keys()), scorer=fuzz.partial_ratio)
    if best and best[1] >= threshold:
        return LABEL_DICT[best[0]], float(best[1])
    return None, 0.0


def normalize_value(text: str) -> str:
    """Fix common OCR character swaps in numeric contexts and strip currency."""
    v = clean_text(text)
    if not v:
        return v
    # currency symbol -> "Rs " prefix for parsing
    if CURRENCY_RE.match(v) or v.startswith(("\u20b9",)):
        v = "Rs " + CURRENCY_RE.sub("", v).strip()
    return v


def digitize(text: str) -> str:
    """Best-effort repair of OCR digit confusions inside numbers."""
    out = []
    for i, ch in enumerate(text):
        if ch.isdigit() or ch in ".,/":
            out.append(ch)
            continue
        # replace confusing letters with digits when surrounded by digits
        prev_digit = out and out[-1][-1].isdigit()
        nxt_digit = i + 1 < len(text) and text[i + 1].isdigit()
        if prev_digit or nxt_digit:
            if ch in "Oo": out.append("0")
            elif ch in "lI|": out.append("1")
            elif ch in "Ss": out.append("5")
            elif ch in "Bb": out.append("8")
            elif ch in "Gg": out.append("6")
            elif ch in "Zz": out.append("2")
            else: out.append(ch)
        else:
            out.append(ch)
    return "".join(out)


def join_ocr(lines: List[Dict[str, Any]]) -> str:
    return " ".join(clean_text(ln.get("text", "")) for ln in lines).strip()