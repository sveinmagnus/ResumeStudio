import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { shellUrls } from '../vite.config'

/**
 * The worker ships as a plain script the build prepends a manifest to, so it is
 * exercised the same way: evaluate the real `src/sw.js` against a stand-in
 * ServiceWorkerGlobalScope and drive its listeners. Nothing here re-implements
 * the worker — a rule that only holds in a copy of the code holds nothing.
 */
const SOURCE = readFileSync(path.join(process.cwd(), 'src', 'sw.js'), 'utf8')

const ORIGIN = 'https://cv.example'
const SHELL = [
  '/index.html',
  '/assets/index-aaa.js',
  '/assets/index-bbb.css',
  '/fonts/ubuntu-400-latin.woff2',
]

interface FakeResponse { body: string }
interface FakeRequest { url: string; method: string; mode: string }

/** Cache keys: the worker matches by path string, `fetch` by request. */
const keyOf = (target: unknown): string =>
  typeof target === 'string' ? target : (target as FakeRequest).url

interface CacheLog { added: string[]; put: string[]; fetched: string[] }

class FakeCache {
  readonly entries = new Map<string, FakeResponse>()
  constructor(private readonly log: CacheLog) {}

  addAll(urls: string[]): Promise<void> {
    for (const url of urls) {
      this.log.added.push(url)
      this.entries.set(url, { body: `cached:${url}` })
    }
    return Promise.resolve()
  }

  put(request: unknown, response: FakeResponse): Promise<void> {
    this.log.put.push(keyOf(request))
    this.entries.set(keyOf(request), response)
    return Promise.resolve()
  }

  match(request: unknown): Promise<FakeResponse | undefined> {
    return Promise.resolve(this.entries.get(keyOf(request)))
  }
}

class FakeCacheStorage {
  readonly opened = new Map<string, FakeCache>()
  constructor(private readonly log: CacheLog) {}

  open(name: string): Promise<FakeCache> {
    const existing = this.opened.get(name)
    if (existing) return Promise.resolve(existing)
    const created = new FakeCache(this.log)
    this.opened.set(name, created)
    return Promise.resolve(created)
  }

  keys(): Promise<string[]> { return Promise.resolve([...this.opened.keys()]) }
  delete(name: string): Promise<boolean> { return Promise.resolve(this.opened.delete(name)) }
}

type Listener = (event: any) => void

interface WorkerOptions {
  shell?: string[]
  version?: string
  fetchImpl?: (request: FakeRequest) => Promise<FakeResponse>
}

function loadWorker(options: WorkerOptions = {}) {
  const log: CacheLog = { added: [], put: [], fetched: [] }
  const listeners = new Map<string, Listener[]>()
  const caches = new FakeCacheStorage(log)
  const skipWaiting = vi.fn()
  const claim = vi.fn(() => Promise.resolve())

  const scope = {
    __SW_VERSION__: options.version ?? 'v-test',
    __SHELL__: options.shell ?? SHELL,
    location: { origin: ORIGIN },
    clients: { claim },
    skipWaiting,
    addEventListener(type: string, fn: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn])
    },
  }

  const network = options.fetchImpl
    ?? ((request: FakeRequest) => Promise.resolve({ body: `network:${request.url}` }))
  const fetchImpl = (request: FakeRequest) => {
    log.fetched.push(keyOf(request))
    return network(request)
  }

  new Function('self', 'caches', 'fetch', 'URL', SOURCE)(scope, caches, fetchImpl, URL)

  const fire = (type: string, event: unknown) => {
    for (const fn of listeners.get(type) ?? []) fn(event)
  }

  const lifecycle = async (type: 'install' | 'activate') => {
    const waits: unknown[] = []
    fire(type, { waitUntil: (p: unknown) => waits.push(p) })
    await Promise.all(waits)
  }

  return {
    log, caches, skipWaiting, claim,
    install: () => lifecycle('install'),
    activate: () => lifecycle('activate'),
    message: (data: unknown) => fire('message', { data }),
    /** Resolves to `undefined` when the worker declined to handle the request. */
    fetch(request: FakeRequest): Promise<FakeResponse | undefined> {
      let responded: Promise<FakeResponse> | undefined
      fire('fetch', { request, respondWith: (p: Promise<FakeResponse>) => { responded = p } })
      return responded ?? Promise.resolve(undefined)
    },
  }
}

const req = (url: string, over: Partial<FakeRequest> = {}): FakeRequest => ({
  url: url.startsWith('http') ? url : `${ORIGIN}${url}`,
  method: 'GET',
  mode: 'no-cors',
  ...over,
})

/** Every key across every cache the worker holds. */
const stored = (worker: ReturnType<typeof loadWorker>): string[] =>
  [...worker.caches.opened.values()].flatMap((c) => [...c.entries.keys()])

describe('the shell service worker', () => {
  it('precaches exactly the build-supplied shell, into one versioned cache', async () => {
    const worker = loadWorker()
    await worker.install()

    expect(worker.log.added).toEqual(SHELL)
    expect([...worker.caches.opened.keys()]).toEqual(['resumestudio-shell-v-test'])
  })

  describe('never caches /api/', () => {
    it('declines an API request instead of answering it from a cache', async () => {
      const worker = loadWorker()
      await worker.install()

      for (const url of ['/api', '/api/resumes', '/api/resumes/abc-123', '/api/backup/export']) {
        expect(await worker.fetch(req(url)), url).toBeUndefined()
      }
      expect(stored(worker)).toEqual(SHELL)
      expect(worker.log.put).toEqual([])
    })

    it('declines an API request while the network is down too', async () => {
      // The offline branch is where a cache write is most tempting: the answer
      // is a failed request, not a stale CV served from disk.
      const worker = loadWorker({ fetchImpl: () => Promise.reject(new Error('offline')) })
      await worker.install()

      expect(await worker.fetch(req('/api/resumes'))).toBeUndefined()
      expect(worker.log.put).toEqual([])
    })

    it('does not answer a navigation to an API URL with the precached document', async () => {
      // Opening /api/backup/export in a tab is a navigation. Without the guard
      // sitting ahead of the navigate branch, an offline one resolves to the
      // SPA shell — an HTML document served as if it were an API response.
      const worker = loadWorker({ fetchImpl: () => Promise.reject(new Error('offline')) })
      await worker.install()

      expect(await worker.fetch(req('/api/backup/export', { mode: 'navigate' }))).toBeUndefined()
    })

    it('refuses an API path even if the build manifest names one', async () => {
      // The shell list is data the worker is handed, not a rule it states. The
      // guard has to win over it, or the invariant is only as strong as a
      // build step.
      const worker = loadWorker({ shell: [...SHELL, '/api/resumes'] })
      await worker.install()

      expect(await worker.fetch(req('/api/resumes'))).toBeUndefined()
    })

    it('cannot cache an API response because it never writes outside install', async () => {
      // The structural claim, exercised: drive every branch of the fetch
      // handler and assert `put` is never reached. A response the worker cannot
      // store is a CV that outlives `clearAllCaches()` nowhere.
      const worker = loadWorker()
      await worker.install()
      worker.log.put.length = 0

      await worker.fetch(req('/api/resumes'))
      await worker.fetch(req('/', { mode: 'navigate' }))
      await worker.fetch(req('/assets/index-aaa.js'))
      await worker.fetch(req('/assets/pdfmake-zzz.js'))
      await worker.fetch(req('/api/resumes', { method: 'POST' }))
      await worker.fetch(req('https://other.example/assets/index-aaa.js'))

      expect(worker.log.put).toEqual([])
      expect(stored(worker)).toEqual(SHELL)
    })
  })

  describe('fetch routing', () => {
    it('prefers the network for a navigation, so a deploy is not masked', async () => {
      const worker = loadWorker()
      await worker.install()

      expect(await worker.fetch(req('/', { mode: 'navigate' })))
        .toEqual({ body: `network:${ORIGIN}/` })
    })

    it('falls back to the precached document when a navigation cannot reach the network', async () => {
      const worker = loadWorker({ fetchImpl: () => Promise.reject(new Error('offline')) })
      await worker.install()

      // A deep SPA route: the server's catch-all is what normally answers it.
      expect(await worker.fetch(req('/r/abc-123', { mode: 'navigate' })))
        .toEqual({ body: 'cached:/index.html' })
    })

    it('lets the network error surface when nothing is precached yet', async () => {
      // respondWith(undefined) would render an opaque failed load instead of
      // the browser's own offline page.
      const worker = loadWorker({ fetchImpl: () => Promise.reject(new Error('offline')) })

      await expect(worker.fetch(req('/', { mode: 'navigate' }))).rejects.toThrow('offline')
    })

    it('serves a precached asset without touching the network', async () => {
      const worker = loadWorker()
      await worker.install()
      worker.log.fetched.length = 0

      expect(await worker.fetch(req('/assets/index-aaa.js')))
        .toEqual({ body: 'cached:/assets/index-aaa.js' })
      expect(await worker.fetch(req('/fonts/ubuntu-400-latin.woff2')))
        .toEqual({ body: 'cached:/fonts/ubuntu-400-latin.woff2' })
      expect(worker.log.fetched).toEqual([])
    })

    it('leaves a lazy export chunk to the browser', async () => {
      // Exports are online-only by decision: pdfmake and the DOCX exporter are
      // ~2 MB, and precaching them would dwarf the shell.
      const worker = loadWorker()
      await worker.install()

      expect(await worker.fetch(req('/assets/pdfmake-zzz.js'))).toBeUndefined()
      expect(await worker.fetch(req('/assets/exporter-zzz.js'))).toBeUndefined()
    })

    it('ignores non-GET requests and other origins', async () => {
      const worker = loadWorker()
      await worker.install()

      expect(await worker.fetch(req('/index.html', { method: 'POST' }))).toBeUndefined()
      expect(await worker.fetch(req('/assets/index-aaa.js', { method: 'HEAD' }))).toBeUndefined()
      expect(await worker.fetch(req('https://other.example/assets/index-aaa.js'))).toBeUndefined()
    })

    it('falls through to the network for a shell URL the cache lost', async () => {
      const worker = loadWorker()

      expect(await worker.fetch(req('/assets/index-aaa.js')))
        .toEqual({ body: `network:${ORIGIN}/assets/index-aaa.js` })
    })
  })

  describe('activation', () => {
    it('drops superseded shells and leaves other origins’ caches alone', async () => {
      const worker = loadWorker({ version: 'v2' })
      await worker.caches.open('resumestudio-shell-v1')
      await worker.caches.open('some-other-app')
      await worker.install()
      await worker.activate()

      expect([...worker.caches.opened.keys()].sort())
        .toEqual(['resumestudio-shell-v2', 'some-other-app'])
      expect(worker.claim).toHaveBeenCalled()
    })
  })

  describe('the update handshake', () => {
    it('takes over only when the page asks', async () => {
      const worker = loadWorker()
      await worker.install()
      expect(worker.skipWaiting).not.toHaveBeenCalled()

      worker.message({ type: 'SKIP_WAITING' })
      expect(worker.skipWaiting).toHaveBeenCalledTimes(1)
    })

    it('ignores any other message, including an empty one', () => {
      const worker = loadWorker()

      worker.message({ type: 'SOMETHING_ELSE' })
      worker.message(undefined)
      worker.message('SKIP_WAITING')

      expect(worker.skipWaiting).not.toHaveBeenCalled()
    })
  })
})

describe('shellUrls — what the build tells the worker to precache', () => {
  const FONTS = ['ubuntu-400-latin.woff2', 'open-sans-condensed-300-latin.woff2']

  const bundle = () => ({
    'assets/index-aaa.js': {
      type: 'chunk', fileName: 'assets/index-aaa.js', isEntry: true,
      imports: ['assets/shared-ddd.js'],
      viteMetadata: { importedCss: new Set(['assets/index-bbb.css']) },
    },
    'assets/swRegister-ccc.js': {
      type: 'chunk', fileName: 'assets/swRegister-ccc.js', isEntry: true, imports: [],
    },
    'assets/shared-ddd.js': {
      type: 'chunk', fileName: 'assets/shared-ddd.js', isEntry: false, imports: [],
    },
    'assets/pdfmake-eee.js': {
      type: 'chunk', fileName: 'assets/pdfmake-eee.js', isEntry: false,
      imports: ['assets/Roboto-fff.js'],
    },
    'assets/Roboto-fff.js': {
      type: 'chunk', fileName: 'assets/Roboto-fff.js', isEntry: false, imports: [],
    },
    'assets/index-bbb.css': { type: 'asset', fileName: 'assets/index-bbb.css' },
  })

  it('lists the document, both entries, their static import and CSS, and the fonts', () => {
    expect(shellUrls(bundle(), FONTS)).toEqual([
      '/index.html',
      '/assets/index-aaa.js',
      '/assets/shared-ddd.js',
      '/assets/swRegister-ccc.js',
      '/assets/index-bbb.css',
      '/fonts/open-sans-condensed-300-latin.woff2',
      '/fonts/ubuntu-400-latin.woff2',
    ])
  })

  it('leaves out the lazy chunks no entry statically imports', () => {
    // pdfmake reaches the app through `await import()` only. Nothing here
    // consults an exclusion list — a renamed chunk stays out for the same
    // reason this one does.
    const urls = shellUrls(bundle(), FONTS)
    expect(urls.some((u) => u.includes('pdfmake'))).toBe(false)
    expect(urls.some((u) => u.includes('Roboto'))).toBe(false)
  })

  it('pulls in a chunk that is lazy from one entry but static from another', () => {
    const mixed = {
      ...bundle(),
      'assets/swRegister-ccc.js': {
        type: 'chunk', fileName: 'assets/swRegister-ccc.js', isEntry: true,
        imports: ['assets/pdfmake-eee.js'],
      },
    }
    expect(shellUrls(mixed, FONTS)).toContain('/assets/pdfmake-eee.js')
  })

  it('is order-independent, so an unchanged build keeps its version hash', () => {
    const forward = bundle()
    const reversed = Object.fromEntries(Object.entries(forward).reverse())
    expect(shellUrls(reversed, [...FONTS].reverse())).toEqual(shellUrls(forward, FONTS))
  })

  it('survives a cycle between chunks rather than recursing forever', () => {
    const cyclic = {
      'assets/index-aaa.js': {
        type: 'chunk', fileName: 'assets/index-aaa.js', isEntry: true,
        imports: ['assets/shared-ddd.js'],
      },
      'assets/shared-ddd.js': {
        type: 'chunk', fileName: 'assets/shared-ddd.js', isEntry: false,
        imports: ['assets/index-aaa.js'],
      },
    }
    expect(shellUrls(cyclic, [])).toEqual([
      '/index.html', '/assets/index-aaa.js', '/assets/shared-ddd.js',
    ])
  })
})
