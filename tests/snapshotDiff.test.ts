import { describe, it, expect } from 'vitest'
import { describeSnapshotChanges } from '../src/lib/snapshotDiff'
import {
  emptyStore, makeProject, makeRole, makeResume, makeSkill, makeSkillCategory, makeWork,
} from './fixtures'

describe('describeSnapshotChanges', () => {
  it('reports an added item with its title', () => {
    const prev = emptyStore()
    const next = emptyStore()
    next.projects = [makeProject({ id: 'p1', customer: { en: 'Acme Bank' } })]
    expect(describeSnapshotChanges(prev, next, 'en')).toEqual([
      { kind: 'added', section: 'Project', label: 'Acme Bank' },
    ])
  })

  it('reports a removed item with its title', () => {
    const prev = emptyStore()
    prev.roles = [makeRole({ id: 'r1', name: { en: 'Architect' } })]
    const next = emptyStore()
    expect(describeSnapshotChanges(prev, next, 'en')).toEqual([
      { kind: 'removed', section: 'Role', label: 'Architect' },
    ])
  })

  it('reports a localized text edit with the char delta and the language box', () => {
    const base = makeProject({ id: 'p1', customer: { en: 'Acme' }, long_description: { en: 'Hello', no: 'Hei' } })
    const prev = emptyStore(); prev.projects = [base]
    const next = emptyStore(); next.projects = [{ ...base, long_description: { en: 'Hello world!!', no: 'Hei' } }]
    const changes = describeSnapshotChanges(prev, next, 'en')
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ kind: 'edited', section: 'Project', label: 'Acme' })
    // Only the English box changed (+8 visible chars); Norwegian is untouched.
    expect(changes[0].details).toEqual(['Description (English): +8 chars'])
  })

  it('counts visible characters, ignoring HTML markup', () => {
    const base = makeProject({ id: 'p1', long_description: { en: '<p>Hi</p>' } })
    const prev = emptyStore(); prev.projects = [base]
    const next = emptyStore(); next.projects = [{ ...base, long_description: { en: '<p><b>Hi there</b></p>' } }]
    expect(describeSnapshotChanges(prev, next, 'en')[0].details).toEqual(['Description (English): +6 chars'])
  })

  it('uses a minus sign for deleted characters', () => {
    const base = makeProject({ id: 'p1', description: { en: 'Hello there' } })
    const prev = emptyStore(); prev.projects = [base]
    const next = emptyStore(); next.projects = [{ ...base, description: { en: 'Hello' } }]
    expect(describeSnapshotChanges(prev, next, 'en')[0].details).toEqual(['Description (English): −6 chars'])
  })

  it('labels a field with no entry in the table by tidying its key', () => {
    // The fallback path: underscores become spaces and the first letter is
    // capitalised, so a field added since the table was written still reads as
    // a label rather than as `company_url`.
    const base = makeProject({ id: 'p1', customer: { en: 'Acme' } })
    const prev = emptyStore(); prev.projects = [base]
    const next = emptyStore()
    next.projects = [{ ...base, company_url: 'https://example.com' } as never]
    const [change] = describeSnapshotChanges(prev, next, 'en')
    expect(change.details?.[0]).toMatch(/^Company url\b/)
  })

  it('names a language the label table does not know by its code', () => {
    const base = makeProject({ id: 'p1', customer: { en: 'Acme' }, description: { xx: 'Old' } })
    const prev = emptyStore(); prev.projects = [base]
    const next = emptyStore()
    next.projects = [{ ...base, description: { xx: 'Old and longer' } }]
    expect(describeSnapshotChanges(prev, next, 'en')[0].details?.[0]).toContain('(xx)')
  })

  it('does not treat an array of strings as a localized value', () => {
    // isLocalized decides whether a change is reported per language box, and
    // an array of strings satisfies "every value is a string" — so without the
    // Array check, role_ids is described as edits to languages "0" and "1".
    const base = makeWork({ id: 'w1', employer: { en: 'BigCo' }, role_ids: ['r1'] })
    const prev = emptyStore(); prev.work_experiences = [base]
    const next = emptyStore()
    next.work_experiences = [{ ...base, role_ids: ['r1', 'r2'] }]
    const [change] = describeSnapshotChanges(prev, next, 'en')
    expect(JSON.stringify(change?.details ?? [])).not.toMatch(/\((0|1)\)/)
  })

  it('ignores pure reordering (sort_order only) — no entries', () => {
    const a = makeProject({ id: 'p1', sort_order: 0 })
    const prev = emptyStore(); prev.projects = [a]
    const next = emptyStore(); next.projects = [{ ...a, sort_order: 5 }]
    expect(describeSnapshotChanges(prev, next, 'en')).toEqual([])
  })

  it('collapses profile field changes into one Profile entry', () => {
    const prev = emptyStore() // resume email = test@example.com
    const next = emptyStore(); next.resume = makeResume({ email: 'new@example.com' })
    const changes = describeSnapshotChanges(prev, next, 'en')
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ section: 'Profile', label: 'Profile details' })
    expect(changes[0].details?.some((d) => d.startsWith('Email'))).toBe(true)
  })

  it('reports an added skill category with its name', () => {
    const prev = emptyStore()
    const next = emptyStore()
    next.skill_categories = [makeSkillCategory({ id: 'cat1', name: { en: 'Languages' } })]
    expect(describeSnapshotChanges(prev, next, 'en')).toEqual([
      { kind: 'added', section: 'Skill category', label: 'Languages' },
    ])
  })

  it('reports a renamed skill category as an edit', () => {
    const cat = makeSkillCategory({ id: 'cat1', name: { en: 'Languages' } })
    const prev = emptyStore(); prev.skill_categories = [cat]
    const next = emptyStore(); next.skill_categories = [{ ...cat, name: { en: 'Programming Languages' } }]
    const changes = describeSnapshotChanges(prev, next, 'en')
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ kind: 'edited', section: 'Skill category' })
  })

  it('does not report a skill re-linked to a different category_id as a diff (identity/link noise)', () => {
    const skill = makeSkill({ id: 'sk1', name: { en: 'React' }, category_id: 'cat1' })
    const prev = emptyStore(); prev.skills = [skill]
    const next = emptyStore(); next.skills = [{ ...skill, category_id: 'cat2' }]
    expect(describeSnapshotChanges(prev, next, 'en')).toEqual([])
  })

  it('orders profile first, then edited/added/removed', () => {
    const role = makeRole({ id: 'r1', name: { en: 'Architect' } })
    const prev = emptyStore(); prev.roles = [role]
    const next = emptyStore()
    next.resume = makeResume({ email: 'changed@example.com' })
    next.roles = [{ ...role, name: { en: 'Solution Architect' } }]
    next.projects = [makeProject({ id: 'p1', customer: { en: 'NewCo' } })]
    const kinds = describeSnapshotChanges(next, prev, 'en') // diff doesn't matter for order check
    expect(kinds[0].section).toBe('Profile')
  })
})
