import { describe, it, expect } from 'vitest'
import { buildWhoKnowsWhat } from '../src/lib/whoKnowsWhat'
import { emptyStore, makeResume, makeSkill } from './fixtures'
import type { ResumeStore } from '../src/types'

/** A resume input: id + name + a store carrying the given skills. */
function person(id: string, fullName: string, skills: ResumeStore['skills']): { id: string; name: string; data: ResumeStore } {
  return { id, name: `${fullName} — CV`, data: { ...emptyStore(), resume: makeResume({ full_name: fullName }), skills } }
}

describe('buildWhoKnowsWhat()', () => {
  it('lists every resume as a person column, using the CV full name', () => {
    const wkw = buildWhoKnowsWhat([
      person('a', 'Ada Lovelace', []),
      person('b', 'Bob Bicep', []),
    ])
    expect(wkw.people.map((p) => p.personName)).toEqual(['Ada Lovelace', 'Bob Bicep'])
    expect(wkw.people[0].resumeId).toBe('a')
  })

  it('falls back to the resume name when the CV has no full name', () => {
    const data = { ...emptyStore(), resume: makeResume({ full_name: '' }) }
    const wkw = buildWhoKnowsWhat([{ id: 'x', name: 'Draft CV', data }])
    expect(wkw.people[0].personName).toBe('Draft CV')
  })

  it('groups the same skill across people by normalized key', () => {
    const wkw = buildWhoKnowsWhat([
      person('a', 'Ada', [makeSkill({ id: 's1', name: { en: 'React' }, proficiency: 5 })]),
      person('b', 'Bob', [makeSkill({ id: 's2', name: { en: 'React.js' }, proficiency: 3 })]),
    ])
    // "React" and "React.js" normalize to the same key → one row, two holders.
    expect(wkw.rows).toHaveLength(1)
    expect(wkw.rows[0].holders.map((h) => h.personName)).toEqual(['Ada', 'Bob'])
  })

  it('does NOT merge genuinely different skills that share a head word', () => {
    const wkw = buildWhoKnowsWhat([
      person('a', 'Ada', [
        makeSkill({ id: 's1', name: { en: 'Spring' } }),
        makeSkill({ id: 's2', name: { en: 'Spring Boot' } }),
      ]),
    ])
    expect(wkw.rows).toHaveLength(2)
  })

  it('orders holders by proficiency, strongest first', () => {
    const wkw = buildWhoKnowsWhat([
      person('a', 'Ada', [makeSkill({ name: { en: 'Go' }, proficiency: 2 })]),
      person('b', 'Bob', [makeSkill({ name: { en: 'Go' }, proficiency: 5 })]),
      person('c', 'Cy', [makeSkill({ name: { en: 'Go' }, proficiency: 4 })]),
    ])
    expect(wkw.rows[0].holders.map((h) => h.personName)).toEqual(['Bob', 'Cy', 'Ada'])
    expect(wkw.rows[0].holders.map((h) => h.proficiency)).toEqual([5, 4, 2])
  })

  it('orders rows by how widely held they are, then alphabetically', () => {
    const wkw = buildWhoKnowsWhat([
      person('a', 'Ada', [makeSkill({ name: { en: 'Widely' } }), makeSkill({ name: { en: 'Zeta' } })]),
      person('b', 'Bob', [makeSkill({ name: { en: 'Widely' } }), makeSkill({ name: { en: 'Alpha' } })]),
    ])
    // "Widely" has 2 holders → first. Then the two singletons alphabetically.
    expect(wkw.rows.map((r) => r.name)).toEqual(['Widely', 'Alpha', 'Zeta'])
  })

  it('picks the most common spelling as the row display name', () => {
    const wkw = buildWhoKnowsWhat([
      person('a', 'Ada', [makeSkill({ name: { en: 'React.js' } })]),
      person('b', 'Bob', [makeSkill({ name: { en: 'React' } })]),
      person('c', 'Cy', [makeSkill({ name: { en: 'React' } })]),
    ])
    expect(wkw.rows[0].name).toBe('React') // 2× "React" beats 1× "React.js"
  })

  it('lines up a Norwegian-only skill with an English-only one for the same tech', () => {
    // Both normalize "Prosjektledelse"? No — different words. Use a shared term:
    // "DevOps" spelled identically in NO and EN keys the same.
    const wkw = buildWhoKnowsWhat([
      person('a', 'Ada', [makeSkill({ name: { no: 'DevOps' } })]),
      person('b', 'Bob', [makeSkill({ name: { en: 'DevOps' } })]),
    ])
    expect(wkw.rows).toHaveLength(1)
    expect(wkw.rows[0].holders).toHaveLength(2)
  })

  it('never double-counts a skill a resume happens to list twice', () => {
    const wkw = buildWhoKnowsWhat([
      person('a', 'Ada', [
        makeSkill({ id: 's1', name: { en: 'Kafka' }, proficiency: 4 }),
        makeSkill({ id: 's2', name: { en: 'Kafka' }, proficiency: 2 }),
      ]),
    ])
    expect(wkw.rows).toHaveLength(1)
    expect(wkw.rows[0].holders).toHaveLength(1) // one person, counted once
  })

  it('is empty-safe', () => {
    expect(buildWhoKnowsWhat([])).toEqual({ people: [], rows: [] })
  })
})
