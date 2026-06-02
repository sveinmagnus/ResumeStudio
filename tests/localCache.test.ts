/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadCache, saveCache, clearCache, clearAllCaches, dropLegacyCache } from '../src/lib/localCache'
import { emptyStore, makeProject } from './fixtures'

const ID = 'abc-1234'
const KEY = `resumestudio:store-cache:v1:${ID}`

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('saveCache / loadCache round-trip', () => {
  it('round-trips a populated store under the given resume id', () => {
    const store = emptyStore()
    store.projects.push(makeProject({ customer: { en: 'RoundTrip Inc' } }))

    saveCache(ID, store)
    const out = loadCache(ID)

    expect(out).not.toBeNull()
    expect(out!.data.projects[0].customer.en).toBe('RoundTrip Inc')
    expect(out!.saved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('returns null when nothing is cached for that id', () => {
    expect(loadCache(ID)).toBeNull()
  })

  it('keeps each resume id in its own slot', () => {
    const a = emptyStore(); a.projects.push(makeProject({ customer: { en: 'A' } }))
    const b = emptyStore(); b.projects.push(makeProject({ customer: { en: 'B' } }))
    saveCache('id-a', a)
    saveCache('id-b', b)
    expect(loadCache('id-a')!.data.projects[0].customer.en).toBe('A')
    expect(loadCache('id-b')!.data.projects[0].customer.en).toBe('B')
  })

  it('returns null when the cached JSON is corrupt', () => {
    localStorage.setItem(KEY, '{not valid json')
    expect(loadCache(ID)).toBeNull()
  })

  it('returns a sane saved_at when the stored record lacks one', () => {
    localStorage.setItem(KEY, JSON.stringify({ data: emptyStore() }))
    const out = loadCache(ID)
    expect(out).not.toBeNull()
    expect(out!.saved_at).toBe(new Date(0).toISOString())
  })
})

describe('clearCache()', () => {
  it('removes the cache for one id', () => {
    saveCache(ID, emptyStore())
    expect(loadCache(ID)).not.toBeNull()
    clearCache(ID)
    expect(loadCache(ID)).toBeNull()
  })

  it('only touches the matching id', () => {
    saveCache('id-a', emptyStore())
    saveCache('id-b', emptyStore())
    clearCache('id-a')
    expect(loadCache('id-a')).toBeNull()
    expect(loadCache('id-b')).not.toBeNull()
  })

  it('is a no-op when nothing is cached', () => {
    expect(() => clearCache(ID)).not.toThrow()
  })
})

describe('clearAllCaches()', () => {
  it('drops every cached resume', () => {
    saveCache('id-a', emptyStore())
    saveCache('id-b', emptyStore())
    clearAllCaches()
    expect(loadCache('id-a')).toBeNull()
    expect(loadCache('id-b')).toBeNull()
  })

  it('does not touch unrelated localStorage keys', () => {
    localStorage.setItem('unrelated', 'keep-me')
    saveCache(ID, emptyStore())
    clearAllCaches()
    expect(localStorage.getItem('unrelated')).toBe('keep-me')
  })
})

describe('dropLegacyCache()', () => {
  it('removes the pre-multi-resume key only', () => {
    localStorage.setItem('resumestudio:store-cache:v1', 'legacy')
    saveCache(ID, emptyStore())
    dropLegacyCache()
    expect(localStorage.getItem('resumestudio:store-cache:v1')).toBeNull()
    // Per-id cache survives.
    expect(loadCache(ID)).not.toBeNull()
  })
})

describe('error swallowing', () => {
  it('does not throw when localStorage.setItem throws (quota exceeded)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError')
    })
    expect(() => saveCache(ID, emptyStore())).not.toThrow()
    spy.mockRestore()
  })

  it('does not throw when localStorage.removeItem throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('boom')
    })
    expect(() => clearCache(ID)).not.toThrow()
    spy.mockRestore()
  })
})
