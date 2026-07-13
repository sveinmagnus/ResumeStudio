import { describe, it, expect } from 'vitest'
import {
  unionMonths, skillExperience, roleExperience,
  fmtYearsMonths, splitMonths, monthsToYears,
} from '../src/lib/experience'
import {
  emptyStore, makeSkill, makeRole, makeProject, makeWork, makePosition,
} from './fixtures'
import type { ProjectSkill } from '../src/types'

const NOW = new Date('2026-07-01T00:00:00Z')
const ym = (year: number, month: number | null = null) => ({ year, month })
const ps = (skill_id: string): ProjectSkill => ({
  id: `ps-${skill_id}`, skill_id, name: {},
  duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0,
})

describe('unionMonths()', () => {
  it('is 0 for no ranges', () => {
    expect(unionMonths([])).toBe(0)
  })

  it('counts a single [start,end] range inclusively', () => {
    // Jan 2020 .. Dec 2020 = 12 months.
    expect(unionMonths([{ start: ym(2020, 1), end: ym(2020, 12) }])).toBe(12)
    // Same month = 1 month.
    expect(unionMonths([{ start: ym(2020, 3), end: ym(2020, 3) }])).toBe(1)
  })

  it('merges overlapping ranges (counts shared time once)', () => {
    // Two identical 2-year spans → 24 months, not 48.
    const r = { start: ym(2020, 1), end: ym(2021, 12) }
    expect(unionMonths([r, { ...r }])).toBe(24)
  })

  it('adds disjoint ranges', () => {
    expect(unionMonths([
      { start: ym(2018, 1), end: ym(2018, 12) }, // 12
      { start: ym(2022, 1), end: ym(2022, 6) },  // 6
    ])).toBe(18)
  })
})

describe('skillExperience()', () => {
  it('computes the union of referencing-project spans', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'k' }))
    store.projects.push(makeProject({ id: 'p1', skills: [ps('k')], start: ym(2020, 1), end: ym(2020, 12) }))
    store.projects.push(makeProject({ id: 'p2', skills: [ps('k')], start: ym(2022, 1), end: ym(2022, 6) }))
    const e = skillExperience(store, store.skills[0], NOW)
    expect(e.computedMonths).toBe(18)
    expect(e.totalMonths).toBe(18)
    expect(e.usesFallback).toBe(false)
  })

  it('treats an ongoing project as running until now', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'k' }))
    store.projects.push(makeProject({ id: 'p', skills: [ps('k')], start: ym(2026, 1), end: null }))
    // Jan..Jul 2026 inclusive = 7 months.
    expect(skillExperience(store, store.skills[0], NOW).computedMonths).toBe(7)
  })

  it('falls back to the stored legacy total when there is no dated usage', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'k', total_duration_in_years: 4 }))
    const e = skillExperience(store, store.skills[0], NOW)
    expect(e.computedMonths).toBe(48)
    expect(e.usesFallback).toBe(true)
  })

  it('adds the signed adjustment on top of the computed base', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'k', experience_offset_years: 0.5 }))
    store.projects.push(makeProject({ id: 'p', skills: [ps('k')], start: ym(2020, 1), end: ym(2020, 12) }))
    const e = skillExperience(store, store.skills[0], NOW)
    expect(e.computedMonths).toBe(12)
    expect(e.adjustmentMonths).toBe(6)
    expect(e.totalMonths).toBe(18)
  })

  it('floors the total at zero for a large negative adjustment', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'k', total_duration_in_years: 1, experience_offset_years: -5 }))
    expect(skillExperience(store, store.skills[0], NOW).totalMonths).toBe(0)
  })

  it('skips disabled projects', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'k' }))
    store.projects.push(makeProject({ id: 'p', skills: [ps('k')], start: ym(2020, 1), end: ym(2021, 12), disabled: true }))
    expect(skillExperience(store, store.skills[0], NOW).computedMonths).toBe(0)
  })
})

describe('roleExperience()', () => {
  it('unions spans across projects, employments and other-roles', () => {
    const store = emptyStore()
    store.roles.push(makeRole({ id: 'r' }))
    store.projects.push(makeProject({
      id: 'p', roles: [{ id: 'pr', role_id: 'r', name: {}, sort_order: 0, disabled: false }],
      start: ym(2018, 1), end: ym(2018, 12), // 12
    }))
    store.work_experiences.push(makeWork({ id: 'w', role_ids: ['r'], start: ym(2020, 1), end: ym(2020, 12) })) // 12
    store.positions.push(makePosition({ id: 'pos', role_ids: ['r'], start: ym(2022, 1), end: ym(2022, 6) })) // 6
    const e = roleExperience(store, store.roles[0], NOW)
    expect(e.computedMonths).toBe(30)
  })

  it('does not double-count overlapping employment and project', () => {
    const store = emptyStore()
    store.roles.push(makeRole({ id: 'r' }))
    store.projects.push(makeProject({
      id: 'p', roles: [{ id: 'pr', role_id: 'r', name: {}, sort_order: 0, disabled: false }],
      start: ym(2020, 1), end: ym(2021, 12),
    }))
    store.work_experiences.push(makeWork({ id: 'w', role_ids: ['r'], start: ym(2020, 1), end: ym(2021, 12) }))
    expect(roleExperience(store, store.roles[0], NOW).computedMonths).toBe(24)
  })

  it('falls back to years_of_experience and applies the offset adjustment', () => {
    const store = emptyStore()
    store.roles.push(makeRole({ id: 'r', years_of_experience: 3, years_of_experience_offset: 1 }))
    const e = roleExperience(store, store.roles[0], NOW)
    expect(e.computedMonths).toBe(36)
    expect(e.usesFallback).toBe(true)
    expect(e.adjustmentMonths).toBe(12)
    expect(e.totalMonths).toBe(48)
  })

  it('ignores positions with no role link', () => {
    const store = emptyStore()
    store.roles.push(makeRole({ id: 'r' }))
    store.positions.push(makePosition({ id: 'pos', start: ym(2020, 1), end: ym(2020, 12) })) // no role_ids
    expect(roleExperience(store, store.roles[0], NOW).computedMonths).toBe(0)
  })
})

describe('formatting helpers', () => {
  it('fmtYearsMonths renders years and months', () => {
    expect(fmtYearsMonths(0)).toBe('—')
    expect(fmtYearsMonths(7)).toBe('7m')
    expect(fmtYearsMonths(24)).toBe('2y')
    expect(fmtYearsMonths(40)).toBe('3y 4m')
    expect(fmtYearsMonths(-5)).toBe('—') // never negative
  })

  it('splitMonths keeps a consistent sign', () => {
    expect(splitMonths(40)).toEqual({ years: 3, months: 4 })
    expect(splitMonths(-18)).toEqual({ years: -1, months: -6 })
  })

  it('monthsToYears round-trips to a 2dp decimal', () => {
    expect(monthsToYears(18)).toBe(1.5)
    expect(monthsToYears(6)).toBe(0.5)
  })
})
