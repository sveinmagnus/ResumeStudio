import { describe, it, expect } from 'vitest'
import {
  usageOfSkill, usageOfRole, isSkillUnused, isRoleUnused,
} from '../src/lib/usage'
import {
  emptyStore, makeSkill, makeRole, makeProject, makeWork, makeTechCategory,
} from './fixtures'

describe('usageOfSkill()', () => {
  it('lists every project (deduped per project) and every tech category that references the skill', () => {
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
    // Tech cat C does — included.
    store.technology_categories.push(makeTechCategory({
      id: 'tc',
      skills: [{ id: 'cs', skill_id: 'k', name: {}, proficiency: 0, total_duration_in_years: 0, sort_order: 0 }],
    }))
    const u = usageOfSkill(store, 'k')
    expect(u.projects.map((p) => p.id)).toEqual(['pa'])
    expect(u.technology_categories.map((c) => c.id)).toEqual(['tc'])
  })

  it('returns empty arrays for an unreferenced skill', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'k' }))
    expect(usageOfSkill(store, 'k')).toEqual({ projects: [], technology_categories: [] })
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
    store.work_experiences.push(makeWork({ id: 'w', role_id: 'r' }))
    // A second employment that doesn't link is excluded.
    store.work_experiences.push(makeWork({ id: 'w2', role_id: null }))

    const u = usageOfRole(store, 'r')
    expect(u.projects.map((p) => p.id)).toEqual(['p'])
    expect(u.work_experiences.map((w) => w.id)).toEqual(['w'])
  })

  it('returns empty arrays for an unreferenced role', () => {
    const store = emptyStore()
    store.roles.push(makeRole({ id: 'r' }))
    expect(usageOfRole(store, 'r')).toEqual({ projects: [], work_experiences: [] })
  })
})

describe('isSkillUnused() / isRoleUnused()', () => {
  it('isSkillUnused — true only when neither projects nor categories reference it', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'k' }))
    expect(isSkillUnused(store, 'k')).toBe(true)
    store.technology_categories.push(makeTechCategory({
      skills: [{ id: 'cs', skill_id: 'k', name: {}, proficiency: 0, total_duration_in_years: 0, sort_order: 0 }],
    }))
    expect(isSkillUnused(store, 'k')).toBe(false)
  })

  it('isRoleUnused — true only when neither projects nor employments reference it', () => {
    const store = emptyStore()
    store.roles.push(makeRole({ id: 'r' }))
    expect(isRoleUnused(store, 'r')).toBe(true)
    store.work_experiences.push(makeWork({ role_id: 'r' }))
    expect(isRoleUnused(store, 'r')).toBe(false)
  })
})
