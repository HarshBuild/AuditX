/**
 * Public report verification — NO auth required.
 *
 *   GET /api/verify/:id
 *     -> { ok: true, verification: { ... } }  (safe fields ONLY)
 *
 * Powers the QR code printed on PDF reports: anyone can scan and confirm
 * the report is genuine. NEVER expose PII here (no user_id, email, notes,
 * remarks, photos or raw OCR text) — only the public verdict facts.
 */

import { Router, Request, Response } from 'express'
import { getScanDoc } from '../supabase-admin.js'

const router = Router()

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id ?? '').trim().slice(0, 128)
    if (!id) {
      res.status(400).json({ ok: false, error: 'Report id is required.' })
      return
    }
    const doc = await getScanDoc(id).catch(() => null)
    if (!doc) {
      res.status(404).json({ ok: false, error: 'Report not found.' })
      return
    }
    const d = doc as Record<string, unknown>
    // Only inspections with a completed analysis are verifiable.
    if (d.ocr_status !== 'done') {
      res.status(404).json({ ok: false, error: 'Report not found.' })
      return
    }
    res.json({
      ok: true,
      verification: {
        id: String(d.id ?? id),
        product_name: String(d.product_name ?? ''),
        brand: String(d.brand ?? ''),
        manufacturer: String(d.manufacturer ?? ''),
        category: d.category ?? null,
        overall_score: typeof d.overall_score === 'number' ? d.overall_score : Number(d.compliance_score ?? 0),
        verdict: String(d.verdict ?? ''),
        status: String(d.status ?? ''),
        scanned_at: String(d.analyzed_at ?? d.created_at ?? ''),
        verified_by: 'AuditX',
      },
    })
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: (e as Error)?.message ?? 'Verification failed.' })
  }
})

export default router
