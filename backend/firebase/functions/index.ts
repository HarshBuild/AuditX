/**
 * AuditX — Firebase Cloud Functions (Groq-powered AI).
 *
 * scanAnalysis (REAL, end-to-end):
 *   1. Groq vision is used ONLY for OCR + structured extraction
 *      (compliance/extraction.ts). It never decides compliance.
 *   2. Package context is detected (retail/wholesale/imported/food/sold-by/
 *      special commodity) — compliance/context.ts.
 *   3. A deterministic Legal Metrology (Packaged Commodities) Rules 2011
 *      engine (compliance/engine.ts) checks each extracted field, decides
 *      rule applicability, and computes the verdict + score + risk with an
 *      evidence chain (Image -> OCR -> field -> rule -> status).
 *   4. If Groq fails, the call fails cleanly and the client keeps the
 *      captured images for a retake — nothing fake is emitted.
 *
 * Other callables:
 *   complianceAssistant   — Groq text Q&A over a stored scan's findings
 *   setClaims             — mint Firebase custom claims (role/status)
 *   lookupBarcode         — Open Food Facts barcode lookup
 *   syncClaimsOnUserStatus — keep claims in sync when users/{uid} changes
 *
 * Secrets live ONLY in env vars:
 *   firebase functions:secrets:set GROQ_API_KEY
 *   - GROQ_API_KEY       (required)
 *   - GROQ_VISION_MODEL  (optional, default llama-3.2-11b-vision-preview)
 *   - GROQ_TEXT_MODEL    (optional, default llama-3.3-70b-versatile)
 */

import { defineSecret } from 'firebase-functions/params'
import * as admin from 'firebase-admin'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { onDocumentUpdated } from 'firebase-functions/v2/firestore'

import {
  buildExtractionPrompt, extractJson, norm, parseRaw, SUPPORTED_LANGS,
} from './compliance/extraction'
import { runComplianceEngine } from './compliance/engine'
import type { EngineInputs, ExtractionStatus } from './compliance/types'

admin.initializeApp()

const groqKey = defineSecret('GROQ_API_KEY')
const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL ?? 'llama-3.2-11b-vision-preview'
const GROQ_TEXT_MODEL = process.env.GROQ_TEXT_MODEL ?? 'llama-3.3-70b-versatile'
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'

function langName(lang: string): string {
  return SUPPORTED_LANGS[lang] ?? 'English'
}

/* ------------------------------------------------------------------ */
/* Auth + Groq HTTP helpers                                            */
/* ------------------------------------------------------------------ */
async function getProfile(uid: string): Promise<{ role: string; status: string } | null> {
  try {
    const snap = await admin.firestore().doc(`users/${uid}`).get()
    if (!snap.exists) return null
    const d = snap.data() as { role?: string; status?: string }
    return { role: String(d.role ?? ''), status: String(d.status ?? '') }
  } catch {
    return null
  }
}

async function assertCallerAuthorized(context: { auth?: { uid: string } }) {
  if (!context.auth) throw new HttpsError('unauthenticated', 'You must be signed in.')
  const profile = await getProfile(context.auth.uid)
  if (!profile) throw new HttpsError('permission-denied', 'Account profile not found.')
  if (!['user', 'inspector', 'admin', 'super_admin'].includes(profile.role)) {
    throw new HttpsError('permission-denied', 'Invalid account role.')
  }
  if (profile.status === 'pending') {
    throw new HttpsError('permission-denied', 'Your staff access request is awaiting approval.')
  }
  if (profile.status !== 'active') {
    throw new HttpsError('permission-denied', 'Your account has been restricted. Contact the system administrator.')
  }
  return { uid: context.auth.uid, role: profile.role }
}

interface GroqMessagePart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function groqChat(model: string, system: string, parts: GroqMessagePart[]): Promise<string> {
  // One retry with a short backoff for transient network failures.
  let res: Response
  try {
    res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${groqKey.value()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 4096,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: parts },
        ],
      }),
    })
  } catch (err) {
    try {
      await sleep(800)
      res = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqKey.value()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 4096,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: parts },
          ],
        }),
      })
    } catch (e2) {
      console.error('Groq unreachable', (e2 as Error).message)
      throw new HttpsError('unavailable', 'AI service is unreachable right now. Check your connection and retry.')
    }
    console.warn('Groq fetch retried after failure:', (err as Error).message)
  }
  if (!res.ok) {
    const text = await res.text()
    if (res.status === 429 || res.status === 403) {
      throw new HttpsError('resource-exhausted', 'AI service is rate limited. Wait a minute and retry.')
    }
    if (res.status === 400) {
      throw new HttpsError(
        'invalid-argument',
        'The AI service could not read this image — it may be too large or corrupted. Retake a closer, well-lit photo and retry.',
      )
    }
    console.error('Groq error', res.status, text.slice(0, 500))
    throw new HttpsError('internal', 'AI service error. Try a clearer image.')
  }
  const payload = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content: string = payload.choices?.[0]?.message?.content ?? ''
  if (!content) throw new HttpsError('internal', 'Empty AI response. Try a clearer image.')
  return content
}

async function imageToDataUrl(url: string): Promise<string> {
  const res = await fetch(url, { headers: { Origin: 'firebase' } })
  if (!res.ok) throw new HttpsError('failed-precondition', 'Could not fetch the uploaded image.')
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > 10 * 1024 * 1024) throw new HttpsError('failed-precondition', 'Image is larger than 10 MB.')
  const mime = res.headers.get('content-type') ?? 'image/jpeg'
  return `data:${mime};base64,${buf.toString('base64')}`
}

/** Save an OCR-only scan (extraction failed) for inspector review. */
async function saveOcrFallback(actor: { uid: string }, input: Record<string, unknown>, ocrText: string): Promise<string> {
  const db = admin.firestore()
  const scanRef = db.collection('scans').doc()
  await scanRef.set({
    user_id: actor.uid,
    product_name: input.product_name ?? 'Label scan (OCR only)',
    brand: '',
    manufacturer: input.manufacturer ?? '',
    category: 'Other',
    barcode: norm(input.barcode) ?? '',
    overall_score: 0,
    verdict: 'NOT_VERIFIABLE',
    summary: 'AI extraction failed. Raw OCR text was captured and saved for inspector review.',
    rules: [],
    labels: [],
    ocr: { text: ocrText.slice(0, 8000), languages: [] },
    assistant: { summary: 'Extraction service returned unparseable data. OCR text preserved.', suggestions: ['Manually review the OCR text.', 'Retake with a clearer, closer photo.'] },
    extractions: null,
    uncertain: [],
    detected: { passed: 0, failed: 0, warnings: 0, not_verifiable: 0, not_applicable: 0, missing: 0, uncertain: 0 },
    counts: { passed: 0, failed: 0, warnings: 0, not_detected: 0, not_verifiable: 0, requires_physical_inspection: 0, not_applicable: 0, uncertain: 0 },
    risk_score: 0,
    status: 'pending_review',
    ai_insights: [],
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    location_name: input.location_name ?? '',
    manual_result: null,
    notes: 'Auto-saved: AI extraction returned invalid JSON. Raw OCR preserved.',
    created_at: new Date().toISOString(),
  } as Record<string, unknown>)
  await db.collection('notifications').add({
    user_id: actor.uid, type: 'scan', title: 'Analysis incomplete — OCR saved',
    body: 'AI extraction failed. Raw OCR text was captured for manual review.',
    link: '/scan-history', read: false, read_at: null, data: { scan_id: scanRef.id },
    created_at: new Date().toISOString(),
  })
  return scanRef.id
}

/* ------------------------------------------------------------------ */
/* scanAnalysis — OCR (Groq) -> context detection -> deterministic      */
/* Legal Metrology engine -> compliance result with evidence.           */
/* ------------------------------------------------------------------ */
export const scanAnalysis = onCall(
  { secrets: [groqKey], timeoutSeconds: 120, memory: '1GiB' },
  async (request) => {
    const actor = await assertCallerAuthorized(request)
    const input = request.data as {
      images?: Array<{ data?: string; url?: string }>
      image?: string | { data?: string; url?: string }
      scanId?: string
      product_name?: string
      manufacturer?: string
      barcode?: string
      latitude?: number
      longitude?: number
      location_name?: string
      lang?: string
      category?: string
    }

    const rawImages: Array<{ data?: string; url?: string }> = input.images ?? []
    if (input.image) rawImages.push(typeof input.image === 'string' ? { data: input.image } : input.image)
    if (rawImages.length === 0) throw new HttpsError('invalid-argument', 'No image provided.')
    if (rawImages.length > 6) throw new HttpsError('invalid-argument', 'At most 6 photos per inspection.')

    /* Stage 1 — OCR + transcription ONLY (Groq vision). */
    const parts: GroqMessagePart[] = [{ type: 'text', text: buildExtractionPrompt(input.lang ?? 'en') }]
    for (const img of rawImages) {
      let url = img.data ?? ''
      if (!url && img.url) url = await imageToDataUrl(img.url)
      if (!url) continue
      if (!url.startsWith('data:')) url = `data:image/jpeg;base64,${url}`
      parts.push({ type: 'image_url', image_url: { url } })
    }
    if (parts.length === 1) throw new HttpsError('invalid-argument', 'No valid image data provided.')

    const text = await groqChat(GROQ_VISION_MODEL, 'You are a machine. Output strict JSON only, no commentary.', parts)
    let raw = extractJson(text) as Record<string, unknown> | null
    let extractionStatus: ExtractionStatus = 'ok'
    if (!raw || typeof raw !== 'object') {
      // One retry with an explicit "no markdown" reminder before giving up.
      const retryText = await groqChat(
        GROQ_VISION_MODEL,
        'You are a machine. Output ONLY one JSON object — no markdown fences, no commentary, no trailing text.',
        parts,
      )
      const raw2 = extractJson(retryText) as Record<string, unknown> | null
      if (!raw2 || typeof raw2 !== 'object') {
        extractionStatus = 'failed'
        const scanId = await saveOcrFallback(actor, input, text)
        throw new HttpsError(
          'internal',
          `AI extraction returned invalid data (scan ${scanId} saved as OCR-only for review). Retry for a full analysis.`,
        )
      }
      raw = raw2
    }

    const parsed = parseRaw(raw, {
      barcode: input.barcode ?? null,
      product_name: input.product_name ?? null,
      category: input.category ?? null,
    })

    /* No legible text at all -> the user must retake the label photo. */
    const hasExtraction = Object.values(parsed.fields).some((f) => f.value !== null)
    if (!parsed.ocrText.trim() && !hasExtraction) {
      throw new HttpsError(
        'invalid-argument',
        'No readable text could be detected on the label. Please retake the photo in good light and close up on the declarations block, then retry.',
      )
    }

    /* Stage 2 — deterministic Legal Metrology compliance engine. */
    const inputs: EngineInputs = {
      ex: parsed.ex,
      fields: parsed.fields,
      ocrText: parsed.ocrText,
      ocrBlocks: parsed.ocrBlocks,
      uncertain: parsed.uncertain,
      barcode: parsed.barcode,
      languages: parsed.ocrLangs,
      labels: parsed.labels,
      userCategory: input.category ?? null,
      userProductName: input.product_name ?? null,
      productLabelText: [parsed.ex.commodity_name ?? '', input.category ?? '', parsed.brand ?? ''].join(' '),
    }
    const outcome = runComplianceEngine(inputs)
    const ctx = outcome.context

    const result = {
      product_name: parsed.productName ?? input.product_name ?? 'Unknown',
      brand: parsed.brand ?? '',
      category: inputs.userCategory ?? parsed.category,
      overall_score: outcome.summary.overall_score,
      verdict: outcome.summary.verdict,
      summary: outcome.assistant.summary,
      rules: outcome.rules,
      labels: parsed.labels.map((l) => ({ ...l, verdict: outcome.summary.verdict, score: outcome.summary.overall_score })),
      ocr: { text: parsed.ocrText, languages: parsed.ocrLangs },
      ocr_blocks: parsed.ocrBlocks,
      extractions: parsed.ex,
      extraction_fields: parsed.fields,
      assistant: outcome.assistant,
      language_note: parsed.languageNote,
      risk_score: outcome.summary.risk_score,
      ai_insights: outcome.summary.ai_insights,
      detected: outcome.summary.detected,
      counts: outcome.summary.counts,
      uncertain: parsed.uncertain,
      context: {
        package_type: ctx.package_type,
        origin: ctx.origin,
        is_food: ctx.is_food,
        sold_by: ctx.sold_by,
        special_commodity: ctx.special_commodity,
        exemptions: ctx.applicable_exemptions,
        reason: ctx.reason,
      },
      evidence_chain: outcome.summary.evidence_chain,
      extraction_status: extractionStatus,
    }

    const db = admin.firestore()
    const notificationBody = `${result.product_name} scored ${outcome.summary.overall_score}/100 — ${outcome.summary.verdict}.`

    /* Prefer updating the pending scan the client already created. */
    if (input.scanId) {
      const ref = db.doc(`scans/${input.scanId}`)
      const snap = await ref.get()
      if (snap.exists && snap.data()?.user_id === actor.uid) {
        await ref.update({
          product_name: result.product_name,
          brand: result.brand,
          manufacturer: parsed.ex.manufacturer ?? input.manufacturer ?? result.brand ?? '',
          category: result.category,
          overall_score: outcome.summary.overall_score,
          verdict: outcome.summary.verdict,
          summary: outcome.assistant.summary,
          rules: outcome.rules,
          labels: result.labels,
          ocr: result.ocr,
          ocr_blocks: parsed.ocrBlocks,
          assistant: outcome.assistant,
          language_note: parsed.languageNote,
          extractions: parsed.ex,
          extraction_fields: parsed.fields,
          uncertain: parsed.uncertain,
          detected: outcome.summary.detected,
          counts: outcome.summary.counts,
          context: result.context,
          evidence_chain: outcome.summary.evidence_chain,
          risk_score: outcome.summary.risk_score,
          status: 'analyzed',
          ai_insights: outcome.summary.ai_insights,
          updated_at: new Date().toISOString(),
        })
        await db.collection('notifications').add({
          user_id: actor.uid, type: 'scan', title: 'Analysis completed', body: notificationBody,
          link: '/scan-history', read: false, read_at: null, data: { scan_id: input.scanId },
          created_at: new Date().toISOString(),
        })
        return { ok: true, scan_id: input.scanId, result }
      }
    }

    const scanRef = db.collection('scans').doc()
    await scanRef.set({
      user_id: actor.uid,
      product_name: result.product_name,
      brand: result.brand,
      manufacturer: parsed.ex.manufacturer ?? input.manufacturer ?? result.brand ?? '',
      category: result.category,
      barcode: parsed.barcode ?? '',
      overall_score: outcome.summary.overall_score,
      verdict: outcome.summary.verdict,
      summary: outcome.assistant.summary,
      rules: outcome.rules,
      labels: result.labels,
      ocr: result.ocr,
      ocr_blocks: parsed.ocrBlocks,
      assistant: outcome.assistant,
      language_note: parsed.languageNote,
      extractions: parsed.ex,
      extraction_fields: parsed.fields,
      uncertain: parsed.uncertain,
      detected: outcome.summary.detected,
      counts: outcome.summary.counts,
      context: result.context,
      evidence_chain: outcome.summary.evidence_chain,
      risk_score: outcome.summary.risk_score,
      status: 'analyzed',
      ai_insights: outcome.summary.ai_insights,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      location_name: input.location_name ?? '',
      manual_result: null,
      notes: '',
      created_at: new Date().toISOString(),
    })
    await db.collection('notifications').add({
      user_id: actor.uid, type: 'scan', title: 'Analysis completed', body: notificationBody,
      link: '/scan-history', read: false, read_at: null, data: { scan_id: scanRef.id },
      created_at: new Date().toISOString(),
    })
    return { ok: true, scan_id: scanRef.id, result }
  },
)

/* ------------------------------------------------------------------ */
/* complianceAssistant — Groq text Q&A over a completed scan.           */
/* ------------------------------------------------------------------ */
export const complianceAssistant = onCall(
  { secrets: [groqKey], timeoutSeconds: 60 },
  async (request) => {
    const actor = await assertCallerAuthorized(request)
    const scanId = String(request.data?.scanId ?? '')
    const question = String(request.data?.question ?? '').trim()
    const lang = String(request.data?.lang ?? 'en')
    if (!scanId) throw new HttpsError('invalid-argument', 'scanId is required.')

    const snap = await admin.firestore().doc(`scans/${scanId}`).get()
    if (!snap.exists) throw new HttpsError('not-found', 'Scan not found.')
    const data = snap.data() ?? {}
    if (data.user_id !== actor.uid && actor.role !== 'inspector' && actor.role !== 'admin' && actor.role !== 'super_admin') {
      throw new HttpsError('permission-denied', 'You cannot review this scan.')
    }

    const condensed = {
      product_name: data.product_name ?? '',
      brand: data.brand ?? '',
      manufacturer: data.manufacturer ?? '',
      overall_score: data.overall_score ?? 0,
      verdict: data.verdict ?? '',
      summary: data.summary ?? '',
      language_note: data.language_note ?? '',
      rules: data.rules ?? [],
      labels: data.labels ?? [],
      ocr_text_excerpt: String(data.ocr?.text ?? '').slice(0, 4000),
      assistant: data.assistant ?? {},
    }

    const parts: GroqMessagePart[] = [
      {
        type: 'text',
        text:
          `Here is the inspection data (JSON):\n${JSON.stringify(condensed)}\n\n` +
          `The user (an inspector) asks: ${question || 'Summarize the findings and list the top verification steps for the next physical inspection.'}\n` +
          `Answer helpfully and concisely in ${langName(lang)}. Only explain findings present in the data — do not invent compliance facts. Distinguish image-verifiable findings from items that require physical inspection (weighing, sampling, MPE, dealer records). Suggest concrete next checks.`,
      },
    ]

    const answer = await groqChat(GROQ_TEXT_MODEL, 'You are a senior Legal Metrology inspector\'s assistant.', parts)
    return { ok: true, answer: answer.trim() }
  },
)

/* ------------------------------------------------------------------ */
/* setClaims — mint/refresh custom claims. Admin/super-admin only.     */
/* ------------------------------------------------------------------ */
export const setClaims = onCall(async (request) => {
  const actor = await assertCallerAuthorized(request)
  if (actor.role !== 'admin' && actor.role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only admins can manage claims.')
  }
  const targetUid = String(request.data?.uid ?? '')
  const nextStatus = String(request.data?.status ?? '')
  if (!targetUid) throw new HttpsError('invalid-argument', 'uid is required.')
  if (!['active', 'blocked', 'pending'].includes(nextStatus)) {
    throw new HttpsError('invalid-argument', 'status must be active, blocked or pending.')
  }
  const target = await admin.firestore().doc(`users/${targetUid}`).get()
  if (target.exists && target.data()?.role === 'super_admin' && actor.role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only a super admin can modify a super admin account.')
  }
  await admin.auth().setCustomUserClaims(targetUid, {
    role: String(target.data()?.role ?? 'user'),
    status: nextStatus,
  })
  return { ok: true }
})

/* Auto-mint claims when an admin flips status directly (bootstrap). */
export const syncClaimsOnUserStatus = onDocumentUpdated('users/{uid}', async (event) => {
  const after = event.data?.after.data() ?? {}
  const before = event.data?.before.data() ?? {}
  const status = String(after.status ?? '')
  const role = String(after.role ?? before.role ?? 'user')
  if (!['active', 'blocked', 'pending'].includes(status)) return
  try {
    await admin.auth().setCustomUserClaims(event.params.uid, { role, status })
  } catch (e) {
    console.warn(`Could not mint claims for ${event.params.uid}`, e)
  }
})

/* ------------------------------------------------------------------ */
/* lookupBarcode — Open Food Facts product lookup (server-side).        */
/* ------------------------------------------------------------------ */
interface OffProduct {
  product_name: string | null
  brands: string | null
  categories: string | null
  quantity: string | null
  manufacturers: string | null
  countries: string | null
  image_url: string | null
}

export const lookupBarcode = onCall({ timeoutSeconds: 15 }, async (request) => {
  const actor = await assertCallerAuthorized(request)
  const barcode = String(request.data?.barcode ?? '').trim()
  if (!barcode) throw new HttpsError('invalid-argument', 'barcode is required.')
  if (!/^\d{8,14}$/.test(barcode)) throw new HttpsError('invalid-argument', 'Barcode must be 8-14 digits.')

  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return { found: false, source: 'open_food_facts' as const, product: null }
    const body = (await res.json()) as { status: number; product?: OffProduct }
    if (body.status !== 1 || !body.product) return { found: false, source: 'open_food_facts' as const, product: null }
    const p = body.product
    return {
      found: true,
      source: 'open_food_facts' as const,
      product: {
        name: p.product_name ?? null,
        brand: p.brands ?? null,
        category: p.categories ?? null,
        net_quantity: p.quantity ?? null,
        manufacturer: p.manufacturers ?? null,
        country: p.countries ?? null,
        image_url: p.image_url ?? null,
      },
    }
  } catch {
    return { found: false, source: 'open_food_facts' as const, product: null }
  }
})