import { describe, it, expect } from 'vitest'
import { diffStores, sectionLabel, labelOf } from '../src/lib/diffResume'
import { emptyStore, makeResume, makeProject, makeSkill, makeSkillCategory } from './fixtures'

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

  it('reports skill category additions under the "Skill categories" section', () => {
    const mine = emptyStore()
    mine.skill_categories.push(makeSkillCategory({ id: 'cat1', name: { en: 'Languages' } }))
    const theirs = emptyStore()
    const d = diffStores(mine, theirs)
    expect(d.sections).toContainEqual(expect.objectContaining({ section: 'Skill categories', added: 1, removed: 0, changed: 0 }))
  })

  it('handles a null resume on one side', () => {
    const mine = { ...emptyStore(), resume: makeResume({ full_name: 'Has Name' }) }
    const theirs = { ...emptyStore(), resume: null }
    const d = diffStores(mine, theirs)
    expect(d.profileFields).toContainEqual({ field: 'Full name', mine: 'Has Name', theirs: '' })
  })

  it('names every section the conflict modal can show', () => {
    // Both halves of the modal call this, so a key with no label must fall back
    // to something rather than render blank.
    expect(sectionLabel('projects')).toBe('Projects')
    expect(sectionLabel('skill_categories')).toBe('Skill categories')
    // `resume` is not a section array, so it has its own name.
    expect(sectionLabel('resume')).toBe('Personal details')
    // A section added since this map was written still names itself.
    expect(sectionLabel('brand_new_section')).toBe('brand_new_section')
  })

  it('gives every mapped section its own name, not the raw key', () => {
    // The conflict modal is a list of section names; an emptied one renders a
    // blank row that the user has to guess at before choosing keep or discard.
    // Pinned as a table so a renamed section fails here rather than silently.
    const labels: Array<[string, string]> = [
      ['skills', 'Skills'],
      ['roles', 'Roles'],
      ['key_qualifications', 'Key qualifications'],
      ['projects', 'Projects'],
      ['work_experiences', 'Work experience'],
      ['educations', 'Education'],
      ['courses', 'Courses'],
      ['certifications', 'Certifications'],
      ['spoken_languages', 'Languages'],
      ['skill_categories', 'Skill categories'],
      ['positions', 'Positions'],
      ['presentations', 'Presentations'],
      ['honor_awards', 'Awards'],
      ['publications', 'Publications'],
      ['references', 'References'],
      ['views', 'Resume views'],
    ]
    for (const [key, label] of labels) expect(sectionLabel(key), key).toBe(label)
    // Each name is distinct, or two sections read as one in the list.
    expect(new Set(labels.map(([, l]) => l)).size).toBe(labels.length)
  })
})

describe('the profile fields the conflict panel surfaces', () => {
  /**
   * Each field is a separate row in the modal that asks "keep mine or take
   * theirs". A field missing from the list makes a real divergence invisible,
   * and the user discards an edit they never saw.
   */
  const FIELDS: Array<[string, string, unknown, unknown]> = [
    ['full_name', 'Full name', 'Ada', 'Grace'],
    ['email', 'Email', 'a@b.no', 'c@d.no'],
    ['phone', 'Phone', '+47 1', '+47 2'],
    ['title', 'Title', { en: 'Consultant' }, { en: 'Architect' }],
    ['nationality', 'Nationality', { en: 'Norwegian' }, { en: 'British' }],
    ['place_of_residence', 'Place of residence', { en: 'Oslo' }, { en: 'Bergen' }],
    ['linkedin_url', 'LinkedIn', 'https://li/a', 'https://li/b'],
    ['website_url', 'Website', 'https://a.no', 'https://b.no'],
  ]

  for (const [key, label, mineValue, theirsValue] of FIELDS) {
    it(`surfaces a divergent ${label}`, () => {
      const mine = emptyStore()
      const theirs = emptyStore()
      mine.resume = makeResume({ [key]: mineValue } as never)
      theirs.resume = makeResume({ [key]: theirsValue } as never)
      const out = diffStores(mine, theirs)
      expect(out.identical).toBe(false)
      expect(out.profileFields.map((f) => f.field)).toEqual([label])
      expect(out.profileFields[0].mine).toBe(typeof mineValue === 'string' ? mineValue : Object.values(mineValue as object)[0])
      expect(out.profileFields[0].theirs).toBe(typeof theirsValue === 'string' ? theirsValue : Object.values(theirsValue as object)[0])
    })
  }

  it('says identical when only the profile agrees AND no section differs', () => {
    const mine = emptyStore()
    const theirs = emptyStore()
    mine.resume = makeResume({ full_name: 'Ada' })
    theirs.resume = makeResume({ full_name: 'Ada' })
    expect(diffStores(mine, theirs).identical).toBe(true)
  })

  it('is not identical when the profile differs but every section agrees', () => {
    const mine = emptyStore()
    const theirs = emptyStore()
    mine.resume = makeResume({ full_name: 'Ada' })
    theirs.resume = makeResume({ full_name: 'Grace' })
    const out = diffStores(mine, theirs)
    expect(out.sections).toEqual([])
    expect(out.identical).toBe(false)
  })

  it('compares a missing profile against a present one without throwing', () => {
    const mine = emptyStore()
    const theirs = emptyStore()
    mine.resume = null as never
    theirs.resume = makeResume({ full_name: 'Ada' })
    const fields = diffStores(mine, theirs).profileFields
    expect(fields).toContainEqual({ field: 'Full name', mine: '', theirs: 'Ada' })
    // Every row reads as "nothing here" on the missing side, not undefined.
    for (const f of fields) expect(f.mine).toBe('')
  })

  it('treats a blank locale slot as no value, so a whitespace edit is not a divergence', () => {
    const mine = emptyStore()
    const theirs = emptyStore()
    mine.resume = makeResume({ title: { en: '   ' } })
    theirs.resume = makeResume({ title: {} })
    expect(diffStores(mine, theirs).profileFields).toEqual([])
  })
})

describe('labelOf — the shared item label', () => {
  it('takes the first title field the item actually has', () => {
    expect(labelOf({ customer: { en: 'Acme' } })).toBe('Acme')
    expect(labelOf({ employer: { en: 'Cartavio' } })).toBe('Cartavio')
    expect(labelOf({ name: 'Client A' })).toBe('Client A')
  })

  it('falls through a title field that is present but empty', () => {
    expect(labelOf({ name: {}, customer: { en: 'Acme' } })).toBe('Acme')
    expect(labelOf({ name: { en: '  ' }, customer: { en: 'Acme' } })).toBe('Acme')
  })

  it('prefers the EARLIER title field when several are filled', () => {
    expect(labelOf({ customer: { en: 'Acme' }, title: { en: 'Something else' } })).toBe('Acme')
  })

  it('says (untitled) for anything it cannot name', () => {
    expect(labelOf({})).toBe('(untitled)')
    expect(labelOf(null)).toBe('(untitled)')
    expect(labelOf('a string')).toBe('(untitled)')
    expect(labelOf(42)).toBe('(untitled)')
    expect(labelOf({ description: { en: 'not a title field' } })).toBe('(untitled)')
  })

  it('ignores a title field holding non-string values', () => {
    expect(labelOf({ name: { year: 2020 } })).toBe('(untitled)')
  })
})
