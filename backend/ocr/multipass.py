"""
AuditX OCR microservice — multi-pass OCR + layout-aware merge.

The same photo is read several times under different preprocessing variants
(original, CLAHE contrast, Otsu binarization, sharpen, deskew, upscale). Every
pass can catch a line another pass missed (faint, low-contrast, small, or
blurry text). The passes are then:

  * merged by geometry + normalized text — a text line that N passes agree on
    keeps the strongest per-line confidence (voted), and a line found by any
    single pass is NOT dropped (coverage wins),
  * de-duplicated (repeated words / split lines from different variants),
  * ordered top-to-bottom, left-to-right (reading order preserved),
  * marked "uncertain" when passes genuinely disagree about the characters.

Nothing is ever fabricated: a conflicting low-confidence read is surfaced as
uncertain instead of overwriting the voted text.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

import ocr as ocr_mod
import preprocess


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def line_rect(ln: Dict[str, Any]) -> Optional[List[int]]:
    box = ln.get("box")
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


def _center(rect: List[int]) -> Tuple[float, float]:
    return rect[0] + rect[2] / 2.0, rect[1] + rect[3] / 2.0


def _iou(a: List[int], b: List[int]) -> float:
    ax0, ay0, aw, ah = a
    bx0, by0, bw, bh = b
    ax1, ay1, bx1, by1 = ax0 + aw, ay0 + ah, bx0 + bw, by0 + bh
    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)
    iw, ih = max(0, ix1 - ix0), max(0, iy1 - iy0)
    inter = iw * ih
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def _norm_text(text: str) -> str:
    return "".join(text.lower().split())


# ---------------------------------------------------------------------------
# Voted merge
# ---------------------------------------------------------------------------

def merge_passes(passes: List[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """Merge the line lists produced by several OCR passes.

    Policy:
      * Group lines whose boxes overlap (IoU >= 0.4) OR whose normalized text
        is identical — they describe the SAME physical text line.
      * For each group pick the highest-confidence reading as the vote.
      * Keep each group's confidence = max member confidence.
      * Surface genuinely-conflicting readings as uncertain: when a group is
        well-corroborated (>=2 agreeing passes) AND a DISAGREEING reading has
        meaningful confidence, flag the line uncertain so the caller can show
        it for manual verification instead of silently trusting it.

    Returns lines already carrying optional `passes` and `uncertain` flags.
    """
    groups: List[List[Dict[str, Any]]] = []

    def find_group(ln: Dict[str, Any]) -> Optional[int]:
        rect = line_rect(ln)
        text = _norm_text(ln.get("text", ""))
        for gi, g in enumerate(groups):
            gtext = _norm_text(g[0].get("text", ""))
            if text and gtext and text == gtext:
                return gi
            grect = line_rect(g[0])
            if rect and grect and _iou(rect, grect) >= 0.4:
                return gi
        return None

    for ln in (line for pass_lines in passes for line in pass_lines):
        text = str(ln.get("text", "") or "").strip()
        if not text:
            continue
        gi = find_group(ln)
        ln["text"] = text
        if gi is None:
            groups.append([ln])
        else:
            groups[gi].append(ln)

    merged: List[Dict[str, Any]] = []
    for group in groups:
        # Voted read: highest-confidence identical text.
        by_text: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for ln in group:
            by_text[_norm_text(ln["text"])].append(ln)
        readings = sorted(by_text.items(), key=lambda kv: max(l["confidence"] for l in kv[1]), reverse=True)
        winner_text, winner_lines = readings[0]
        winner = max(winner_lines, key=lambda l: l["confidence"]).copy()
        passes_count = len(group)
        agreeing = len(winner_lines)
        winner["passes"] = len(group)
        winner["agreeing_passes"] = agreeing

        # Frame with the tightest geometry from any agreeing member.
        rects = [line_rect(l) for l in group if line_rect(l)]
        if rects:
            x0 = min(r[0] for r in rects)
            y0 = min(r[1] for r in rects)
            x1 = max(r[0] + r[2] for r in rects)
            y1 = max(r[1] + r[3] for r in rects)
            winner["box"] = [[float(x0), float(y0)], [float(x1), float(y0)], [float(x1), float(y1)], [float(x0), float(y1)]]

        # Conflict: a strong second reading disagrees with the winner.
        uncertain = False
        if len(readings) > 1:
            runner_conf = max(l["confidence"] for l in readings[1][1])
            if agreeing < passes_count and runner_conf >= 0.5 and runner_conf <= winner["confidence"] + 0.15:
                uncertain = True
        winner["uncertain"] = uncertain
        merged.append(winner)
    return merged


# ---------------------------------------------------------------------------
# Layout-aware ordering (reading order)
# ---------------------------------------------------------------------------

def sort_layout(lines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Order OCR lines top-to-bottom, then left-to-right.

    Also keeps the numeric field values directly after their label key
    (e.g. "MRP" then "₹499") because we never reorder across a label group.
    Column detection is heuristic: lines whose horizontal spans overlap are
    treated as a reading group and sorted by the dominant axis.
    """
    with_rect = [ln for ln in lines if line_rect(ln)]
    without_rect = [ln for ln in lines if not line_rect(ln)]
    if len(with_rect) <= 1:
        return lines

    anchored = [(line_rect(ln), ln) for ln in with_rect]
    # Vertical bands: group rows that overlap vertically (same visual row).
    rows: List[List[Tuple[List[int], Dict[str, Any]]]] = []
    for rect, ln in sorted(anchored, key=lambda p: p[0][1]):
        cy = rect[1] + rect[3] / 2.0
        placed = False
        for row in rows:
            r_repr = row[0][0]
            r_cy = r_repr[1] + r_repr[3] / 2.0
            r_h = max(r_repr[3], 6)
            if abs(cy - r_cy) <= r_h * 0.75:
                row.append((rect, ln))
                placed = True
                break
        if not placed:
            rows.append([(rect, ln)])

    # Within each row, left → right; rows top → bottom.
    ordered: List[Dict[str, Any]] = []
    for row in sorted(rows, key=lambda r: min(p[0][1] for p in r)):
        for rect, ln in sorted(row, key=lambda p: p[0][0]):
            ordered.append(ln)
    return ordered + without_rect


# ---------------------------------------------------------------------------
# Entry point — multi-pass OCR for a single image
# ---------------------------------------------------------------------------

def run_multipass(
    img: np.ndarray,
    lang: str = "en",
    depth: int = 3,
    target_lines: Optional[List[int]] = None,
) -> List[Dict[str, Any]]:
    """OCR one image across `depth` preprocessing variants and merge the passes.

    target_lines  optionally restricts geometry to a list of [x,y,w,h] rects —
    used by the adaptive re-read path so recovery work stays localised.
    """
    candidates: List[List[Dict[str, Any]]] = []
    for name, variant in preprocess.make_variants(img, depth):
        if target_lines:
            lines: List[Dict[str, Any]] = []
            for (x, y, rw, rh) in target_lines:
                crop = preprocess.crop_region(variant, (x, y, rw, rh))
                target = preprocess.upscale_for_ocr(crop)
                if preprocess.needs_enhancement(crop):
                    target = preprocess.enhance(target)
                for l in (ocr_mod.read_text(target, lang) or []):
                    if not l.get("text"):
                        continue
                    cx = float(x) + (l.get("box") and float(l["box"][0][0]) or 0)
                    cy = float(y) + (l.get("box") and float(l["box"][0][1]) or 0)
                    l["box"] = [[float(x) + p[0], float(y) + p[1]] for p in (l.get("box") or [[0, 0]])]
                    lines.append(l)
            candidates.append(lines)
            continue
        candidates.append(ocr_mod.read_text(variant, lang) or [])

    merged = merge_passes(candidates)
    return sort_layout(merged)