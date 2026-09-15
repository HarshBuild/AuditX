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

# ---------------------------------------------------------------------------
# OCR noise filtering (spec §3 — OCR CLEANING).
#
# Design rules:
#   * Cost is based on SYMBOL DENSITY and duplicates, never length, so legit
#     short values (A1, B12, 500, XL, ABC-120) always survive.
#   * A line is noise when it is symbol-only, crammed with rare symbols around
#     no real word, or an artifact repeat (e.g. "|||", "....", "-----").
#   * A merged-text token is garbage when >half its characters are rare
#     symbols around a ≤2-character alphanumeric core ("x7@#"), or it is a
#     run of one punctuation char.
#   * Allowed symbols (kept even in labels/addresses): . , : / ( ) + - % & ' # ₹ $ * = [ ]
# ---------------------------------------------------------------------------
_ALNUM = set("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")
_RARE_RE = re.compile(r"(?u)[^0-9A-Za-z .,:/()+\-%&'#₹$*=\[\]]")


def rare_symbol_ratio(text: str) -> float:
    """Fraction of characters that are not letters/digits or allowed punctuation."""
    if not text:
        return 1.0
    return len(_RARE_RE.findall(text)) / len(text)


def is_noise_line(text: str) -> bool:
    """True for OCR lines that carry no readable word — never length-based."""
    t = str(text or "").strip()
    if not t:
        return True
    if not any(c.isalnum() for c in t):
        return True
    rare = len(_RARE_RE.findall(t))
    if rare and rare / len(t) >= 0.35 and len([c for c in t if c.isalnum()]) <= 1:
        return True
    if " " not in t and len(t) <= 6 and is_garbage_token(t):
        return True
    if len(set(t)) == 1 and set(t).isdisjoint(_ALNUM):
        return True
    return False


def is_garbage_token(token: str) -> bool:
    """True for embedded fragments like `x7@#` — drop them from merged text.
    Short tokens that carry ANY rare symbol are suspect; longer strings
    (emails, codes) only when symbol density is extreme."""
    t = str(token or "").strip()
    if not t:
        return True
    if not any(c.isalnum() for c in t):
        return True
    rare = len(_RARE_RE.findall(t))
    alnum_count = len([c for c in t if c.isalnum()])
    if rare > 0 and alnum_count <= 2 and len(t) <= 6:
        return True
    if rare_symbol_ratio(t) >= 0.5 and alnum_count <= 2:
        return True
    if re.fullmatch(r"([^0-9a-zA-Z])\1{2,}", t):
        return True
    return False


def _dedupe_key(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def filter_tokens(text: str) -> str:
    """Remove garbage tokens from merged OCR text (keeps short real values)."""
    return " ".join(t for t in str(text or "").split() if not is_garbage_token(t)).strip()


def _dedupe_repeats(text: str) -> str:
    """Collapse an immediately repeated word sequence inside one line, e.g.
    "Net Quantity: 250 g Net Quantity: 250 g" -> "Net Quantity: 250 g"."""
    words = text.split()
    n = len(words)
    for size in range(n // 2, 2, -1):
        if words[:size] == words[size : size * 2]:
            return " ".join(words[:size] + words[size * 2 :])
    return text


def clean_text(raw: str) -> str:
    t = str(raw or "")
    t = GARBAGE_RE.sub("", t)
    t = t.replace("''", '"').replace("..", ".").replace("--", "-")
    # OCR punctuation collisions: ",." and ".," are one punctuation, not two,
    # and a comma hanging before a line boundary belongs to the value ("150 g,").
    t = re.sub(r"[,.\s]+([,.;:])", r"\1", t)
    t = re.sub(r"\s+", " ", t).strip()
    t = _dedupe_repeats(t)
    return t


def collapse_whitespace(lines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Clean, noise-filter and de-duplicate an OCR line list. Duplicates keep
    the highest-confidence first occurrence."""
    out: List[Dict[str, Any]] = []
    seen: set = set()
    for ln in lines:
        t = clean_text(ln.get("text", ""))
        if not t or is_noise_line(t):
            continue
        key = _dedupe_key(t)
        if key in seen:
            continue
        seen.add(key)
        ln["text"] = t
        out.append(ln)
    return out


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