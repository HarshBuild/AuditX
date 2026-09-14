"""
AuditX OCR microservice — OpenCV preprocessing.
Pipeline matching the spec: deskew → perspective → denoise → sharpen → contrast.
Each photo is normalized before PaddleOCR reads it.
"""
from __future__ import annotations

import cv2
import numpy as np


def deskew(img: np.ndarray) -> np.ndarray:
    """Correct small rotation skw using min area rect of text contours."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    inv = cv2.bitwise_not(gray)
    coords = np.column_stack(np.where(inv > 0))
    if coords.size == 0:
        return img
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle
    if abs(angle) < 0.5:
        return img
    (h, w) = img.shape[:2]
    m = cv2.getRotationMatrix2D((w // 2, h // 2), angle, 1.0)
    return cv2.warpAffine(img, m, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


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