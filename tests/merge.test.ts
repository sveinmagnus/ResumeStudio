import { describe, it, expect } from 'vitest'
import {
  mergeSkills, mergeRoles, mergeIndustries, mergeRegistry,
  countSkillReferences, countRoleReferences, countIndustryReferences,
} from '../src/lib/merge'
import {
  emptyStore, makeSkill, makeRole, makeIndustry, makeProject, makeWork, makePosition,
} from './fixtures'
import type { ResumeStore } from '../src/types'

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

  it('rewrites positions[].role_ids (deduped) for "Other roles"', () => {
    const store = emptyStore()
    store.roles.push(makeRole({ id: 'src' }))
    store.roles.push(makeRole({ id: 'tgt' }))
    store.positions.push(makePosition({ id: 'pos1', role_ids: ['src'] }))
    store.positions.push(makePosition({ id: 'pos2', role_ids: ['src', 'tgt'] }))
    const out = mergeRoles(store, 'src', 'tgt')
    expect(out.positions[0].role_ids).toEqual(['tgt'])
    expect(out.positions[1].role_ids).toEqual(['tgt'])
  })

  it('leaves a position that never referenced the source alone', () => {
    // The rewrite is gated on `includes`; without the gate every position is
    // rebuilt, and one carrying no role_ids at all becomes a changed object for
    // no reason — which the diff then shows the user as a conflict.
    const store = emptyStore()
    store.roles.push(makeRole({ id: 'src' }), makeRole({ id: 'tgt' }))
    const untouched = makePosition({ id: 'pos1', role_ids: ['other'] })
    const legacy = makePosition({ id: 'pos2' })
    delete (legacy as unknown as Record<string, unknown>).role_ids
    store.positions.push(untouched, legacy)

    const out = mergeRoles(store, 'src', 'tgt')
    expect(out.positions[0]).toBe(untouched)   // same object, not a copy
    expect(out.positions[1]).toBe(legacy)      // a position with no role_ids at all
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
    store.positions.push(makePosition({ role_ids: ['r'] })) // "Other role" counts too
    expect(countRoleReferences(store, 'r')).toBe(4)
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

describe('mergeRegistryEntries — industries', () => {
  const store = (): ResumeStore => {
    const s = emptyStore()
    s.industries = [
      makeIndustry({ id: 'src', name: { en: 'Oil & Gas' } }),
      makeIndustry({ id: 'dst', name: { en: 'Energy', no: 'Energi' } }),
    ]
    s.projects = [
      makeProject({ id: 'p1', industries: [{ industry_id: 'src', name: { en: 'Oil & Gas' } }] }),
      makeProject({
        id: 'both',
        industries: [
          { industry_id: 'dst', name: { en: 'Energy' } },
          { industry_id: 'src', name: { en: 'Oil & Gas' } },
        ],
      }),
      makeProject({ id: 'untouched', industries: [{ industry_id: 'other', name: { en: 'Retail' } }] }),
    ]
    return s
  }

  it('repoints the link and refreshes the denormalized name snapshot', () => {
    const out = mergeIndustries(store(), 'src', 'dst')
    const p1 = out.projects.find((p) => p.id === 'p1')!
    expect(p1.industries).toEqual([{ industry_id: 'dst', name: { en: 'Energy', no: 'Energi' } }])
  })

  it('collapses a project that already listed the target — no double link', () => {
    const out = mergeIndustries(store(), 'src', 'dst')
    expect(out.projects.find((p) => p.id === 'both')!.industries.map((pi) => pi.industry_id))
      .toEqual(['dst'])
  })

  it('leaves a project that references neither entry alone', () => {
    const before = store()
    const out = mergeIndustries(before, 'src', 'dst')
    const p = out.projects.find((p) => p.id === 'untouched')!
    expect(p.industries).toEqual([{ industry_id: 'other', name: { en: 'Retail' } }])
    expect(p).toBe(before.projects[2])
  })

  it('deletes the source entry and keeps the target', () => {
    const out = mergeIndustries(store(), 'src', 'dst')
    expect(out.industries.map((i) => i.id)).toEqual(['dst'])
  })

  it('counts industry references per link', () => {
    expect(countIndustryReferences(store(), 'src')).toBe(2)
    expect(countIndustryReferences(store(), 'dst')).toBe(1)
  })
})

describe('mergeRegistryEntries — role links beyond projects', () => {
  const store = (): ResumeStore => {
    const s = emptyStore()
    s.roles = [makeRole({ id: 'src', name: { en: 'Dev' } }), makeRole({ id: 'dst', name: { en: 'Engineer' } })]
    s.projects = [makeProject({ id: 'p1', roles: [{ role_id: 'src', name: { en: 'Dev' }, description: {} }] })]
    s.work_experiences = [
      makeWork({ id: 'w1', role_ids: ['src'] }),
      makeWork({ id: 'w2', role_ids: ['dst', 'src'] }),
      makeWork({ id: 'w3', role_ids: ['unrelated'] }),
    ]
    s.positions = [
      makePosition({ id: 'pos1', role_ids: ['src'] }),
      makePosition({ id: 'pos2', role_ids: ['dst', 'src'] }),
      makePosition({ id: 'pos3', role_ids: undefined }),
    ]
    return s
  }

  it('remaps an employment role link and dedupes one that held both', () => {
    const out = mergeRoles(store(), 'src', 'dst')
    expect(out.work_experiences.find((w) => w.id === 'w1')!.role_ids).toEqual(['dst'])
    expect(out.work_experiences.find((w) => w.id === 'w2')!.role_ids).toEqual(['dst'])
    expect(out.work_experiences.find((w) => w.id === 'w3')!.role_ids).toEqual(['unrelated'])
  })

  it('remaps a position role link and dedupes one that held both', () => {
    const out = mergeRoles(store(), 'src', 'dst')
    expect(out.positions.find((p) => p.id === 'pos1')!.role_ids).toEqual(['dst'])
    expect(out.positions.find((p) => p.id === 'pos2')!.role_ids).toEqual(['dst'])
    expect(out.positions.find((p) => p.id === 'pos3')!.role_ids).toBeUndefined()
  })

  it('counts a project link, an employment link and a position link alike', () => {
    // 1 project + 2 employments + 2 positions.
    expect(countRoleReferences(store(), 'src')).toBe(5)
    expect(countRoleReferences(store(), 'dst')).toBe(2)
  })
})

describe('mergeRegistryEntries — skills', () => {
  it('rewrites only the merged skill link, refreshing its snapshot name', () => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 'src', name: { en: 'React.js' } }), makeSkill({ id: 'dst', name: { en: 'React' } })]
    s.projects = [makeProject({
      skills: [
        { skill_id: 'src', name: { en: 'React.js' }, proficiency: 3 },
        { skill_id: 'keep', name: { en: 'Go' }, proficiency: 1 },
      ],
    })]
    const out = mergeSkills(s, 'src', 'dst')
    expect(out.projects[0].skills).toEqual([
      { skill_id: 'dst', name: { en: 'React' }, proficiency: 3 },
      { skill_id: 'keep', name: { en: 'Go' }, proficiency: 1 },
    ])
    expect(countSkillReferences(s, 'src')).toBe(1)
  })
})

describe('mergeRegistry — a merge touches the merged link and nothing beside it', () => {
  it('leaves a project\u2019s OTHER role links alone', () => {
    const s = emptyStore()
    s.roles = [makeRole({ id: 'src', name: { en: 'Dev' } }), makeRole({ id: 'dst', name: { en: 'Engineer' } })]
    s.projects = [makeProject({
      roles: [
        { role_id: 'src', name: { en: 'Dev' }, description: {} },
        { role_id: 'keep', name: { en: 'Tester' }, description: {} },
      ],
    })]
    expect(mergeRoles(s, 'src', 'dst').projects[0].roles).toEqual([
      { role_id: 'dst', name: { en: 'Engineer' }, description: {} },
      { role_id: 'keep', name: { en: 'Tester' }, description: {} },
    ])
  })

  it('leaves an employment\u2019s and a position\u2019s other role ids alone', () => {
    const s = emptyStore()
    s.roles = [makeRole({ id: 'src', name: { en: 'Dev' } }), makeRole({ id: 'dst', name: { en: 'Engineer' } })]
    s.work_experiences = [makeWork({ role_ids: ['src', 'keep'] })]
    s.positions = [makePosition({ role_ids: ['keep', 'src'] })]
    const out = mergeRoles(s, 'src', 'dst')
    expect(out.work_experiences[0].role_ids).toEqual(['dst', 'keep'])
    expect(out.positions[0].role_ids).toEqual(['keep', 'dst'])
  })

  it('leaves a project\u2019s other industry links alone', () => {
    const s = emptyStore()
    s.industries = [makeIndustry({ id: 'src', name: { en: 'Oil' } }), makeIndustry({ id: 'dst', name: { en: 'Energy' } })]
    s.projects = [makeProject({
      industries: [
        { industry_id: 'src', name: { en: 'Oil' } },
        { industry_id: 'keep', name: { en: 'Retail' } },
      ],
    })]
    expect(mergeIndustries(s, 'src', 'dst').projects[0].industries).toEqual([
      { industry_id: 'dst', name: { en: 'Energy' } },
      { industry_id: 'keep', name: { en: 'Retail' } },
    ])
  })

  it('leaves a project\u2019s other skill links alone', () => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 'src', name: { en: 'React.js' } }), makeSkill({ id: 'dst', name: { en: 'React' } })]
    s.projects = [makeProject({
      skills: [
        { skill_id: 'src', name: { en: 'React.js' }, proficiency: 2 },
        { skill_id: 'keep', name: { en: 'Go' }, proficiency: 1 },
      ],
    })]
    expect(mergeSkills(s, 'src', 'dst').projects[0].skills.map((ps) => ps.skill_id)).toEqual(['dst', 'keep'])
  })
})
