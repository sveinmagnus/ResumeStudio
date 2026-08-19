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
    // Empty label, not a guessed one: with no server there is nothing to
    // report, and every display site falls back on its own (`versionLabel ||
    // …`) rather than showing a version this build can't vouch for.
    supported: false, state: 'idle', currentVersion: '0.0.0', versionLabel: '', latestVersion: null,
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

/**
 * Every endpoint that can fail has to fail LOUDLY or QUIETLY on purpose: a save
 * that swallows a 500 loses the user's work silently, and a status probe that
 * throws breaks the page around it. These pin which of the two each one is, and
 * what the request looked like.
 */
describe('api — the ones that must throw on a bad response', () => {
  const okJson = (body: unknown = {}) => mockRes({ status: 200, body })

  const cases: Array<[string, () => Promise<unknown>]> = [
    ['login', () => api.login('secret')],
    ['patchResume', () => api.patchResume('r1', { name: 'New name' })],
    ['deleteResume', () => api.deleteResume('r1')],
    ['getSnapshot', () => api.getSnapshot('r1', 1)],
    ['translate', () => api.translate('hei', 'no', 'en')],
    ['importBackupFile', () => api.importBackupFile(new File(['{}'], 'b.json'))],
    ['restoreBackup', () => api.restoreBackup('merge')],
    ['backupNow', () => api.backupNow()],
    ['saveSettings', () => api.saveSettings({} as never)],
    ['getSettings', () => api.getSettings()],
    ['browseFolders', () => api.browseFolders('/')],
  ]

  for (const [name, call] of cases) {
    it(`${name} throws a ServerError on a 500`, async () => {
      fetchMock.mockResolvedValue(mockRes({ status: 500 }))
      await expect(call()).rejects.toThrow(ServerError)
    })
  }

  it('carries the server\u2019s own message when it sends one', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 400, body: { error: 'Model not configured' } }))
    await expect(api.translate('hei', 'no', 'en')).rejects.toThrow(/Model not configured/)
  })

  it('falls back to its own wording, with the status, when the body says nothing', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 503, body: {} }))
    await expect(api.translate('hei', 'no', 'en')).rejects.toThrow(/503/)
  })

  it('still throws when the error body is not JSON at all', async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 502, statusText: 'HTTP 502',
      json: async () => { throw new Error('not json') },
    } as unknown as Response)
    await expect(api.translate('hei', 'no', 'en')).rejects.toThrow(ServerError)
  })

  it('maps a 401 to UnauthorizedError before anything else looks at the body', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 401 }))
    await expect(api.patchResume('r1', { name: 'x' })).rejects.toThrow(UnauthorizedError)
  })

  it('maps a 401 on the endpoints that raise their own error type too', async () => {
    // Both of these build a message of their own for a failure, so the 401
    // check has to come FIRST or an expired session reads as a broken folder
    // picker and a broken model — neither of which re-prompts for the token.
    fetchMock.mockResolvedValue(mockRes({ status: 401 }))
    await expect(api.browseFolders('/')).rejects.toThrow(UnauthorizedError)
    fetchMock.mockResolvedValue(mockRes({ status: 401 }))
    await expect(api.llmComplete('prompt')).rejects.toThrow(UnauthorizedError)
  })

  it('maps a 404 to NotFoundError on the endpoints that address one resume', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 404 }))
    await expect(api.patchResume('r1', { name: 'x' })).rejects.toThrow(NotFoundError)
    await expect(api.deleteResume('r1')).rejects.toThrow(NotFoundError)
  })

  it('returns the parsed body when the response is fine', async () => {
    fetchMock.mockResolvedValue(okJson({ data: emptyStore() }))
    await expect(api.getSnapshot('r1', 1)).resolves.toBeTruthy()
  })
})

describe('api — the ones that must never throw', () => {
  const probes: Array<[string, () => Promise<unknown>, unknown]> = [
    ['storageStats', () => api.storageStats(), null],
    ['logout', () => api.logout(), undefined],
  ]

  for (const [name, call, fallback] of probes) {
    it(`${name} answers with its fallback on a 500`, async () => {
      fetchMock.mockResolvedValue(mockRes({ status: 500 }))
      await expect(call()).resolves.toBe(fallback)
    })

    it(`${name} answers with its fallback when the network is down`, async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
      await expect(call()).resolves.toBe(fallback)
    })
  }

  it('storageStats returns the stats when the server has them', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 200, body: { resumes: [], db_bytes: 10 } }))
    await expect(api.storageStats()).resolves.toMatchObject({ db_bytes: 10 })
  })

  it('logout posts to the logout endpoint even though it ignores the answer', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 200 }))
    await api.logout()
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }))
  })
})

describe('api — what saveResume puts in the body', () => {
  const saved = () => mockRes({ status: 200, body: { saved_at: '2026-01-01T00:00:00Z', version: 3 } })
  const bodyOf = () => JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as Record<string, unknown>

  it('sends the base version when it has one — that is what makes a 409 possible', async () => {
    fetchMock.mockResolvedValue(saved())
    await api.saveResume('r1', emptyStore(), undefined, 7)
    expect(bodyOf().base_version).toBe(7)
  })

  it('omits the base version entirely when there is none', async () => {
    // A first save has no version to compare against; sending `undefined` would
    // read as "version 0" on the server.
    fetchMock.mockResolvedValue(saved())
    await api.saveResume('r1', emptyStore())
    expect('base_version' in bodyOf()).toBe(false)
  })

  it('sends version ZERO as a real value', async () => {
    fetchMock.mockResolvedValue(saved())
    await api.saveResume('r1', emptyStore(), undefined, 0)
    expect(bodyOf().base_version).toBe(0)
  })

  it('sends the editing locales only when given', async () => {
    fetchMock.mockResolvedValue(saved())
    await api.saveResume('r1', emptyStore(), { primary_locale: 'no', secondary_locale: 'en' })
    expect(bodyOf()).toMatchObject({ primary_locale: 'no', secondary_locale: 'en' })

    fetchMock.mockClear()
    fetchMock.mockResolvedValue(saved())
    await api.saveResume('r1', emptyStore())
    expect('primary_locale' in bodyOf()).toBe(false)
  })

  it('returns the saved_at and version the server reports', async () => {
    fetchMock.mockResolvedValue(saved())
    await expect(api.saveResume('r1', emptyStore()))
      .resolves.toEqual({ saved_at: '2026-01-01T00:00:00Z', version: 3 })
  })
})

/**
 * The happy path of each endpoint, and what the request looked like.
 *
 * Asserting only the failures leaves "always fail" indistinguishable from the
 * real code — and a settings screen that reports an error on a perfectly good
 * response is the same bug seen from the other side.
 */
describe('api — the successful answers', () => {
  const ok = (body: unknown) => mockRes({ status: 200, body })

  it('translate returns the translated text and sends the whole payload', async () => {
    fetchMock.mockResolvedValue(ok({ translation: 'hello' }))
    await expect(api.translate('hei', 'no', 'en', { terms: [], keep: ['NAV'] } as never))
      .resolves.toBe('hello')
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as Record<string, unknown>
    expect(body).toMatchObject({ text: 'hei', source: 'no', target: 'en' })
    expect(body.glossary).toBeTruthy()
  })

  it('getSettings, saveSettings and browseFolders return their bodies', async () => {
    fetchMock.mockResolvedValue(ok({ managed: true }))
    await expect(api.getSettings()).resolves.toMatchObject({ managed: true })

    fetchMock.mockResolvedValue(ok({ managed: true }))
    await expect(api.saveSettings({} as never)).resolves.toMatchObject({ managed: true })

    fetchMock.mockResolvedValue(ok({ path: '/', entries: [] }))
    await expect(api.browseFolders('/')).resolves.toMatchObject({ path: '/' })
  })

  it('the backup endpoints return their bodies', async () => {
    fetchMock.mockResolvedValue(ok({ configured: true }))
    await expect(api.backupStatus()).resolves.toMatchObject({ configured: true })

    fetchMock.mockResolvedValue(ok({ bytes: 10, resumeCount: 2, removed: 0 }))
    await expect(api.backupNow()).resolves.toMatchObject({ resumeCount: 2 })

    fetchMock.mockResolvedValue(ok({ imported: 1, skipped: 0 }))
    await expect(api.restoreBackup('merge')).resolves.toMatchObject({ imported: 1 })

    fetchMock.mockResolvedValue(ok({ imported: 1, skipped: 0 }))
    await expect(api.importBackupFile(new File(['{}'], 'b.json'))).resolves.toMatchObject({ imported: 1 })
  })

  it('the test-connection endpoints return their verdicts', async () => {
    fetchMock.mockResolvedValue(ok({ ok: true }))
    await expect(api.testTranslate()).resolves.toMatchObject({ ok: true })

    fetchMock.mockResolvedValue(ok({ ok: false, error: 'no key' }))
    await expect(api.testLlm()).resolves.toMatchObject({ ok: false })
  })

  it('testTranslate sends an empty body rather than nothing when given no input', async () => {
    // The server reads the pending form values from the body; `undefined` would
    // arrive as no body at all and be parsed as a missing field.
    fetchMock.mockResolvedValue(ok({ ok: true }))
    await api.testTranslate()
    expect((fetchMock.mock.calls[0][1] as { body?: string }).body).toBe('{}')
  })

  it('browseFolders maps a 401 to UnauthorizedError and other failures to ServerError', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 401 }))
    await expect(api.browseFolders('/')).rejects.toThrow(UnauthorizedError)

    fetchMock.mockResolvedValue(mockRes({ status: 500 }))
    await expect(api.browseFolders('/')).rejects.toThrow(ServerError)
  })
})

describe('api — importing a backup file', () => {
  const ok = () => mockRes({ status: 200, body: { imported: 1, skipped: 0 } })
  const headerOf = () =>
    ((fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers)['Content-Type']

  it('posts a .zip as an archive', async () => {
    fetchMock.mockResolvedValue(ok())
    await api.importBackupFile(new File(['PK'], 'backup.zip'))
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe('POST')
    expect(headerOf()).toBe('application/zip')
  })

  it('posts anything else as JSON', async () => {
    fetchMock.mockResolvedValue(ok())
    await api.importBackupFile(new File(['{}'], 'backup.json'))
    expect(headerOf()).toBe('application/json')
  })

  it('reads the EXTENSION, not merely a mention of zip in the name', async () => {
    // "backup.zip.json" is a JSON file someone renamed; sending it as an archive
    // makes the server unzip a text file.
    fetchMock.mockResolvedValue(ok())
    await api.importBackupFile(new File(['{}'], 'backup.zip.json'))
    expect(headerOf()).toBe('application/json')
  })

  it('matches the extension whatever its case', async () => {
    fetchMock.mockResolvedValue(ok())
    await api.importBackupFile(new File(['PK'], 'BACKUP.ZIP'))
    expect(headerOf()).toBe('application/zip')
  })
})

describe('api — the Docker controls report rather than throw', () => {
  it('returns the server’s result when the action succeeded', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 200, body: { available: true, message: 'started' } }))
    await expect(api.translateDocker('start')).resolves.toMatchObject({ available: true, message: 'started' })
  })

  it('reports a failed action as unavailable with the server’s message', async () => {
    // The settings screen shows this text; throwing here would blank the panel.
    fetchMock.mockResolvedValue(mockRes({ status: 500, body: { error: 'docker not installed' } }))
    await expect(api.translateDocker('start'))
      .resolves.toMatchObject({ available: false, message: 'docker not installed' })
  })

  it('reports an unreachable server as unavailable too', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(api.translateDocker('status')).resolves.toMatchObject({ available: false })
  })

  it('names the action in its own fallback message', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 500, body: {} }))
    const out = await api.translateDocker('stop')
    expect(out.message).toMatch(/stop/)
  })
})

/**
 * The request builder itself, and the AI endpoints on top of it.
 */
describe('api — how a request is built', () => {
  it('sends a JSON content type and a body only when there IS a body', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 200, body: [] }))
    await api.listResumes()
    const init = fetchMock.mock.calls[0][1] as { body?: string; headers: Record<string, string> }
    // A GET with a Content-Type and an empty body confuses proxies and servers.
    expect(init.body).toBeUndefined()
    expect(init.headers['Content-Type']).toBeUndefined()

    fetchMock.mockClear()
    fetchMock.mockResolvedValue(mockRes({ status: 200, body: {} }))
    await api.patchResume('r1', { name: 'x' })
    const withBody = fetchMock.mock.calls[0][1] as { body?: string; headers: Record<string, string> }
    expect(withBody.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(withBody.body!)).toEqual({ name: 'x' })
  })

  it('sends the session cookie on every request', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 200, body: [] }))
    await api.listResumes()
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin' })
  })

  it('recognises a real abort and nothing else as one', async () => {
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true)
    // A DOMException of another kind is a failure, not a cancellation…
    expect(isAbortError(new DOMException('boom', 'NotFoundError'))).toBe(false)
    // …and so is a plain object that merely calls itself one.
    expect(isAbortError({ name: 'AbortError' })).toBe(false)
    expect(isAbortError(new Error('AbortError'))).toBe(false)
    expect(isAbortError(null)).toBe(false)
  })
})

describe('api — the AI endpoints', () => {
  it('llmComplete returns the reply and sends the prompt', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 200, body: { text: 'drafted' } }))
    await expect(api.llmComplete('write something', 500, true)).resolves.toBe('drafted')
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as Record<string, unknown>
    expect(body).toMatchObject({ prompt: 'write something', advanced: true })
  })

  it('llmComplete rejects a reply with no usable text, saying so', async () => {
    // A malformed reply must not be applied as an empty draft over the user's
    // field, and the message is what the panel shows.
    for (const body of [{}, { text: 42 }, { text: '   ' }]) {
      fetchMock.mockResolvedValue(mockRes({ status: 200, body }))
      await expect(api.llmComplete('hi'), JSON.stringify(body))
        .rejects.toThrow(/returned no text/)
    }
  })

  it('createResume returns the new metadata and throws on a failure', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 200, body: { resume: { id: 'r9', name: 'New' } } }))
    await expect(api.createResume({ name: 'New' } as never)).resolves.toMatchObject({ id: 'r9' })

    fetchMock.mockResolvedValue(mockRes({ status: 500 }))
    await expect(api.createResume({ name: 'New' } as never)).rejects.toThrow(ServerError)
  })

  it('llmComplete maps a 401 to UnauthorizedError and a 500 to a plain error', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 401 }))
    await expect(api.llmComplete('hi')).rejects.toThrow(UnauthorizedError)

    fetchMock.mockResolvedValue(mockRes({ status: 500, body: { error: 'no model' } }))
    await expect(api.llmComplete('hi')).rejects.toThrow(/no model/)
  })

  it('summarize returns the line and sends the heading context with it', async () => {
    // The item's heading is what stops the model restating the customer name.
    fetchMock.mockResolvedValue(mockRes({ status: 200, body: { summary: 'One line.' } }))
    await expect(api.summarize('long text', 'no', ['Customer: Statoil'])).resolves.toBe('One line.')
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as Record<string, unknown>
    expect(body).toMatchObject({ text: 'long text', locale: 'no', context: ['Customer: Statoil'] })
  })

  it('summarize sends an EMPTY context rather than none when the caller has no heading', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 200, body: { summary: 'One line.' } }))
    await api.summarize('long text', 'en')
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as Record<string, unknown>
    expect(body.context).toEqual([])
  })

  it('summarize throws on a failed response', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 500, body: { error: 'model gone' } }))
    await expect(api.summarize('long text', 'en')).rejects.toThrow(/model gone/)
  })

  it('testLlm sends an empty body when given no pending values', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 200, body: { ok: true } }))
    await api.testLlm()
    expect((fetchMock.mock.calls[0][1] as { body?: string }).body).toBe('{}')
  })

  it('llmModels keeps only the models the server actually named', async () => {
    // A model with no id cannot be selected, so offering it in the picker is a
    // dead row; and a failure hides the picker rather than breaking Settings.
    fetchMock.mockResolvedValue(mockRes({
      status: 200,
      body: { models: [{ id: 'llama3' }, { id: '' }, { name: 'no id' }, null] },
    }))
    await expect(api.llmModels()).resolves.toEqual([{ id: 'llama3' }])

    fetchMock.mockResolvedValue(mockRes({ status: 500 }))
    await expect(api.llmModels()).resolves.toEqual([])
  })

  it('llmModels ignores a model list carried by a FAILING response', async () => {
    // A 500 still has a body, and a proxy or error page can put anything in it.
    // Reading models out of a failed request builds the picker from an error
    // and the user picks a model the server never offered.
    fetchMock.mockResolvedValue(mockRes({
      status: 500,
      body: { models: [{ id: 'ghost-model' }] },
    }))
    await expect(api.llmModels()).resolves.toEqual([])
  })

  it('llmModels POSTs the pending form values when it has them, GETs otherwise', async () => {
    // The useful moment is right after pasting a key, before Save.
    fetchMock.mockResolvedValue(mockRes({ status: 200, body: { models: [] } }))
    await api.llmModels({ llm_api_key: 'k' } as never)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/settings/llm/models')
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe('POST')

    fetchMock.mockClear()
    fetchMock.mockResolvedValue(mockRes({ status: 200, body: { models: [] } }))
    await api.llmModels()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/llm/models')
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe('GET')
  })

  it('ollamaDocker reports rather than throws, like the translate one', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 200, body: { available: true, message: 'pulled' } }))
    await expect(api.ollamaDocker('start', 'llama3')).resolves.toMatchObject({ available: true })

    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(api.ollamaDocker('status')).resolves.toMatchObject({ available: false })
  })
})

describe('api — the updater endpoints', () => {
  it('updateStatus and checkForUpdate return their bodies and throw on failure', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 200, body: { supported: true, current: '1.0.0' } }))
    await expect(api.updateStatus()).resolves.toMatchObject({ supported: true })

    fetchMock.mockResolvedValue(mockRes({ status: 200, body: { supported: true, latest: '1.1.0' } }))
    await expect(api.checkForUpdate()).resolves.toMatchObject({ latest: '1.1.0' })

    fetchMock.mockResolvedValue(mockRes({ status: 500 }))
    await expect(api.checkForUpdate()).rejects.toThrow(ServerError)
  })

  it('installUpdate resolves on success and throws on refusal', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 200, body: {} }))
    await expect(api.installUpdate()).resolves.toBeUndefined()

    // A VPS reports updates as unsupported and 403s the install.
    fetchMock.mockResolvedValue(mockRes({ status: 403, body: { error: 'not supported here' } }))
    await expect(api.installUpdate()).rejects.toThrow(/not supported here/)
  })
})

/**
 * Which URL each call actually addresses.
 *
 * Nearly every endpoint path in this module survived the mutation report: the
 * tests assert what a call RETURNS from a mocked response, which holds whatever
 * URL was requested. A wrong path is not an error the user sees — `safe()`
 * turns a 404 into the fallback, so the feature simply reports itself as
 * unavailable. This is the one place the paths are stated.
 */
describe('api — the endpoint each call addresses', () => {
  const ok = (body: unknown = {}) => mockRes({ status: 200, body })

  const routes: Array<[string, () => Promise<unknown>, string, string]> = [
    ['health', () => api.health(), 'GET', '/api/health'],
    ['listResumes', () => api.listResumes(), 'GET', '/api/resumes'],
    ['storageStats', () => api.storageStats(), 'GET', '/api/resumes/storage'],
    ['listSnapshots', () => api.listSnapshots('r1'), 'GET', '/api/resumes/r1/snapshots'],
    ['getSnapshot', () => api.getSnapshot('r1', 7), 'GET', '/api/resumes/r1/snapshots/7'],
    ['listRegistry', () => api.listRegistry(), 'GET', '/api/registry'],
    ['translateStatus', () => api.translateStatus(), 'GET', '/api/translate/status'],
    ['translate', () => api.translate('hi', 'en', 'no'), 'POST', '/api/translate'],
    ['backupStatus', () => api.backupStatus(), 'GET', '/api/backup/status'],
    ['backupNow', () => api.backupNow(), 'POST', '/api/backup/now'],
    ['restoreBackup', () => api.restoreBackup(), 'POST', '/api/backup/restore'],
    ['getSettings', () => api.getSettings(), 'GET', '/api/settings'],
    ['browseFolders', () => api.browseFolders(), 'POST', '/api/settings/folders'],
    ['saveSettings', () => api.saveSettings({}), 'PUT', '/api/settings'],
    ['testTranslate', () => api.testTranslate(), 'POST', '/api/settings/translate/test'],
    ['hostnameStatus', () => api.hostnameStatus('resumestudio.local'), 'POST', '/api/settings/hostname'],
    ['hostnameSetup', () => api.hostnameSetup('install', 'resumestudio.local'), 'POST', '/api/settings/hostname'],
    ['llmStatus', () => api.llmStatus(), 'GET', '/api/llm/status'],
    ['testLlm', () => api.testLlm(), 'POST', '/api/settings/llm/test'],
    ['updateStatus', () => api.updateStatus(), 'GET', '/api/update/status'],
    ['checkForUpdate', () => api.checkForUpdate(), 'POST', '/api/update/check'],
    ['installUpdate', () => api.installUpdate(), 'POST', '/api/update/install'],
  ]

  for (const [name, call, method, path] of routes) {
    it(`${name} calls ${method} ${path}`, async () => {
      fetchMock.mockResolvedValue(ok({ entries: [], snapshots: [], resumes: [], text: 'x', translated: 'x' }))
      await call()
      const [url, init] = callArgs()
      expect(url).toBe(path)
      expect((init?.method ?? 'GET').toUpperCase()).toBe(method)
    })
  }

  it('llmComplete and summarize post to their own endpoints', async () => {
    fetchMock.mockResolvedValue(ok({ text: 'answer' }))
    await api.llmComplete('prompt')
    expect(callArgs()[0]).toBe('/api/llm/complete')

    fetchMock.mockClear()
    fetchMock.mockResolvedValue(ok({ text: 'answer' }))
    await api.summarize('long text', 'en')
    expect(callArgs()[0]).toBe('/api/summarize')
  })

  it('logs out and imports a backup through fetch directly, not the JSON helper', async () => {
    // Both bypass `request` — logout ignores the answer, and the import sends
    // multipart form data, so neither can inherit the helper's path handling.
    fetchMock.mockResolvedValue(ok())
    await api.logout()
    expect(callArgs()[0]).toBe('/api/auth/logout')

    fetchMock.mockClear()
    fetchMock.mockResolvedValue(ok({ imported: 0 }))
    await api.importBackupFile(new File(['{}'], 'backup.json'))
    expect(callArgs()[0]).toBe('/api/backup/import')
  })

  it('escapes an id rather than splicing it into the path', async () => {
    // An id with a slash would otherwise address a different route entirely.
    fetchMock.mockResolvedValue(ok({ data: emptyStore(), meta: META }))
    await api.loadResume('a/b c')
    expect(callArgs()[0]).toBe('/api/resumes/a%2Fb%20c')
  })

  it('narrows the registry listing by kind through the query string', async () => {
    fetchMock.mockResolvedValue(ok({ entries: [] }))
    await api.listRegistry('skill')
    expect(callArgs()[0]).toBe('/api/registry?kind=skill')
  })
})

/**
 * The two hostname calls behind Settings' `.local` set-up button (§14).
 *
 * Neither was called by any test. They are `safe()`-wrapped on purpose: the
 * panel shows a Set-up button when the answer is null, so an exception here
 * would replace a working panel with an error boundary.
 */
describe('api — the local-hostname calls', () => {
  it('asks for the status of a candidate name', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 200, body: { installed: true, resolves: true } }))
    await expect(api.hostnameStatus('resumestudio.local'))
      .resolves.toMatchObject({ installed: true })
    expect(JSON.parse(callArgs()[1].body as string))
      .toEqual({ action: 'status', hostname: 'resumestudio.local' })
  })

  it('passes install and uninstall through as the action', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 200, body: { ok: true } }))
    await api.hostnameSetup('install', 'resumestudio.local')
    expect(JSON.parse(callArgs()[1].body as string))
      .toEqual({ action: 'install', hostname: 'resumestudio.local' })

    fetchMock.mockClear()
    fetchMock.mockResolvedValue(mockRes({ status: 200, body: { ok: true } }))
    await api.hostnameSetup('uninstall', 'resumestudio.local')
    expect(JSON.parse(callArgs()[1].body as string))
      .toEqual({ action: 'uninstall', hostname: 'resumestudio.local' })
  })

  it('reads a refusal as "not installed" rather than throwing', async () => {
    // A VPS build 403s both; the panel must still render.
    for (const status of [403, 500]) {
      fetchMock.mockResolvedValue(mockRes({ status }))
      await expect(api.hostnameStatus('x.local')).resolves.toBeNull()
      await expect(api.hostnameSetup('install', 'x.local')).resolves.toBeNull()
    }
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(api.hostnameStatus('x.local')).resolves.toBeNull()
    await expect(api.hostnameSetup('install', 'x.local')).resolves.toBeNull()
  })
})
