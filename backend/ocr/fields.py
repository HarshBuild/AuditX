"""
AuditX OCR microservice — field extraction with regexes on corrected OCR text.
Every field carries value, confidence (high/medium/low) and the source line.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List

from correction import clean_text, digitize, join_ocr, normalize_value

MRP_RE = re.compile(
    r"(?:(?:mrp|max(?:imum)?\s*retail\s*price|m\.?\s*r\.?\s*p\.?)[:.\s]*"
    r"(?:rs\.?|inr|rupees|\u20b9)?\s*[0-9][0-9,.]*)"
    r"|(?:(?:incl(?:usive)?\.?\s*(?:of)?\s*all\s*taxes)|(?:incl\.?\s*of\s*all\s*taxes))?",
    re.IGNORECASE,
)
MRP_VALUE_RE = re.compile(r"(?:rs\.?|inr|\u20b9)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\b", re.IGNORECASE)

NET_QTY_RE = re.compile(
    r"(?i)(?:net\s*(?:qty|wt|weight|quantity|contents)?\s*[:.]?\s*)"
    r"([0-9][0-9.,]*(?:\s*x\s*[0-9.,]+)?)\s*(kg|g|gm|grams?|ml|millilitre|litre|l\b|lb|oz|mtr|cm|m\b|pcs|units?)",
)
MULTIPACK_RE = re.compile(r"(?i)([0-9]+)\s*x\s*([0-9.,]+)\s*(kg|g|gm|ml|litre|l|mtr|cm|m|pcs)")

MFG_RE = re.compile(
    r"(?i)(?:mfg|mfr|manufactur(?:ed|ing)?|made|packed|pkd)\s*(?:date|dt|month)?\s*[:.]?\s*"
    r"((?:\d{1,2}[/-]\d{1,2}[/-](?:19|20)?\d{2})"          # dd/mm/yyyy or dd-mm-yy
    r"|(?:\d{1,2}[/-](?:19|20)?\d{2})"                     # mm/yyyy or mm/yy
    r"|(?:[a-z]{3,9}\.?\s+[0-9]{2,4}))"                    # MMM yyyy
)
BEST_BEFORE_RE = re.compile(
    r"(?i)(?:best\s*before|best-by|use\s*by|exp(?:iry|ires|\.)?|expiration)\s*[:.]?\s*"
    r"((?:\d{1,2}[/-]\d{1,2}[/-](?:19|20)?\d{2})"          # dd/mm/yyyy
    r"|(?:\d{1,2}[/-](?:19|20)?\d{2})"                     # mm/yyyy
    r"|(?:\d{1,2}\s+[a-z]{3,9}\.?\s*\d{2,4})"              # dd MMM yyyy
    r"|([0-9]{1,3}\s*(?:month|months|day|days|year|years)(?:\s*from\s*manufacture)?)"  # shelf life
    r"|(\d{1,2}/(?:19|20)?\d{2}))"
)
ORIGIN_RE = re.compile(
    r"(?i)(?:made in|country of origin|product of|manufactured in)\s*[:.]?\s*"
    r"([A-Za-z]{3,40}(?:\s+&?\s*[A-Za-z]{3,40})?)"
    r"[,.]?(?=\s+(?:consumer|customer|helpline|best|use|exp|mfg|net|mrp|fssai|lic|packed|manufactured|imported|address|batch|\dx|\d)|$)"
)
CARE_RE = re.compile(
    r"(?i)(?:consumer care|customer care|helpline|toll[- ]?free|help ?line)\s*[:.\s]*"
    r"((?:\+?91[- ]?)?(?:1800[- ]?\d{3}[- ]?\d{3,4}|[6-9]\d{4}[- ]?\d{5}|[6-9]\d{9})|"
    r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})"
)
FSSAI_RE = re.compile(r"(?<!\d)([12]\d{13})(?!\d)")
LIC_RE = re.compile(r"(?i)(?:lic(?:ence)?|fssai|regd\.?)\s*(?:no|number)?\s*[:.]?\s*([12]\d{13})")
ADDRESS_STATE_RE = re.compile(r"\b(?:andra pradesh|arunachal|assam|bihar|chhattisgarh|goa|gujarat|haryana|himachal|jammu|jharkhand|karnataka|kerala|madhya pradesh|maharashtra|manipur|meghalaya|mizoram|nagaland|odisha|punjab|rajasthan|sikkim|tamil nadu|telangana|tripura|uttar pradesh|uttarakhand|west bengal|delhi|puducherry|chandigarh|dadra|daman|diu|ladakh|lakshadweep|andaman|nicobar)\b", re.IGNORECASE)
PIN_RE = re.compile(r"\b[1-9][0-9]{5}\b")
PHONE_RE = re.compile(r"(?:\+?91[- ]?)?(?:1800[- ]?\d{3}[- ]?\d{3,4}|\d{5}[- ]?\d{5}|[6-9]\d{9})")
EMAIL_RE = re.compile(r"[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}", re.IGNORECASE)
VEG_RE = re.compile(r"\bveg(?:etarian)?\b", re.IGNORECASE)
NONVEG_RE = re.compile(r"\b(?:non\s*-?\s*veg|non-vegetarian)\b", re.IGNORECASE)

_UNITS = re.compile(r"[:.]?\s*(oz|lbs?|lb|kg|g|gm|ml|l|litre|mtr|cm|m|pcs|units?)$", re.IGNORECASE)


def extract_mrp(ocr_text: str) -> Dict[str, Any]:
    m = re.search(r"(?i)(?:mrp|max(?:imum)?\s*retail\s*price|m\.?\s*r\.?\s*p\.?)\s*(?:is|:)?\s*"
                  r"(?:rs\.?|inr|\u20b9)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)", ocr_text)
    if not m:
        return {"value": None, "confidence": "low", "source": None}
    val = m.group(1).replace(",", "")
    return {"value": f"Rs {val}", "confidence": "high", "source": m.group(0)}


def extract_net_quantity(ocr_text: str) -> Dict[str, Any]:
    multi = MULTIPACK_RE.search(ocr_text)
    if multi:
        return {"value": f"{multi.group(1)} x {multi.group(2)} {multi.group(3)}", "confidence": "high", "source": multi.group(0)}
    m = NET_QTY_RE.search(ocr_text)
    if not m:
        return {"value": None, "confidence": "low", "source": None}
    val = m.group(1).replace(",", "") + " " + m.group(2).lower()
    return {"value": val, "confidence": "high", "source": m.group(0)}


def extract_dates(ocr_text: str) -> tuple[Dict[str, Any], Dict[str, Any]]:
    mfg = MFG_RE.search(ocr_text)
    bb = BEST_BEFORE_RE.search(ocr_text)
    mfg_res = {"value": mfg.group(1) if mfg else None, "confidence": "high" if mfg else "low", "source": mfg.group(0) if mfg else None}
    bb_res = {"value": bb.group(1) if bb else None, "confidence": "high" if bb else "low", "source": bb.group(0) if bb else None}
    return mfg_res, bb_res


def extract_origin(ocr_text: str) -> Dict[str, Any]:
    m = ORIGIN_RE.search(ocr_text)
    if not m:
        return {"value": None, "confidence": "low", "source": None}
    val = clean_text(m.group(1)).rstrip(".").strip()
    return {"value": val or None, "confidence": "high", "source": m.group(0)}


def extract_consumer_care(ocr_text: str) -> Dict[str, Any]:
    m = CARE_RE.search(ocr_text)
    if not m:
        return {"value": None, "confidence": "low", "source": None}
    val = clean_text(m.group(1))
    return {"value": val, "confidence": "high", "source": m.group(0)}


def extract_fssai(ocr_text: str) -> Dict[str, Any]:
    for rx in (LIC_RE, FSSAI_RE):
        m = re.search(rx, ocr_text)
        if m:
            return {"value": m.group(1) if m.lastindex else m.group(0), "confidence": "high", "source": m.group(0)}
    return {"value": None, "confidence": "low", "source": None}


def extract_brand_manufacturer(ocr_text: str) -> Dict[str, Any]:
    """Best-effort brand/company name from 'Manufactured by ...' lines."""
    m = re.search(
        r"(?i)(?:manufactur(?:ed|ing)?|packed|marketed|distributed)\s*by\s*[:.]?\s*"
        r"([A-Za-z][A-Za-z0-9 .&'-]{3,60}?)"
        r"(?=[,:.](?: |$)|(?:\s+(?:regd|works|plot|addr(?:ess)?|\d))|\|)",
        ocr_text,
    )
    if m:
        val = clean_text(re.sub(r"[,.]\s*$", "", m.group(1))).strip()
        return {"value": val or None, "confidence": "medium", "source": m.group(0)}
    return {"value": None, "confidence": "low", "source": None}


def extract_address(ocr_text: str) -> Dict[str, Any]:
    anchor = ADDRESS_STATE_RE.search(ocr_text) or PIN_RE.search(ocr_text)
    if not anchor:
        return {"value": None, "confidence": "low", "source": None}
    # Backtrack from the state/pin anchor to the previous labelled segment
    # (e.g. "Consumer Care:", "Manufactured by:") so the address starts cleanly.
    head = ocr_text[:anchor.start()]
    boundary = list(
        re.finditer(
            r"(consumer care|customer care|helpline|toll[- ]?free|help ?line|manufactur(?:ed|ing)?|packed|marketed|imported|distributed|reg(?:istered)? ?office)\s*(?:by)?\s*[:.\s]*",
            head,
            flags=re.IGNORECASE,
        )
    )
    if boundary:
        start = boundary[-1].end()
    else:
        start = max(0, anchor.start() - 80)
    chunk = ocr_text[start:anchor.end() + 40]
    # drop a leading contact number that precedes the street address.
    chunk = re.sub(r"^\s*\+?[\d()\s-]{7,}\s*(?=[A-Za-z0-9])", "", chunk)
    # drop a dangling tail like "Manufactured by: Healthy Snacks" after the pin.
    chunk = re.sub(
        r"(?:\s*(?:manufactur(?:ed|ing)?|packed|marketed|imported|distributed)\s*(?:by)?\s*[:.\s]*[^.:,]{0,80}$)+",
        "",
        chunk,
        flags=re.IGNORECASE,
    )
    val = clean_text(chunk).strip()
    return {"value": val or None, "confidence": "medium", "source": chunk}


def extract_veg(ocr_text: str) -> Dict[str, Any]:
    if NONVEG_RE.search(ocr_text):
        return {"value": "nonveg", "confidence": "high", "source": NONVEG_RE.search(ocr_text).group(0)}
    if VEG_RE.search(ocr_text):
        return {"value": "veg", "confidence": "high", "source": VEG_RE.search(ocr_text).group(0)}
    return {"value": None, "confidence": "low", "source": None}


def extract_all(ocr_text: str) -> Dict[str, Dict[str, Any]]:
    mfg, bb = extract_dates(ocr_text)
    out = {
        "mrp": extract_mrp(ocr_text),
        "net_quantity": extract_net_quantity(ocr_text),
        "unit_sale_price": {"value": None, "confidence": "low", "source": None},
        "manufacturer": extract_brand_manufacturer(ocr_text),
        "packer": extract_brand_manufacturer(ocr_text),
        "mfg_date": mfg,
        "best_before": bb,
        "country_of_origin": extract_origin(ocr_text),
        "consumer_care": extract_consumer_care(ocr_text),
        "fssai_license": extract_fssai(ocr_text),
        "address": extract_address(ocr_text),
        "veg_nonveg": extract_veg(ocr_text),
    }
    # commodity/generic name: first non-label, non-number line — best effort
    out["commodity_name"] = {"value": None, "confidence": "low", "source": None}
    return out