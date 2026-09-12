/**
 * Render smoke test — starts the built server, checks /health, 404 JSON and
 * CORS preflight behaviour, then shuts the server down.
 * Run after `npm run build`:   node scripts/render-smoke.mjs
 */

import { spawn } from 'node:child_process'

const PORT = Number(process.env.PORT) || 8080
const BASE = `http://127.0.0.1:${PORT}`

const child = spawn(process.execPath, ['dist/server.js'], {
  cwd: process.cwd(),
  stdio: 'inherit',
})

const results = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitReady(retries = 40) {
  for (let n = 0; n < retries; n++) {
    try {
      const res = await fetch(`${BASE}/health`)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await sleep(250)
  }
  throw new Error('server did not become ready')
}

async function run() {
  try {
    await waitReady()

    const health = await fetch(`${BASE}/health`).then((r) => r.json())
    results.push(['HEALTH', JSON.stringify(health)])

    const nf = await fetch(`${BASE}/nope`)
    const nfBody = await nf.json().catch(() => ({}))
    results.push(['404 status', String(nf.status), `error="${nfBody.error}"`])

    const okPreflight = await fetch(`${BASE}/api/barcode`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'GET',
      },
    })
    results.push([
      'CORS localhost preflight',
      String(okPreflight.status),
      `ACAO=${JSON.stringify(okPreflight.headers.get('access-control-allow-origin'))}`,
      `ACAM=${JSON.stringify(okPreflight.headers.get('access-control-allow-methods'))}`,
    ])

    const foreignPreflight = await fetch(`${BASE}/api/barcode`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example.com',
        'Access-Control-Request-Method': 'GET',
      },
    })
    const foreignAllowed = foreignPreflight.headers.get('access-control-allow-origin')
    results.push([
      'CORS foreign origin',
      foreignAllowed === null ? 'blocked (no ACAO header)' : `ALLOWED (${foreignAllowed}) — BAD`,
    ])

    console.log(results.map((line) => line.join(' | ')).join('\n'))
  } catch (err) {
    console.error('SMOKE FAIL:', err)
    process.exitCode = 1
  } finally {
    child.kill('SIGTERM')
  }
}

run()