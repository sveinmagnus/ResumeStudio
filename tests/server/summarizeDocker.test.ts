import { describe, it, expect, vi, afterEach } from 'vitest'
import { listOllamaModels, isValidModelName } from '../../server/summarizeDocker'

afterEach(() => { vi.unstubAllGlobals() })

function mockFetch(resp: unknown) {
  const fn = vi.fn().mockResolvedValue(resp)
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('isValidModelName()', () => {
  it('accepts real Ollama tags', () => {
    expect(isValidModelName('llama3.2:3b')).toBe(true)
    expect(isValidModelName('my-org/custom:latest')).toBe(true)
  })
  it('rejects anything that could escape into argv', () => {
    expect(isValidModelName('a; rm -rf /')).toBe(false)
    expect(isValidModelName('$(whoami)')).toBe(false)
    expect(isValidModelName('')).toBe(false)
  })
})

describe('listOllamaModels()', () => {
  it('maps /api/tags into name + size', async () => {
    mockFetch({
      ok: true,
      json: async () => ({ models: [{ name: 'llama3.2:3b', size: 2_000_000_000 }, { name: 'mistral:7b' }] }),
    })
    expect(await listOllamaModels('http://localhost:11434')).toEqual([
      { name: 'llama3.2:3b', size: 2_000_000_000 },
      { name: 'mistral:7b', size: undefined },
    ])
  })

  it('calls the instance tags endpoint, trimming a trailing slash', async () => {
    const fn = mockFetch({ ok: true, json: async () => ({ models: [] }) })
    await listOllamaModels('http://localhost:11434/')
    expect(fn.mock.calls[0][0]).toBe('http://localhost:11434/api/tags')
  })

  it('is empty (never throws) when the instance is down or erroring', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    await expect(listOllamaModels('http://localhost:11434')).resolves.toEqual([])

    mockFetch({ ok: false, status: 500 })
    await expect(listOllamaModels('http://localhost:11434')).resolves.toEqual([])
  })

  it('is empty for a malformed payload rather than throwing', async () => {
    mockFetch({ ok: true, json: async () => ({ models: 'nope' }) })
    await expect(listOllamaModels('http://localhost:11434')).resolves.toEqual([])
  })

  it('drops entries with no usable name', async () => {
    mockFetch({ ok: true, json: async () => ({ models: [{ size: 1 }, { name: 'ok:1b' }] }) })
    expect(await listOllamaModels('http://localhost:11434')).toEqual([{ name: 'ok:1b', size: undefined }])
  })

  it('refuses a non-http URL without making a request', async () => {
    const fn = mockFetch({ ok: true, json: async () => ({ models: [] }) })
    expect(await listOllamaModels('file:///etc/passwd')).toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })
})
