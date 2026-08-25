// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadFlags, saveFlags, countFlags, addFlag, removeFlag, updateFlagNote, findFlag,
  type ReadFlag,
} from '../src/lib/readThrough'

const NOW = new Date('2026-06-15T00:00:00Z')
let n = 0
const ids = (): string => `f${n++}`

const make = (over: Partial<ReadFlag> = {}): ReadFlag => ({
  id: ids(), section: 'projects', itemId: 'p1', label: 'Acme', note: '', created_at: NOW.toISOString(), ...over,
})

beforeEach(() => localStorage.clear())

describe('flag persistence', () => {
  it('round-trips flags per (resume, view) and keeps views separate', () => {
    const a = [make({ id: 'a' })]
    saveFlags('r1', 'v1', a)
    saveFlags('r1', 'v2', [make({ id: 'b' })])
    expect(loadFlags('r1', 'v1').map((f) => f.id)).toEqual(['a'])
    expect(loadFlags('r1', 'v2').map((f) => f.id)).toEqual(['b'])
    expect(loadFlags('r2', 'v1')).toEqual([])
    expect(countFlags('r1', 'v1')).toBe(1)
  })

  it('removes the key when the last flag goes', () => {
    saveFlags('r1', 'v1', [make()])
    saveFlags('r1', 'v1', [])
    expect(localStorage.getItem('resumestudio.readflags.r1.v1')).toBeNull()
  })

  it('reads corrupt storage as no flags', () => {
    localStorage.setItem('resumestudio.readflags.r1.v1', '{not json')
    expect(loadFlags('r1', 'v1')).toEqual([])
    localStorage.setItem('resumestudio.readflags.r1.v1', '{"a":1}')
    expect(loadFlags('r1', 'v1')).toEqual([])
    localStorage.setItem('resumestudio.readflags.r1.v1', '[{"id":1},{"id":"ok","section":"projects","note":""}]')
    expect(loadFlags('r1', 'v1').map((f) => f.id)).toEqual(['ok'])
  })
})

describe('flag list operations', () => {
  it('adds newest-last with injected id/time, removes by id, edits notes', () => {
    let flags = addFlag([], { section: 'projects', itemId: 'p1', label: 'Acme' }, NOW, () => 'x')
    expect(flags).toEqual([{
      id: 'x', section: 'projects', itemId: 'p1', label: 'Acme', note: '', created_at: NOW.toISOString(),
    }])
    flags = updateFlagNote(flags, 'x', 'stale numbers')
    expect(flags[0].note).toBe('stale numbers')
    expect(removeFlag(flags, 'x')).toEqual([])
  })

  it('findFlag matches on section + item, including the view-level null item', () => {
    const flags = [make({ id: 'a', itemId: 'p1' }), make({ id: 'b', section: 'views', itemId: null })]
    expect(findFlag(flags, 'projects', 'p1')?.id).toBe('a')
    expect(findFlag(flags, 'views', null)?.id).toBe('b')
    expect(findFlag(flags, 'projects', 'p2')).toBeUndefined()
  })
})
