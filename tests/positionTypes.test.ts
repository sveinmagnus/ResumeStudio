import { describe, it, expect } from 'vitest'
import { POSITION_TYPES, positionTypeLabel } from '../src/lib/positionTypes'

describe('POSITION_TYPES', () => {
  /**
   * The stored values are identifiers: a position carries one, so renaming or
   * dropping one silently un-types every position already tagged with it. The
   * LABELS are free to change — they are display text, and their per-locale
   * completeness is enforced separately by tests/localeCoverage.test.ts.
   *
   * If this fails because you added a type, add it here. If it fails because
   * you renamed one, that needs a migration rather than an edit.
   */
  it('pins the stored vocabulary — a renamed value un-types existing positions', () => {
    expect(POSITION_TYPES.map((t) => t.value)).toEqual([
      'board_member',
      'committee_member',
      'advisor',
      'mentor',
      'coach',
      'organizer',
      'volunteer',
      'reviewer',
      'side_venture',
    ])
  })

  it('gives every type an English label, and no duplicates', () => {
    const values = POSITION_TYPES.map((t) => t.value)
    expect(new Set(values).size).toBe(values.length)
    for (const t of POSITION_TYPES) {
      expect(t.label, t.value).toBeTruthy()
      // `label` is the English twin of the localized set, not a second source.
      expect(t.label, t.value).toBe(t.labels.en)
    }
  })
})

describe('positionTypeLabel()', () => {
  it('resolves a stored value in the asked-for language', () => {
    expect(positionTypeLabel('board_member')).toBe('Board member')
    expect(positionTypeLabel('board_member', 'no')).toBe('Styremedlem')
  })

  it('falls back to English for a language the labels do not cover', () => {
    // resolve()'s chain, exercised here because the picker is the one place a
    // user cannot supply their own wording.
    expect(positionTypeLabel('board_member', 'ja')).toBe('Board member')
  })

  it('is empty for no type and for one it does not know', () => {
    // An empty string, not the raw value: a stored type from a newer build
    // would otherwise render as "side_venture" in an exported CV.
    expect(positionTypeLabel(null)).toBe('')
    expect(positionTypeLabel(undefined)).toBe('')
    expect(positionTypeLabel('')).toBe('')
    expect(positionTypeLabel('not_a_type')).toBe('')
  })
})
