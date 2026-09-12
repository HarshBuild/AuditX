"""
AuditX OCR microservice — FastAPI app.
Endpoints:
  GET  /health                  -> service status
  POST /ocr                    -> multipart files or JSON base64 images
Body (multipart): files = [...]
Body (JSON):      { "images": ["data:image/...;base64,..."], "lang": "en" }
Returns structured fields, rule results and verdict.
"""
from __future__ import annotations

import base64
import io
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import preprocess

app = FastAPI(title="AuditX OCR", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Render frontend origin should override in prod
    allow_methods=["*"],
    allow_headers=["*"],
)


class OCRRequest(BaseModel):
    images: List[str]
    lang: str = "en"


@app.get("/health")
def health() -> Dict[str, Any]:
    try:
        import ocr as ocr_mod
        ready = ocr_mod.get_engine is not None
    except Exception:
        ready = False
    return {"ok": True, "service": "AuditX OCR", "paddle_ready": ready}


def _decode(data_url: str) -> np.ndarray:
    raw = data_url.split(",", 1)[1] if "," in data_url else data_url
    img = preprocess.decode_base64(raw)
    if img is None:
        raise HTTPException(400, "Invalid image data")
    return img


def _run_ocr(images: List[np.ndarray], lang: str) -> Dict[str, Any]:
    from ocr import read_texts
    from correction import collapse_whitespace, join_ocr
    from fields import extract_all
    from rules import evaluate

    all_lines = read_texts(images, lang)
    ocr_blocks = []
    combined = []
    for i, lines in enumerate(all_lines):
        lines = collapse_whitespace(lines)
        text = join_ocr(lines)
        ocr_blocks.append({"position": f"photo_{i+1}", "text": text, "confidence": round(float(np.mean([l["confidence"] for l in lines]) if lines else 0), 3), "lines": len(lines)})
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


@app.post("/ocr")
async def ocr_endpoint(files: Optional[List[UploadFile]] = None, payload: Optional[OCRRequest] = None) -> Dict[str, Any]:
    images: List[np.ndarray] = []
    lang = "en"
    if files:
        lang = "en"
        for f in files:
            raw = await f.read()
            img = preprocess.decode_bytes(raw)
            if img is None:
                raise HTTPException(400, f"Could not decode file {f.filename}")
            images.append(img)
    elif payload:
        lang = payload.lang or "en"
        for d in payload.images:
            images.append(_decode(d))
    else:
        raise HTTPException(400, "Send files or {images: [base64 or data URLs]}")

    if not images:
        raise HTTPException(400, "No images provided")
    if len(images) > 6:
        raise HTTPException(400, "At most 6 photos per inspection")

    # preprocess every image before OCR
    images = [preprocess.normalize(im) for im in images]
    return _run_ocr(images, lang)


if __name__ == "__main__":
    import os
    import uvicorn
    port = int(os.getenv("PORT", "8100"))
    uvicorn.run("main:app", host="0.0.0.0", port=port)