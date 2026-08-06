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

  it('merges ranges given out of order', () => {
    // The input is whatever order the projects happen to be in, so the sort is
    // load-bearing: unsorted, these two read as disjoint and double-count.
    expect(unionMonths([
      { start: ym(2021, 1), end: ym(2021, 12) },
      { start: ym(2020, 1), end: ym(2021, 6) },
    ])).toBe(24)
  })

  it('counts a month shared by two ranges once', () => {
    // Touching at exactly one month is the boundary the merge turns on: with a
    // strict comparison December is counted twice.
    expect(unionMonths([
      { start: ym(2020, 1), end: ym(2020, 12) },
      { start: ym(2020, 12), end: ym(2021, 5) },
    ])).toBe(17)
  })

  it('keeps a gap of a single month a gap', () => {
    // Jan–Jun and Aug–Dec: July belongs to neither.
    expect(unionMonths([
      { start: ym(2020, 1), end: ym(2020, 6) },
      { start: ym(2020, 8), end: ym(2020, 12) },
    ])).toBe(11)
  })

  it('survives a range whose end precedes its start', () => {
    // Bad data, not a crash: the end is clamped up to the start, so the range
    // counts as the single month it names.
    expect(unionMonths([{ start: ym(2020, 6), end: ym(2019, 1) }])).toBe(1)
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

/**
 * Where the experience numbers come from.
 *
 * These feed the Skill Matrix's Experience column and the registry editors, so
 * a reader takes them as facts about the person. The union is the whole point:
 * two projects running at the same time are ONE stretch of calendar time, and
 * counting them twice inflates a career.
 */
describe('skillExperience / roleExperience — the union and its sources', () => {
  const ym = (year: number, month: number) => ({ year, month })
  const NOW = new Date('2026-06-15T00:00:00Z')

  const withSkill = (projects: Array<Record<string, unknown>>, over: Record<string, unknown> = {}) => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 'go', name: { en: 'Go' }, ...over })]
    s.projects = projects.map((p, i) => makeProject({
      id: `p${i}`,
      skills: [{ id: `ps${i}`, skill_id: 'go', name: {}, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0 }],
      ...p,
    } as never))
    return skillExperience(s, s.skills[0], NOW)
  }

  it('counts overlapping projects ONCE', () => {
    // Jan–Dec 2020 and Jun 2020–Jun 2021: one continuous 18-month stretch, not
    // 12 + 13.
    expect(withSkill([
      { start: ym(2020, 1), end: ym(2020, 12) },
      { start: ym(2020, 6), end: ym(2021, 6) },
    ]).computedMonths).toBe(18)
  })

  it('counts adjacent months as one continuous stretch', () => {
    // Jan–Mar then Apr–Jun is six months, with no gap invented between them.
    expect(withSkill([
      { start: ym(2020, 1), end: ym(2020, 3) },
      { start: ym(2020, 4), end: ym(2020, 6) },
    ]).computedMonths).toBe(6)
  })

  it('keeps a real gap out of the total', () => {
    // 2020 (12) + 2022 (12) is 24 months of work, not 36 months of elapsed time.
    expect(withSkill([
      { start: ym(2020, 1), end: ym(2020, 12) },
      { start: ym(2022, 1), end: ym(2022, 12) },
    ]).computedMonths).toBe(24)
  })

  it('does not let a NESTED range shorten the one containing it', () => {
    // Mar–Jun sits entirely inside Jan–Dec. Taking the later end unconditionally
    // would cut the total from twelve months to six.
    expect(withSkill([
      { start: ym(2020, 1), end: ym(2020, 12) },
      { start: ym(2020, 3), end: ym(2020, 6) },
    ]).computedMonths).toBe(12)
  })

  it('counts a single-month project as one month, not zero', () => {
    expect(withSkill([{ start: ym(2020, 5), end: ym(2020, 5) }]).computedMonths).toBe(1)
  })

  it('runs an open-ended project up to now', () => {
    const months = withSkill([{ start: ym(2025, 6), end: null }]).computedMonths
    expect(months).toBe(13) // Jun 2025 … Jun 2026 inclusive
  })

  it('ignores a DISABLED project and one with no start', () => {
    // Both are invisible in every export; counting them puts experience in the
    // matrix that the CV never shows.
    expect(withSkill([
      { start: ym(2020, 1), end: ym(2020, 12) },
      { start: ym(2015, 1), end: ym(2015, 12), disabled: true },
      { start: null, end: ym(2016, 12) },
    ]).computedMonths).toBe(12)
  })

  it('ignores a project that does not use the skill', () => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 'go', name: { en: 'Go' } })]
    s.projects = [makeProject({ id: 'p1', skills: [], start: ym(2020, 1), end: ym(2020, 12) })]
    expect(skillExperience(s, s.skills[0], NOW).computedMonths).toBe(0)
  })

  describe('the legacy fallback', () => {
    it('uses the stored number ONLY when no dated usage exists', () => {
      const only = withSkill([], { total_duration_in_years: 4 })
      expect(only).toMatchObject({ computedMonths: 48, usesFallback: true })
    })

    it('prefers real dates over the stored number', () => {
      const dated = withSkill([{ start: ym(2020, 1), end: ym(2020, 12) }], { total_duration_in_years: 40 })
      expect(dated).toMatchObject({ computedMonths: 12, usesFallback: false })
    })

    it('does not fall back on a zero or absent stored number', () => {
      expect(withSkill([], { total_duration_in_years: 0 }))
        .toMatchObject({ computedMonths: 0, usesFallback: false })
    })
  })

  describe('the manual adjustment', () => {
    it('adds a positive offset on top of the computed months', () => {
      const r = withSkill([{ start: ym(2020, 1), end: ym(2020, 12) }], { experience_offset_years: 2 })
      expect(r).toMatchObject({ computedMonths: 12, adjustmentMonths: 24, totalMonths: 36 })
    })

    it('subtracts a negative offset', () => {
      const r = withSkill([{ start: ym(2020, 1), end: ym(2020, 12) }], { experience_offset_years: -0.5 })
      expect(r).toMatchObject({ adjustmentMonths: -6, totalMonths: 6 })
    })

    it('never reports a negative total', () => {
      const r = withSkill([{ start: ym(2020, 1), end: ym(2020, 12) }], { experience_offset_years: -10 })
      expect(r.totalMonths).toBe(0)
    })
  })

  describe('roleExperience draws on three sources', () => {
    const roleStore = () => {
      const s = emptyStore()
      s.roles = [makeRole({ id: 'arch', name: { en: 'Architect' } })]
      return s
    }

    it('counts projects, employments and positions, merged as one union', () => {
      const s = roleStore()
      s.projects = [makeProject({ id: 'p1', roles: [{ id: 'r1', role_id: 'arch', name: {}, sort_order: 0 }] as never, start: ym(2020, 1), end: ym(2020, 6) })]
      s.work_experiences = [makeWork({ id: 'w1', role_ids: ['arch'], start: ym(2020, 4), end: ym(2020, 12) })]
      s.positions = [{ ...makePosition({ id: 'pos1' }), role_ids: ['arch'], start: ym(2021, 1), end: ym(2021, 6) } as never]
      // Jan–Dec 2020 (overlapping pair merged) + Jan–Jun 2021.
      expect(roleExperience(s, s.roles[0], NOW).computedMonths).toBe(18)
    })

    it('ignores disabled rows in every one of the three', () => {
      const s = roleStore()
      s.projects = [makeProject({ id: 'p1', disabled: true, roles: [{ id: 'r1', role_id: 'arch', name: {}, sort_order: 0 }] as never, start: ym(2020, 1), end: ym(2020, 6) })]
      s.work_experiences = [makeWork({ id: 'w1', disabled: true, role_ids: ['arch'], start: ym(2020, 1), end: ym(2020, 6) })]
      s.positions = [{ ...makePosition({ id: 'pos1' }), disabled: true, role_ids: ['arch'], start: ym(2020, 1), end: ym(2020, 6) } as never]
      expect(roleExperience(s, s.roles[0], NOW).computedMonths).toBe(0)
    })

    it('survives a position with no role_ids array at all', () => {
      const s = roleStore()
      s.positions = [{ ...makePosition({ id: 'pos1' }), start: ym(2020, 1), end: ym(2020, 6) } as never]
      delete (s.positions[0] as unknown as Record<string, unknown>).role_ids
      expect(() => roleExperience(s, s.roles[0], NOW)).not.toThrow()
    })
  })
})
