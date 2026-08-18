import { describe, it, expect } from 'vitest'
import { overlayCanonicalNames, planPublish, registryKey, applyCanonicalLinks, linkedNameSnapshot } from '../src/lib/registrySync'
import { emptyStore, makeSkill, makeRole, makeIndustry, makeSkillCategory } from './fixtures'
import type { RegistryEntry, ResumeStore } from '../src/types'

function canon(over: Partial<RegistryEntry> & Pick<RegistryEntry, 'id' | 'kind' | 'name' | 'key'>): RegistryEntry {
  return { extra: {}, version: 1, updated_at: '2026-01-01T00:00:00Z', ...over }
}

describe('registryKey()', () => {
  it('applies the js-alias to skills only', () => {
    expect(registryKey('skill', 'React.js')).toBe(registryKey('skill', 'React'))
    expect(registryKey('role', 'Node js')).toBe('node js')
  })
})

describe('overlayCanonicalNames()', () => {
  it('returns the same store reference when there are no canonical entries', () => {
    const store = { ...emptyStore(), skills: [makeSkill({ canonical_id: 'c1' })] }
    expect(overlayCanonicalNames(store, [])).toBe(store)
  })

  it('returns the same store reference when nothing links', () => {
    const store = { ...emptyStore(), skills: [makeSkill({ name: { en: 'Go' } })] }
    const entries = [canon({ id: 'c1', kind: 'skill', name: { en: 'Golang' }, key: 'go' })]
    expect(overlayCanonicalNames(store, entries)).toBe(store)
  })

  it('reconciles a linked skill name from the canonical entry', () => {
    const store: ResumeStore = {
      ...emptyStore(),
      skills: [makeSkill({ id: 's1', name: { en: 'React.js' }, canonical_id: 'c1', proficiency: 4, is_highlighted: true })],
    }
    const entries = [canon({ id: 'c1', kind: 'skill', name: { en: 'React', no: 'React' }, key: 'react', extra: { classification: 'Frontend', category_id: 'cat9' } })]
    const out = overlayCanonicalNames(store, entries)

    expect(out).not.toBe(store)
    expect(out.skills[0].name).toEqual({ en: 'React', no: 'React' })       // identity from canonical
    expect(out.skills[0].classification).toBe('Frontend')
    expect(out.skills[0].category_id).toBe('cat9')
    // Per-person facts are untouched.
    expect(out.skills[0].proficiency).toBe(4)
    expect(out.skills[0].is_highlighted).toBe(true)
  })

  it('reconciles roles, industries and categories too', () => {
    const store: ResumeStore = {
      ...emptyStore(),
      roles: [makeRole({ id: 'r1', name: { en: 'Architect' }, canonical_id: 'cr' })],
      industries: [makeIndustry({ id: 'i1', name: { en: 'Finance' }, canonical_id: 'ci' })],
      skill_categories: [makeSkillCategory({ id: 'k1', name: { en: 'Cloud' }, canonical_id: 'ck' })],
    }
    const entries = [
      canon({ id: 'cr', kind: 'role', name: { en: 'Solution Architect' }, key: 'architect' }),
      canon({ id: 'ci', kind: 'industry', name: { en: 'Financial Services' }, key: 'finance' }),
      canon({ id: 'ck', kind: 'category', name: { en: 'Cloud & Infra' }, key: 'cloud' }),
    ]
    const out = overlayCanonicalNames(store, entries)
    expect(out.roles[0].name.en).toBe('Solution Architect')
    expect(out.industries[0].name.en).toBe('Financial Services')
    expect(out.skill_categories![0].name.en).toBe('Cloud & Infra')
  })

  it('leaves a dangling link (canonical entry deleted) showing the stored name', () => {
    const store = { ...emptyStore(), skills: [makeSkill({ name: { en: 'Kept' }, canonical_id: 'gone' })] }
    const out = overlayCanonicalNames(store, [canon({ id: 'other', kind: 'skill', name: { en: 'x' }, key: 'x' })])
    expect(out).toBe(store) // nothing resolved → unchanged reference
    expect(store.skills[0].name.en).toBe('Kept')
  })

  it('does not overwrite category_id when the canonical extra omits it', () => {
    const store = { ...emptyStore(), skills: [makeSkill({ category_id: 'local-cat', canonical_id: 'c1' })] }
    const entries = [canon({ id: 'c1', kind: 'skill', name: { en: 'Go' }, key: 'go', extra: {} })]
    const out = overlayCanonicalNames(store, entries)
    expect(out.skills[0].category_id).toBe('local-cat')
  })
})

describe('planPublish()', () => {
  it('creates a canonical entry for an unlinked skill with no match', () => {
    const store = { ...emptyStore(), skills: [makeSkill({ id: 's1', name: { en: 'Rust' }, classification: 'Systems' })] }
    const plan = planPublish(store, [])
    expect(plan.links).toEqual([])
    expect(plan.creates).toHaveLength(1)
    expect(plan.creates[0]).toMatchObject({ kind: 'skill', localIds: ['s1'], name: { en: 'Rust' }, extra: { classification: 'Systems' } })
  })

  it('links to an existing canonical entry with the same key', () => {
    const store = { ...emptyStore(), skills: [makeSkill({ id: 's1', name: { en: 'React.js' } })] }
    const entries = [canon({ id: 'c1', kind: 'skill', name: { en: 'React' }, key: 'react' })]
    const plan = planPublish(store, entries)
    expect(plan.creates).toEqual([])
    expect(plan.links).toEqual([{ kind: 'skill', localId: 's1', canonicalId: 'c1' }])
  })

  it('skips entries that are already linked (idempotent)', () => {
    const store = { ...emptyStore(), skills: [makeSkill({ id: 's1', name: { en: 'Go' }, canonical_id: 'c1' })] }
    expect(planPublish(store, [])).toEqual({ creates: [], links: [] })
  })

  it('keys an entry off its first non-empty locale, not the first slot', () => {
    // A Norwegian-only skill has an empty `en` slot. Keying off whatever comes
    // first would produce an empty key and either drop it or collide every
    // such entry into one.
    const store = {
      ...emptyStore(),
      skills: [
        makeSkill({ id: 's1', name: { en: '', no: 'Skydrift' } }),
        makeSkill({ id: 's2', name: { en: '', no: 'Testing' } }),
      ],
    }
    // Two distinct keys → two creates, not one coalesced pair.
    expect(planPublish(store, []).creates).toHaveLength(2)

    // …and the key is the Norwegian one, so an existing canonical entry under
    // that key is LINKED rather than duplicated.
    const existing = [canon({ id: 'c1', kind: 'skill', name: { no: 'Skydrift' }, key: 'skydrift' })]
    const plan = planPublish(store, existing)
    expect(plan.links).toEqual([{ kind: 'skill', localId: 's1', canonicalId: 'c1' }])
    expect(plan.creates).toHaveLength(1)
  })

  it('coalesces same-key siblings into ONE create with several localIds', () => {
    const store = {
      ...emptyStore(),
      skills: [makeSkill({ id: 's1', name: { en: 'React' } }), makeSkill({ id: 's2', name: { en: 'React.js' } })],
    }
    const plan = planPublish(store, [])
    expect(plan.creates).toHaveLength(1)
    expect(plan.creates[0].localIds.sort()).toEqual(['s1', 's2'])
  })

  it('plans across all four kinds', () => {
    const store: ResumeStore = {
      ...emptyStore(),
      skills: [makeSkill({ id: 's1', name: { en: 'Go' } })],
      roles: [makeRole({ id: 'r1', name: { en: 'Architect' } })],
      industries: [makeIndustry({ id: 'i1', name: { en: 'Finance' } })],
      skill_categories: [makeSkillCategory({ id: 'k1', name: { en: 'Cloud' } })],
    }
    const plan = planPublish(store, [])
    expect(plan.creates.map((c) => c.kind).sort()).toEqual(['category', 'industry', 'role', 'skill'])
  })

  it('does not include skill extras for non-skill kinds', () => {
    const store = { ...emptyStore(), roles: [makeRole({ id: 'r1', name: { en: 'SRE' } })] }
    expect(planPublish(store, []).creates[0].extra).toEqual({})
  })

  it('ignores an entry whose name is empty in every locale', () => {
    const store = { ...emptyStore(), skills: [makeSkill({ id: 's1', name: {} })] }
    expect(planPublish(store, [])).toEqual({ creates: [], links: [] })
  })
})

describe('applyCanonicalLinks()', () => {
  it('sets canonical_id on the named entries across all kinds', () => {
    const store = {
      ...emptyStore(),
      skills: [makeSkill({ id: 's1' }), makeSkill({ id: 's2' })],
      roles: [makeRole({ id: 'r1' })],
      industries: [makeIndustry({ id: 'i1' })],
      skill_categories: [makeSkillCategory({ id: 'k1' })],
    }
    const out = applyCanonicalLinks(store, { s1: 'c-s1', r1: 'c-r1', i1: 'c-i1', k1: 'c-k1' })
    expect(out.skills.find((s) => s.id === 's1')!.canonical_id).toBe('c-s1')
    expect(out.skills.find((s) => s.id === 's2')!.canonical_id).toBeUndefined() // untouched
    expect(out.roles[0].canonical_id).toBe('c-r1')
    expect(out.industries[0].canonical_id).toBe('c-i1')
    expect(out.skill_categories![0].canonical_id).toBe('c-k1')
  })

  it('returns the same store ref for an empty map', () => {
    const store = { ...emptyStore(), skills: [makeSkill({ id: 's1' })] }
    expect(applyCanonicalLinks(store, {})).toBe(store)
  })

  it('writes back an EMPTY categories array for a store that predates them', () => {
    // Publishing rebuilds all four registry arrays, and the result is what gets
    // saved. Anything but a real empty array here is persisted junk in a
    // registry the editor then tries to render.
    const s = emptyStore()
    s.skills = [makeSkill({ id: 's1' })]
    delete (s as unknown as Record<string, unknown>).skill_categories

    const out = applyCanonicalLinks(s, { s1: 'c-s1' })

    expect(out.skill_categories).toEqual([])
    expect(out.skills[0].canonical_id).toBe('c-s1')
  })
})

describe('linkedNameSnapshot()', () => {
  it('captures the name of only the linked entries, keyed by canonical id', () => {
    const store = {
      ...emptyStore(),
      skills: [
        makeSkill({ id: 's1', name: { en: 'Go' }, canonical_id: 'c1' }),
        makeSkill({ id: 's2', name: { en: 'Rust' } }), // unlinked → excluded
      ],
      roles: [makeRole({ id: 'r1', name: { en: 'SRE' }, canonical_id: 'cr' })],
    }
    const snap = linkedNameSnapshot(store)
    expect([...snap.keys()].sort()).toEqual(['c1', 'cr'])
    expect(snap.get('c1')).toEqual({ en: 'Go' })
    expect(snap.get('cr')).toEqual({ en: 'SRE' })
  })
})

describe('the canonical extras a skill carries', () => {
  const store = (over: Partial<Parameters<typeof makeSkill>[0]> = {}): ResumeStore => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 's1', name: { en: 'Go' }, canonical_id: 'c1', ...over })]
    return s
  }

  it('takes the canonical classification when it has one', () => {
    const out = overlayCanonicalNames(store({ classification: 'local' }), [
      canon({ id: 'c1', kind: 'skill', key: 'go', name: { en: 'Go' }, extra: { classification: 'language' } }),
    ])
    expect(out.skills[0].classification).toBe('language')
  })

  it('keeps the resume’s classification when the canonical entry has none', () => {
    const out = overlayCanonicalNames(store({ classification: 'local' }), [
      canon({ id: 'c1', kind: 'skill', key: 'go', name: { en: 'Go' } }),
    ])
    expect(out.skills[0].classification).toBe('local')
  })

  it('honours a canonical category of NULL — "deliberately uncategorised"', () => {
    // `undefined` means the canonical entry says nothing; null is a statement.
    const out = overlayCanonicalNames(store({ category_id: 'local-cat' }), [
      canon({ id: 'c1', kind: 'skill', key: 'go', name: { en: 'Go' }, extra: { category_id: null } }),
    ])
    expect(out.skills[0].category_id).toBeNull()
  })

  it('takes a canonical category id over the local one', () => {
    const out = overlayCanonicalNames(store({ category_id: 'local-cat' }), [
      canon({ id: 'c1', kind: 'skill', key: 'go', name: { en: 'Go' }, extra: { category_id: 'shared-cat' } }),
    ])
    expect(out.skills[0].category_id).toBe('shared-cat')
  })
})

describe('planPublish carries a skill’s extras onto the create', () => {
  const withSkill = (over: Partial<Parameters<typeof makeSkill>[0]>): ResumeStore => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 's1', name: { en: 'Go' }, canonical_id: null, ...over })]
    return s
  }

  it('includes the classification and category when the skill has them', () => {
    const plan = planPublish(withSkill({ classification: 'language', category_id: 'cat1' }), [])
    expect(plan.creates[0].extra).toEqual({ classification: 'language', category_id: 'cat1' })
  })

  it('omits an extra the skill does not have rather than publishing an empty one', () => {
    // A shared registry entry claiming classification: undefined would overwrite
    // a good value on the next machine to read it.
    expect(planPublish(withSkill({ classification: undefined, category_id: null }), []).creates[0].extra)
      .toEqual({})
    expect(planPublish(withSkill({ classification: 'language', category_id: null }), []).creates[0].extra)
      .toEqual({ classification: 'language' })
    expect(planPublish(withSkill({ classification: undefined, category_id: 'cat1' }), []).creates[0].extra)
      .toEqual({ category_id: 'cat1' })
  })

  it('publishes no extras for a role, even one carrying skill-shaped fields', () => {
    const s = emptyStore()
    s.roles = [makeRole({ id: 'r1', name: { en: 'Architect' }, canonical_id: null })]
    ;(s.roles[0] as unknown as Record<string, unknown>).classification = 'language'
    expect(planPublish(s, []).creates[0].extra).toEqual({})
  })

  it('plans nothing for a store whose registry arrays are missing entirely', () => {
    const s = emptyStore()
    delete (s as unknown as Record<string, unknown>).skill_categories
    expect(planPublish(s, []).creates).toEqual([])
  })
})

describe('linkedNameSnapshot covers every registry', () => {
  it('captures a linked entry of each kind, and skips the unlinked', () => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 's1', name: { en: 'Go' }, canonical_id: 'c-skill' }),
      makeSkill({ id: 's2', name: { en: 'Rust' }, canonical_id: null })]
    s.roles = [makeRole({ id: 'r1', name: { en: 'Architect' }, canonical_id: 'c-role' })]
    s.industries = [makeIndustry({ id: 'i1', name: { en: 'Energy' }, canonical_id: 'c-ind' })]
    s.skill_categories = [makeSkillCategory({ id: 'k1', name: { en: 'Languages' }, canonical_id: 'c-cat' })]
    const snap = linkedNameSnapshot(s)
    expect([...snap.keys()].sort()).toEqual(['c-cat', 'c-ind', 'c-role', 'c-skill'])
    expect(snap.get('c-cat')).toEqual({ en: 'Languages' })
  })

  it('works on a store with no categories array at all', () => {
    const s = emptyStore()
    delete (s as unknown as Record<string, unknown>).skill_categories
    expect(linkedNameSnapshot(s).size).toBe(0)
  })
})

describe('overlayCanonicalNames on partial stores and dangling links', () => {
  it('leaves a role, industry or category with a dangling link untouched', () => {
    // The canonical entry was deleted on another machine; the stored name is
    // all we have and must still render.
    const s = emptyStore()
    s.roles = [makeRole({ id: 'r1', name: { en: 'Architect' }, canonical_id: 'gone' })]
    s.industries = [makeIndustry({ id: 'i1', name: { en: 'Energy' }, canonical_id: 'gone' })]
    s.skill_categories = [makeSkillCategory({ id: 'k1', name: { en: 'Languages' }, canonical_id: 'gone' })]
    s.skills = [makeSkill({ id: 's1', name: { en: 'Go' }, canonical_id: 'c1' })]
    const out = overlayCanonicalNames(s, [canon({ id: 'c1', kind: 'skill', key: 'go', name: { en: 'Golang' } })])
    expect(out.skills[0].name).toEqual({ en: 'Golang' })
    expect(out.roles[0].name).toEqual({ en: 'Architect' })
    expect(out.industries[0].name).toEqual({ en: 'Energy' })
    expect(out.skill_categories?.[0].name).toEqual({ en: 'Languages' })
  })

  it('produces an EMPTY categories array for a store that has none', () => {
    // The overlay rebuilds every registry array, so a store predating skill
    // categories must come back with an empty one, not something invented.
    const s = emptyStore()
    s.skills = [makeSkill({ id: 's1', name: { en: 'Go' }, canonical_id: 'c1' })]
    delete (s as unknown as Record<string, unknown>).skill_categories
    const out = overlayCanonicalNames(s, [canon({ id: 'c1', kind: 'skill', key: 'go', name: { en: 'Golang' } })])
    expect(out.skill_categories).toEqual([])
  })
})
