import { describe, it, expect } from 'vitest'
import { emptyStore, freshStore } from '../src/lib/freshStore'

describe('emptyStore()', () => {
  it('has a null resume and every section as an empty array', () => {
    const s = emptyStore()
    expect(s.resume).toBeNull()
    expect(s.skills).toEqual([])
    expect(s.projects).toEqual([])
    expect(s.views).toEqual([])
  })

  it('returns a fresh object each call (no shared array references)', () => {
    const a = emptyStore()
    const b = emptyStore()
    a.projects.push({} as never)
    expect(b.projects).toEqual([]) // not aliased to a's array
  })
})

describe('freshStore()', () => {
  it('scaffolds a non-null resume with en as the only locale', () => {
    const s = freshStore()
    expect(s.resume).not.toBeNull()
    expect(s.resume!.supported_locales).toEqual(['en'])
    expect(s.resume!.default_locale).toBe('en')
    expect(s.resume!.full_name).toBe('')
  })

  it('mints a fresh uuid on each call', () => {
    const a = freshStore()
    const b = freshStore()
    expect(a.resume!.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(a.resume!.id).not.toBe(b.resume!.id)
  })

  it('starts with empty sections like emptyStore', () => {
    const s = freshStore()
    expect(s.projects).toEqual([])
    expect(s.skills).toEqual([])
  })
})
