/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  api, UnauthorizedError, NotFoundError, ServerError,
  isAbortError, setStoredToken, clearStoredToken,
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
  clearStoredToken()
})
afterEach(() => {
  vi.unstubAllGlobals()
  clearStoredToken()
})

const META: ResumeMeta = {
  id: 'r1', name: 'CV', primary_locale: 'en', secondary_locale: null,
  saved_at: '2026-06-01T00:00:00Z', created_at: '2026-06-01T00:00:00Z',
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
  it('PUTs {data} only when no locales given', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: { ok: true } }))
    await api.saveResume('r1', emptyStore())
    const [url, init] = callArgs()
    expect(url).toBe('/api/resumes/r1')
    expect(init.method).toBe('PUT')
    const body = JSON.parse(init.body as string)
    expect(body).toHaveProperty('data')
    expect(body).not.toHaveProperty('primary_locale')
  })

  it('folds locales into the body when provided', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: { ok: true } }))
    await api.saveResume('r1', emptyStore(), { primary_locale: 'no', secondary_locale: 'en' })
    const body = JSON.parse(callArgs()[1].body as string)
    expect(body.primary_locale).toBe('no')
    expect(body.secondary_locale).toBe('en')
  })

  it('throws NotFoundError on 404 (resume deleted under us)', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 404 }))
    await expect(api.saveResume('ghost', emptyStore())).rejects.toBeInstanceOf(NotFoundError)
  })

  it('throws ServerError on other non-ok', async () => {
    fetchMock.mockResolvedValue(mockRes({ status: 500 }))
    await expect(api.saveResume('r1', emptyStore())).rejects.toBeInstanceOf(ServerError)
  })

  it('forwards the AbortSignal', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: { ok: true } }))
    const ctrl = new AbortController()
    await api.saveResume('r1', emptyStore(), undefined, ctrl.signal)
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

describe('auth header', () => {
  it('attaches a bearer token when one is stored', async () => {
    setStoredToken('s3cret')
    fetchMock.mockResolvedValue(mockRes({ body: { resumes: [] } }))
    await api.listResumes()
    const headers = callArgs()[1].headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer s3cret')
  })

  it('omits the header when no token is stored', async () => {
    fetchMock.mockResolvedValue(mockRes({ body: { resumes: [] } }))
    await api.listResumes()
    const headers = callArgs()[1].headers as Record<string, string>
    expect(headers['Authorization']).toBeUndefined()
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
