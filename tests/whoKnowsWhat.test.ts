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

  it('falls back for a whitespace name and for a CV with no resume record', () => {
    // A padded name is no name; and a resume row can exist before its CV does.
    const padded = { ...emptyStore(), resume: makeResume({ full_name: '   ' }) }
    expect(buildWhoKnowsWhat([{ id: 'x', name: 'Draft CV', data: padded }]).people[0].personName)
      .toBe('Draft CV')

    const headless = { ...emptyStore(), resume: null }
    expect(buildWhoKnowsWhat([{ id: 'y', name: 'Empty CV', data: headless }]).people[0].personName)
      .toBe('Empty CV')
  })

  it('reads a resume whose skills array is missing entirely', () => {
    // Pre-registry data, and the shape a partially-restored backup can have.
    const legacy = { ...emptyStore() } as unknown as Record<string, unknown>
    delete legacy.skills
    expect(() => buildWhoKnowsWhat([{ id: 'z', name: 'Old CV', data: legacy as never }])).not.toThrow()
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

describe('buildWhoKnowsWhat — spelling, proficiency and bad data', () => {
  it('keeps the FIRST spelling when two are equally common, not the last', () => {
    // A tie must resolve deterministically, or the matrix header changes between
    // loads for no reason the user can see.
    const wkw = buildWhoKnowsWhat([
      person('a', 'Ada', [makeSkill({ id: 's1', name: { en: 'Kubernetes' } })]),
      person('b', 'Bob', [makeSkill({ id: 's2', name: { en: 'kubernetes' } })]),
    ], 'en')
    expect(wkw.rows[0].name).toBe('Kubernetes')
  })

  it('treats a missing proficiency as zero rather than dropping the holder', () => {
    const noProf = makeSkill({ id: 's1', name: { en: 'Go' } })
    delete (noProf as unknown as Record<string, unknown>).proficiency
    const wkw = buildWhoKnowsWhat([
      person('a', 'Ada', [noProf]),
      person('b', 'Bob', [makeSkill({ id: 's2', name: { en: 'Go' }, proficiency: 4 })]),
    ], 'en')
    expect(wkw.rows[0].holders.map((h) => h.personName)).toEqual(['Bob', 'Ada'])
    expect(wkw.rows[0].holders[1].proficiency).toBe(0)
  })

  it('ignores a non-numeric proficiency from an import', () => {
    const bad = makeSkill({ id: 's1', name: { en: 'Go' } })
    ;(bad as unknown as Record<string, unknown>).proficiency = 'expert'
    const wkw = buildWhoKnowsWhat([person('a', 'Ada', [bad])], 'en')
    expect(wkw.rows[0].holders[0].proficiency).toBe(0)
  })

  it('names a row from the requested locale, falling back to any spelling it has', () => {
    const wkw = buildWhoKnowsWhat([
      person('a', 'Ada', [makeSkill({ id: 's1', name: { en: 'Go', no: 'Go-spr\u00e5ket' } })]),
    ], 'no')
    expect(wkw.rows[0].name).toBe('Go-spr\u00e5ket')
  })

  it('groups on a real spelling even when an EARLIER locale slot is blank', () => {
    // The blank slot must be discarded before the key is chosen, or a skill
    // named in only one of two columns drops out of the matrix.
    const wkw = buildWhoKnowsWhat([
      person('a', 'Ada', [makeSkill({ id: 's1', name: { en: '   ', no: 'Kubernetes' } })]),
      person('b', 'Bob', [makeSkill({ id: 's2', name: { en: 'Kubernetes' } })]),
    ], 'en')
    expect(wkw.rows).toHaveLength(1)
    expect(wkw.rows[0].holders.map((h) => h.personName).sort()).toEqual(['Ada', 'Bob'])
  })

  it('skips a skill whose every name is blank rather than grouping them together', () => {
    const wkw = buildWhoKnowsWhat([
      person('a', 'Ada', [makeSkill({ id: 's1', name: { en: '   ' } }), makeSkill({ id: 's2', name: {} })]),
    ], 'en')
    expect(wkw.rows).toEqual([])
  })
})
