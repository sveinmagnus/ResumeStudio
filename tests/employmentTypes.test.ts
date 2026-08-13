import { describe, it, expect } from 'vitest'
import { EMPLOYMENT_TYPES, employmentTypeLabel } from '../src/lib/employmentTypes'

describe('EMPLOYMENT_TYPES', () => {
  /**
   * The stored values are identifiers: every employment carries one, and the
   * view editor's type facet groups on them, so renaming one silently
   * un-types the entries already saved. Labels are editor chrome and may
   * change freely — this vocabulary is deliberately English-only, since
   * employment_type never reaches an export.
   */
  it('pins the stored vocabulary — a renamed value un-types existing entries', () => {
    expect(EMPLOYMENT_TYPES.map((t) => t.value))
      .toEqual(['permanent', 'contract', 'freelance', 'part_time', 'internship'])
  })

  it('gives every type a label, with no duplicate values', () => {
    const values = EMPLOYMENT_TYPES.map((t) => t.value)
    expect(new Set(values).size).toBe(values.length)
    for (const t of EMPLOYMENT_TYPES) expect(t.label, t.value).toBeTruthy()
  })
})

describe('employmentTypeLabel()', () => {
  it('resolves every value in the vocabulary', () => {
    for (const t of EMPLOYMENT_TYPES) {
      expect(employmentTypeLabel(t.value), t.value).toBe(t.label)
    }
  })

  it('is empty for no type and for one it does not know', () => {
    // Empty, not the raw value: a type from a newer build would otherwise
    // render as "part_time" on the card.
    expect(employmentTypeLabel(null)).toBe('')
    expect(employmentTypeLabel(undefined)).toBe('')
    expect(employmentTypeLabel('')).toBe('')
    expect(employmentTypeLabel('not_a_type')).toBe('')
  })
})

describe('employmentTypeLabel — the lookup behind the label', () => {
  it('resolves every stored value to its own label', () => {
    // The label table is derived from the list; if the derivation breaks, every
    // employment card and every view facet silently loses its type wording.
    for (const t of EMPLOYMENT_TYPES) expect(employmentTypeLabel(t.value), t.value).toBe(t.label)
  })

  it('is empty for an unknown value and for none', () => {
    expect(employmentTypeLabel('freelanceish')).toBe('')
    expect(employmentTypeLabel(null)).toBe('')
    expect(employmentTypeLabel(undefined)).toBe('')
  })
})
