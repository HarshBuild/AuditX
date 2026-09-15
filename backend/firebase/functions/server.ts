/**
 * AuditX — Production Node.js/Express backend for Render deployment.
 * 
 * Environment variables:
 *   PORT                 — listen port (default: 8080, Render injects its own)
 *   PROJECT_ID           — Firebase project ID
 *   CLIENT_EMAIL         — Firebase client email
 *   PRIVATE_KEY          — Firebase private key (PEM; literal \\n supported)
 *   GEMINI_API_KEY       — Google Gemini API key
 *   GEMINI_VISION_MODEL  — Gemini model for label extraction (default gemini-3.6-flash)
 *   GEMINI_TEXT_MODEL    — Gemini model for assistant answers (default gemini-3.6-flash)
 *   FRONTEND_URL         — CORS allowed origin(s), comma-separated
 *   CORS_ORIGINS         — optional; overrides FRONTEND_URL for CORS
 *   GOOGLE_VISION_CREDENTIALS_JSON — full Google Cloud service-account JSON
 *                       (single-line string) for Vision OCR. Preferred secret.
 *   GOOGLE_APPLICATION_CREDENTIALS — path to a service-account JSON file
 *                       (alternative to the inline JSON secret).
 */

// --- Load local .env first (no-op in production; Render injects environment) ---
import './env.js'

import * as admin from 'firebase-admin'
import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'

// --- Firebase Admin initialization from env vars ---
import './firebase-admin-init.js'

// --- API routers ---
import scanRouter from './routes/scan.js'
import assistantRouter from './routes/assistant.js'
import barcodeRouter from './routes/barcode.js'
import claimsRouter from './routes/claims.js'
import ocrRouter from './routes/ocr.js'
import productsRouter from './routes/products.js'
import inspectionsRouter from './routes/inspections.js'

// --- Express app ---
const app: express.Express = express()

// CORS — allow FRONTEND_URL / CORS_ORIGINS (comma-separated) plus localhost dev origins.
// When no origins are configured the API reflects the request origin so a browser
// app whose origin is not registered yet (e.g. Render FRONTEND_URL left unset)
// can still reach token-authed endpoints like /api/products. Authorization is the
// Firebase ID token — never the Origin header — so reflection is safe; an operator
// should still set FRONTEND_URL for a locked-down policy.
const allowedOrigins: string[] = (process.env.CORS_ORIGINS ?? process.env.FRONTEND_URL ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

if (allowedOrigins.length === 0) {
  console.warn(
    '[auditx-api] CORS_ORIGINS/FRONTEND_URL not set — reflecting any browser origin. ' +
      'Set FRONTEND_URL to the dashboard URL for a locked-down policy.',
  )
}

app.use(
  cors({
    origin: (origin, callback) => {
      const loopback =
        !!origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
      if (allowedOrigins.length === 0 || !origin || allowedOrigins.includes(origin) || loopback) {
        callback(null, true)
      } else {
        callback(null, false)
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }),
)

// Body parsers
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

// --- Firebase ID token authentication middleware ---
function firebaseAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    try {
      const authHeader: string = req.headers.authorization ?? ''
      if (!authHeader.startsWith('Bearer ')) {
        res.status(401).json({ ok: false, error: 'Unauthorized — missing Bearer token.' })
        return
      }
      const idToken: string = authHeader.slice('Bearer '.length).trim()
      const decoded = await admin.auth().verifyIdToken(idToken)
      const profileSnap = await admin.firestore().doc(`users/${decoded.uid}`).get()
      if (!profileSnap.exists) {
        // Auto-create user profile for authenticated users (first login)
        const email = decoded.email ?? ''
        const displayName = decoded.name ?? decoded.email?.split('@')[0] ?? 'User'
        await admin.firestore().doc(`users/${decoded.uid}`).set({
          email,
          display_name: displayName,
          role: 'user',
          status: 'active',
          created_at: new Date().toISOString(),
        })
        ;(req as any).uid = decoded.uid
        ;(req as any).role = 'user'
        ;(req as any).status = 'active'
        next()
        return
      }
      const data = profileSnap.data()
      const role: string = String(data?.role ?? '')
      const status: string = String(data?.status ?? '')
      const validRoles: string[] = ['user', 'inspector', 'admin', 'super_admin']
      if (!validRoles.includes(role)) {
        res.status(403).json({ ok: false, error: 'Invalid account role.' })
        return
      }
      if (status === 'pending') {
        res.status(403).json({ ok: false, error: 'Your staff access request is awaiting approval.' })
        return
      }
      if (status !== 'active') {
        res.status(403).json({ ok: false, error: 'Your account has been restricted. Contact the system administrator.' })
        return
      }
      ;(req as any).uid = decoded.uid
      ;(req as any).role = role
      ;(req as any).status = status
      next()
    } catch (e: any) {
      if (e.code === 'auth/id-token-expired' || e.code === 'auth/user-token-expired') {
        res.status(401).json({ ok: false, error: 'Unauthorized — ID token has expired.' })
        return
      }
      if (e.code === 'auth/invalid-id-token') {
        res.status(401).json({ ok: false, error: 'Unauthorized — invalid ID token.' })
        return
      }
      // Log full error for debugging
      console.error('⚠️ Firebase auth middleware error:', {
        code: e?.code,
        message: e?.message,
        stack: e?.stack,
        projectId: process.env.PROJECT_ID,
      })
      res.status(500).json({ ok: false, error: `Authentication service error: ${e?.message ?? 'unknown'}` })
    }
  })().catch((e) => {
    console.error('⚠️ Auth middleware unexpected error:', e)
  })
}

// --- Health check ---
app.get('/health', (_req: Request, res: Response): void => {
  res.json({ ok: true, service: 'AuditX backend' })
})

// --- API route mounts (all require Firebase ID token auth) ---
app.use('/api/scan', firebaseAuthMiddleware, scanRouter)
app.use('/api/assistant', firebaseAuthMiddleware, assistantRouter)
app.use('/api/barcode', firebaseAuthMiddleware, barcodeRouter)
app.use('/api/set-claims', firebaseAuthMiddleware, claimsRouter)
app.use('/api/ocr', firebaseAuthMiddleware, ocrRouter)
app.use('/api/products', firebaseAuthMiddleware, productsRouter)
app.use('/api/inspections', firebaseAuthMiddleware, inspectionsRouter)

// --- 404 ---
app.use((_req: Request, _res: Response): void => {
  _res.status(404).json({ ok: false, error: 'Not found' })
})

// --- Centralized error handler (last, so it catches body-parser and route errors) ---
app.use(
  (err: any, _req: Request, _res: Response, _next: NextFunction): void => {
    console.error('⚠️ Express error handler:', err?.message ?? err)
    const status: number = err.status ?? 500
    _res.status(status).json({ ok: false, error: err?.message ?? 'Internal server error' })
  },
)

// --- Start server ---
const PORT: number = Number(process.env.PORT) || 8080
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 AuditX backend listening on http://0.0.0.0:${PORT}`)
})

// --- Graceful shutdown ---
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received — shutting down')
  process.exit(0)
})