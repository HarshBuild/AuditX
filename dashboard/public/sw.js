/**
 * AuditX — service worker.
 * Tiny offline-first cache so the installed app opens fast and works when
 * the network drops. Only same-origin app shell assets are cached (the
 * bundle is a single self-contained index.html; everything else is OTA data).
 */
const VERSION = 'auditx-v1'
const SHELL = ['./', './index.html', './manifest.json']

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
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // App shell: network-first so fresh builds win, cache as offline fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(VERSION).then((cache) => cache.put('./index.html', copy))
          return res
        })
        .catch(() => caches.match('./index.html').then((hit) => hit || caches.match('./'))),
    )
    return
  }

  // Static assets (manifest, icons): stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone()
            caches.open(VERSION).then((cache) => cache.put(req, copy))
          }
          return res
        })
        .catch(() => cached)
      return cached || fresh
    }),
  )
})