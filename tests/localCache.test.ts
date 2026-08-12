/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  loadPending, savePending, clearPending, listDirty,
  clearAllCaches, dropLegacyCache,
  type SavePendingInput,
} from '../src/lib/localCache'
import { emptyStore, makeProject } from './fixtures'

const ID = 'abc-1234'
const KEY = `resumestudio:store-cache:v1:${ID}`

const input = (over: Partial<SavePendingInput> = {}): SavePendingInput => ({
  data: emptyStore(),
  locales: { primary: 'en', secondary: null },
  base_version: 3,
  dirty: true,
  ...over,
})

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('savePending / loadPending round-trip', () => {
  it('round-trips data, locales, base_version and dirty flag', () => {
    const data = emptyStore()
    data.projects.push(makeProject({ customer: { en: 'RoundTrip Inc' } }))
    savePending(ID, input({ data, locales: { primary: 'no', secondary: 'en' }, base_version: 7 }))

    const out = loadPending(ID)
    expect(out).not.toBeNull()
    expect(out!.data.projects[0].customer.en).toBe('RoundTrip Inc')
    expect(out!.locales).toEqual({ primary: 'no', secondary: 'en' })
    expect(out!.base_version).toBe(7)
    expect(out!.dirty).toBe(true)
    expect(out!.saved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('returns null when nothing is cached for that id', () => {
    expect(loadPending(ID)).toBeNull()
  })

  it('keeps each resume id in its own slot', () => {
    savePending('id-a', input({ base_version: 1 }))
    savePending('id-b', input({ base_version: 2 }))
    expect(loadPending('id-a')!.base_version).toBe(1)
    expect(loadPending('id-b')!.base_version).toBe(2)
  })

  it('returns null when the cached JSON is corrupt', () => {
    localStorage.setItem(KEY, '{not valid json')
    expect(loadPending(ID)).toBeNull()
  })

  it('returns null for well-formed JSON that is not a record', () => {
    // Each of these parses fine and then has to be refused: a record with no
    // `data` would otherwise be handed to the store as an empty resume and
    // overwrite the server copy on the next flush.
    for (const junk of ['null', '"a string"', '42', '[]', '{}', '{"saved_at":"2026-01-01T00:00:00Z"}']) {
      localStorage.setItem(KEY, junk)
      expect(loadPending(ID), junk).toBeNull()
    }
  })

  it('preserves dirty_since across successive dirty writes, resets on clean→dirty', async () => {
    savePending(ID, input({ dirty: true }))
    const first = loadPending(ID)!.dirty_since
    await new Promise((r) => setTimeout(r, 5))
    savePending(ID, input({ dirty: true }))
    expect(loadPending(ID)!.dirty_since).toBe(first) // same dirty run

    // A clean write, then dirty again → dirty_since restarts.
    savePending(ID, input({ dirty: false }))
    await new Promise((r) => setTimeout(r, 5))
    savePending(ID, input({ dirty: true }))
    expect(loadPending(ID)!.dirty_since).not.toBe(first)
  })
})

describe('legacy record migration', () => {
  it('reads the pre-queue { saved_at, data } shape as a clean (non-dirty) record', () => {
    localStorage.setItem(KEY, JSON.stringify({ saved_at: '2026-01-01T00:00:00Z', data: emptyStore() }))
    const out = loadPending(ID)
    expect(out).not.toBeNull()
    expect(out!.dirty).toBe(false)          // legacy is a fallback, not a queued edit
    expect(out!.base_version).toBe(0)
    expect(out!.locales).toEqual({ primary: 'en', secondary: null })
    expect(out!.saved_at).toBe('2026-01-01T00:00:00Z')
  })
})

describe('clearPending', () => {
  it('removes the record for one id only', () => {
    savePending('id-a', input())
    savePending('id-b', input())
    clearPending('id-a')
    expect(loadPending('id-a')).toBeNull()
    expect(loadPending('id-b')).not.toBeNull()
  })

  it('is a no-op when nothing is cached', () => {
    expect(() => clearPending(ID)).not.toThrow()
  })
})

describe('listDirty', () => {
  it('returns only the dirty resumes, with their dirty_since', () => {
    savePending('dirty-1', input({ dirty: true }))
    savePending('clean-1', input({ dirty: false }))
    savePending('dirty-2', input({ dirty: true }))

    const dirty = listDirty().map((d) => d.id).sort()
    expect(dirty).toEqual(['dirty-1', 'dirty-2'])
    expect(listDirty().every((d) => typeof d.dirty_since === 'string')).toBe(true)
  })

  it('is empty when nothing is dirty', () => {
    savePending('clean', input({ dirty: false }))
    expect(listDirty()).toEqual([])
  })
})

describe('clearAllCaches', () => {
  it('drops every cached resume', () => {
    savePending('id-a', input())
    savePending('id-b', input())
    clearAllCaches()
    expect(loadPending('id-a')).toBeNull()
    expect(loadPending('id-b')).toBeNull()
  })

  it('does not touch unrelated localStorage keys', () => {
    localStorage.setItem('unrelated', 'keep-me')
    savePending(ID, input())
    clearAllCaches()
    expect(localStorage.getItem('unrelated')).toBe('keep-me')
  })
})

describe('dropLegacyCache', () => {
  it('removes the pre-multi-resume key only', () => {
    localStorage.setItem('resumestudio:store-cache:v1', 'legacy')
    savePending(ID, input())
    dropLegacyCache()
    expect(localStorage.getItem('resumestudio:store-cache:v1')).toBeNull()
    expect(loadPending(ID)).not.toBeNull()
  })
})

describe('error swallowing', () => {
  it('does not throw when setItem throws (quota exceeded)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError')
    })
    expect(() => savePending(ID, input())).not.toThrow()
    spy.mockRestore()
  })

  it('does not throw when removeItem throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('boom')
    })
    expect(() => clearPending(ID)).not.toThrow()
    spy.mockRestore()
  })
})

describe('the pending record survives whatever localStorage holds', () => {
  it('returns null for a key that is not there', () => {
    expect(loadPending('never-saved')).toBeNull()
  })

  it('returns null for an EMPTY string value rather than parsing it', () => {
    localStorage.setItem(KEY, '')
    expect(loadPending(ID)).toBeNull()
  })

  it('returns null for a value that is valid JSON but not an object', () => {
    for (const raw of ['null', '42', '"a string"', 'true']) {
      localStorage.setItem(KEY, raw)
      expect(loadPending(ID), raw).toBeNull()
    }
  })

  it('returns null for an object with no data', () => {
    localStorage.setItem(KEY, JSON.stringify({ saved_at: '2026-01-01T00:00:00Z' }))
    expect(loadPending(ID)).toBeNull()
  })

  it('returns null for unparseable JSON', () => {
    localStorage.setItem(KEY, '{oh no')
    expect(loadPending(ID)).toBeNull()
  })

  it('does not throw when the write fails — the fallback is best-effort', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => savePending(ID, input())).not.toThrow()
    expect(warn).toHaveBeenCalled()
    setItem.mockRestore()
    warn.mockRestore()
  })
})

describe('enumeration across the whole of localStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('reads every cached resume, not all but the last', () => {
    // An off-by-one in the scan loses whichever record happens to be last.
    savePending('a', input({ dirty: true }))
    savePending('b', input({ dirty: true }))
    savePending('c', input({ dirty: true }))
    expect(listDirty().map((d) => d.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('ignores keys belonging to anything else in localStorage', () => {
    localStorage.setItem('unrelated', 'x')
    localStorage.setItem('resumestudio:other', 'x')
    savePending('a', input({ dirty: true }))
    expect(listDirty().map((d) => d.id)).toEqual(['a'])
  })

  it('lists only the DIRTY records', () => {
    savePending('clean', input({ dirty: false }))
    savePending('dirty', input({ dirty: true }))
    expect(listDirty().map((d) => d.id)).toEqual(['dirty'])
  })

  it('skips a cache key whose record no longer parses, and keeps scanning past it', () => {
    // The broken key is written FIRST: a scan that throws on it would return
    // an empty list and the unsynced-changes guard would wave the user off.
    localStorage.setItem('resumestudio:store-cache:v1:broken', '{oh no')
    savePending('good', input({ dirty: true }))
    expect(listDirty().map((d) => d.id)).toEqual(['good'])
  })

  it('does not read a foreign key as a cache key and count a resume twice', () => {
    // Same length as the prefix plus "a", so slicing it blindly yields the id
    // of a resume that is already in the list.
    savePending('a', input({ dirty: true }))
    localStorage.setItem('other:namespace:cache:xxxxxxa', 'x')
    const ids = listDirty().map((d) => d.id)
    expect(ids).toEqual(['a'])
  })

  it('clears every cached resume and nothing else', () => {
    savePending('a', input())
    savePending('b', input())
    localStorage.setItem('unrelated', 'keep me')
    clearAllCaches()
    expect(loadPending('a')).toBeNull()
    expect(loadPending('b')).toBeNull()
    expect(localStorage.getItem('unrelated')).toBe('keep me')
  })
})
