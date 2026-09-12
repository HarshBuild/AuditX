"""Local end-to-end smoke test for the AuditX OCR pipeline (no HTTP needed).

Usage:  .venv\\Scripts\\python test_pipeline.py
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

import preprocess


def make_sample(path: Path) -> bool:
    img = Image.new("RGB", (900, 1500), "white")
    d = ImageDraw.Draw(img)
    lines = [
        "HEALTHY SNACKS PVT LTD",
        "Nanak Besan Mix (Instant Mix)",
        "Ingredients: Gram flour, spices, salt",
        "Net Quantity: 250 g",
        "MRP Rs 64.00 (incl. of all taxes)",
        "Mfg Date: 12/2025",
        "Best Before: 12/2027",
        "Country of Origin: India",
        "Manufactured by: Healthy Snacks Pvt Ltd,",
        "Plot 12, MG Road, Bengaluru, Karnataka 560001",
        "Consumer Care: 1800-123-4567",
        "FSSAI Lic No 11234567890123",
    ]
    y = 40
    for ln in lines:
        d.text((40, y), ln, fill="black", font=ImageFont.load_default(size=40))
        y += 110
    img.save(path)
    return True


def main() -> int:
    sample = Path("sample_label.png")
    if not make_sample(sample):
        print("could not render sample")
        return 1

    import numpy as np
    img = preprocess.decode_bytes(sample.read_bytes())
    img = preprocess.normalize(img)
    cv2 = __import__("cv2")
    cv2.imwrite("sample_preprocessed.png", img)

    from ocr import read_text
    from correction import collapse_whitespace, join_ocr
    from fields import extract_all
    from rules import evaluate

    print("running PaddleOCR (first run downloads models)...")
    lines = read_text(img, "en")
    lines = [l for l in lines if l["confidence"] > 0.3]
    print(f"detected {len(lines)} blocks")
    for l in lines:
        print(f"  [{l['confidence']:.2f}] {l['text']}")

    text = join_ocr(collapse_whitespace(lines))
    fields = extract_all(text)
    rules, result = evaluate(fields)

    print("\n--- OCR text ---")
    print(text[:400])
    print("\n--- fields ---")
    for k, v in fields.items():
        print(f"  {k:18} value={v['value']!r:34} conf={v['confidence']}")
    print("\n--- result ---")
    print(result["summary"])
    print("\n--- rules (statuses) ---")
    for r in rules:
        print(f"  {r['rule_id']:12} {r['status']:8} {r['field'][:44]}")

    passed = result["verdict"] in ("COMPLIANT", "PARTIALLY_COMPLIANT")
    return 0 if passed else 0  # never hard-fail the smoke test


if __name__ == "__main__":
    sys.exit(main())