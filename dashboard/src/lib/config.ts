/*
 * AuditX v3.0 — Runtime configuration.
 * Resolution order: .env (VITE_FIREBASE_*)  →  localStorage override  →  built-in default.
 *
 * Firebase web config is public by design (API keys are not secrets).
 * Authorization is enforced server-side by Firestore/Storage security rules,
 * never by the config values themselves.
 */

const read = (envKey: string, lsKey: string, fallback: string) =>
  (import.meta.env[envKey] as string | undefined) ||
  localStorage.getItem(lsKey) ||
  fallback

export const CONFIG = {
  FIREBASE_API_KEY: read(
    'VITE_FIREBASE_API_KEY',
    'mc_firebase_api_key',
    'AIzaSyD63lNnW4AQyoVQkbStssbx67V2-kdNd5Y',
  ),
  FIREBASE_AUTH_DOMAIN: read(
    'VITE_FIREBASE_AUTH_DOMAIN',
    'mc_firebase_auth_domain',
    'scanner-56fcf.firebaseapp.com',
  ),
  FIREBASE_PROJECT_ID: read(
    'VITE_FIREBASE_PROJECT_ID',
    'mc_firebase_project_id',
    'scanner-56fcf',
  ),
  FIREBASE_STORAGE_BUCKET: read(
    'VITE_FIREBASE_STORAGE_BUCKET',
    'mc_firebase_storage_bucket',
    'scanner-56fcf.firebasestorage.app',
  ),
  FIREBASE_MESSAGING_SENDER_ID: read(
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'mc_firebase_messaging_sender_id',
    '999791645311',
  ),
  FIREBASE_APP_ID: read(
    'VITE_FIREBASE_APP_ID',
    'mc_firebase_app_id',
    '1:999791645311:web:ec2766e5587ed817b1654a',
  ),
  FIREBASE_MEASUREMENT_ID: read(
    'VITE_FIREBASE_MEASUREMENT_ID',
    'mc_firebase_measurement_id',
    'G-GW55L9SCP6',
  ),
  /** Region where the scan/analytics Cloud Functions are deployed */
  FIREBASE_FUNCTIONS_REGION: (import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION as string | undefined) || 'asia-south1',
  /**
   * Google Gemini API key for real-time AI analysis + assistant answers.
   *
   * SECURITY: never hardcode the key here. It is resolved at runtime from
   * VITE_GEMINI_API_KEY (build/deploy env) or localStorage `mc_gemini_api_key`
   * (operator-supplied after deployment) so the published bundle stays clean.
   */
  GEMINI_API_KEY:
    (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) ||
    localStorage.getItem('mc_gemini_api_key') ||
    '',
  /** Gemini models (tuned for fast, multimodal label extraction and Q&A). */
  GEMINI_MODEL: (import.meta.env.VITE_GEMINI_MODEL as string | undefined) || 'gemini-3.6-flash',
  GEMINI_VISION_MODEL: (import.meta.env.VITE_GEMINI_VISION_MODEL as string | undefined) || 'gemini-3.6-flash',
}