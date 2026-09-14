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

# Missed-text-region detection (#9): how many candidate gaps to re-OCR per image
MAX_MISSED_REGIONS_PER_IMAGE = 3


def _image_hash(img: np.ndarray) -> str:
    """Fast perceptual hash for caching."""
    # Use a small downscaled version for hashing
    small = preprocess.resize_for_hash(img)
    return hashlib.md5(small.tobytes()).hexdigest()[:16]


def _rect_from_box(box) -> Optional[List[int]]:
    """Convert a PaddleOCR quad [[x,y]x4] into a [x,y,width,height] rect."""
    if not box:
        return None
    try:
        xs = [float(p[0]) for p in box]
        ys = [float(p[1]) for p in box]
        x, y = int(min(xs)), int(min(ys))
        w, h = int(max(xs)) - x, int(max(ys)) - y
        if w < 1 or h < 1:
            return None
        return [x, y, w, h]
    except Exception:
        return None


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


def _assemble_results(all_lines: List[Optional[List[Dict[str, Any]]]], missed_checked: Optional[List[int]] = None) -> Dict[str, Any]:
    """Assemble final result from OCR lines."""
    from correction import collapse_whitespace, join_ocr
    from fields import extract_all
    from rules import evaluate

    ocr_blocks = []
    blocks_detail = []
    combined = []
    for i, lines in enumerate(all_lines):
        if not lines:
            continue
        lines = collapse_whitespace(lines)
        text = join_ocr(lines)
        conf = round(float(np.mean([l["confidence"] for l in lines]) if lines else 0), 3)
        ocr_blocks.append({"position": f"photo_{i+1}", "text": text, "confidence": conf, "lines": len(lines)})
        per = {"image_id": f"image_{i+1}", "blocks": []}
        for j, ln in enumerate(lines):
            rect = _rect_from_box(ln.get("box"))
            if not rect:
                continue
            per["blocks"].append({
                "text": str(ln.get("text", "")),
                "confidence": round(float(ln.get("confidence", 0)), 3),
                "region": rect,
                "region_id": f"img{i+1}_r{j+1}",
                "enhanced": bool(ln.get("enhanced", False)),
            })
        if per["blocks"]:
            per["text_regions_detected"] = len(per["blocks"])
            per["lines_extracted"] = len(per["blocks"])
            per["missed_regions_checked"] = int(missed_checked[i]) if missed_checked else 0
            blocks_detail.append(per)
        combined.append(text)
    ocr_text = " ".join(c for c in combined if c).strip()

    fields = extract_all(ocr_text)
    rules, result = evaluate(fields)

    return {
        "ok": True,
        "ocr_text": ocr_text,
        "ocr_blocks": ocr_blocks,
        "blocks_detail": blocks_detail,
        "fields": {k: {"value": v["value"], "confidence": v["confidence"], "source": v.get("source")} for k, v in fields.items()},
        "rules": rules,
        "result": result,
    }


def _detect_missed_regions(rects: List[List[int]]) -> List[List[int]]:
    """Heuristic: rows of detected text boxes often leave internal vertical gaps
    where small/unreadable text was missed. Returns candidate [x,y,w,h] regions
    for the largest in-band gaps. Pure geometry — never fabricates text."""
    if len(rects) < 2:
        return []
    area_x0 = int(min(r[0] for r in rects))
    area_x1 = int(max(r[0] + r[2] for r in rects))
    area_y0 = int(min(r[1] for r in rects))
    area_y1 = int(max(r[1] + r[3] for r in rects))
    if area_x1 - area_x0 < 40 or area_y1 - area_y0 < 24:
        return []
    med_h = float(np.median([r[3] for r in rects]))
    # Merge vertically-overlapping rows into horizontal bands
    rows = sorted(rects, key=lambda r: r[1])
    bands: List[List[int]] = []
    for r in rows:
        top, bot = r[1], r[1] + r[3]
        if bands and top <= bands[-1][1] + max(6, med_h * 0.35):
            bands[-1][1] = max(bands[-1][1], bot)
        else:
            bands.append([top, bot])
    bands.sort(key=lambda b: b[0])
    candidates: List[List[int]] = []
    for a, b in zip(bands, bands[1:]):
        gap_top, gap_bot = a[1], b[0]
        gap_h = gap_bot - gap_top
        # A real missed row is usually at least ~half a text-line tall
        if gap_h < max(8, med_h * 0.55):
            continue
        candidates.append([area_x0, gap_top, area_x1 - area_x0, gap_h])
        if len(candidates) >= MAX_MISSED_REGIONS_PER_IMAGE:
            break
    return candidates


def _run_missed_region_ocr(img: np.ndarray, lines: List[Dict[str, Any]], lang: str) -> Tuple[List[Dict[str, Any]], List[List[int]], int]:
    """Auto-OCR likely-missed text regions. Returns (extra_lines, found_rects, checked)."""
    rects = [r for l in lines if (r := _rect_from_box(l.get("box"))) and l.get("text")]
    candidates = _detect_missed_regions(rects)
    extra_lines: List[Dict[str, Any]] = []
    found_rects: List[List[int]] = []
    for (x, y, rw, rh) in candidates:
        crop = preprocess.crop_region(img, (x, y, rw, rh))
        target = preprocess.upscale_for_ocr(crop)
        if preprocess.needs_enhancement(crop):
            target = preprocess.enhance(target)
        found = [l for l in ocr_mod.read_text(target, lang) if l.get("text")]
        if not found:
            continue
        seen = {l["text"].strip() for l in lines}
        picked = [l for l in found if l["text"].strip() not in seen]
        if not picked:
            continue
        best = max(picked, key=lambda l: l["confidence"])
        best = dict(best)
        best["box"] = [[float(x), float(y)], [float(x + rw), float(y)], [float(x + rw), float(y + rh)], [float(x), float(y + rh)]]
        best["enhanced"] = True
        best["missed_region"] = True
        extra_lines.append(best)
        seen.add(best["text"].strip())
        found_rects.append([int(x), int(y), int(rw), int(rh)])
    return extra_lines, found_rects, len(candidates)


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

    # Cheap quality assessment (used for honest prompts + trust-score input)
    quality_info = [preprocess.estimate_quality(img) for img in images]

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

    # ------------------------------------------------------------------
    # Missed-text-region detection + auto re-OCR (#9).
    # After the main OCR pass, gaps between detected text rows are probed;
    # ONLY those candidate regions get a second, targeted read. The full
    # image is never re-scanned and results are merged back into the same
    # image's block list so field extraction sees the recovered text.
    # ------------------------------------------------------------------
    missed_checked = [0] * len(all_lines)
    missed_summary = {
        "text_regions_detected": 0,
        "lines_extracted": 0,
        "missed_regions_checked": 0,
        "missed_found": 0,
        "missed_regions": [],
    }
    for i, img in enumerate(images):
        if not all_lines[i]:
            continue
        missed_summary["text_regions_detected"] += len(all_lines[i])
        extra_lines, found_rects, checked = _run_missed_region_ocr(img, all_lines[i], lang)
        missed_checked[i] = checked
        if extra_lines:
            all_lines[i] = all_lines[i] + extra_lines
            all_confidences[i] = float(np.mean([l["confidence"] for l in all_lines[i]]))
            img_hash = _image_hash(images[i])
            _OCR_CACHE[img_hash] = {"lines": all_lines[i], "confidence": all_confidences[i]}
            if len(_OCR_CACHE) > _CACHE_MAX_SIZE:
                _OCR_CACHE.pop(next(iter(_OCR_CACHE)))
        missed_summary["lines_extracted"] += len(all_lines[i])
        missed_summary["missed_regions_checked"] += checked
        missed_summary["missed_found"] += len(found_rects)
        for r in found_rects:
            missed_summary["missed_regions"].append({"image_id": f"image_{i+1}", "region": r})

    # includes None slots; _assemble_results aligns per-image stats by index
    result = _assemble_results(all_lines, missed_checked)
    result["processing_time_ms"] = round((time.time() - start_time) * 1000, 1)
    result["cache_hits"] = len(cached_results)
    result["reocr_count"] = len(reocr_needed)
    result["image_quality"] = quality_info
    result["image_regions"] = missed_summary
    return result


@app.post("/verify-region")
async def verify_region_endpoint(request: Request) -> Dict[str, Any]:
    """ADAPTIVE TARGETED RE-SCAN — the core evidence-based optimization.

    Input (JSON): { "image": "<data URL or base64>", "regions": [[x,y,w,h], ...],
                     "lang": "en", "enhance": true }
    Crops ONLY the requested regions, applies conditional preprocessing
    (detect blur/dull -> denoise/CLAHE/sharpen, upscale small crops) and re-runs
    OCR on each crop. The full image is NEVER re-scanned.
    """
    start_time = time.time()
    try:
        data = json.loads(await request.body())
    except Exception:
        raise HTTPException(400, 'Send JSON {"image": <data URL>, "regions": [[x,y,w,h], ...]}')

    image_b64 = data.get("image")
    regions = data.get("regions")
    lang = str(data.get("lang") or "en")
    enhance = bool(data.get("enhance", True))

    if not image_b64 or not isinstance(image_b64, str):
        raise HTTPException(400, "Missing image (data URL or base64).")
    if not isinstance(regions, list) or not regions:
        raise HTTPException(400, "Missing regions — send at least one [x,y,width,height].")
    if len(regions) > 24:
        raise HTTPException(400, "At most 24 regions per image.")

    img = _decode(image_b64)
    h, w = img.shape[:2]
    tasks: List[Tuple] = []
    for idx, r in enumerate(regions):
        if not isinstance(r, (list, tuple)) or len(r) != 4:
            raise HTTPException(400, "Each region must be [x, y, width, height].")
        try:
            x, y, rw, rh = (int(v) for v in r)
        except Exception:
            raise HTTPException(400, "Region coordinates must be numbers.")
        if rw < 4 or rh < 4:
            raise HTTPException(400, "Region is too small.")
        if x < 0 or y < 0 or x + rw > w or y + rh > h:
            # clamp instead of rejecting (slightly out-of-bounds is common)
            x = max(0, min(x, w - 1))
            y = max(0, min(y, h - 1))
            rw = max(4, min(rw, w - x))
            rh = max(4, min(rh, h - y))
        tasks.append((idx, x, y, rw, rh))

    def _run_one(task) -> Dict[str, Any]:
        idx, x, y, rw, rh = task
        crop = preprocess.crop_region(img, (x, y, rw, rh))
        enhanced = False
        t0 = time.time()
        target = crop
        if enhance and preprocess.needs_enhancement(crop):
            target = preprocess.enhance(preprocess.upscale_for_ocr(crop))
            enhanced = True
        elif crop.shape[1] < 200:
            # tiny crop: always upscale so glyphs are legible
            target = preprocess.upscale_for_ocr(crop)
            enhanced = True
        lines = ocr_mod.read_text(target, lang)
        lines = [l for l in lines if l.get("text")]
        best = max(lines, key=lambda l: l["confidence"]) if lines else None
        return {
            "index": idx,
            "region": [x, y, rw, rh],
            "text": best["text"] if best else None,
            "confidence": round(best["confidence"], 3) if best else 0.0,
            "enhanced": enhanced,
            "lines": [{"text": l["text"], "confidence": round(l["confidence"], 3)} for l in lines],
            "processed_ms": round((time.time() - t0) * 1000, 1),
        }

    results: List[Dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=min(4, len(tasks))) as executor:
        futures = [executor.submit(_run_one, t) for t in tasks]
        for fut in as_completed(futures):
            try:
                results.append(fut.result())
            except Exception as e:
                print(f"Region verify failed: {e}")
    results.sort(key=lambda r: r["index"])
    return {
        "ok": True,
        "results": results,
        "processing_time_ms": round((time.time() - start_time) * 1000, 1),
    }


if __name__ == "__main__":
    import os
    import uvicorn
    import cv2  # noqa: F401
    port = int(os.getenv("PORT", "8100"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, workers=1)