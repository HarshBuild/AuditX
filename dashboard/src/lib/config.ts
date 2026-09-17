/*
 * AuditX — Runtime configuration.
 * Resolution order: .env (VITE_*)  →  localStorage override  →  built-in default.
 *
 * The Supabase publishable key is public by design (not a secret).
 * Authorization is enforced server-side by RLS policies + the Express
 * backend (service role), never by the config values themselves.
 */

const read = (envKey: string, lsKey: string, fallback: string) =>
  (import.meta.env[envKey] as string | undefined) ||
  localStorage.getItem(lsKey) ||
  fallback

export const CONFIG = {
  SUPABASE_URL: read(
    'VITE_SUPABASE_URL',
    'mc_supabase_url',
    'https://imcymvfoicfvskyvdyko.supabase.co',
  ),
  SUPABASE_ANON_KEY: read(
    'VITE_SUPABASE_ANON_KEY',
    'mc_supabase_anon_key',
    'sb_publishable_m6SGr96VZo0n3jVbQ-Q49A_UATQ4vCF',
  ),
  /**
   * AuditX Express API base URL (Render service `AuditX-111`).
   * Used for scan analysis, assistant, barcode lookup, product-database
   * writes (/api/products) and role administration (/api/set-claims).
   * Resolved from VITE_AUDITX_API_URL, localStorage `mc_auditx_api_url`,
   * or the deployed onrender.com default.
   */
  AUDITX_API_URL:
    (import.meta.env.VITE_AUDITX_API_URL as string | undefined) ||
    localStorage.getItem('mc_auditx_api_url') ||
    'https://auditx-111.onrender.com',
}