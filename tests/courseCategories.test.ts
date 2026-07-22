import { describe, it, expect } from 'vitest'
import { COURSE_CATEGORIES, courseCategoryLabel } from '../src/lib/courseCategories'

describe('COURSE_CATEGORIES', () => {
  it('is sorted alphabetically by label (the order every dropdown/filter/facet shows)', () => {
    const labels = COURSE_CATEGORIES.map((c) => c.label)
    const sorted = [...labels].sort((a, b) => a.localeCompare(b))
    expect(labels).toEqual(sorted)
  })

  it('keeps every value unique and label-resolvable', () => {
    const values = COURSE_CATEGORIES.map((c) => c.value)
    expect(new Set(values).size).toBe(values.length)
    for (const c of COURSE_CATEGORIES) expect(courseCategoryLabel(c.value)).toBe(c.label)
    expect(courseCategoryLabel(null)).toBe('')
    expect(courseCategoryLabel('unknown')).toBe('')
  })
})
