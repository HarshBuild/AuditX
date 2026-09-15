"""
AuditX OCR microservice — OpenCV preprocessing.
Pipeline matching the spec: deskew → perspective → denoise → sharpen → contrast.
Each photo is normalized before PaddleOCR reads it.
"""
from __future__ import annotations

import math
from typing import List, Tuple

import cv2
import numpy as np


def deskew(img: np.ndarray) -> np.ndarray:
    """Correct small rotation skew from dominant text-line angles.

    Uses the median angle of near-horizontal Hough line segments. This is far
    more reliable than the old minAreaRect-over-all-ink approach, which could
    transpose the image when the label is tall (a 90° flip that collapsed every
    OCR box onto one row). Returns the image unchanged when the angle is not a
    small, confident rotation (never guesses).
    """
    from typing import Optional
    angle = _text_line_angle(img)
    if angle is None or abs(angle) < 0.5 or abs(angle) > 12:
        return img
    (h, w) = img.shape[:2]
    m = cv2.getRotationMatrix2D((w // 2, h // 2), -angle, 1.0)
    return cv2.warpAffine(img, m, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def _text_line_angle(img: np.ndarray) -> "float | None":
    """Median angle (degrees) of near-horizontal text lines, or None when weak."""
    try:
        g = _gray(img)
    except Exception:
        return None
    if g.size == 0:
        return None
    blur = cv2.GaussianBlur(g, (3, 3), 0)
    edges = cv2.Canny(blur, 50, 150)
    try:
        lines = cv2.HoughLinesP(
            edges, 1, math.pi / 720.0, threshold=60,
            minLineLength=max(24, g.shape[1] // 9), maxLineGap=12
        )
    except Exception:
        return None
    if lines is None or len(lines) == 0:
        return None
    angles = []
    for ln in lines:
        x1, y1, x2, y2 = ln[0]
        dx, dy = x2 - x1, y2 - y1
        if abs(dx) < 2:
            continue
        ang = math.degrees(math.atan2(dy, dx))
        if abs(ang) <= 30:
            # near-horizontal lines only; vertical/side panels are not auto-rotated
            angles.append(ang)
    if len(angles) < 3:
        return None
    return float(np.median(angles))


def perspective_correct(img: np.ndarray) -> np.ndarray:
    """Straighten a mildly tilted package using largest 4-point contour."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 50, 150)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return img
    cnt = max(contours, key=cv2.contourArea)
    rect = cv2.minAreaRect(cnt)
    box = cv2.boxPoints(rect)
    # angle-based correction is handled by deskew; here we just crop tight
    (h, w) = img.shape[:2]
    x, y = int(box[:, 0].min()), int(box[:, 1].min())
    x2, y2 = int(box[:, 0].max()), int(box[:, 1].max())
    x, y = max(0, x), max(0, y)
    x2, y2 = min(w, x2), min(h, y2)
    if x2 - x < 32 or y2 - y < 32:
        return img
    return img[y:y2, x:x2]


def denoise(img: np.ndarray) -> np.ndarray:
    return cv2.fastNlMeansDenoisingColored(img, None, 8, 8, 7, 21) if img.ndim == 3 else cv2.fastNlMeansDenoising(img, None, 8, 7, 21)


def sharpen(img: np.ndarray) -> np.ndarray:
    blur = cv2.GaussianBlur(img, (0, 0), 3.0)
    return cv2.addWeighted(img, 1.5, blur, -0.5, 0)


def adaptive_contrast(img: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    out = clahe.apply(gray)
    return cv2.cvtColor(out, cv2.COLOR_GRAY2BGR) if img.ndim == 3 else out


def normalize(img: np.ndarray) -> np.ndarray:
    """Full preprocessing chain. Returns a clean copy ready for OCR."""
    out = img.copy()
    out = deskew(out)
    out = perspective_correct(out)
    out = denoise(out)
    out = sharpen(out)
    out = adaptive_contrast(out)
    return out


def decode_bytes(raw: bytes) -> np.ndarray | None:
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img


def decode_base64(b64: str) -> np.ndarray | None:
    import base64
    try:
        return decode_bytes(base64.b64decode(b64))
    except Exception:
        return None


def resize_for_hash(img: np.ndarray, max_dim: int = 128) -> np.ndarray:
    """Resize image to small fixed size for fast perceptual hashing."""
    h, w = img.shape[:2]
    if max(h, w) <= max_dim:
        return img
    scale = max_dim / max(h, w)
    new_w, new_h = int(w * scale), int(h * scale)
    return cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)


# ---------------------------------------------------------------------------
# Adaptive / region-level helpers (evidence-based OCR)
# ---------------------------------------------------------------------------

def _gray(img: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img


def blur_score(img: np.ndarray) -> float:
    """Variance of Laplacian — lower means blurrier."""
    g = _gray(img)
    if g.size == 0:
        return 0.0
    return float(cv2.Laplacian(g, cv2.CV_64F).var())


def rotation_deg(img: np.ndarray) -> float:
    """Estimate label skew (degrees) from dominant near-horizontal text lines.
    Used only as an honest quality signal — never auto-rotates."""
    g = _gray(img)
    blur = cv2.GaussianBlur(g, (3, 3), 0)
    edges = cv2.Canny(blur, 50, 150)
    try:
        lines = cv2.HoughLinesP(
            edges, 1, np.pi / 720.0, threshold=60,
            minLineLength=max(20, g.shape[1] // 8), maxLineGap=12
        )
    except Exception:
        return 0.0
    if lines is None or len(lines) == 0:
        return 0.0
    angles = []
    for ln in lines:
        x1, y1, x2, y2 = ln[0]
        dx, dy = x2 - x1, y2 - y1
        if abs(dx) < 1:
            continue
        ang = math.degrees(math.atan2(dy, dx))
        if abs(ang) < 40.0:
            angles.append(ang)
    if not angles:
        return 0.0
    return round(float(np.median(angles)), 1)


def estimate_quality(img: np.ndarray) -> dict:
    """Cheap, non-OCR image-quality assessment used for honest prompts and
    the trust-score 'image quality' signal. No heavy processing."""
    h, w = img.shape[:2]
    g = _gray(img).astype(np.float32)
    mean_ = float(np.mean(g))
    std_ = float(np.std(g))
    blur = blur_score(img)
    blur_pct = float(np.clip(100 - (blur / 40.0) * 100, 0, 100))  # lower blur -> higher pct
    res_score = float(np.clip((min(h, w) / 900.0) * 100, 0, 100))
    # brightness not too dark (<35) and not blown out (>235)
    bright_pct = float(np.clip(100 - (abs(mean_ - 140) * 1.1), 20, 100))
    contrast_pct = float(np.clip(100 - (abs(std_ - 70) * 1.2), 20, 100))
    rot = rotation_deg(img)
    rot_pct = float(np.clip(100 - abs(rot) * 8.0, 0, 100))
    overall = round(0.28 * blur_pct + 0.22 * res_score + 0.18 * bright_pct + 0.22 * contrast_pct + 0.10 * rot_pct, 1)
    issues = []
    if blur < 90:
        issues.append("Image is blurry — retake the photo closer to the label.")
    if min(h, w) < 500:
        issues.append("Image resolution is low — capture the label more closely.")
    if mean_ < 45:
        issues.append("Image is too dark — use better lighting.")
    if mean_ > 215:
        issues.append("Image is over-exposed — reduce glare/lighting.")
    if abs(rot) >= 4:
        issues.append(f"Image appears rotated by {abs(rot):.0f} degrees — straighten the label.")
    if not issues:
        issues.append("Image quality looks good.")
    return {
        "score": overall,
        "resolution": [w, h],
        "blur_score": round(blur, 2),
        "brightness": round(mean_, 1),
        "contrast": round(std_, 1),
        "rotation_deg": rot,
        "verdict": "good" if overall >= 75 else "acceptable" if overall >= 50 else "poor",
        "message": " ".join(issues),
    }


def needs_enhancement(img: np.ndarray) -> bool:
    """Decide whether a crop needs preprocessing BEFORE targeted re-OCR.
    Only enhance when the region is blurry, dull, or very low resolution."""
    if img.size == 0:
        return False
    h, w = img.shape[:2]
    if min(h, w) < 160:
        return True
    return blur_score(img) < 120 or float(np.std(_gray(img))) < 30


def enhance(img: np.ndarray) -> np.ndarray:
    """Light, crop-appropriate enhancement: denoise -> CLAHE contrast -> sharpen."""
    out = img.copy()
    if out.ndim == 3:
        out = cv2.fastNlMeansDenoisingColored(out, None, 6, 6, 5, 15)
    else:
        out = cv2.fastNlMeansDenoising(out, None, 6, 5, 15)
    gray = _gray(out)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    gray = clahe.apply(gray)
    out = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR) if out.ndim == 3 else gray
    blr = cv2.GaussianBlur(out, (0, 0), 2.0)
    out = cv2.addWeighted(out, 1.4, blr, -0.4, 0)
    return out


def crop_region(img: np.ndarray, region: tuple, margin_fraction: float = 0.12) -> np.ndarray:
    """Extract a region [x,y,w,h] plus a small margin, clamped to image bounds."""
    h, w = img.shape[:2]
    x, y, rw, rh = (int(v) for v in region)
    mx = max(6, int(rw * margin_fraction))
    my = max(6, int(rh * margin_fraction))
    x0, y0 = max(0, x - mx), max(0, y - my)
    x1, y1 = min(w, x + rw + mx), min(h, y + rh + my)
    if x1 - x0 < 8 or y1 - y0 < 8:
        return img[y:y + rh, x:x + rw].copy()
    return img[y0:y1, x0:x1].copy()


def upscale_for_ocr(img: np.ndarray, min_side: int = 420) -> np.ndarray:
    """Upscale a small crop so tiny label text becomes readable by OCR. No-op
    when the crop is already large enough."""
    h, w = img.shape[:2]
    if min(h, w) >= min_side:
        return img
    scale = min_side / float(min(h, w))
    return cv2.resize(img, (max(2, int(w * scale)), max(2, int(h * scale))), interpolation=cv2.INTER_CUBIC)


# ---------------------------------------------------------------------------
# Multi-pass preprocessing variants (spec §2/§3).
#
# The same photo is read under several different normalizations because one
# pass can always miss some text: faint/low-contrast glyphs, small fonts,
# glare, busy backgrounds. Combined by the multipass module these variants
# DRAMATICALLY increase coverage without ever inventing text.
# ---------------------------------------------------------------------------

def _as_bgr(img: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(img, cv2.COLOR_GRAY2BGR) if img.ndim == 2 else img


def variant_contrast(img: np.ndarray, upscale: bool = False) -> np.ndarray:
    """CLAHE contrast-boosted grayscale (kept as 3-channel for the OCR API)."""
    gray = _gray(img)
    out = img.copy()
    if min(gray.shape[0], gray.shape[1]) < 260 and upscale:
        gray = cv2.resize(gray, (gray.shape[1] * 2, gray.shape[0] * 2), interpolation=cv2.INTER_CUBIC)
        out = cv2.resize(out, (out.shape[1] * 2, out.shape[0] * 2), interpolation=cv2.INTER_CUBIC)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    boosted = clahe.apply(gray)
    return _as_bgr(boosted)


def variant_binary(img: np.ndarray) -> np.ndarray:
    """Otsu binarization — turns faint grey glyphs into solid black-on-white."""
    gray = _gray(img)
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    _, thresh = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return _as_bgr(thresh)


def variant_sharpen(img: np.ndarray) -> np.ndarray:
    """Denoise + CLAHE + strong sharpening — for slightly blurry photos."""
    out = img.copy()
    if out.ndim == 3:
        out = cv2.fastNlMeansDenoisingColored(out, None, 5, 5, 5, 15)
    else:
        out = cv2.fastNlMeansDenoising(out, None, 5, 5, 15)
    gray = _gray(out)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    gray = clahe.apply(gray)
    out = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR) if out.ndim == 3 else gray
    blr = cv2.GaussianBlur(out, (0, 0), 1.5)
    return cv2.addWeighted(out, 1.6, blr, -0.6, 0)


def variant_deskew(img: np.ndarray) -> np.ndarray:
    """Skew-corrected copy (safe: no-op when already straight)."""
    return deskew(img)


def make_variants(img: np.ndarray, depth: int = 3) -> List[Tuple[str, np.ndarray]]:
    """Build the preprocessing variants OCR should be run over.

    depth 1 = original only (legacy fast path)
    depth 2 = + contrast          (recommended fast path)
    depth 3 = + binary + sharpen  (full accuracy path)
    depth 4 = + deskew + upscale  (maximum recovery for hard photos)
    """
    variants: List[Tuple[str, np.ndarray]] = [("original", img)]
    if depth >= 2:
        try:
            variants.append(("contrast", variant_contrast(img)))
        except Exception:
            pass
    if depth >= 3:
        try:
            variants.append(("binary", variant_binary(img)))
        except Exception:
            pass
        try:
            variants.append(("sharpen", variant_sharpen(img)))
        except Exception:
            pass
    if depth >= 4:
        try:
            variants.append(("deskew", variant_deskew(img)))
        except Exception:
            pass
        try:
            variants.append(("upscaled", upscale_for_ocr(img)))
        except Exception:
            pass
    # De-duplicate variants that produced identical arrays (tiny images).
    seen: List[np.ndarray] = []
    out: List[Tuple[str, np.ndarray]] = []
    for name, v in variants:
        if any(v.shape == s.shape and np.array_equal(v, s) for s in seen):
            continue
        seen.append(v)
        out.append((name, v))
    return out