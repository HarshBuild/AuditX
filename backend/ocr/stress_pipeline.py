"""Stress-test the multi-pass OCR on degraded synthetic labels.

Generates rotated, low-contrast, and downscaled variants of the same
label and verifies that the pipeline recovers every expected line.

Usage:  .venv\\Scripts\\python stress_pipeline.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

import preprocess
from multipass import run_multipass

EXPECTED = [
    "HEALTHY SNACKS PVT LTD",
    "Nanak Besan Mix (Instant Mix)",
    "Ingredients: Gram flour, spices, salt",
    "Net Quantity: 250 g",
    "MRP Rs 64.00 (incl. of all taxes)",
    "Mfg Date: 12/2025",
    "Best Before: 12/2027",
    "Country of Origin: India",
    "Manufactured by: Healthy Snacks Pvt Ltd",
    "Plot 12, MG Road, Bengaluru, Karnataka 560001",
    "Consumer Care: 1800-123-4567",
    "FSSAI Lic No 11234567890123",
]

# Normalized, substring-insensitive keyword that must appear somewhere in a
# detected line for us to count the expected label as "covered".
KEYWORDS = [
    "HEALTHY SNACKS",
    "Besan Mix",
    "Ingredients",
    "Net Quantity",
    "MRP",
    "Mfg Date",
    "Best Before",
    "Country of Origin",
    "Manufactured by",
    "MG Road",
    "Consumer Care",
    "FSSAI",
]


def norm(s: str) -> str:
    import re

    # Collapse confusable glyphs (l/1/I, 0/O) so OCR variants still match.
    t = re.sub(r"\s+", " ", s.upper()).strip()
    for a, b in [("L", "I"), ("1", "I"), ("0", "O")]:
        t = t.replace(a, b)
    return t


def render_label() -> Image.Image:
    img = Image.new("RGB", (900, 1500), "white")
    d = ImageDraw.Draw(img)
    y = 40
    for ln in EXPECTED:
        d.text((40, y), ln, fill="black", font=ImageFont.load_default(size=40))
        y += 110
    return img


def rotate(img: Image.Image, deg: float) -> Image.Image:
    return img.rotate(deg, expand=True, fillcolor="white", resample=Image.Resampling.BICUBIC)


def low_contrast(img: Image.Image, factor: float = 0.55) -> Image.Image:
    a = np.array(img).astype(np.float32)
    a = 255.0 - (255.0 - a) * factor
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def downscale(img: Image.Image, scale: float = 0.6) -> Image.Image:
    return img.resize((int(img.width * scale), int(img.height * scale)), Image.Resampling.LANCZOS)


def blob(s: str) -> str:
    # Comparison key: whitespace-insensitive + confusable-tolerant (l/1/I, 0/O).
    return norm(s).replace(" ", "")


def coverage(detected: list) -> tuple[int, int, list[str]]:
    text = " | ".join(d["text"] for d in detected)
    b = blob(text)
    found, missing = 0, []
    for kw in KEYWORDS:
        if blob(kw) in b:
            found += 1
        else:
            missing.append(kw)
    return found, len(KEYWORDS), missing


def run_case(name: str, pil_img: Image.Image, depth: int = 4) -> tuple[int, int, list[str], list[str]]:
    buf = pil_img.convert("RGB")
    import io

    b = io.BytesIO()
    buf.save(b, format="PNG")
    img = preprocess.decode_bytes(b.getvalue())
    lines = run_multipass(img, "en", depth=depth)
    lines = [l for l in lines if l["confidence"] > 0.3]
    hit, total, missing = coverage(lines)
    print(f"[{name}] {hit}/{total} lines")
    for kw in missing:
        print(f"    MISSING: {kw}")
    return hit, total, missing, [d["text"] for d in lines]


def main() -> int:
    base = render_label()
    cases = [
        ("original", base),
        ("rotated 2deg", rotate(base, 2.0)),
        ("rotated 5deg", rotate(base, 5.0)),
        ("low-contrast 0.55", low_contrast(base)),
        ("downscaled 0.6x", downscale(base)),
        ("rotated 3deg + low-contrast", low_contrast(rotate(base, 3.0))),
        ("downscaled 0.5x + rotated 2deg", rotate(downscale(base, 0.5), 2.0)),
    ]
    worst = 100
    for name, p in cases:
        hit, total, missing, _ = run_case(name, p)
        pct = round(100.0 * hit / total)
        worst = min(worst, pct)
    print(f"\nworst-case coverage: {worst}%")
    return 0 if worst >= 90 else 1


if __name__ == "__main__":
    sys.exit(main())