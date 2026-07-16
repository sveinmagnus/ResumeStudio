import { describe, it, expect } from 'vitest'
import {
  groupState, includeIds, excludeIds, toggleIds, typeGroups, hasTypeFacet,
  type SelectableItem,
} from '../src/lib/viewItemSelect'

const pos = (id: string, position_type?: string | null): SelectableItem => ({ id, position_type })
const pub = (id: string, publication_type: string): SelectableItem => ({ id, publication_type })

describe('groupState()', () => {
  it('reports all / none / some', () => {
    expect(groupState([], ['a', 'b'])).toBe('all')
    expect(groupState(['a', 'b'], ['a', 'b'])).toBe('none')
    expect(groupState(['a'], ['a', 'b'])).toBe('some')
  })

  it('ignores exclusions belonging to other sections', () => {
    expect(groupState(['zzz'], ['a', 'b'])).toBe('all')
  })

  it('treats an empty group as none rather than vacuously all', () => {
    // Guards the control: an 'all' here would render "All" permanently disabled.
    expect(groupState([], [])).toBe('none')
  })
})

describe('includeIds() / excludeIds()', () => {
  it('includes by dropping ids from the exclusion list', () => {
    expect(includeIds(['a', 'b', 'c'], ['a', 'c'])).toEqual(['b'])
  })

  it('excludes without duplicating what is already excluded', () => {
    expect(excludeIds(['a'], ['a', 'b']).sort()).toEqual(['a', 'b'])
  })

  it('leaves other sections exclusions alone', () => {
    // The contract that makes a flat excluded_item_ids safe to bulk-edit.
    expect(includeIds(['other', 'a'], ['a'])).toEqual(['other'])
    expect(excludeIds(['other'], ['a']).sort()).toEqual(['a', 'other'])
  })

  it('does not mutate its input', () => {
    const excluded = ['a']
    excludeIds(excluded, ['b'])
    includeIds(excluded, ['a'])
    expect(excluded).toEqual(['a'])
  })
})

describe('toggleIds()', () => {
  it('clears a fully-included group', () => {
    expect(toggleIds([], ['a', 'b']).sort()).toEqual(['a', 'b'])
  })

  it('includes a fully-excluded group', () => {
    expect(toggleIds(['a', 'b'], ['a', 'b'])).toEqual([])
  })

  it('completes a partial group rather than clearing it', () => {
    // A click must always do something visible; from 'some', filling up is the
    // less destructive of the two directions.
    expect(toggleIds(['a'], ['a', 'b'])).toEqual([])
  })
})

describe('typeGroups()', () => {
  it('has no facet for sections without a type field', () => {
    expect(hasTypeFacet('projects')).toBe(false)
    expect(typeGroups('projects', [{ id: 'a' }], 'en')).toEqual([])
  })

  it('groups positions by position_type in the editor order', () => {
    expect(hasTypeFacet('positions')).toBe(true)
    const groups = typeGroups('positions', [
      pos('a', 'volunteer'), pos('b', 'board_member'), pos('c', 'board_member'),
    ], 'en')
    // board_member precedes volunteer in POSITION_TYPES — not insertion order.
    expect(groups.map((g) => g.value)).toEqual(['board_member', 'volunteer'])
    expect(groups[0]).toMatchObject({ label: 'Board member', ids: ['b', 'c'] })
  })

  it('omits types the resume has no items for', () => {
    const groups = typeGroups('positions', [pos('a', 'mentor')], 'en')
    expect(groups).toHaveLength(1)
    expect(groups[0].value).toBe('mentor')
  })

  it('labels groups in the editing locale', () => {
    expect(typeGroups('positions', [pos('a', 'board_member')], 'de')[0].label)
      .toBe('Vorstandsmitglied')
  })

  it('collects untyped items into a trailing group', () => {
    const groups = typeGroups('positions', [
      pos('a', 'advisor'), pos('b', null), pos('c'),
    ], 'en')
    expect(groups.map((g) => g.value)).toEqual(['advisor', ''])
    expect(groups[1]).toMatchObject({ label: 'No type', ids: ['b', 'c'] })
  })

  it('puts an unrecognised type in the untyped group, not a nameless chip', () => {
    // Imported data can carry a type this build doesn't know; it has no label,
    // so it must not render as an empty chip.
    const groups = typeGroups('positions', [pos('a', 'wat')], 'en')
    expect(groups).toEqual([{ value: '', label: 'No type', ids: ['a'] }])
  })

  it('groups publications by publication_type', () => {
    const groups = typeGroups('publications', [
      pub('a', 'book'), pub('b', 'article'), pub('c', 'article'),
    ], 'en')
    expect(groups.map((g) => g.value)).toEqual(['article', 'book'])
    expect(groups[0].ids).toEqual(['b', 'c'])
  })

  it('returns no groups for no items', () => {
    expect(typeGroups('positions', [], 'en')).toEqual([])
  })
})
