"""
AuditX OCR microservice — FastAPI app (OPTIMIZED).
Endpoints:
  GET  /health                  -> service status
  POST /ocr                    -> multipart files or JSON base64 images
Body (multipart): files = [...]
Body (JSON):      { "images": ["data:image/...;base64,..."], "lang": "en", "fast": true }
Returns structured fields, rule results and verdict.

OPTIMIZATIONS:
- Fast OCR path first (no heavy preprocessing)
- Parallel image processing
- Targeted re-OCR only for low-confidence images
- Image resize/optimization before processing
- Simple in-memory cache for identical images
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import preprocess
import ocr as ocr_mod

app = FastAPI(title="AuditX OCR", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class OCRRequest(BaseModel):
    images: List[str]
    lang: str = "en"
    fast: bool = True  # Enable fast path by default


# Simple in-memory cache for identical images (hash -> result)
_OCR_CACHE: Dict[str, Dict[str, Any]] = {}
_CACHE_MAX_SIZE = 50

# Thread pool for parallel OCR
_OCR_EXECUTOR = ThreadPoolExecutor(max_workers=4)

# Confidence threshold for triggering enhanced OCR
LOW_CONFIDENCE_THRESHOLD = 0.65
MIN_MEAN_CONFIDENCE_FOR_FAST_PATH = 0.75


def _image_hash(img: np.ndarray) -> str:
    """Fast perceptual hash for caching."""
    # Use a small downscaled version for hashing
    small = preprocess.resize_for_hash(img)
    return hashlib.md5(small.tobytes()).hexdigest()[:16]


def _decode(data_url: str) -> np.ndarray:
    raw = data_url.split(",", 1)[1] if "," in data_url else data_url
    img = preprocess.decode_base64(raw)
    if img is None:
        raise HTTPException(400, "Invalid image data")
    return img


def _optimize_image(img: np.ndarray, max_dim: int = 1920) -> np.ndarray:
    """Resize image to max dimension while preserving aspect ratio.
    Reduces OCR processing time significantly without hurting accuracy."""
    h, w = img.shape[:2]
    if max(h, w) <= max_dim:
        return img
    scale = max_dim / max(h, w)
    new_w, new_h = int(w * scale), int(h * scale)
    return cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)


def _fast_ocr_single(img: np.ndarray, lang: str) -> Tuple[List[Dict[str, Any]], float]:
    """Fast OCR: single pass, no preprocessing. Returns (lines, mean_confidence)."""
    lines = ocr_mod.read_text(img, lang)
    if not lines:
        return [], 0.0
    mean_conf = float(np.mean([l["confidence"] for l in lines]))
    return lines, mean_conf


def _enhanced_ocr_single(img: np.ndarray, lang: str) -> Tuple[List[Dict[str, Any]], float]:
    """Enhanced OCR: full preprocessing + OCR. Returns (lines, mean_confidence)."""
    processed = preprocess.normalize(img)
    lines = ocr_mod.read_text(processed, lang)
    if not lines:
        return [], 0.0
    mean_conf = float(np.mean([l["confidence"] for l in lines]))
    return lines, mean_conf


def _run_fast_ocr_parallel(images: List[np.ndarray], lang: str) -> List[Tuple[List[Dict[str, Any]], float, np.ndarray]]:
    """Run fast OCR on all images in parallel. Returns [(lines, confidence, original_img), ...]"""
    results = []
    with ThreadPoolExecutor(max_workers=min(4, len(images))) as executor:
        futures = {executor.submit(_fast_ocr_single, img, lang): i for i, img in enumerate(images)}
        for future in as_completed(futures):
            i = futures[future]
            try:
                lines, conf = future.result()
                results.append((i, lines, conf, images[i]))
            except Exception as e:
                print(f"Fast OCR failed for image {i}: {e}")
                results.append((i, [], 0.0, images[i]))
    # Sort by original index
    results.sort(key=lambda x: x[0])
    return [(lines, conf, img) for _, lines, conf, img in results]


def _run_enhanced_ocr_parallel(images: List[np.ndarray], lang: str) -> List[Tuple[List[Dict[str, Any]], float]]:
    """Run enhanced OCR on specific images in parallel."""
    results = []
    with ThreadPoolExecutor(max_workers=min(4, len(images))) as executor:
        futures = {executor.submit(_enhanced_ocr_single, img, lang): i for i, img in enumerate(images)}
        for future in as_completed(futures):
            i = futures[future]
            try:
                lines, conf = future.result()
                results.append((i, lines, conf))
            except Exception as e:
                print(f"Enhanced OCR failed for image {i}: {e}")
                results.append((i, [], 0.0))
    results.sort(key=lambda x: x[0])
    return [(lines, conf) for _, lines, conf in results]


def _assemble_results(all_lines: List[List[Dict[str, Any]]]) -> Dict[str, Any]:
    """Assemble final result from OCR lines."""
    from correction import collapse_whitespace, join_ocr
    from fields import extract_all
    from rules import evaluate

    ocr_blocks = []
    combined = []
    for i, lines in enumerate(all_lines):
        lines = collapse_whitespace(lines)
        text = join_ocr(lines)
        conf = round(float(np.mean([l["confidence"] for l in lines]) if lines else 0), 3)
        ocr_blocks.append({"position": f"photo_{i+1}", "text": text, "confidence": conf, "lines": len(lines)})
        combined.append(text)
    ocr_text = " ".join(c for c in combined if c).strip()

    fields = extract_all(ocr_text)
    rules, result = evaluate(fields)

    return {
        "ok": True,
        "ocr_text": ocr_text,
        "ocr_blocks": ocr_blocks,
        "fields": {k: {"value": v["value"], "confidence": v["confidence"], "source": v.get("source")} for k, v in fields.items()},
        "rules": rules,
        "result": result,
    }


@app.get("/health")
def health() -> Dict[str, Any]:
    try:
        ready = ocr_mod.get_engine is not None
    except Exception:
        ready = False
    return {"ok": True, "service": "AuditX OCR", "paddle_ready": ready, "cache_size": len(_OCR_CACHE)}


@app.post("/ocr")
async def ocr_endpoint(request: Request) -> Dict[str, Any]:
    start_time = time.time()
    images: List[np.ndarray] = []
    lang = "en"
    fast_mode = True

    # ------------------------------------------------------------------
    # Accept EITHER multipart/form-data (files=…) OR application/json.
    # Manual parsing avoids the FastAPI mixing limitation where declaring
    # both UploadFile and a Pydantic body param silently rejects one.
    # ------------------------------------------------------------------
    content_type = request.headers.get("content-type", "")
    try:
        if "multipart/form-data" in content_type:
            form = await request.form()
            lang = str(form.get("lang") or "en")
            for f in form.getlist("files"):
                raw = await f.read()
                img = preprocess.decode_bytes(raw)
                if img is None:
                    raise HTTPException(400, f"Could not decode file {getattr(f, 'filename', None) or 'upload'}")
                images.append(img)
        else:
            data = json.loads(await request.body())
            lang = str((data.get("lang") or "en"))
            fast_mode = bool(data.get("fast", True))
            for d in (data.get("images") or []):
                if not isinstance(d, str):
                    raise HTTPException(400, "Each image must be a base64 data URL or base64 string.")
                images.append(_decode(d))
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "Send files (multipart) or {\"images\": [base64…], \"lang\": \"en\", \"fast\": true}")

    if not images:
        raise HTTPException(400, "No images provided")
    if len(images) > 6:
        raise HTTPException(400, "At most 6 photos per inspection")

    # Optimize images (resize large ones) BEFORE any processing
    images = [_optimize_image(img) for img in images]

    # Check cache for each image
    cached_results = []
    uncached_indices = []
    uncached_images = []
    
    for i, img in enumerate(images):
        img_hash = _image_hash(img)
        if img_hash in _OCR_CACHE:
            cached_results.append((i, _OCR_CACHE[img_hash]))
        else:
            uncached_indices.append(i)
            uncached_images.append(img)

    all_lines: List[Optional[List[Dict[str, Any]]]] = [None] * len(images)
    all_confidences: List[float] = [0.0] * len(images)
    reocr_needed = []

    # Process cached results
    for i, cached in cached_results:
        all_lines[i] = cached["lines"]
        all_confidences[i] = cached["confidence"]

    # Fast OCR path for uncached images
    if uncached_images:
        if fast_mode:
            # Fast OCR: single pass, no preprocessing
            fast_results = _run_fast_ocr_parallel(uncached_images, lang)
            
            for idx, (lines, conf, orig_img) in enumerate(fast_results):
                orig_i = uncached_indices[idx]
                all_lines[orig_i] = lines
                all_confidences[orig_i] = conf
                
                # Check if we need enhanced OCR
                if conf < LOW_CONFIDENCE_THRESHOLD:
                    reocr_needed.append((orig_i, orig_img))
                else:
                    # Cache good results
                    img_hash = _image_hash(orig_img)
                    _OCR_CACHE[img_hash] = {"lines": lines, "confidence": conf}
                    if len(_OCR_CACHE) > _CACHE_MAX_SIZE:
                        _OCR_CACHE.pop(next(iter(_OCR_CACHE)))
        else:
            # Legacy mode: full preprocessing for all
            enhanced_results = _run_enhanced_ocr_parallel(uncached_images, lang)
            for idx, (lines, conf) in enumerate(enhanced_results):
                orig_i = uncached_indices[idx]
                all_lines[orig_i] = lines
                all_confidences[orig_i] = conf
                # Cache
                img_hash = _image_hash(uncached_images[idx])
                _OCR_CACHE[img_hash] = {"lines": lines, "confidence": conf}

    # Targeted re-OCR for low-confidence images
    if reocr_needed:
        reocr_images = [img for _, img in reocr_needed]
        reocr_indices = [idx for idx, _ in reocr_needed]
        enhanced_results = _run_enhanced_ocr_parallel(reocr_images, lang)
        
        for idx, (lines, conf) in enumerate(enhanced_results):
            orig_i = reocr_indices[idx]
            # Use enhanced result if better
            if conf > all_confidences[orig_i]:
                all_lines[orig_i] = lines
                all_confidences[orig_i] = conf
            # Cache the better result
            img_hash = _image_hash(reocr_images[idx])
            _OCR_CACHE[img_hash] = {"lines": all_lines[orig_i], "confidence": all_confidences[orig_i]}
            if len(_OCR_CACHE) > _CACHE_MAX_SIZE:
                _OCR_CACHE.pop(next(iter(_OCR_CACHE)))

    # Filter out None entries
    final_lines = [lines for lines in all_lines if lines is not None]
    
    result = _assemble_results(final_lines)
    result["processing_time_ms"] = round((time.time() - start_time) * 1000, 1)
    result["cache_hits"] = len(cached_results)
    result["reocr_count"] = len(reocr_needed)
    return result


if __name__ == "__main__":
    import os
    import uvicorn
    import cv2  # noqa: F401
    port = int(os.getenv("PORT", "8100"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, workers=1)