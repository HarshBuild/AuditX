/*
 * AuditX — Runtime configuration.
 * Resolution order: .env (VITE_*)  →  localStorage override  →  built-in default.
 *
 * The Supabase publishable key is public by design (not a secret).
 * Authorization is enforced server-side by RLS policies + the Express
 * backend (service role), never by the config values themselves.
 */

function ls(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null
  } catch {
    return null
  }
}
export const CONFIG = {
  SUPABASE_URL:
    (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
    ls('mc_supabase_url') ||
    '',
  SUPABASE_ANON_KEY:
    (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
    ls('mc_supabase_anon_key') ||
    '',
  /**
   * AuditX Express API base URL (Render service `AuditX-111`).
   * Used for scan analysis, assistant, barcode lookup, product-database
   * writes (/api/products) and role administration (/api/set-claims).
   * Resolved from VITE_AUDITX_API_URL, localStorage `mc_auditx_api_url`,
   * or the deployed onrender.com default.
   */
  AUDITX_API_URL:
    (import.meta.env.VITE_AUDITX_API_URL as string | undefined) ||
    (typeof localStorage !== 'undefined' ? localStorage.getItem('mc_auditx_api_url') : null) ||
    'https://auditx-111.onrender.com',
}

/** True when a plausible Supabase URL + anon key are configured. */
export function isSupabaseConfigured(): boolean {
  const url = CONFIG.SUPABASE_URL.trim()
  const key = CONFIG.SUPABASE_ANON_KEY.trim()
  return url.startsWith('https://') && url.includes('.supabase.co') && key.length > 20
}

/** Actionable message shown when Supabase is not configured. */
export function supabaseConfigError(): string {
  return (
    'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in dashboard/.env ' +
    '(see .env.example), or in the browser via localStorage keys mc_supabase_url / mc_supabase_anon_key, ' +
    'then restart the dev server. Get values from Supabase Dashboard → Project Settings → Data API.'
  )
}