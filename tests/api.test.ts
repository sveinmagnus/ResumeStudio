/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  api, UnauthorizedError, NotFoundError, ServerError, ConflictError,
  isAbortError,
} from '../src/lib/api'
import { emptyStore, makeResume } from './fixtures'
import type { ResumeMeta } from '../src/lib/api'

// ── Mock fetch at the boundary (testing skill §3) ─────────────────────────────

interface MockResOpts { status?: number; body?: unknown }
function mockRes({ status = 200, body = {} }: MockResOpts) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    json: async () => body,
  } as unknown as Response
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const META: ResumeMeta = {
  id: 'r1', name: 'CV', primary_locale: 'en', secondary_locale: null,
  saved_at: '2026-06-01T00:00:00Z', created_at: '2026-06-01T00:00:00Z', version: 1,
}

// Pull the [url, init] of the Nth fetch call.
function callArgs(n = 0): [string, RequestInit] {
  return fetchMock.mock.calls[n] as [string, RequestInit]
}

describe('listResumes', () => {
  it('returns the array on 200', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: { resumes: [META] } }))
    expect(await api.listResumes()).toEqual([META])
    expect(callArgs()[0]).toBe('/api/resumes')
  })

  it('throws ServerError on non-ok', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 500 }))
    await expect(api.listResumes()).rejects.toBeInstanceOf(ServerError)
  })

  it('throws UnauthorizedError on 401', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 401 }))
    await expect(api.listResumes()).rejects.toBeInstanceOf(UnauthorizedError)
  })
})

describe('createResume', () => {
  it('POSTs the input and returns the new meta', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 201, body: { resume: META } }))
    const out = await api.createResume({ name: 'CV', data: emptyStore() })
    expect(out).toEqual(META)
    const [url, init] = callArgs()
    expect(url).toBe('/api/resumes')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string).name).toBe('CV')
  })
})

describe('loadResume', () => {
  it('returns {data, meta} on 200', async () => {
    const data = { ...emptyStore(), resume: makeResume({ full_name: 'A' }) }
    fetchMock.mockResolvedValue(mockRes({ body: { data, meta: META } }))
    const out = await api.loadResume('r1')
    expect(out?.meta).toEqual(META)
    expect(out?.data.resume?.full_name).toBe('A')
  })

  it('returns null on 404 (not an error — caller redirects)', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 404 }))
    expect(await api.loadResume('ghost')).toBeNull()
  })

  it('throws ServerError on other non-ok', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 500 }))
    await expect(api.loadResume('r1')).rejects.toBeInstanceOf(ServerError)
  })

  it('percent-encodes the id in the URL', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 404 }))
    await api.loadResume('a b/c')
    expect(callArgs()[0]).toBe('/api/resumes/a%20b%2Fc')
  })
})

describe('saveResume', () => {
  const okBody = { ok: true, saved_at: '2026-06-02T00:00:00Z', version: 2 }

  it('PUTs {data} only when no locales/baseVersion given; returns saved_at + version', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: okBody }))
    const out = await api.saveResume('r1', emptyStore())
    expect(out).toEqual({ saved_at: okBody.saved_at, version: 2 })
    const [url, init] = callArgs()
    expect(url).toBe('/api/resumes/r1')
    expect(init.method).toBe('PUT')
    const body = JSON.parse(init.body as string)
    expect(body).toHaveProperty('data')
    expect(body).not.toHaveProperty('primary_locale')
    expect(body).not.toHaveProperty('base_version')
  })

  it('folds locales into the body when provided', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: okBody }))
    await api.saveResume('r1', emptyStore(), { primary_locale: 'no', secondary_locale: 'en' })
    const body = JSON.parse(callArgs()[1].body as string)
    expect(body.primary_locale).toBe('no')
    expect(body.secondary_locale).toBe('en')
  })

  it('sends base_version only when provided', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: okBody }))
    await api.saveResume('r1', emptyStore(), undefined, 5)
    expect(JSON.parse(callArgs()[1].body as string).base_version).toBe(5)
  })

  it('throws ConflictError on 409, carrying the server current state', async () => {
    const current = { data: { ...emptyStore(), resume: makeResume({ full_name: 'Theirs' }) }, meta: { ...META, version: 9 } }
    fetchMock.mockResolvedValue(mockRes({ status: 409, body: { error: 'changed', current } }))
    try {
      await api.saveResume('r1', emptyStore(), undefined, 4)
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError)
      expect((err as ConflictError).current.meta.version).toBe(9)
      expect((err as ConflictError).current.data.resume?.full_name).toBe('Theirs')
    }
  })

  it('throws NotFoundError on 404 (resume deleted under us)', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 404 }))
    await expect(api.saveResume('ghost', emptyStore())).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws ServerError on other non-ok', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 500 }))
    await expect(api.saveResume('r1', emptyStore())).rejects.toBeInstanceOf(ServerError)
  })

  it('forwards the AbortSignal (now the 5th arg)', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: okBody }))
    const ctrl = new AbortController()
    await api.saveResume('r1', emptyStore(), undefined, undefined, ctrl.signal)
    expect(callArgs()[1].signal).toBe(ctrl.signal)
  })
})

describe('patchResume', () => {
  it('PATCHes the name', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: { ok: true } }))
    await api.patchResume('r1', { name: 'Renamed' })
    const [url, init] = callArgs()
    expect(url).toBe('/api/resumes/r1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Renamed' })
  })

  it('throws NotFoundError on 404', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 404 }))
    await expect(api.patchResume('ghost', { name: 'x' })).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('deleteResume', () => {
  it('DELETEs the resume', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: { ok: true } }))
    await api.deleteResume('r1')
    const [url, init] = callArgs()
    expect(url).toBe('/api/resumes/r1')
    expect(init.method).toBe('DELETE')
  })

  it('throws NotFoundError on 404', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 404 }))
    await expect(api.deleteResume('ghost')).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('snapshots', () => {
  it('lists snapshots, scoping the URL by resume id', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: { snapshots: [{ id: 1, saved_at: 'x', size: 10 }] } }))
    const out = await api.listSnapshots('r 1')
    expect(out).toHaveLength(1)
    expect(callArgs()[0]).toBe('/api/resumes/r%201/snapshots')
  })

  it('fetches one snapshot by id', async () => {
    const data = { ...emptyStore(), resume: makeResume({ full_name: 'Snap' }) }
    fetchMock.mockResolvedValue(mockRes({ body: { data } }))
    const out = await api.getSnapshot('r1', 7)
    expect(out.resume?.full_name).toBe('Snap')
    expect(callArgs()[0]).toBe('/api/resumes/r1/snapshots/7')
  })

  it('throws ServerError when a snapshot list fails', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 500 }))
    await expect(api.listSnapshots('r1')).rejects.toBeInstanceOf(ServerError)
  })
})

describe('auth (cookie session)', () => {
  it('login POSTs the token to /api/auth/login', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: { ok: true } }))
    await api.login('s3cret')
    const [url, init] = callArgs()
    expect(url).toBe('/api/auth/login')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ token: 's3cret' })
  })

  it('login throws UnauthorizedError on 401 (wrong token)', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 401 }))
    await expect(api.login('bad')).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('sends requests with same-origin credentials so the cookie carries auth', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: { resumes: [] } }))
    await api.listResumes()
    expect(callArgs()[1].credentials).toBe('same-origin')
  })

  it('never attaches an Authorization header from JS (token is not in JS storage)', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: { resumes: [] } }))
    await api.listResumes()
    const headers = callArgs()[1].headers as Record<string, string>
    expect(headers['Authorization']).toBeUndefined()
  })

  it('logout POSTs to /api/auth/logout and never throws', async () => {
    fetchMock.mockRejectedValue(new Error('network'))
    await expect(api.logout()).resolves.toBeUndefined()
  })
})

describe('translateStatus (never throws)', () => {
  it('returns false when the request rejects', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    expect(await api.translateStatus()).toBe(false)
  })

  it('returns false on non-ok', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 500 }))
    expect(await api.translateStatus()).toBe(false)
  })

  it('returns true only when configured:true', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: { configured: true } }))
    expect(await api.translateStatus()).toBe(true)
  })
})

describe('isAbortError', () => {
  it('recognises a DOMException AbortError', () => {
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true)
    expect(isAbortError(new Error('nope'))).toBe(false)
  })
})

/**
 * The probes behind optional features. Every one of these is called on render
 * to decide whether a feature exists at all, so an unreachable or unhappy
 * server has to make the feature hide quietly — never break the page and never
 * reject into a render path.
 */
describe('probes that must never throw', () => {
  const OFF_ASSIST = { configured: false, provider: '', model: '', local: false, highEnd: false }
  const OFF_UPDATE = {
    supported: false, state: 'idle', currentVersion: '0.0.0', latestVersion: null,
    updateAvailable: false, downloadable: false, progress: 0, lastCheckedAt: null,
    notes: '', htmlUrl: null, error: null,
  }

  /**
   * [name, call, what a 500 yields, what an unreachable server yields].
   *
   * The connection-test probes deliberately differ between the two: "the
   * server refused" and "there is no server" are different things to show a
   * user who is mid-way through configuring a backend.
   */
  const probes: Array<[string, () => Promise<unknown>, unknown, unknown]> = [
    ['health', () => api.health(), false, false],
    ['backupStatus', () => api.backupStatus(), { configured: false }, { configured: false }],
    ['llmStatus', () => api.llmStatus(), OFF_ASSIST, OFF_ASSIST],
    ['llmModels', () => api.llmModels(), [], []],
    ['updateStatus', () => api.updateStatus(), OFF_UPDATE, OFF_UPDATE],
    ['testTranslate', () => api.testTranslate(),
      { reachable: false, message: 'Test failed (500)' },
      { reachable: false, message: 'Test request failed.' }],
    ['testLlm', () => api.testLlm(),
      { reachable: false, message: 'Test failed (500)' },
      { reachable: false, message: 'Test request failed.' }],
  ]

  it.each(probes)('%s falls back when the server answers 500', async (_name, call, onRefused) => {
    fetchMock.mockResolvedValue(mockRes({ status: 500 }))
    expect(await call()).toEqual(onRefused)
  })

  it.each(probes)('%s falls back when the network is down', async (_name, call, _refused, onDown) => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await call()).toEqual(onDown)
  })

  it('logout swallows a failure rather than blocking sign-out', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(api.logout()).resolves.toBeUndefined()
  })

  it('reports the assist as off unless the server says configured', async () => {
    // A truthy-but-not-true value must not switch the feature on.
    fetchMock.mockResolvedValue(mockRes({ body: { configured: 'yes', provider: 'openai' } }))
    expect(await api.llmStatus()).toEqual(OFF_ASSIST)
  })

  it('keeps only models the server actually named', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: { models: [
      { id: 'gpt-5' }, { id: '' }, { name: 'no id' }, null,
    ] } }))
    expect(await api.llmModels()).toEqual([{ id: 'gpt-5' }])
  })

  it('treats a models payload that is not a list as no models', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: { models: 'gpt-5' } }))
    expect(await api.llmModels()).toEqual([])
  })

  it('asks the server to honour pending form values only when it has them', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: { models: [] } }))
    await api.llmModels()
    expect(callArgs()).toMatchObject(['/api/llm/models', { method: 'GET' }])

    // Right after pasting a key, before Save — the values aren't stored yet.
    fetchMock.mockClear()
    await api.llmModels({ llm_api_key: 'sk-test' } as never)
    expect(callArgs()[0]).toBe('/api/settings/llm/models')
    expect(callArgs()[1].method).toBe('POST')
  })
})

/**
 * Every failing endpoint prefers the server's own `{ error }` wording, because
 * the server knows what went wrong ("Sync folder is read-only") and the client
 * only knows which button was pressed.
 */
describe('failure messages', () => {
  it('surfaces the server message over the generic one', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 500, body: { error: 'Sync folder is read-only' } }))
    await expect(api.backupNow()).rejects.toThrow('Sync folder is read-only')
  })

  it('falls back to its own wording, with the status, when there is no message', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 503, body: {} }))
    await expect(api.backupNow()).rejects.toThrow(/\(503\)/)
  })

  it('falls back when the body is not JSON at all', async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 502, statusText: 'Bad Gateway',
      json: async () => { throw new SyntaxError('Unexpected token <') },
    } as unknown as Response)
    await expect(api.backupNow()).rejects.toThrow(/\(502\)/)
  })

  it.each([
    ['backupNow', () => api.backupNow()],
    ['restoreBackup', () => api.restoreBackup()],
    ['browseFolders', () => api.browseFolders()],
    ['saveSettings', () => api.saveSettings({} as never)],
    ['llmComplete', () => api.llmComplete('hi')],
    ['importBackupFile', () => api.importBackupFile(new File(['{}'], 'b.json'))],
  ])('%s maps 401 to UnauthorizedError', async (_name, call) => {
    fetchMock.mockResolvedValue(mockRes({ status: 401 }))
    await expect(call()).rejects.toBeInstanceOf(UnauthorizedError)
  })
})

describe('endpoints that carry a payload', () => {
  it('restoreBackup defaults to merging, never replacing', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: {} }))
    await api.restoreBackup()
    expect(JSON.parse(callArgs()[1].body as string)).toEqual({ mode: 'merge' })
  })

  it('browseFolders asks for the default location when given no path', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: { path: '/', entries: [] } }))
    await api.browseFolders()
    expect(JSON.parse(callArgs()[1].body as string)).toEqual({ path: '' })
  })

  it('llmComplete passes the advanced flag through, and refuses an empty answer', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: { text: 'drafted' } }))
    expect(await api.llmComplete('prompt', 4096, true)).toBe('drafted')
    expect(JSON.parse(callArgs()[1].body as string))
      .toEqual({ prompt: 'prompt', max_tokens: 4096, advanced: true })

    // A model that answers with whitespace has not answered.
    fetchMock.mockResolvedValue(mockRes({ body: { text: '   ' } }))
    await expect(api.llmComplete('prompt')).rejects.toThrow(/returned no text/i)
  })

  it('checkForUpdate and installUpdate report the server’s reason for refusing', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 403, body: { error: 'Not the desktop build' } }))
    await expect(api.checkForUpdate()).rejects.toThrow('Not the desktop build')
    await expect(api.installUpdate()).rejects.toThrow('Not the desktop build')
  })
})

/**
 * The cross-resume registry client (§14). Four methods, none called by a test.
 *
 * The registry is instance-level and shared across every resume, and it rides
 * the desktop sync — so its optimistic-concurrency handling is the same
 * contract as a resume save, and its URL encoding is what keeps an id with a
 * slash or a space in it from addressing a different row.
 */
describe('registry client', () => {
  it('lists every kind, and filters when asked', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: { entries: [] } }))
    await api.listRegistry()
    expect(callArgs()[0]).toBe('/api/registry')

    fetchMock.mockResolvedValue(mockRes({ body: { entries: [] } }))
    await api.listRegistry('skill')
    expect(callArgs(1)[0]).toBe('/api/registry?kind=skill')
  })

  it('unwraps the entries array rather than returning the envelope', async () => {
    const entry = { id: 'e1', kind: 'skill', name: { en: 'Go' }, version: 1 }
    fetchMock.mockResolvedValue(mockRes({ body: { entries: [entry] } }))
    expect(await api.listRegistry()).toEqual([entry])
  })

  it('POSTs a create and returns the created entry', async () => {
    const entry = { id: 'e1', kind: 'skill', name: { en: 'Go' }, version: 1 }
    fetchMock.mockResolvedValue(mockRes({ body: { entry } }))
    expect(await api.createRegistryEntry({ kind: 'skill', name: { en: 'Go' } })).toEqual(entry)
    const [url, init] = callArgs()
    expect(url).toBe('/api/registry')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ kind: 'skill', name: { en: 'Go' } })
  })

  it('PUTs an update to the entry’s own URL, encoded', async () => {
    // An id is opaque; one containing a slash would otherwise address a
    // different route entirely.
    const entry = { id: 'a/b', kind: 'skill', name: { en: 'Go' }, version: 2 }
    fetchMock.mockResolvedValue(mockRes({ body: { entry } }))
    await api.updateRegistryEntry('a/b', { name: { en: 'Go' } })
    expect(callArgs()[0]).toBe('/api/registry/a%2Fb')
    expect(callArgs()[1].method).toBe('PUT')
  })

  it('turns a 409 into a RegistryConflictError CARRYING the server’s entry', async () => {
    // The current row is what the UI needs to show "someone renamed this" —
    // dropping it leaves a conflict the user cannot act on.
    const current = { id: 'e1', kind: 'skill', name: { en: 'Golang' }, version: 7 }
    fetchMock.mockResolvedValue(mockRes({ status: 409, body: { current } }))
    await expect(api.updateRegistryEntry('e1', { name: { en: 'Go' }, base_version: 1 }))
      .rejects.toMatchObject({ current })
  })

  it('still reports a 409 whose body cannot be parsed', async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 409, statusText: 'Conflict',
      json: async () => { throw new Error('not json') },
    } as unknown as Response)
    await expect(api.updateRegistryEntry('e1', { name: {} })).rejects.toMatchObject({ current: null })
  })

  it('DELETEs and reports whether a row was actually removed', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: { deleted: true } }))
    expect(await api.deleteRegistryEntry('e1')).toBe(true)
    expect(callArgs()[1].method).toBe('DELETE')

    fetchMock.mockResolvedValue(mockRes({ body: { deleted: false } }))
    expect(await api.deleteRegistryEntry('gone')).toBe(false)

    // Encoded here too — the id is opaque and may carry a slash.
    fetchMock.mockResolvedValue(mockRes({ body: { deleted: true } }))
    await api.deleteRegistryEntry('a/b')
    expect(callArgs(2)[0]).toBe('/api/registry/a%2Fb')
  })

  it('throws ServerError on a failed create, update or delete', async () => {
    for (const call of [
      () => api.createRegistryEntry({ kind: 'skill', name: {} }),
      () => api.updateRegistryEntry('e1', { name: {} }),
      () => api.deleteRegistryEntry('e1'),
      () => api.listRegistry(),
    ]) {
      fetchMock.mockResolvedValue(mockRes({ status: 500 }))
      await expect(call()).rejects.toBeInstanceOf(ServerError)
    }
  })
})

describe('translateStatus / llmStatus — the feature gates', () => {
  it('reports configured only when the server says so', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: { configured: true } }))
    expect(await api.translateStatus()).toBe(true)
    fetchMock.mockResolvedValue(mockRes({ body: { configured: false } }))
    expect(await api.translateStatus()).toBe(false)
  })

  it('reads configured STRICTLY, so a truthy string does not enable the feature', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: { configured: 'yes' } }))
    expect(await api.translateStatus()).toBe(false)
  })

  it('is false — never a throw — when the endpoint fails or the network is down', async () => {
    // The Draft button just hides; an exception here would take the editor
    // down with it.
    // The body is deliberately a VALID enabling payload: a proxy or error page
    // can return one with a 5xx, and only the status check rejects it.
    fetchMock.mockResolvedValue(mockRes({ status: 500, body: { configured: true } }))
    expect(await api.translateStatus()).toBe(false)
    fetchMock.mockRejectedValue(new Error('offline'))
    expect(await api.translateStatus()).toBe(false)
  })
})

/**
 * The desktop and AI-assist endpoints — 83 unreached mutants.
 *
 * These are the calls that decide whether a feature APPEARS and, in llmStatus's
 * case, what the app promises about privacy. They all use `safe()`, so a failure
 * must degrade to a defined answer rather than throw into the UI.
 */
describe('llmStatus — the privacy and capability flags', () => {
  const ok = (body: unknown) => fetchMock.mockResolvedValue(mockRes({ body }))

  it('reads a configured backend and reports where it runs', async () => {
    ok({ configured: true, provider: 'ollama', model: 'llama3.1:8b', local: true })
    expect(await api.llmStatus()).toMatchObject({
      configured: true, provider: 'ollama', model: 'llama3.1:8b', local: true,
    })
  })

  it('fails CLOSED on local — a server that does not say so is treated as remote', async () => {
    // Getting this wrong promises privacy the app does not have.
    for (const local of [undefined, 'yes', 1, null]) {
      ok({ configured: true, provider: 'compat', model: 'm', local })
      expect((await api.llmStatus()).local, JSON.stringify(local)).toBe(false)
    }
  })

  it('fails CLOSED on high-end — an unstated flag is not high-end', async () => {
    // Getting this wrong runs a whole-CV review on a 3B model and presents the
    // result as advice (§15).
    for (const flag of [undefined, 'true', 1]) {
      ok({ configured: true, provider: 'ollama', model: 'm', local: true, high_end: flag })
      expect((await api.llmStatus()).highEnd, JSON.stringify(flag)).toBeFalsy()
    }
    ok({ configured: true, provider: 'ollama', model: 'm', local: true, high_end: true })
    expect((await api.llmStatus()).highEnd).toBe(true)
  })

  it('reads `configured` strictly, so a truthy value does not enable the surface', async () => {
    ok({ configured: 'yes', provider: 'ollama', model: 'm' })
    expect(await api.llmStatus()).toMatchObject({ configured: false })
  })

  it('reports not-configured — never throws — on a failure or a dead server', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 500, body: { configured: true, local: true } }))
    expect(await api.llmStatus()).toMatchObject({ configured: false })
    fetchMock.mockRejectedValue(new Error('offline'))
    expect(await api.llmStatus()).toMatchObject({ configured: false })
  })

  it('defaults the provider and model to empty strings rather than undefined', async () => {
    // They are rendered directly in the settings panel.
    ok({ configured: true, local: true })
    expect(await api.llmStatus()).toMatchObject({ provider: '', model: '' })
  })
})

describe('the Docker controls', () => {
  const cases: Array<[string, (a: 'start' | 'stop' | 'status') => Promise<{ available: boolean; message?: string }>, string]> = [
    ['translateDocker', (a) => api.translateDocker(a), '/api/settings/docker'],
    ['ollamaDocker', (a) => api.ollamaDocker(a), '/api/settings/llm/docker'],
  ]

  it.each(cases)('%s POSTs the action to %s', async (_name, call, url) => {
    fetchMock.mockResolvedValue(mockRes({ body: { available: true } }))
    await call('start')
    expect(callArgs()[0]).toBe(url)
    expect(callArgs()[1].method).toBe('POST')
    expect(JSON.parse(callArgs()[1].body as string)).toMatchObject({ action: 'start' })
  })

  it.each(cases)('%s reports unavailable with the server’s message on a failure', async (_name, call) => {
    // Managed Docker is best-effort and must never throw into the request path
    // (§14) — the panel shows the reason instead.
    // The server's reason travels in `error`; anything else falls back to the
    // generic message, which is why the field name is worth pinning.
    fetchMock.mockResolvedValue(mockRes({ status: 500, body: { error: 'daemon not running' } }))
    const r = await call('start')
    expect(r.available).toBe(false)
    expect(r.message).toContain('daemon not running')

    fetchMock.mockResolvedValue(mockRes({ status: 500, body: { message: 'wrong field' } }))
    expect((await call('start')).message).not.toContain('wrong field')
  })

  it.each(cases)('%s reports unavailable when the request itself fails', async (_name, call) => {
    fetchMock.mockRejectedValue(new Error('offline'))
    const r = await call('status')
    expect(r.available).toBe(false)
    expect(r.message).toBeTruthy()
  })

  it.each(cases)('%s names the action in BOTH fallback messages', async (_name, call) => {
    // "stop failed" and "start failed" are different problems to the reader,
    // and there are two fallbacks: the one used when the request itself fails,
    // and the one used when the server answers 5xx with no reason.
    fetchMock.mockRejectedValue(new Error('offline'))
    expect((await call('stop')).message).toContain('stop')

    fetchMock.mockResolvedValue(mockRes({ status: 500, body: {} }))
    const r = await call('stop')
    expect(r.available).toBe(false)
    expect(r.message).toContain('stop')
    expect(r.message).toContain('500')
  })

  it('carries the model on the Ollama pull, and omits it otherwise', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: { available: true } }))
    await api.ollamaDocker('start', 'llama3.1:8b')
    expect(JSON.parse(callArgs()[1].body as string)).toMatchObject({ model: 'llama3.1:8b' })
  })
})

describe('exportBackupZip', () => {
  const zipRes = (disposition?: string) => ({
    ok: true, status: 200, statusText: 'OK',
    headers: { get: (h: string) => (h === 'Content-Disposition' ? disposition ?? null : null) },
    blob: async () => new Blob(['zip']),
    json: async () => ({}),
  } as unknown as Response)

  it('prefers the filename the SERVER supplied — it carries the date', async () => {
    fetchMock.mockResolvedValue(zipRes('attachment; filename="resumes-2026-06-01.zip"'))
    const anchor = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await api.exportBackupZip()
    expect((anchor.mock.instances[0] as HTMLAnchorElement).download)
      .toBe('resumes-2026-06-01.zip')
  })

  it('falls back to a fixed name when the server sent no disposition', async () => {
    fetchMock.mockResolvedValue(zipRes(undefined))
    const anchor = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await api.exportBackupZip()
    expect((anchor.mock.instances[0] as HTMLAnchorElement).download).toMatch(/\.zip$/)
  })

  it('throws rather than downloading an error page as a zip', async () => {
    // Specifically a ServerError: without the status check it would fall
    // through to res.blob() and throw a TypeError, which `Error` also matches.
    fetchMock.mockResolvedValue(mockRes({ status: 500 }))
    await expect(api.exportBackupZip()).rejects.toBeInstanceOf(ServerError)
  })
})
