import { describe, it, expect } from 'vitest'
import {
  mergeSkills, mergeRoles, mergeIndustries, mergeRegistry,
  countSkillReferences, countRoleReferences, countIndustryReferences,
} from '../src/lib/merge'
import {
  emptyStore, makeSkill, makeRole, makeIndustry, makeProject, makeWork,
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

  it('rewrites work_experiences[].role_ids (deduped) and leaves the company-specific role_title untouched', () => {
    const store = emptyStore()
    store.roles.push(makeRole({ id: 'src', name: { en: 'Architect' } }))
    store.roles.push(makeRole({ id: 'tgt', name: { en: 'Solution Architect' } }))
    store.work_experiences.push(makeWork({
      id: 'w1', role_ids: ['src'], role_title: { en: 'Architect (old)' },
    }))
    // Already links the target too — the merge must dedup, not duplicate it.
    store.work_experiences.push(makeWork({
      id: 'w2', role_ids: ['src', 'tgt'], role_title: { en: 'Lead Engineer' },
    }))
    const out = mergeRoles(store, 'src', 'tgt')
    expect(out.work_experiences[0].role_ids).toEqual(['tgt'])
    // role_title is the company-specific title — never rewritten by a role merge.
    expect(out.work_experiences[0].role_title).toEqual({ en: 'Architect (old)' })
    expect(out.work_experiences[1].role_ids).toEqual(['tgt'])
    expect(out.work_experiences[1].role_title).toEqual({ en: 'Lead Engineer' })
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
  it('counts references across projects', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'k' }))
    store.projects.push(makeProject({
      skills: [
        { id: 'p1-a', skill_id: 'k', name: {}, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0 },
        { id: 'p1-b', skill_id: 'k', name: {}, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 1 },
      ],
    }))
    expect(countSkillReferences(store, 'k')).toBe(2)
  })

  it('returns 0 for an unused skill', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'unused' }))
    expect(countSkillReferences(store, 'unused')).toBe(0)
  })
})

describe('countRoleReferences()', () => {
  it('counts references across projects and work_experiences', () => {
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
    store.work_experiences.push(makeWork({ role_ids: ['r'] }))
    expect(countRoleReferences(store, 'r')).toBe(3)
  })
})

// ─── mergeIndustries + generic mergeRegistry (A8.1) ──────────────────────────

describe('mergeIndustries()', () => {
  function storeWithDupes() {
    const store = emptyStore()
    store.industries.push(makeIndustry({ id: 'fin', name: { en: 'Finance' } }))
    store.industries.push(makeIndustry({ id: 'finance2', name: { en: 'finance' } }))
    store.projects.push(makeProject({ id: 'p1', industries: [{ id: 'pi1', industry_id: 'fin', name: { en: 'Finance' }, sort_order: 0 }] }))
    store.projects.push(makeProject({ id: 'p2', industries: [{ id: 'pi2', industry_id: 'finance2', name: { en: 'finance' }, sort_order: 0 }] }))
    return store
  }

  it('rewrites project industry links + refreshes the snapshot, deletes source', () => {
    const out = mergeIndustries(storeWithDupes(), 'finance2', 'fin')
    expect(out.industries.map((i) => i.id)).toEqual(['fin'])
    expect(out.projects.every((p) => p.industries.every((pi) => pi.industry_id === 'fin'))).toBe(true)
    // p2's snapshot name now matches the surviving target.
    expect(out.projects.find((p) => p.id === 'p2')!.industries[0].name).toEqual({ en: 'Finance' })
  })

  it('dedupes when a project already links both source and target', () => {
    const store = emptyStore()
    store.industries.push(makeIndustry({ id: 'fin', name: { en: 'Finance' } }))
    store.industries.push(makeIndustry({ id: 'finance2', name: { en: 'finance' } }))
    store.projects.push(makeProject({
      id: 'p', industries: [
        { id: 'a', industry_id: 'fin', name: { en: 'Finance' }, sort_order: 0 },
        { id: 'b', industry_id: 'finance2', name: { en: 'finance' }, sort_order: 1 },
      ],
    }))
    const out = mergeIndustries(store, 'finance2', 'fin')
    expect(out.projects[0].industries).toHaveLength(1)
    expect(out.projects[0].industries[0].industry_id).toBe('fin')
  })

  it('no-ops on same id or missing ids', () => {
    const store = storeWithDupes()
    expect(mergeIndustries(store, 'fin', 'fin')).toBe(store)
    expect(mergeIndustries(store, 'nope', 'fin')).toBe(store)
    expect(mergeIndustries(store, 'fin', 'nope')).toBe(store)
  })
})

describe('countIndustryReferences()', () => {
  it('counts industry links across projects', () => {
    const store = emptyStore()
    store.industries.push(makeIndustry({ id: 'fin' }))
    store.projects.push(makeProject({ industries: [{ id: 'a', industry_id: 'fin', name: {}, sort_order: 0 }] }))
    store.projects.push(makeProject({ industries: [{ id: 'b', industry_id: 'fin', name: {}, sort_order: 0 }] }))
    store.projects.push(makeProject({ industries: [] }))
    expect(countIndustryReferences(store, 'fin')).toBe(2)
  })
})

describe('mergeRegistry() generic engine', () => {
  it('dispatches to the same behaviour as the named wrappers', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 's1', name: { en: 'A' } }))
    store.skills.push(makeSkill({ id: 's2', name: { en: 'B' } }))
    store.projects.push(makeProject({
      skills: [{ id: 'ps', skill_id: 's1', name: { en: 'A' }, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0 }],
    }))
    const viaGeneric = mergeRegistry(store, 'skills', 's1', 's2')
    const viaWrapper = mergeSkills(store, 's1', 's2')
    expect(viaGeneric).toEqual(viaWrapper)
    expect(viaGeneric.skills.map((s) => s.id)).toEqual(['s2'])
    expect(viaGeneric.projects[0].skills[0].skill_id).toBe('s2')
  })
})
