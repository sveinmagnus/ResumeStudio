import { describe, it, expect } from 'vitest'
import { COURSE_CATEGORIES, courseCategoryLabel } from '../src/lib/courseCategories'

describe('COURSE_CATEGORIES', () => {
  /**
   * The stored values are identifiers, not labels: every course and
   * certification carries one, so renaming or dropping a value silently
   * un-categorises the items already tagged with it. Labels stay free to
   * change — they are editor-only and never exported — which is why this pins
   * the values alone.
   *
   * If this fails because you added a category, add it here. If it fails
   * because you renamed one, you need a migration, not an edit.
   */
  it('pins the stored vocabulary — a renamed value orphans existing items', () => {
    expect([...COURSE_CATEGORIES.map((c) => c.value)].sort()).toEqual([
      'architecture_design',
      'communication',
      'creativity_agile',
      'finance',
      'food_beverage',
      'health_safety',
      'legal_compliance',
      'leisure',
      'management',
      'medical',
      'non_technical_expertise',
      'personal_development',
      'project_management',
      'quality',
      'sales',
      'soft_skills',
      'sustainability',
      'technical_expertise',
      'vehicles',
    ])
  })

  it('gives every category a non-empty label', () => {
    for (const c of COURSE_CATEGORIES) {
      expect(c.label, c.value).toBeTruthy()
      expect(typeof c.label, c.value).toBe('string')
    }
  })

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
