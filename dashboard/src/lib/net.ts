/**
 * fetch() with an AbortController timeout so a hung Express/API call can never
 * leave the client waiting forever. Aborts are surfaced as a readable error.
 */
export async function fetchWithTimeout(url: string, init?: RequestInit, ms = 15000): Promise<Response> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new Error(`Request timed out (${ms}ms): ${url}`)
    throw e
  } finally {
    window.clearTimeout(timer)
  }
}