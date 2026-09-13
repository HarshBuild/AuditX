/**
 * Barcode ⇄ OCR human-readable digits cross-check.
 *
 * A scanner reads the barcode optically (BarcodeDetector); the SAME digits are
 * also printed under the bars ("human-readable line"). When both agree we can
 * VERIFY fields and the barcode itself. When they disagree, that is a hard
 * flag — a label whose printed digits don't match its own barcode must be
 * reviewed, never silently accepted. Pure / DOM-free (Node-testable).
 */

export const BARCODE_GTIN_LENGTHS = [8, 12, 13, 14]

export function normalizeBarcode(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\s/g, '').replace(/[^\d]/g, '')
  return digits.length > 0 ? Number(digits).toString().padStart(digits.length, '0') : null
}

export function isPlausibleBarcode(digits: string): boolean {
  return BARCODE_GTIN_LENGTHS.includes(digits.length)
}

/** All barcode-length digit runs found in an OCR text (deduplicated). */
export function findBarcodesInText(text: string): string[] {
  if (!text) return []
  // Grab WHOLE contiguous digit runs (\d{8,14}) then keep only run lengths that
  // are a valid GTIN/GS1 length. Never \d{8}|\d{13} alternation: that matches the
  // first 8 digits OF a 13-digit GTIN and fabricates a false conflict.
  const out = new Set<string>()
  for (const run of text.match(/\d{8,14}/g) ?? []) {
    if (isPlausibleBarcode(run)) out.add(run)
  }
  return [...out]
}

export interface BarcodeCrossCheckResult {
  detected: string | null
  fromOcr: string | null
  agree: boolean
  needsReview: boolean
}

/**
 * Compare the optically-read barcode against OCR-visible digit runs.
 *   agree        → detected == OCR run (VERIFY)
 *   needsReview  → detected != OCR run, or OCR found barcode-length digits
 *                  where the detector read nothing
 */
export function crosscheckBarcode(
  detected: string | null | undefined,
  ocrTexts: string[],
): BarcodeCrossCheckResult {
  const det = normalizeBarcode(detected)
  const ocrRuns = Array.from(new Set(ocrTexts.flatMap((t) => findBarcodesInText(t))))
  const fromOcr = ocrRuns[0] ?? null

  if (det && fromOcr) {
    return { detected: det, fromOcr, agree: det === fromOcr, needsReview: det !== fromOcr }
  }
  if (fromOcr) {
    // Detector missed it but OCR saw barcode-length digits — usable, but the
    // optical read should confirm before we trust it.
    return { detected: null, fromOcr, agree: false, needsReview: true }
  }
  if (det) {
    // Read optically but the digits weren't readable by OCR (blurred human
    // line, or digits are rendered as graphics). Still usable, no conflict.
    return { detected: det, fromOcr: null, agree: false, needsReview: false }
  }
  return { detected: null, fromOcr: null, agree: false, needsReview: false }
}