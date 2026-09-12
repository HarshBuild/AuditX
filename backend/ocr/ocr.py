"""
AuditX OCR microservice — PaddleOCR wrapper (v2.7 API, paddlepaddle 2.6.2 CPU).
Lazily initializes the PaddleOCR engine (first call downloads models).
Returns per-line text, bounding box and confidence for the full image.
"""
from __future__ import annotations

import threading
from typing import Any, Dict, List

import numpy as np

_engine: Any = None
_engine_lock = threading.Lock()

SUPPORTED_LANGS = ("en", "hi", "bn", "ta", "te")  # add more as needed


def get_engine(lang: str = "en") -> Any:
    """Return the shared PaddleOCR engine, initializing on first use."""
    global _engine
    if lang not in SUPPORTED_LANGS:
        lang = "en"
    with _engine_lock:
        if _engine is None:
            import paddle
            paddle.set_flags({"FLAGS_enable_pir_api": False})
            from paddleocr import PaddleOCR
            _engine = PaddleOCR(use_angle_cls=True, lang=lang, show_log=False, use_gpu=False)
        return _engine


def read_text(img: np.ndarray, lang: str = "en") -> List[Dict[str, Any]]:
    """Run OCR. Returns [{"text","confidence","box":[[x,y] x4]}, ...]."""
    engine = get_engine(lang)
    result = engine.ocr(img, cls=True)
    lines: List[Dict[str, Any]] = []
    # v2.x result is [ [ [box, (text, conf)], ... ] ] (one page entry)
    for page in result or []:
        if not page:
            continue
        for det in page:
            try:
                box, (text, conf) = det
            except Exception:
                continue
            lines.append({"text": str(text), "confidence": float(conf), "box": [[float(x), float(y)] for x, y in box]})
    return lines


def read_texts(imgs: List[np.ndarray], lang: str = "en") -> List[List[Dict[str, Any]]]:
    return [read_text(im, lang) for im in imgs]