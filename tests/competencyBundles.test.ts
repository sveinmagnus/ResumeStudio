import { describe, it, expect } from 'vitest'
import {
  UNASSIGNED_GROUP, chipDragId, parseChipDragId, reassignCompetency,
} from '../src/lib/competencyBundles'
import { makeKQ } from './fixtures'

describe('chipDragId / parseChipDragId', () => {
  it('round-trips a group + competency id (ids contain hyphens, not the pipe)', () => {
    const id = chipDragId('p-1-abc', 'c-2-def')
    expect(id).toBe('p-1-abc|c-2-def')
    expect(parseChipDragId(id)).toEqual({ group: 'p-1-abc', competencyId: 'c-2-def' })
  })

  it('parses the Unassigned sentinel group', () => {
    expect(parseChipDragId(chipDragId(UNASSIGNED_GROUP, 'c1'))).toEqual({ group: UNASSIGNED_GROUP, competencyId: 'c1' })
  })

  it('returns null for a malformed id (no separator or empty competency)', () => {
    expect(parseChipDragId('nopipe')).toBeNull()
    expect(parseChipDragId('group|')).toBeNull()
  })

  it('accepts an empty group, which is where the separator sits at index 0', () => {
    // The one position a "no separator" test cannot reach: index 0 is a real
    // separator, and treating it as missing loses the drop entirely.
    expect(parseChipDragId('|c1')).toEqual({ group: '', competencyId: 'c1' })
  })
})

describe('reassignCompetency', () => {
  const profiles = () => [
    makeKQ({ id: 'p1', competency_ids: ['c1', 'c2'] }),
    makeKQ({ id: 'p2', competency_ids: ['c1'] }),
    makeKQ({ id: 'p3', competency_ids: [] }),
  ]

  it('moves a competency between two profiles (detach source, attach target)', () => {
    const patches = reassignCompetency(profiles(), 'p1', 'p3', 'c2')
    expect(patches).toEqual([
      { profileId: 'p1', competency_ids: ['c1'] },
      { profileId: 'p3', competency_ids: ['c2'] },
    ])
  })

  it('leaves other profiles holding the same competency untouched', () => {
    // c1 is in BOTH p1 and p2. Dragging p1's instance to p3 must not touch p2.
    const patches = reassignCompetency(profiles(), 'p1', 'p3', 'c1')
    expect(patches).toEqual([
      { profileId: 'p1', competency_ids: ['c2'] },
      { profileId: 'p3', competency_ids: ['c1'] },
    ])
    expect(patches.some((p) => p.profileId === 'p2')).toBe(false)
  })

  it('appends to the end of the target bundle, preserving order', () => {
    // Move c2 from p1 to p2 (p2 holds c1, not c2) → c2 appended after c1.
    const patches = reassignCompetency(profiles(), 'p1', 'p2', 'c2')
    expect(patches).toEqual([
      { profileId: 'p1', competency_ids: ['c1'] },
      { profileId: 'p2', competency_ids: ['c1', 'c2'] },
    ])
  })

  it('is a no-op when the target profile already holds the competency (no source strip)', () => {
    // c1 is in p1 and p2. Dropping p1's c1 onto p2 (which already has c1) does nothing.
    expect(reassignCompetency(profiles(), 'p1', 'p2', 'c1')).toEqual([])
  })

  it('is a no-op for a same-group drop', () => {
    expect(reassignCompetency(profiles(), 'p1', 'p1', 'c1')).toEqual([])
  })

  it('detaches only (no attach) when dropped on the Unassigned bucket', () => {
    const patches = reassignCompetency(profiles(), 'p1', UNASSIGNED_GROUP, 'c2')
    expect(patches).toEqual([{ profileId: 'p1', competency_ids: ['c1'] }])
  })

  it('attaches only (no detach) when dragged out of the Unassigned bucket', () => {
    const patches = reassignCompetency(profiles(), UNASSIGNED_GROUP, 'p3', 'c9')
    expect(patches).toEqual([{ profileId: 'p3', competency_ids: ['c9'] }])
  })

  it('ignores an empty competency id', () => {
    expect(reassignCompetency(profiles(), 'p1', 'p3', '')).toEqual([])
  })

  it('handles a drop naming a profile that no longer exists', () => {
    // Both ends are ids from the DOM, so either can be stale after a delete.
    // An unknown TARGET resolves to no profile and so behaves exactly like the
    // Unassigned bucket: detach, with nothing to attach to.
    expect(reassignCompetency(profiles(), 'p1', 'deleted', 'c2'))
      .toEqual([{ profileId: 'p1', competency_ids: ['c1'] }])
    // An unknown SOURCE has nothing to detach from, so only the attach lands.
    expect(reassignCompetency(profiles(), 'deleted', 'p3', 'c2'))
      .toEqual([{ profileId: 'p3', competency_ids: ['c2'] }])
  })

  it('does not detach a competency the source profile never held', () => {
    // A stale drag id would otherwise write the source's bundle back unchanged,
    // which is a mutation the undo stack has to carry for no reason.
    expect(reassignCompetency(profiles(), 'p3', 'p1', 'c9'))
      .toEqual([{ profileId: 'p1', competency_ids: ['c1', 'c2', 'c9'] }])
  })

  it('treats a profile with no bundle field as an empty one', () => {
    const legacy = [makeKQ({ id: 'p1', competency_ids: undefined as unknown as string[] })]
    expect(reassignCompetency(legacy, UNASSIGNED_GROUP, 'p1', 'c1'))
      .toEqual([{ profileId: 'p1', competency_ids: ['c1'] }])
  })
})
