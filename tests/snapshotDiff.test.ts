import { describe, it, expect } from 'vitest'
import { describeSnapshotChanges } from '../src/lib/snapshotDiff'
import {
  emptyStore, makeProject, makeRole, makeResume, makeSkill, makeSkillCategory, makeWork,
  makeView,
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

describe('describeSnapshotChanges — per-field detail', () => {
  /**
   * The detail line is what tells a user whether restoring a snapshot loses
   * work, so it has to name the field, the language and the direction of the
   * change. Each of those is a separate step that can silently stop working.
   */
  const details = (before: unknown, after: unknown, key = 'long_description'): string[] => {
    const prev = emptyStore()
    const next = emptyStore()
    prev.projects = [makeProject({ id: 'p1', customer: { en: 'Acme' }, [key]: before } as never)]
    next.projects = [makeProject({ id: 'p1', customer: { en: 'Acme' }, [key]: after } as never)]
    const out = describeSnapshotChanges(prev, next, 'en')
    return out.length ? out[0].details ?? [] : []
  }

  it('reports growth and shrinkage in characters, and an equal-length edit as "edited"', () => {
    expect(details({ en: 'abc' }, { en: 'abcdef' })[0]).toContain('+3 chars')
    expect(details({ en: 'abcdef' }, { en: 'abc' })[0]).toContain('−3 chars')
    expect(details({ en: 'abc' }, { en: 'xyz' })[0]).toContain('edited')
  })

  it('counts VISIBLE text, so a markup-only change reports no change at all', () => {
    // Wrapping a paragraph in <strong> adds characters to the value but none to
    // what the reader sees.
    expect(details({ en: '<p>abc</p>' }, { en: '<p><strong>abc</strong></p>' })).toEqual([])
    expect(details({ en: '<p>abc</p>' }, { en: '<p>abc&nbsp;d</p>' })[0]).toContain('+2 chars')
  })

  it('names the language of the column that changed', () => {
    const out = details({ en: 'abc', no: 'abc' }, { en: 'abc', no: 'abcdef' })
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('(Norsk)')
  })

  it('names the field with a human label, falling back to the key humanised', () => {
    expect(details({ en: 'a' }, { en: 'ab' })[0]).toMatch(/^Description/)
    // No label entry for this key, so the key itself is title-cased.
    expect(details('x', 'xy', 'project_url')[0]).toMatch(/^Project url/)
  })

  it('reports a plain string field, treating an absent side as empty', () => {
    expect(details(undefined, 'https://x.no', 'project_url')[0]).toContain('+12 chars')
    expect(details('https://x.no', undefined, 'project_url')[0]).toContain('−12 chars')
  })

  it('reports a non-text change as simply "changed"', () => {
    expect(details({ year: 2020, month: 1 }, { year: 2021, month: 1 }, 'start'))
      .toEqual(['Start date changed'])
  })

  it('says nothing about the bookkeeping keys', () => {
    // sort_order moves on every drag, and an image is not a described change.
    expect(details(1, 2, 'sort_order')).toEqual([])
    expect(details(false, true, 'starred')).toEqual([])
    expect(details('2020-01-01', '2021-01-01', 'updated_at')).toEqual([])
  })

  it('caps the detail list rather than printing every column of a rewritten item', () => {
    const many = (n: number) => {
      const ls: Record<string, string> = {}
      for (const loc of ['en', 'no', 'se', 'dk', 'de', 'fr', 'es', 'it', 'nl', 'pt']) ls[loc] = 'x'.repeat(n)
      return ls
    }
    const out = details(many(3), many(9))
    expect(out.length).toBe(8)
  })
})

describe('describeSnapshotChanges — how an item is titled', () => {
  const titleOf = (over: Record<string, unknown>): string => {
    const prev = emptyStore()
    const next = emptyStore()
    next.projects = [makeProject({ id: 'p1', ...over } as never)]
    return describeSnapshotChanges(prev, next, 'en')[0].label
  }

  it('prefers the requested locale, then any language that has text', () => {
    expect(titleOf({ customer: { en: 'Acme', no: 'Acme NO' } })).toBe('Acme')
    expect(titleOf({ customer: { no: 'Bare norsk' } })).toBe('Bare norsk')
  })

  it('skips a locale slot that is present but blank', () => {
    expect(titleOf({ customer: { en: '   ', no: 'Norsk' } })).toBe('Norsk')
  })

  it('falls through to the next title field when the first has no text', () => {
    const prev = emptyStore()
    const next = emptyStore()
    next.work_experiences = [makeWork({ id: 'w1', employer: {}, role_title: { en: 'Architect' } })]
    expect(describeSnapshotChanges(prev, next, 'en')[0].label).toBe('Architect')
  })

  it('says (untitled) when nothing identifies the item', () => {
    expect(titleOf({ customer: {}, description: {} })).toBe('(untitled)')
  })

  it('does not mistake a non-localized object for a title', () => {
    // { year: 2020 } has a non-string value, so it is not a localized string.
    expect(titleOf({ customer: { year: 2020 } as never, description: {} })).toBe('(untitled)')
  })
})

describe('describeSnapshotChanges — malformed values never reach a renderer', () => {
  const two = (before: unknown, after: unknown, key = 'start'): ReturnType<typeof describeSnapshotChanges> => {
    const prev = emptyStore()
    const next = emptyStore()
    prev.projects = [makeProject({ id: 'p1', customer: { en: 'Acme' }, [key]: before } as never)]
    next.projects = [makeProject({ id: 'p1', customer: { en: 'Acme' }, [key]: after } as never)]
    return describeSnapshotChanges(prev, next, 'en')
  }

  it('does not treat an EMPTY object as a set of language columns', () => {
    // Walking {} as localized would read the other side's non-string values as
    // text and throw on them.
    expect(two({}, { year: 2021, month: 1 })[0].details).toEqual(['Start date changed'])
  })

  it('does not treat a MIXED object as language columns either', () => {
    // Some values are strings and some are not, so it is structured data.
    expect(two({ label: 'x', count: 3 }, { label: 'y', count: 3 }, 'meta')[0].details)
      .toEqual(['Meta changed'])
  })

  it('describes a localized field that did not exist before as a text change', () => {
    // Only one side is localized on an added field; treating that as structured
    // data would report "changed" and lose the size of what was written.
    const out = two(undefined, { en: 'abc' }, 'long_description')
    expect(out[0].details).toEqual(['Description (English): +3 chars'])
  })

  it('skips a section whose value is not an array at all', () => {
    const prev = emptyStore()
    const next = emptyStore()
    ;(next as unknown as Record<string, unknown>).courses = 'not an array'
    expect(describeSnapshotChanges(prev, next, 'en')).toEqual([])
  })

  it('reports nothing for two identical stores that DO have content', () => {
    const store = () => {
      const s = emptyStore()
      s.projects = [makeProject({ id: 'p1', customer: { en: 'Acme' }, long_description: { en: 'text' } })]
      return s
    }
    expect(describeSnapshotChanges(store(), store(), 'en')).toEqual([])
  })

  it('titles a view by its PLAIN-string name', () => {
    // Most sections title from a LocalizedString; a view's name is a bare string,
    // and reading only localized values would leave every view "(untitled)".
    const prev = emptyStore()
    const next = emptyStore()
    next.views = [makeView({ id: 'v1', name: 'Client A' })]
    expect(describeSnapshotChanges(prev, next, 'en')[0])
      .toEqual({ kind: 'added', section: 'View', label: 'Client A' })
  })

  it('titles by the requested locale even when another language is stored first', () => {
    const prev = emptyStore()
    const next = emptyStore()
    next.projects = [makeProject({ id: 'p1', customer: { no: 'Norsk navn', en: 'English name' } })]
    expect(describeSnapshotChanges(next, prev, 'en')[0].label).toBe('English name')
  })
})

describe('the item diff reports only what actually changed', () => {
  it('says nothing about an item that is byte-identical', () => {
    // Every restore compares two whole snapshots; reporting an unchanged item
    // as edited makes the history list useless on a large CV.
    const a = { ...emptyStore(), projects: [makeProject({ id: 'p1', customer: { en: 'Acme' } })] }
    const b = { ...emptyStore(), projects: [makeProject({ id: 'p1', customer: { en: 'Acme' } })] }
    const changes = describeSnapshotChanges(a as never, b as never, 'en')
    expect(changes.filter((c) => c.kind === 'edited')).toEqual([])
  })

  it('reports an item whose text changed', () => {
    const a = { ...emptyStore(), projects: [makeProject({ id: 'p1', customer: { en: 'Acme' } })] }
    const b = { ...emptyStore(), projects: [makeProject({ id: 'p1', customer: { en: 'Beta' } })] }
    expect(describeSnapshotChanges(a as never, b as never, 'en').some((c) => c.kind === 'edited')).toBe(true)
  })
})
