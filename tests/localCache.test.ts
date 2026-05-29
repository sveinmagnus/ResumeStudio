/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadCache, saveCache, clearCache } from '../src/lib/localCache'
import { emptyStore, makeProject } from './fixtures'

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('saveCache / loadCache round-trip', () => {
  it('round-trips a populated store', () => {
    const store = emptyStore()
    store.projects.push(makeProject({ customer: { en: 'RoundTrip Inc' } }))

    saveCache(store)
    const out = loadCache()

    expect(out).not.toBeNull()
    expect(out!.data.projects[0].customer.en).toBe('RoundTrip Inc')
    expect(out!.saved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('returns null when nothing is cached', () => {
    expect(loadCache()).toBeNull()
  })

  it('returns null when the cached JSON is corrupt', () => {
    localStorage.setItem('resumestudio:store-cache:v1', '{not valid json')
    expect(loadCache()).toBeNull()
  })

  it('returns a sane saved_at when the stored record lacks one', () => {
    // Hand-craft a record missing the timestamp — proves we tolerate older
    // shapes without crashing.
    localStorage.setItem('resumestudio:store-cache:v1', JSON.stringify({ data: emptyStore() }))
    const out = loadCache()
    expect(out).not.toBeNull()
    expect(out!.saved_at).toBe(new Date(0).toISOString())
  })
})

describe('clearCache()', () => {
  it('removes both the data and meta entries', () => {
    saveCache(emptyStore())
    expect(loadCache()).not.toBeNull()
    clearCache()
    expect(loadCache()).toBeNull()
  })

  it('is a no-op when nothing is cached', () => {
    expect(() => clearCache()).not.toThrow()
  })
})

describe('error swallowing', () => {
  it('does not throw when localStorage.setItem throws (quota exceeded)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError')
    })
    expect(() => saveCache(emptyStore())).not.toThrow()
    spy.mockRestore()
  })

  it('does not throw when localStorage.removeItem throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('boom')
    })
    expect(() => clearCache()).not.toThrow()
    spy.mockRestore()
  })
})
