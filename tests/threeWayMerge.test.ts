import { describe, it, expect } from 'vitest'
import { mergeStores, deepEqual } from '../src/lib/threeWayMerge'
import { emptyStore, makeProject, makeSkill, makeResume, makeView, makeKQ, makeCoverLetter, makeSkillCategory } from './fixtures'
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

/**
 * The conflict panel's value rendering.
 *
 * `show` had 23 mutants and 9 killed. It is what the user READS when deciding
 * whether to keep their edit or take the server's — a value rendered wrongly
 * makes an identical-looking pair, or an empty one, out of a real difference.
 */
describe('threeWayMerge — how a conflicting value is shown', () => {
  const conflictOn = (base: unknown, mine: unknown, theirs: unknown) => {
    const s = (title: unknown) => ({
      ...emptyStore(),
      key_qualifications: [{ ...makeKQ({ id: 'k1' }), summary: title } as never],
    })
    return mergeStores(s(base), s(mine), s(theirs)).conflicts
  }

  it('shows a localized value by its first non-empty text', () => {
    const c = conflictOn({ en: 'base' }, { en: 'mine' }, { en: 'theirs' })
    expect(c[0]).toMatchObject({ mine: 'mine', theirs: 'theirs' })
  })

  it('conflicts PER LOCALE, not per field', () => {
    // A localized value is descended into, so two sides editing different
    // language columns of one field do not collide — and when they edit the
    // same column, the panel names that column rather than the whole field.
    const c = conflictOn({ en: 'base' }, { en: '', no: 'mitt' }, { en: '', no: 'deres' })
    expect(c[0]).toMatchObject({ mine: 'mitt', theirs: 'deres' })
    expect(c[0].field).toContain('no')
  })

  it('renders an absent value as a dash, not as empty', () => {
    const c = conflictOn({ en: 'base' }, null, { en: 'theirs' })
    expect(c[0].mine).toBe('—')
  })

  it('counts array items, singular and plural', () => {
    // A list is summarised by its LENGTH — the panel has one line per field,
    // and dumping the contents there would make the choice unreadable.
    const s = (locales: string[]) =>
      ({ ...emptyStore(), resume: { ...makeResume(), supported_locales: locales } as never })
    const one = mergeStores(s(['en']), s(['en', 'no']), s(['en'])).conflicts
    const many = mergeStores(s(['en']), s(['en', 'no']), s(['en', 'se', 'dk'])).conflicts
    expect(one.length + many.length).toBeGreaterThan(0)
    expect((one[0] ?? many[0]).mine).toMatch(/^\d+ items?$/)
    if (many[0]) expect(many[0].theirs).toBe('3 items')
  })

  it('summarises a single-element list in the singular', () => {
    const s = (locales: string[]) =>
      ({ ...emptyStore(), resume: { ...makeResume(), supported_locales: locales } as never })
    const c = mergeStores(s([]), s(['en']), s(['en', 'no', 'se'])).conflicts
    expect(c[0].mine).toBe('1 item')
    expect(c[0].theirs).toBe('3 items')
  })
})


/**
 * deepEqual and the add/remove asymmetry.
 *
 * deepEqual decides whether a value CHANGED. A false positive means an edit is
 * silently discarded; a false negative means the user is asked about something
 * they did not touch. Both are worse than a merge conflict, because neither is
 * visible.
 */
describe('threeWayMerge — deepEqual', () => {
  it('is false for values of different types that look alike', () => {
    // '1' and 1 stringify the same but are not the same edit.
    expect(deepEqual(1, '1')).toBe(false)
    expect(deepEqual(true, 'true')).toBe(false)
    expect(deepEqual(0, false)).toBe(false)
  })

  it('treats null and undefined as distinct from a value, and from each other', () => {
    expect(deepEqual(null, undefined)).toBe(false)
    expect(deepEqual(null, '')).toBe(false)
    expect(deepEqual(undefined, 0)).toBe(false)
    expect(deepEqual(null, null)).toBe(true)
  })

  it('compares arrays by length AND by element', () => {
    expect(deepEqual([1, 2], [1, 2])).toBe(true)
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false)
    expect(deepEqual([1, 2], [2, 1])).toBe(false)
  })

  it('is false when only ONE side is an array', () => {
    expect(deepEqual([1], 1)).toBe(false)
    expect(deepEqual({ 0: 1 }, [1])).toBe(false)
  })

  it('compares plain objects by their keys and values', () => {
    expect(deepEqual({ en: 'a' }, { en: 'a' })).toBe(true)
    expect(deepEqual({ en: 'a' }, { en: 'b' })).toBe(false)
    expect(deepEqual({ en: 'a' }, { en: 'a', no: 'b' })).toBe(false)
  })

  it('compares nested structures all the way down', () => {
    expect(deepEqual({ a: [{ b: 1 }] }, { a: [{ b: 1 }] })).toBe(true)
    expect(deepEqual({ a: [{ b: 1 }] }, { a: [{ b: 2 }] })).toBe(false)
  })
})

describe('threeWayMerge — one-sided adds and removes', () => {
  const withProjects = (projects: Project[]): ResumeStore =>
    ({ ...emptyStore(), resume: makeResume({ full_name: 'X' }), projects })
  const p = (id: string, customer: string) => makeProject({ id, customer: { en: customer } })

  it('keeps an item only I added', () => {
    const base = withProjects([p('a', 'Acme')])
    const mine = withProjects([p('a', 'Acme'), p('b', 'Beta')])
    const theirs = withProjects([p('a', 'Acme')])
    const out = mergeStores(base, mine, theirs)
    expect(out.merged.projects.map((x) => x.id).sort()).toEqual(['a', 'b'])
    expect(out.conflicts).toEqual([])
  })

  it('keeps an item only THEY added', () => {
    const base = withProjects([p('a', 'Acme')])
    const mine = withProjects([p('a', 'Acme')])
    const theirs = withProjects([p('a', 'Acme'), p('c', 'Gamma')])
    const out = mergeStores(base, mine, theirs)
    expect(out.merged.projects.map((x) => x.id).sort()).toEqual(['a', 'c'])
    expect(out.conflicts).toEqual([])
  })

  it('keeps both sides’ additions', () => {
    const base = withProjects([p('a', 'Acme')])
    const mine = withProjects([p('a', 'Acme'), p('b', 'Beta')])
    const theirs = withProjects([p('a', 'Acme'), p('c', 'Gamma')])
    expect(mergeStores(base, mine, theirs).merged.projects.map((x) => x.id).sort())
      .toEqual(['a', 'b', 'c'])
  })

  it('honours a deletion made on one side only', () => {
    const base = withProjects([p('a', 'Acme'), p('b', 'Beta')])
    const mine = withProjects([p('a', 'Acme')])
    const theirs = withProjects([p('a', 'Acme'), p('b', 'Beta')])
    expect(mergeStores(base, mine, theirs).merged.projects.map((x) => x.id)).toEqual(['a'])
  })

  it('does not resurrect an item both sides deleted', () => {
    const base = withProjects([p('a', 'Acme'), p('b', 'Beta')])
    const mine = withProjects([p('a', 'Acme')])
    const theirs = withProjects([p('a', 'Acme')])
    expect(mergeStores(base, mine, theirs).merged.projects.map((x) => x.id)).toEqual(['a'])
  })
})

/**
 * `deepEqual` decides whether a 409 becomes a silent merge or a modal, so a false
 * "changed" manufactures exactly the spurious conflict this module exists to
 * remove — and a false "same" silently discards an edit. Both directions are
 * asserted per value shape.
 */
describe('deepEqual — same and not-same, per shape', () => {
  it('is true for identical primitives and false across types', () => {
    expect(deepEqual('a', 'a')).toBe(true)
    expect(deepEqual(1, 1)).toBe(true)
    expect(deepEqual(true, true)).toBe(true)
    expect(deepEqual('1', 1)).toBe(false)
    expect(deepEqual(0, false)).toBe(false)
    expect(deepEqual('a', 'b')).toBe(false)
  })

  it('treats null and undefined as equal to themselves only', () => {
    expect(deepEqual(null, null)).toBe(true)
    expect(deepEqual(undefined, undefined)).toBe(true)
    expect(deepEqual(null, undefined)).toBe(false)
    expect(deepEqual(null, '')).toBe(false)
    expect(deepEqual(undefined, '')).toBe(false)
    expect(deepEqual(null, {})).toBe(false)
    expect(deepEqual({}, null)).toBe(false)
  })

  it('compares arrays element by element, and length first', () => {
    expect(deepEqual([1, 2], [1, 2])).toBe(true)
    expect(deepEqual([1, 2], [2, 1])).toBe(false)
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false)
    expect(deepEqual([1, 2, 3], [1, 2])).toBe(false)
    expect(deepEqual([{ a: 1 }], [{ a: 1 }])).toBe(true)
    expect(deepEqual([{ a: 1 }], [{ a: 2 }])).toBe(false)
  })

  it('refuses an array against a non-array, either way round', () => {
    // Without the pair check, an array would fall through to the object branch
    // and compare by index keys.
    expect(deepEqual([1], { 0: 1 })).toBe(false)
    expect(deepEqual({ 0: 1 }, [1])).toBe(false)
    expect(deepEqual([], {})).toBe(false)
    expect(deepEqual([1], 'x')).toBe(false)
  })

  it('ignores key ORDER — a JSON round trip is not an edit', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
  })

  it('treats an absent key and an explicitly-undefined one as the same', () => {
    // A JSON round trip drops undefined-valued keys; calling that a change would
    // conflict every save made by a build that did not write the key.
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true)
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true)
    // A key with a real value is still a difference.
    expect(deepEqual({ a: 1 }, { a: 1, b: null })).toBe(false)
    expect(deepEqual({ a: 1 }, { a: 1, b: 0 })).toBe(false)
  })

  it('compares nested values, not just the top level', () => {
    expect(deepEqual({ a: { b: [1, { c: 'x' }] } }, { a: { b: [1, { c: 'x' }] } })).toBe(true)
    expect(deepEqual({ a: { b: [1, { c: 'x' }] } }, { a: { b: [1, { c: 'y' }] } })).toBe(false)
  })
})

describe('threeWayMerge — an absent optional section equals an empty one', () => {
  const store = (over: Record<string, unknown> = {}) => ({ ...emptyStore(), ...over }) as ResumeStore

  it('keeps a row added on one side when the other two never had the section', () => {
    // The commonest upgrade shape: this machine writes a section the server has
    // never seen. Treating "absent" as a different TYPE from "[]" would conflict
    // on the whole section, which the user cannot act on.
    const base = store()
    delete (base as unknown as Record<string, unknown>).skill_categories
    const mine = store({ skill_categories: [makeSkillCategory({ id: 'c1', name: { en: 'Languages' } })] })
    const theirs = store()
    delete (theirs as unknown as Record<string, unknown>).skill_categories

    const out = mergeStores(base, mine, theirs)
    expect(out.conflicts).toEqual([])
    expect(out.merged.skill_categories!.map((c) => c.id)).toEqual(['c1'])
  })

  it('takes a row the SERVER added in a section this build never wrote', () => {
    const base = store()
    delete (base as unknown as Record<string, unknown>).skill_categories
    const mine = store()
    delete (mine as unknown as Record<string, unknown>).skill_categories
    const theirs = store({ skill_categories: [makeSkillCategory({ id: 'c2', name: { en: 'Platforms' } })] })

    const out = mergeStores(base, mine, theirs)
    expect(out.conflicts).toEqual([])
    expect(out.merged.skill_categories!.map((c) => c.id)).toEqual(['c2'])
  })

  it('does not conflict when one side predates a section entirely', () => {
    // `skill_categories` is absent in older data and `[]` in newer; a type
    // mismatch here would raise a conflict the user cannot act on.
    const base = store()
    delete (base as unknown as Record<string, unknown>).skill_categories
    const mine = store({ skill_categories: [] })
    const theirs = store()
    delete (theirs as unknown as Record<string, unknown>).skill_categories

    const out = mergeStores(base, mine, theirs)
    expect(out.conflicts).toEqual([])
  })

  it('still merges an added row against a side that never had the section', () => {
    const base = store()
    delete (base as unknown as Record<string, unknown>).cover_letters
    const mine = store({ cover_letters: [makeCoverLetter({ id: 'cl1', name: 'Acme' })] })
    const theirs = store()
    delete (theirs as unknown as Record<string, unknown>).cover_letters

    const out = mergeStores(base, mine, theirs)
    expect(out.conflicts).toEqual([])
    expect(out.merged.cover_letters.map((c) => c.id)).toEqual(['cl1'])
  })
})

/**
 * How each side of a conflict READS in the modal.
 *
 * The panel lists "mine" against "theirs" per field, and the user decides from
 * those two strings alone. A value rendered as "[object Object]" or as an empty
 * cell is a choice made blind, so each value shape gets its own rendering.
 */
describe('mergeStores — the strings the conflict panel shows', () => {
  /** Force a conflict on one project field and return how both sides render. */
  const conflictOn = (field: string, mineValue: unknown, theirsValue: unknown) => {
    const project = (value: unknown) => ({
      ...makeProject({ id: 'p1', customer: { en: 'Acme' } }),
      [field]: value,
    })
    const store = (value: unknown) => ({ ...emptyStore(), projects: [project(value)] }) as ResumeStore
    const out = mergeStores(store('base value'), store(mineValue), store(theirsValue))
    const conflict = out.conflicts.find((c) => c.field.startsWith(field))
    return conflict ? { mine: conflict.mine, theirs: conflict.theirs } : null
  }

  it('shows a string as itself', () => {
    expect(conflictOn('project_url', 'https://mine', 'https://theirs'))
      .toEqual({ mine: 'https://mine', theirs: 'https://theirs' })
  })

  it('shows a number and a boolean as their value, not as blank', () => {
    expect(conflictOn('percent_allocated', 50, 80)).toEqual({ mine: '50', theirs: '80' })
    expect(conflictOn('starred', true, false)).toEqual({ mine: 'true', theirs: 'false' })
  })

  it('shows an absent value as a dash', () => {
    expect(conflictOn('project_url', null, 'https://theirs')?.mine).toBe('—')
    expect(conflictOn('project_url', undefined, 'https://theirs')?.mine).toBe('—')
  })

  it('counts the items in a list, with the singular spelled correctly', () => {
    const one = conflictOn('highlights', [{ en: 'a' }], [{ en: 'a' }, { en: 'b' }])
    expect(one).toEqual({ mine: '1 item', theirs: '2 items' })
  })

  it('conflicts per language slot when both sides are localized', () => {
    // The recursion descends into a localized value, so the panel asks about the
    // Norwegian column rather than about "the customer".
    const store = (customer: unknown) => ({
      ...emptyStore(),
      projects: [{ ...makeProject({ id: 'p1' }), customer }],
    }) as ResumeStore
    const out = mergeStores(
      store({ en: 'Base', no: 'Base' }),
      store({ en: 'Base', no: 'Mitt navn' }),
      store({ en: 'Base', no: 'Deira navn' }),
    )
    expect(out.conflicts.map((c) => c.field)).toEqual(['customer.no'])
    expect(out.conflicts[0]).toMatchObject({ mine: 'Mitt navn', theirs: 'Deira navn' })
  })

  it('shows an object against a primitive as its first readable string', () => {
    // A type mismatch is the one case the panel renders a whole object, and a
    // localized value is what that object usually is.
    expect(conflictOn('customer', { en: '', no: 'Mitt navn' }, 'their plain string'))
      .toEqual({ mine: 'Mitt navn', theirs: 'their plain string' })
  })

  it('says "(changed)" for an object with nothing readable in it', () => {
    expect(conflictOn('customer', { year: 2020 }, 'their plain string')?.mine).toBe('(changed)')
    expect(conflictOn('customer', { en: '   ' }, 'their plain string')?.mine).toBe('(changed)')
  })
})
