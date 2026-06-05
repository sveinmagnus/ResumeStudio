import { describe, it, expect, afterEach, vi } from 'vitest'
import { translateReachable, startTranslate, stopTranslate } from '../../server/translateDocker'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete process.env.RESUME_COMPOSE_FILE })

describe('translateReachable', () => {
  it('rejects a non-http(s) URL without hitting the network', async () => {
    const r = await translateReachable('ftp://nope')
    expect(r.reachable).toBe(false)
    expect(r.message).toMatch(/http/i)
  })

  it('reports reachable + language count when /languages returns an array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ code: 'en' }, { code: 'nb' }, { code: 'sv' }],
    }))
    const r = await translateReachable('http://localhost:5000')
    expect(r.reachable).toBe(true)
    expect(r.languages).toBe(3)
  })

  it('reports not reachable when the fetch throws (service down/starting)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const r = await translateReachable('http://localhost:5000')
    expect(r.reachable).toBe(false)
  })

  it('reports not reachable on a non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }))
    const r = await translateReachable('http://localhost:5000')
    expect(r.reachable).toBe(false)
    expect(r.message).toMatch(/503/)
  })
})

describe('start/stopTranslate without a compose file', () => {
  it('startTranslate reports unavailable when no compose file is configured', async () => {
    delete process.env.RESUME_COMPOSE_FILE
    const r = await startTranslate()
    expect(r.ok).toBe(false)
    expect(r.available).toBe(false)
    expect(r.message).toMatch(/compose/i)
  })

  it('stopTranslate reports unavailable when no compose file is configured', async () => {
    delete process.env.RESUME_COMPOSE_FILE
    const r = await stopTranslate()
    expect(r.ok).toBe(false)
    expect(r.available).toBe(false)
  })
})
