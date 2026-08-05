import { describe, it, expect } from 'vitest'
import { mergeStores, deepEqual } from '../src/lib/threeWayMerge'
import { emptyStore, makeProject, makeSkill, makeResume, makeView } from './fixtures'
import { buildViewSections } from '../src/lib/viewFilter'
import type { ResumeStore, Project } from '../src/types'

/**
 * The behaviour under test is "don't ask the user about something only one
 * person changed". Every case here is a scenario that USED to raise the
 * keep/discard modal, listing the whole document.
 */

/** Deep clone through JSON — also the round trip `theirs` really goes through. */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function storeWith(projects: Project[]): ResumeStore {
  return { ...emptyStore(), projects }
}

function projectById(store: ResumeStore, id: string): Project {
  const p = store.projects.find((x) => x.id === id)
  if (!p) throw new Error(`no project ${id}`)
  return p
}

describe('deepEqual', () => {
  it('ignores key insertion order', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
  })

  it('treats an absent key and an explicitly-undefined key as equal', () => {
    // A JSON round trip drops undefined-valued keys; if that read as a change,
    // every optional field the server has seen would look edited.
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true)
  })

  it('still distinguishes null from absent', () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: null })).toBe(false)
  })

  it('compares arrays element-wise and by length', () => {
    expect(deepEqual([1, [2, 3]], [1, [2, 3]])).toBe(true)
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false)
  })
})

describe('mergeStores — edits that do not overlap', () => {
  it('merges edits to different items of the same section', () => {
    const a = makeProject({ customer: { en: 'Acme' } })
    const b = makeProject({ customer: { en: 'Beta' } })
    const base = storeWith([a, b])

    const mine = clone(base)
    projectById(mine, a.id).customer = { en: 'Acme Corp' }

    const theirs = clone(base)
    projectById(theirs, b.id).customer = { en: 'Beta Ltd' }

    const res = mergeStores(base, mine, theirs)

    expect(res.conflicts).toEqual([])
    expect(projectById(res.merged, a.id).customer).toEqual({ en: 'Acme Corp' })
    expect(projectById(res.merged, b.id).customer).toEqual({ en: 'Beta Ltd' })
    expect(res.adopted).toBe(1)
  })

  it('merges edits to different FIELDS of the same item', () => {
    const p = makeProject()
    const base = storeWith([p])

    const mine = clone(base)
    projectById(mine, p.id).customer = { en: 'Renamed' }

    const theirs = clone(base)
    projectById(theirs, p.id).description = { en: 'A longer description' }

    const res = mergeStores(base, mine, theirs)

    expect(res.conflicts).toEqual([])
    expect(projectById(res.merged, p.id).customer).toEqual({ en: 'Renamed' })
    expect(projectById(res.merged, p.id).description).toEqual({ en: 'A longer description' })
  })

  it('merges edits to different LOCALES of the same field', () => {
    // The dual-view pattern makes this the single most likely overlap: two
    // people filling the two language columns of one description.
    const p = makeProject({ description: { en: 'English', no: 'Norsk' } })
    const base = storeWith([p])

    const mine = clone(base)
    projectById(mine, p.id).description = { en: 'English, revised', no: 'Norsk' }

    const theirs = clone(base)
    projectById(theirs, p.id).description = { en: 'English', no: 'Norsk, revidert' }

    const res = mergeStores(base, mine, theirs)

    expect(res.conflicts).toEqual([])
    expect(projectById(res.merged, p.id).description).toEqual({
      en: 'English, revised', no: 'Norsk, revidert',
    })
  })

  it('merges a whole-section reorder against a text edit', () => {
    // This is the reported symptom: `moveItem` renumbers sort_order on EVERY
    // item in the section, so one drag in one window used to present as "every
    // project differs" in the other.
    const items = [0, 1, 2, 3, 4].map((i) =>
      makeProject({ customer: { en: `P${i}` }, sort_order: i }),
    )
    const base = storeWith(items)

    // Mine: dragged the last project to the top — every sort_order rewritten.
    const mine = clone(base)
    const dragged = mine.projects.pop()!
    mine.projects.unshift(dragged)
    mine.projects.forEach((p, i) => { p.sort_order = i })

    // Theirs: edited one project's text, no reordering.
    const theirs = clone(base)
    projectById(theirs, items[2].id).description = { en: 'Edited elsewhere' }

    const res = mergeStores(base, mine, theirs)

    expect(res.conflicts).toEqual([])
    // My ordering survived…
    expect(projectById(res.merged, items[4].id).sort_order).toBe(0)
    expect(projectById(res.merged, items[0].id).sort_order).toBe(1)
    // …and so did their edit.
    expect(projectById(res.merged, items[2].id).description).toEqual({ en: 'Edited elsewhere' })
  })

  it('keeps both sides’ additions', () => {
    const base = storeWith([makeProject({ customer: { en: 'Shared' } })])

    const mine = clone(base)
    mine.projects.push(makeProject({ customer: { en: 'Mine' } }))

    const theirs = clone(base)
    theirs.projects.push(makeProject({ customer: { en: 'Theirs' } }))

    const res = mergeStores(base, mine, theirs)

    expect(res.conflicts).toEqual([])
    expect(res.merged.projects).toHaveLength(3)
    expect(res.merged.projects.map((p) => p.customer.en).sort())
      .toEqual(['Mine', 'Shared', 'Theirs'])
  })

  /**
   * Element-wise merging is only safe for arrays of id-bearing objects: those
   * have identity, so "changed on one side" is answerable per element. An
   * array of bare strings has none — position IS the identity — so it has to
   * be treated as a single value, or two sides appending different tags merge
   * into a list neither of them wrote.
   */
  it('treats an array without ids as one value, not as mergeable elements', () => {
    const base = storeWith([makeProject({ customer: { en: 'Shared' } })])
    base.resume!.supported_locales = ['en']

    const mine = clone(base)
    mine.resume!.supported_locales = ['en', 'no']

    const theirs = clone(base)
    theirs.resume!.supported_locales = ['en', 'se']

    const res = mergeStores(base, mine, theirs)
    // One side wins whole, and the disagreement is reported — never a silent
    // ['en','no','se'] that neither machine chose.
    expect(res.merged.resume!.supported_locales).toEqual(
      expect.arrayContaining(['en']),
    )
    expect(res.merged.resume!.supported_locales.length).toBeLessThanOrEqual(2)
    expect(res.conflicts.length).toBeGreaterThan(0)
  })

  it('treats an array of id-less objects as one value too', () => {
    // A view's `sections` are objects with a key but no id, so there is no way
    // to say which element on one side corresponds to which on the other.
    // Merging them element-wise would blend two different section layouts.
    const base = storeWith([makeProject({ customer: { en: 'Shared' } })])
    base.views = [makeView({ id: 'v1', sections: buildViewSections() })]

    const mine = clone(base)
    mine.views[0].sections = mine.views[0].sections.map((s) => (
      s.key === 'projects' ? { ...s, detail: 'summary' as const } : s
    ))

    const theirs = clone(base)
    theirs.views[0].sections = theirs.views[0].sections.map((s) => (
      s.key === 'educations' ? { ...s, detail: 'off' as const } : s
    ))

    const res = mergeStores(base, mine, theirs)
    const merged = JSON.stringify(res.merged.views[0].sections)
    // Whole-array, one side or the other — never a blend of both edits.
    expect([JSON.stringify(mine.views[0].sections), JSON.stringify(theirs.views[0].sections)])
      .toContain(merged)
  })

  it('does not treat null as an object to merge into', () => {
    // `end: null` means ongoing and is everywhere in this model. Recursing
    // into it as if it were an object is a crash, not a merge.
    const p = makeProject({ customer: { en: 'Shared' }, end: null })
    const base = storeWith([p])

    const mine = clone(base)
    projectById(mine, p.id).end = { year: 2024, month: 6 }

    const theirs = clone(base)
    projectById(theirs, p.id).customer = { en: 'Renamed elsewhere' }

    const res = mergeStores(base, mine, theirs)
    expect(projectById(res.merged, p.id).end).toEqual({ year: 2024, month: 6 })
    expect(projectById(res.merged, p.id).customer).toEqual({ en: 'Renamed elsewhere' })
    expect(res.conflicts).toEqual([])
  })

  it('reports a null-against-a-date disagreement instead of walking into it', () => {
    // One side reopened the project (ongoing), the other closed it on a date.
    // Two different answers about the same field: a conflict to show, and the
    // one place a null and an object meet head-on.
    const p = makeProject({ customer: { en: 'Shared' }, end: { year: 2019, month: 1 } })
    const base = storeWith([p])

    const mine = clone(base)
    projectById(mine, p.id).end = null

    const theirs = clone(base)
    projectById(theirs, p.id).end = { year: 2020, month: 6 }

    const res = mergeStores(base, mine, theirs)
    expect(res.conflicts.length).toBeGreaterThan(0)
  })

  it('merges an emptied section against additions on the other side', () => {
    // An empty array still qualifies as element-wise mergeable — there is
    // nothing in it to contradict the other side's items.
    const base = storeWith([makeProject({ customer: { en: 'Shared' } })])

    const mine = clone(base)
    mine.projects = []

    const theirs = clone(base)
    theirs.projects.push(makeProject({ customer: { en: 'Theirs' } }))

    const res = mergeStores(base, mine, theirs)
    expect(res.merged.projects.map((p) => p.customer.en)).toEqual(['Theirs'])
    expect(res.conflicts).toEqual([])
  })

  it('accepts a deletion of an item we never touched', () => {
    const a = makeProject({ customer: { en: 'Keep' } })
    const b = makeProject({ customer: { en: 'Delete me' } })
    const base = storeWith([a, b])

    const mine = clone(base)
    projectById(mine, a.id).customer = { en: 'Keep, edited' }

    const theirs = clone(base)
    theirs.projects = theirs.projects.filter((p) => p.id !== b.id)

    const res = mergeStores(base, mine, theirs)

    expect(res.conflicts).toEqual([])
    expect(res.merged.projects.map((p) => p.id)).toEqual([a.id])
  })

  it('keeps OUR deletion when they left the item alone', () => {
    const a = makeProject()
    const b = makeProject()
    const base = storeWith([a, b])

    const mine = clone(base)
    mine.projects = mine.projects.filter((p) => p.id !== b.id)

    const theirs = clone(base)
    theirs.projects.push(makeProject({ customer: { en: 'Unrelated new' } }))

    const res = mergeStores(base, mine, theirs)

    expect(res.conflicts).toEqual([])
    expect(res.merged.projects.some((p) => p.id === b.id)).toBe(false)
    expect(res.merged.projects).toHaveLength(2)
  })

  it('merges edits in different SECTIONS', () => {
    const base = { ...emptyStore(), projects: [makeProject()], skills: [makeSkill()] }

    const mine = clone(base)
    mine.projects[0].customer = { en: 'Mine' }

    const theirs = clone(base)
    theirs.skills[0].name = { en: 'Their skill' }

    const res = mergeStores(base, mine, theirs)

    expect(res.conflicts).toEqual([])
    expect(res.merged.projects[0].customer).toEqual({ en: 'Mine' })
    expect(res.merged.skills[0].name).toEqual({ en: 'Their skill' })
  })

  it('merges profile fields edited on either side', () => {
    const base = { ...emptyStore(), resume: makeResume({ phone: null, email: 'a@b.c' }) }

    const mine = clone(base)
    mine.resume!.phone = '+47 123'

    const theirs = clone(base)
    theirs.resume!.email = 'new@b.c'

    const res = mergeStores(base, mine, theirs)

    expect(res.conflicts).toEqual([])
    expect(res.merged.resume!.phone).toBe('+47 123')
    expect(res.merged.resume!.email).toBe('new@b.c')
  })

  it('reports nothing when only the version moved and content is identical', () => {
    const base = storeWith([makeProject()])
    const res = mergeStores(base, clone(base), clone(base))

    expect(res.conflicts).toEqual([])
    expect(res.adopted).toBe(0)
    expect(res.merged).toEqual(base)
  })
})

describe('mergeStores — genuine overlap', () => {
  it('flags the same field changed differently on both sides', () => {
    const p = makeProject({ customer: { en: 'Acme' } })
    const base = storeWith([p])

    const mine = clone(base)
    projectById(mine, p.id).customer = { en: 'Acme Corp' }

    const theirs = clone(base)
    projectById(theirs, p.id).customer = { en: 'ACME AS' }

    const res = mergeStores(base, mine, theirs)

    expect(res.conflicts).toHaveLength(1)
    expect(res.conflicts[0]).toMatchObject({
      section: 'projects',
      itemId: p.id,
      field: 'customer.en',
      mine: 'Acme Corp',
      theirs: 'ACME AS',
    })
  })

  it('does NOT flag the same field changed to the same value', () => {
    const p = makeProject({ customer: { en: 'Acme' } })
    const base = storeWith([p])

    const mine = clone(base)
    projectById(mine, p.id).customer = { en: 'Acme AS' }

    const theirs = clone(base)
    projectById(theirs, p.id).customer = { en: 'Acme AS' }

    expect(mergeStores(base, mine, theirs).conflicts).toEqual([])
  })

  it('flags an item deleted on one side and edited on the other, both ways', () => {
    const p = makeProject({ customer: { en: 'Contested' } })
    const base = storeWith([p])

    const deletedByThem = clone(base)
    deletedByThem.projects = []
    const editedByMe = clone(base)
    projectById(editedByMe, p.id).description = { en: 'Still working on it' }

    const a = mergeStores(base, editedByMe, deletedByThem)
    expect(a.conflicts).toHaveLength(1)
    expect(a.conflicts[0]).toMatchObject({ itemId: p.id, theirs: 'deleted on the server' })
    // Our in-progress edit is kept in the merged output rather than vanishing.
    expect(a.merged.projects).toHaveLength(1)

    const b = mergeStores(base, deletedByThem, editedByMe)
    expect(b.conflicts).toHaveLength(1)
    expect(b.conflicts[0]).toMatchObject({ itemId: p.id, mine: 'deleted here' })
    // Someone else's edit is not silently thrown away by our delete either.
    expect(b.merged.projects).toHaveLength(1)
  })

  it('names the contested item so the modal can identify it', () => {
    const p = makeProject({ customer: { en: 'Norwegian Rail' } })
    const base = storeWith([p])
    const mine = clone(base); projectById(mine, p.id).customer = { en: 'NSB' }
    const theirs = clone(base); projectById(theirs, p.id).customer = { en: 'Vy' }

    expect(mergeStores(base, mine, theirs).conflicts[0].label).toBe('NSB')
  })

  it('reports only the contested value, not every difference', () => {
    // The whole point: five untouched-by-me changes plus one real clash yields
    // ONE thing to decide.
    const items = [0, 1, 2, 3, 4, 5].map((i) => makeProject({ customer: { en: `P${i}` } }))
    const base = storeWith(items)

    const mine = clone(base)
    projectById(mine, items[0].id).customer = { en: 'Mine wins' }

    const theirs = clone(base)
    for (const i of [1, 2, 3, 4, 5]) {
      projectById(theirs, items[i].id).description = { en: `Their edit ${i}` }
    }
    projectById(theirs, items[0].id).customer = { en: 'Theirs wins' }

    const res = mergeStores(base, mine, theirs)

    expect(res.conflicts).toHaveLength(1)
    expect(res.adopted).toBe(5)
  })
})

describe('mergeStores — structural tolerance', () => {
  it('survives a section array that one side does not have at all', () => {
    const base = emptyStore()
    const mine = clone(base)
    const theirs = clone(base)
    delete (theirs as Partial<ResumeStore>).skill_categories
    mine.skill_categories = [{ id: 'c1', name: { en: 'Cloud' }, sort_order: 0 }]

    const res = mergeStores(base, mine, theirs)
    expect(res.conflicts).toEqual([])
    expect(res.merged.skill_categories).toHaveLength(1)
  })

  it('does not treat a JSON round trip as a change', () => {
    const base = storeWith([makeProject()])
    const res = mergeStores(base, base, clone(base))
    expect(res.conflicts).toEqual([])
    expect(res.adopted).toBe(0)
  })
})
