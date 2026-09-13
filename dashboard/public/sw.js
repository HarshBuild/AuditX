/* AuditX — service worker (offline app shell).
 *
 * Honest offline model: the build is a single-file SPA (vite-plugin-singlefile),
 * so the *whole UI shell* can run offline. Anything that needs the network —
 * Firebase Auth, Firestore, Storage, Gemini analysis, the AuditX Express API —
 * stays network-only and surfaces the app's normal error handling when offline.
 *
 * Strategy:
 *  - install:  precache the app shell (index.html + manifest + icons)
 *  - fetch:    navigations go network-first (fresh shell wins when online;
 *              the cached shell is the offline fallback), so an updated deploy
 *              is picked up on the very next load instead of serving a stale
 *              app shell forever. Static assets use stale-while-revalidate.
 *  - activate: purge outdated cache versions after each deploy.
 */

const VERSION = 'auditx-v2'
const SHELL = ['./', './index.html', './manifest.json', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return // never intercept API/CDN origins

  // Navigation requests: network-first — a freshly deployed shell wins whenever
  // the user is online, and the precached shell covers offline use.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(VERSION).then((cache) => cache.put('./index.html', copy))
          }
          return res
        })
        .catch(() => caches.match('./index.html')),
    )
    return
  }

  // Static assets (icons, manifest): stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(VERSION).then((cache) => cache.put(request, copy))
          }
          return res
        })
        .catch(() => cached)
      return cached || network
    }),
  )
})