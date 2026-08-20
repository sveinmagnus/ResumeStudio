/* global self, caches, fetch, URL -- a worker script; eslint.config.js declares browser globals for TypeScript sources only */

/**
 * Shell-only offline cache.
 *
 * Two invariants hold this file together:
 *
 * 1. **The cache is written during `install` and never again.** There is no
 *    runtime `cache.put` anywhere below, which is what makes storing a response
 *    from `/api/` impossible rather than merely avoided. CV content belongs in
 *    the one browser-side store `clearAllCaches()` wipes on logout; a copy in
 *    the Cache API would survive it, and PRIVACY.md would stop being true.
 * 2. **What it precaches is decided at BUILD time** — `self.__SHELL__` is
 *    prepended by the `shellUrls` plugin in `vite.config.ts`, which walks the
 *    entry chunks' STATIC imports only. The DOCX exporter and pdfmake (~2 MB
 *    between them) reach the worker through dynamic imports and so are absent:
 *    an export needs the server anyway.
 *
 * The build stamps the shell's own hash into `__SW_VERSION__`. That is
 * load-bearing rather than cosmetic: a browser reinstalls a worker only when
 * the worker's BYTES change, so a version derived from anything else would
 * leave a new deploy's chunks unprecached behind an unchanged file.
 */

const VERSION = self.__SW_VERSION__ || 'dev'
const SHELL = self.__SHELL__ || []
const CACHE = `resumestudio-shell-${VERSION}`
const CACHE_PREFIX = 'resumestudio-shell-'

/** Every navigation falls back to this document — the SPA routes client-side. */
const SHELL_DOCUMENT = '/index.html'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE)
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  )
})

/**
 * The swap happens only once the page has asked for it, because the page only
 * asks once the user agreed to reload. A worker calling `skipWaiting()` on its
 * own would put new code under a tab that is mid-edit against the old one.
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

async function fromShell(path) {
  const cache = await caches.open(CACHE)
  return cache.match(path)
}

async function networkThenShell(request) {
  try {
    return await fetch(request)
  } catch (err) {
    const shell = await fromShell(SHELL_DOCUMENT)
    // Nothing precached yet: let the network error surface as the browser's own
    // offline page rather than as an opaque undefined response.
    if (!shell) throw err
    return shell
  }
}

async function shellThenNetwork(path, request) {
  const hit = await fromShell(path)
  return hit || fetch(request)
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // Refused ahead of BOTH branches below, which each answer from the cache: a
  // navigation to an API URL would otherwise be handed the precached document,
  // and `SHELL` is build-supplied data rather than something this file states.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(networkThenShell(request))
    return
  }

  // The precached subresources are content-hashed (chunks) or immutable
  // (fonts), so a hit is never stale. Anything else is left to the browser —
  // including the lazy export chunks, which have no offline story by design.
  if (SHELL.includes(url.pathname)) event.respondWith(shellThenNetwork(url.pathname, request))
})
