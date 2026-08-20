import { describe, it, expect } from 'vitest'
import {
  usageOfSkill, usageOfRole, usageOfIndustry, isSkillUnused, isRoleUnused,
} from '../src/lib/usage'
import {
  emptyStore, makeSkill, makeRole, makeIndustry, makeProject, makeWork, makePosition, makeProjectSkill, makeProjectRole, makeProjectIndustry
} from './fixtures'
import type { ResumeStore } from '../src/types'

describe('usageOfSkill()', () => {
  it('lists every project that references the skill, deduped per project', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'k' }))
    // Project A references the skill twice — should appear ONCE.
    store.projects.push(makeProject({
      id: 'pa',
      skills: [
        { id: 'a1', skill_id: 'k', name: {}, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0 },
        { id: 'a2', skill_id: 'k', name: {}, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 1 },
      ],
    }))
    // Project B doesn't reference it — excluded.
    store.projects.push(makeProject({ id: 'pb' }))
    const u = usageOfSkill(store, 'k')
    expect(u.projects.map((p) => p.id)).toEqual(['pa'])
  })

  it('returns empty arrays for an unreferenced skill', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'k' }))
    expect(usageOfSkill(store, 'k')).toEqual({ projects: [] })
  })

  it('includes a project where only ONE of several skills matches', () => {
    // "some", not "every": a project lists many skills, so requiring all of
    // them to match reports a used skill as unused — and the delete dialog
    // acts on that.
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'k' }))
    store.projects.push(makeProject({
      id: 'p',
      skills: [
        { id: 'a1', skill_id: 'other', name: {}, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0 },
        { id: 'a2', skill_id: 'k', name: {}, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 1 },
      ],
    }))
    expect(usageOfSkill(store, 'k').projects.map((p) => p.id)).toEqual(['p'])
  })
})

describe('usageOfRole()', () => {
  it('lists projects and work_experiences that reference the role', () => {
    const store = emptyStore()
    store.roles.push(makeRole({ id: 'r' }))
    store.projects.push(makeProject({
      id: 'p',
      roles: [{ id: 'pr', role_id: 'r', name: {}, sort_order: 0, disabled: false }],
    }))
    store.work_experiences.push(makeWork({ id: 'w', role_ids: ['r'] }))
    // A second employment that doesn't link is excluded.
    store.work_experiences.push(makeWork({ id: 'w2', role_ids: [] }))
    // An "Other role" (position) that links the role is included too.
    store.positions.push(makePosition({ id: 'pos', role_ids: ['r'] }))
    store.positions.push(makePosition({ id: 'pos2' })) // no role_ids → excluded

    const u = usageOfRole(store, 'r')
    expect(u.projects.map((p) => p.id)).toEqual(['p'])
    expect(u.work_experiences.map((w) => w.id)).toEqual(['w'])
    expect(u.positions.map((p) => p.id)).toEqual(['pos'])
  })

  it('returns empty arrays for an unreferenced role', () => {
    const store = emptyStore()
    store.roles.push(makeRole({ id: 'r' }))
    expect(usageOfRole(store, 'r')).toEqual({ projects: [], work_experiences: [], positions: [] })
  })

  it('includes a project where only ONE of several roles matches', () => {
    // "some", not "every": a project usually lists several roles, and
    // requiring all of them to match would report a used role as unused —
    // which is what the delete dialog then offers to do.
    const store = emptyStore()
    store.roles.push(makeRole({ id: 'r' }), makeRole({ id: 'other' }))
    store.projects.push(makeProject({
      id: 'p',
      roles: [
        { id: 'pr1', role_id: 'other', name: {}, sort_order: 0, disabled: false },
        { id: 'pr2', role_id: 'r', name: {}, sort_order: 1, disabled: false },
      ],
    }))
    expect(usageOfRole(store, 'r').projects.map((p) => p.id)).toEqual(['p'])
  })
})

describe('isSkillUnused() / isRoleUnused()', () => {
  it('isSkillUnused — true only when no project references it', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'k' }))
    expect(isSkillUnused(store, 'k')).toBe(true)
    store.projects.push(makeProject({
      skills: [{ id: 'ps', skill_id: 'k', name: {}, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0 }],
    }))
    expect(isSkillUnused(store, 'k')).toBe(false)
  })

  it('isRoleUnused — true only when neither projects nor employments reference it', () => {
    const store = emptyStore()
    store.roles.push(makeRole({ id: 'r' }))
    expect(isRoleUnused(store, 'r')).toBe(true)
    store.work_experiences.push(makeWork({ role_ids: ['r'] }))
    expect(isRoleUnused(store, 'r')).toBe(false)
  })
})

describe('usageOfIndustry()', () => {
  it('lists every project linking the industry, and nothing else', () => {
    // Industry links are many-per-project (shape v4), so a project carrying the
    // industry ALONGSIDE others still counts — matching by the whole array,
    // rather than by a single field, is the thing worth pinning.
    const store = emptyStore()
    store.industries.push(makeIndustry({ id: 'fin' }), makeIndustry({ id: 'gov' }))
    store.projects.push(makeProject({
      id: 'p1',
      industries: [{ id: 'l1', industry_id: 'fin', name: {}, sort_order: 0 }],
    }))
    store.projects.push(makeProject({
      id: 'p2',
      industries: [
        { id: 'l2', industry_id: 'gov', name: {}, sort_order: 0 },
        { id: 'l3', industry_id: 'fin', name: {}, sort_order: 1 },
      ],
    }))
    store.projects.push(makeProject({ id: 'p3', industries: [] }))

    expect(usageOfIndustry(store, 'fin').projects.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(usageOfIndustry(store, 'gov').projects.map((p) => p.id)).toEqual(['p2'])
  })

  it('is empty for an industry nothing references', () => {
    const store = emptyStore()
    store.industries.push(makeIndustry({ id: 'orphan' }))
    expect(usageOfIndustry(store, 'orphan').projects).toEqual([])
    expect(usageOfIndustry(store, 'no-such-id').projects).toEqual([])
  })
})

describe('usageOfIndustry / industry references', () => {
  const store = (): ResumeStore => {
    const s = emptyStore()
    s.projects = [
      makeProject({ id: 'p1', industries: [makeProjectIndustry({ industry_id: 'i1', name: { en: 'Energy' } })] }),
      makeProject({
        id: 'p2',
        industries: [
          makeProjectIndustry({ industry_id: 'i2', name: { en: 'Retail' } }),
          makeProjectIndustry({ industry_id: 'i1', name: { en: 'Energy' } }),
        ],
      }),
      makeProject({ id: 'p3', industries: [] }),
    ]
    return s
  }

  it('returns every project linking the industry, in store order', () => {
    expect(usageOfIndustry(store(), 'i1').projects.map((p) => p.id)).toEqual(['p1', 'p2'])
  })

  it('matches the industry asked for, not merely any link', () => {
    expect(usageOfIndustry(store(), 'i2').projects.map((p) => p.id)).toEqual(['p2'])
    expect(usageOfIndustry(store(), 'nope').projects).toEqual([])
  })

  it('lists a project once even when the same industry is linked twice', () => {
    const s = store()
    s.projects[0].industries.push(makeProjectIndustry({ industry_id: 'i1', name: { en: 'Energy' } }))
    expect(usageOfIndustry(s, 'i1').projects.map((p) => p.id)).toEqual(['p1', 'p2'])
  })
})

describe('isRoleUnused — every reference kind holds a role back', () => {
  const withRole = (over: Partial<ResumeStore>): ResumeStore => ({ ...emptyStore(), ...over })

  it('is unused only when no project, employment or position links it', () => {
    expect(isRoleUnused(emptyStore(), 'r1')).toBe(true)
  })

  it('is held by a project role link', () => {
    const s = withRole({ projects: [makeProject({ roles: [makeProjectRole({ role_id: 'r1', name: { en: 'Dev' } })] })] })
    expect(isRoleUnused(s, 'r1')).toBe(false)
    expect(isRoleUnused(s, 'other')).toBe(true)
  })

  it('is held by an employment role link', () => {
    const s = withRole({ work_experiences: [makeWork({ role_ids: ['r1'] })] })
    expect(isRoleUnused(s, 'r1')).toBe(false)
    expect(isRoleUnused(s, 'other')).toBe(true)
  })

  it('is held by a position ("other roles") link', () => {
    const s = withRole({ positions: [makePosition({ role_ids: ['r1'] })] })
    expect(isRoleUnused(s, 'r1')).toBe(false)
    expect(isRoleUnused(s, 'other')).toBe(true)
  })

  it('is unused when a position carries no role_ids at all', () => {
    const s = withRole({ positions: [makePosition({ role_ids: undefined })] })
    expect(isRoleUnused(s, 'r1')).toBe(true)
  })
})

describe('isSkillUnused', () => {
  it('is held by exactly the skill linked, not by a sibling link', () => {
    const s = emptyStore()
    s.projects = [makeProject({ skills: [makeProjectSkill({ skill_id: 's1', name: { en: 'Go' } })] })]
    expect(isSkillUnused(s, 's1')).toBe(false)
    expect(isSkillUnused(s, 's2')).toBe(true)
  })
})
