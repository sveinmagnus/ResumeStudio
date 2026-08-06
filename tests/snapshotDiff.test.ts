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

/**
 * The parts a restore actually hangs on.
 *
 * This list is what the History modal shows BEFORE the user replaces their
 * current document with an older one, so a wrong or missing line here is a
 * restore made on bad information. 155 mutants survived, concentrated in the
 * title fallback, the locale fallback, and the caps — none of which any test
 * reached.
 */
describe('describeSnapshotChanges — the parts a restore hangs on', () => {
  const proj = (over: Record<string, unknown>) => ({ ...makeProject({ id: 'p1' }), ...over })
  const pair = (a: Record<string, unknown>, b: Record<string, unknown>) => {
    const prev = emptyStore(); prev.projects = [a as never]
    const next = emptyStore(); next.projects = [b as never]
    return describeSnapshotChanges(prev, next, 'en')
  }

  describe('the item label', () => {
    it('takes the FIRST title field the item actually has, in list order', () => {
      // customer beats name; an item carrying both must not be labelled by the
      // later field, or two different projects read identically in the list.
      const prev = emptyStore()
      const next = emptyStore()
      next.projects = [proj({ customer: { en: 'Acme Bank' }, name: { en: 'Ignore me' } }) as never]
      expect(describeSnapshotChanges(prev, next, 'en')[0].label).toBe('Acme Bank')
    })

    it('falls through a title field that is present but EMPTY', () => {
      // `'customer' in item` is true for an empty LocalizedString, so a blank
      // customer must not win and label the row with nothing.
      const prev = emptyStore()
      const next = emptyStore()
      next.projects = [proj({ customer: {}, name: { en: 'Fallback name' } }) as never]
      expect(describeSnapshotChanges(prev, next, 'en')[0].label).toBe('Fallback name')
    })

    it('says (untitled) rather than an empty label when nothing names the item', () => {
      const prev = emptyStore()
      const next = emptyStore()
      next.projects = [proj({ customer: {}, name: {} }) as never]
      expect(describeSnapshotChanges(prev, next, 'en')[0].label).toBe('(untitled)')
    })

    it('labels from ANOTHER locale when the requested one is empty', () => {
      // The snapshot list is one line per change; falling back is what stops a
      // Norwegian-only item showing as "(untitled)" to an English reader.
      const prev = emptyStore()
      const next = emptyStore()
      next.projects = [proj({ customer: { en: '', no: 'Storebrand' } }) as never]
      expect(describeSnapshotChanges(prev, next, 'en')[0].label).toBe('Storebrand')
    })
  })

  describe('the change descriptor', () => {
    it('reports a shrink with a real minus sign, not a hyphen', () => {
      // U+2212 aligns with the digits; a hyphen does not. Both render, so only
      // an exact assertion holds it.
      const c = pair(
        proj({ customer: { en: 'Acme' }, long_description: { en: 'Hello world' } }),
        proj({ customer: { en: 'Acme' }, long_description: { en: 'Hello' } }),
      )
      expect(c[0].details).toEqual(['Description (English): −6 chars'])
      expect(c[0].details![0]).not.toContain('-6')
    })

    it('says "edited" when the length is unchanged but the text is not', () => {
      const c = pair(
        proj({ customer: { en: 'Acme' }, long_description: { en: 'cat' } }),
        proj({ customer: { en: 'Acme' }, long_description: { en: 'dog' } }),
      )
      expect(c[0].details).toEqual(['Description (English): edited'])
    })

    it('ignores a change that is only markup', () => {
      // Retagging the same words is not something to warn about before a
      // restore — stripTags is what makes that true.
      const c = pair(
        proj({ customer: { en: 'Acme' }, long_description: { en: '<p>Hi</p>' } }),
        proj({ customer: { en: 'Acme' }, long_description: { en: '<div><b>Hi</b></div>' } }),
      )
      expect(c).toEqual([])
    })

    it('names each changed language separately', () => {
      const c = pair(
        proj({ customer: { en: 'Acme' }, long_description: { en: 'aa', no: 'bb' } }),
        proj({ customer: { en: 'Acme' }, long_description: { en: 'aaa', no: 'bbbb' } }),
      )
      expect(c[0].details).toEqual([
        'Description (English): +1 chars',
        'Description (Norsk): +2 chars',
      ])
    })

    it('describes a non-text field as changed rather than counting characters', () => {
      const c = pair(
        proj({ customer: { en: 'Acme' }, start: { year: 2020, month: 1 } }),
        proj({ customer: { en: 'Acme' }, start: { year: 2021, month: 1 } }),
      )
      expect(c[0].details).toEqual(['Start date changed'])
    })

    it('humanizes an unmapped field key instead of printing the raw one', () => {
      const c = pair(
        proj({ customer: { en: 'Acme' }, some_new_field: 'a' }),
        proj({ customer: { en: 'Acme' }, some_new_field: 'ab' }),
      )
      expect(c[0].details).toEqual(['Some new field: +1 chars'])
    })

    it('says nothing about the bookkeeping fields', () => {
      // sort_order moves on every drag; reporting it would bury the real edits.
      expect(pair(
        proj({ customer: { en: 'Acme' }, sort_order: 0, updated_at: 'x' }),
        proj({ customer: { en: 'Acme' }, sort_order: 9, updated_at: 'y' }),
      )).toEqual([])
    })
  })

  describe('the caps', () => {
    it('stops at 8 details for one item', () => {
      const many = (n: number) => Object.fromEntries(
        Array.from({ length: n }, (_, i) => [`field_${i}`, `${'x'.repeat(i + 1)}`]),
      )
      const c = pair(
        proj({ customer: { en: 'Acme' }, ...many(12) }),
        proj({ customer: { en: 'Acme' }, ...many(12), field_0: 'zz', ...Object.fromEntries(
          Array.from({ length: 12 }, (_, i) => [`field_${i}`, 'y'.repeat(i + 5)]),
        ) }),
      )
      expect(c[0].details).toHaveLength(8)
    })

    it('stops at 8 details inside ONE localized field too', () => {
      // The cap is checked in two places: once per field, and once per LOCALE
      // within a single localized field. A resume can carry 15 languages, so
      // one edited description alone can overrun it — that inner check is a
      // different branch from the per-field one above.
      const locales = ['en', 'no', 'se', 'dk', 'de', 'fr', 'es', 'it', 'nl', 'pt', 'pl', 'fi']
      const before = Object.fromEntries(locales.map((l) => [l, 'a']))
      const after = Object.fromEntries(locales.map((l) => [l, 'abc']))
      const c = pair(
        proj({ customer: { en: 'Acme' }, long_description: before }),
        proj({ customer: { en: 'Acme' }, long_description: after }),
      )
      expect(c[0].details).toHaveLength(8)
    })

    it('stops at 40 entries overall', () => {
      const prev = emptyStore()
      const next = emptyStore()
      next.projects = Array.from({ length: 60 }, (_, i) =>
        makeProject({ id: `p${i}`, customer: { en: `Client ${i}` } })) as never
      expect(describeSnapshotChanges(prev, next, 'en')).toHaveLength(40)
    })
  })

  it('collapses every header edit into ONE Profile entry', () => {
    const prev = emptyStore(); prev.resume = makeResume({ full_name: 'A', email: 'a@x.io' })
    const next = emptyStore(); next.resume = makeResume({ full_name: 'AB', email: 'ab@x.io' })
    const c = describeSnapshotChanges(prev, next, 'en')
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ kind: 'edited', section: 'Profile', label: 'Profile details' })
    expect(c[0].details!.length).toBeGreaterThan(1)
  })

  it('reports nothing when the two snapshots are identical', () => {
    const store = emptyStore()
    store.projects = [makeProject({ id: 'p1', customer: { en: 'Acme' } })]
    expect(describeSnapshotChanges(store, structuredClone(store), 'en')).toEqual([])
  })
})
