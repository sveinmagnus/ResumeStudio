import { describe, it, expect } from 'vitest'
import { diffStores } from '../src/lib/diffResume'
import { emptyStore, makeResume, makeProject, makeSkill } from './fixtures'

describe('diffStores', () => {
  it('reports identical for two equal stores', () => {
    const a = emptyStore()
    const b = emptyStore()
    const d = diffStores(a, b)
    expect(d.identical).toBe(true)
    expect(d.sections).toEqual([])
    expect(d.profileFields).toEqual([])
  })

  it('counts an item present only locally as "added"', () => {
    const mine = emptyStore()
    mine.projects.push(makeProject({ id: 'p1' }))
    const theirs = emptyStore()
    const d = diffStores(mine, theirs)
    expect(d.identical).toBe(false)
    expect(d.sections).toContainEqual(expect.objectContaining({ section: 'Projects', added: 1, removed: 0, changed: 0 }))
  })

  it('counts an item present only on the server as "removed"', () => {
    const mine = emptyStore()
    const theirs = emptyStore()
    theirs.skills.push(makeSkill({ id: 's1' }))
    const d = diffStores(mine, theirs)
    expect(d.sections).toContainEqual(expect.objectContaining({ section: 'Skills', added: 0, removed: 1, changed: 0 }))
  })

  it('counts a same-id item with different content as "changed"', () => {
    const mine = emptyStore()
    mine.projects.push(makeProject({ id: 'p1', customer: { en: 'Mine Inc' } }))
    const theirs = emptyStore()
    theirs.projects.push(makeProject({ id: 'p1', customer: { en: 'Theirs Inc' } }))
    const d = diffStores(mine, theirs)
    expect(d.sections).toContainEqual(expect.objectContaining({ section: 'Projects', added: 0, removed: 0, changed: 1 }))
  })

  it('labels which items differ (changed first, then added, then removed)', () => {
    const mine = emptyStore()
    mine.projects.push(makeProject({ id: 'p1', customer: { en: 'Acme' } }))         // added (yours)
    mine.projects.push(makeProject({ id: 'p2', customer: { en: 'Globex v2' } }))    // changed
    const theirs = emptyStore()
    theirs.projects.push(makeProject({ id: 'p2', customer: { en: 'Globex v1' } }))  // changed counterpart
    theirs.projects.push(makeProject({ id: 'p3', customer: { en: 'Initech' } }))    // removed (theirs)

    const proj = diffStores(mine, theirs).sections.find((s) => s.section === 'Projects')!
    expect(proj.items).toEqual([
      { label: 'Globex v2', change: 'changed' },
      { label: 'Acme', change: 'added' },
      { label: 'Initech', change: 'removed' },
    ])
  })

  it('caps the per-section item list at 6', () => {
    const mine = emptyStore()
    for (let i = 0; i < 10; i++) mine.skills.push(makeSkill({ id: `s${i}`, name: { en: `Skill ${i}` } }))
    const proj = diffStores(mine, emptyStore()).sections.find((s) => s.section === 'Skills')!
    expect(proj.added).toBe(10)
    expect(proj.items).toHaveLength(6)
  })

  it('does not flag an identical same-id item', () => {
    const proj = makeProject({ id: 'p1' })
    const mine = emptyStore(); mine.projects.push(structuredClone(proj))
    const theirs = emptyStore(); theirs.projects.push(structuredClone(proj))
    expect(diffStores(mine, theirs).sections).toEqual([])
  })

  it('surfaces profile field differences with both values', () => {
    const mine = { ...emptyStore(), resume: makeResume({ full_name: 'Astrid', title: { en: 'Architect' } }) }
    const theirs = { ...emptyStore(), resume: makeResume({ full_name: 'Astrid', title: { en: 'Engineer' } }) }
    const d = diffStores(mine, theirs)
    expect(d.profileFields).toContainEqual({ field: 'Title', mine: 'Architect', theirs: 'Engineer' })
    // full_name is equal → not listed.
    expect(d.profileFields.find((f) => f.field === 'Full name')).toBeUndefined()
  })

  it('reduces a localized field to its first non-empty value', () => {
    const mine = { ...emptyStore(), resume: makeResume({ title: { no: 'Arkitekt', en: '' } }) }
    const theirs = { ...emptyStore(), resume: makeResume({ title: { no: 'Utvikler', en: '' } }) }
    const d = diffStores(mine, theirs)
    expect(d.profileFields).toContainEqual({ field: 'Title', mine: 'Arkitekt', theirs: 'Utvikler' })
  })

  it('handles a null resume on one side', () => {
    const mine = { ...emptyStore(), resume: makeResume({ full_name: 'Has Name' }) }
    const theirs = { ...emptyStore(), resume: null }
    const d = diffStores(mine, theirs)
    expect(d.profileFields).toContainEqual({ field: 'Full name', mine: 'Has Name', theirs: '' })
  })
})
