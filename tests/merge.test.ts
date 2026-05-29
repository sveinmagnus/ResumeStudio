import { describe, it, expect } from 'vitest'
import {
  mergeSkills, mergeRoles,
  countSkillReferences, countRoleReferences,
} from '../src/lib/merge'
import {
  emptyStore, makeSkill, makeRole, makeProject, makeTechCategory,
} from './fixtures'

// ─── mergeSkills ────────────────────────────────────────────────────────────

describe('mergeSkills()', () => {
  it('removes the source entry from the registry', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'src', name: { en: 'TS' } }))
    store.skills.push(makeSkill({ id: 'tgt', name: { en: 'TypeScript' } }))
    const out = mergeSkills(store, 'src', 'tgt')
    expect(out.skills.map((s) => s.id)).toEqual(['tgt'])
  })

  it('rewrites project skills to point to the target id', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'src', name: { en: 'TS' } }))
    store.skills.push(makeSkill({ id: 'tgt', name: { en: 'TypeScript' } }))
    store.projects.push(makeProject({
      skills: [
        { id: 'ps1', skill_id: 'src', name: { en: 'TS' }, duration_in_years: 1, offset_in_years: 0, total_duration_in_years: 1, sort_order: 0 },
      ],
    }))
    const out = mergeSkills(store, 'src', 'tgt')
    expect(out.projects[0].skills[0].skill_id).toBe('tgt')
    expect(out.projects[0].skills[0].name).toEqual({ en: 'TypeScript' }) // snapshot updated
  })

  it('rewrites technology_categories skills to point to the target id', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'src', name: { en: 'TS' } }))
    store.skills.push(makeSkill({ id: 'tgt', name: { en: 'TypeScript' } }))
    store.technology_categories.push(makeTechCategory({
      skills: [
        { id: 'cs1', skill_id: 'src', name: { en: 'TS' }, proficiency: 0, total_duration_in_years: 0, sort_order: 0 },
      ],
    }))
    const out = mergeSkills(store, 'src', 'tgt')
    expect(out.technology_categories[0].skills[0].skill_id).toBe('tgt')
    expect(out.technology_categories[0].skills[0].name).toEqual({ en: 'TypeScript' })
  })

  it('leaves unrelated references untouched', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'src' }))
    store.skills.push(makeSkill({ id: 'tgt' }))
    store.skills.push(makeSkill({ id: 'other', name: { en: 'Go' } }))
    store.projects.push(makeProject({
      skills: [
        { id: 'a', skill_id: 'src',   name: {}, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0 },
        { id: 'b', skill_id: 'other', name: { en: 'Go' }, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 1 },
      ],
    }))
    const out = mergeSkills(store, 'src', 'tgt')
    expect(out.projects[0].skills[1].skill_id).toBe('other')
  })

  it('is a no-op when sourceId === targetId', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'same' }))
    const out = mergeSkills(store, 'same', 'same')
    expect(out).toBe(store)
  })

  it('is a no-op when either id is missing', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'only' }))
    expect(mergeSkills(store, 'missing', 'only')).toBe(store)
    expect(mergeSkills(store, 'only', 'missing')).toBe(store)
  })

  it('does not mutate the input store', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'src' }))
    store.skills.push(makeSkill({ id: 'tgt' }))
    const beforeSkills = store.skills
    mergeSkills(store, 'src', 'tgt')
    expect(store.skills).toBe(beforeSkills)
    expect(store.skills).toHaveLength(2)
  })
})

// ─── mergeRoles ─────────────────────────────────────────────────────────────

describe('mergeRoles()', () => {
  it('removes the source role and rewrites project role links', () => {
    const store = emptyStore()
    store.roles.push(makeRole({ id: 'src', name: { en: 'Architect' } }))
    store.roles.push(makeRole({ id: 'tgt', name: { en: 'Solution Architect' } }))
    store.projects.push(makeProject({
      roles: [
        { id: 'pr1', role_id: 'src', name: { en: 'Architect' }, sort_order: 0, disabled: false },
      ],
    }))
    const out = mergeRoles(store, 'src', 'tgt')
    expect(out.roles.map((r) => r.id)).toEqual(['tgt'])
    expect(out.projects[0].roles[0].role_id).toBe('tgt')
    expect(out.projects[0].roles[0].name).toEqual({ en: 'Solution Architect' })
  })

  it('is a no-op when either id is missing', () => {
    const store = emptyStore()
    store.roles.push(makeRole({ id: 'only' }))
    expect(mergeRoles(store, 'missing', 'only')).toBe(store)
    expect(mergeRoles(store, 'only', 'missing')).toBe(store)
  })
})

// ─── reference counts ──────────────────────────────────────────────────────

describe('countSkillReferences()', () => {
  it('counts references across projects and technology categories', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'k' }))
    store.projects.push(makeProject({
      skills: [
        { id: 'p1-a', skill_id: 'k', name: {}, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0 },
        { id: 'p1-b', skill_id: 'k', name: {}, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 1 },
      ],
    }))
    store.technology_categories.push(makeTechCategory({
      skills: [
        { id: 'c1', skill_id: 'k', name: {}, proficiency: 0, total_duration_in_years: 0, sort_order: 0 },
      ],
    }))
    expect(countSkillReferences(store, 'k')).toBe(3)
  })

  it('returns 0 for an unused skill', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'unused' }))
    expect(countSkillReferences(store, 'unused')).toBe(0)
  })
})

describe('countRoleReferences()', () => {
  it('counts references across projects', () => {
    const store = emptyStore()
    store.roles.push(makeRole({ id: 'r' }))
    store.projects.push(makeProject({
      roles: [
        { id: 'a', role_id: 'r', name: {}, sort_order: 0, disabled: false },
      ],
    }))
    store.projects.push(makeProject({
      roles: [
        { id: 'b', role_id: 'r', name: {}, sort_order: 0, disabled: false },
      ],
    }))
    expect(countRoleReferences(store, 'r')).toBe(2)
  })
})
