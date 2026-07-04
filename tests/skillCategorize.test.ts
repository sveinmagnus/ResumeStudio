import { describe, it, expect } from 'vitest'
import {
  autoCategorizeSkills, clearSkillCategories, effectiveSkillCategory,
  skillCategoryList, categoryNameIndex, assignSkillCategory, deleteSkillCategory,
  renameSkillCategory, moveSkillCategory,
} from '../src/lib/skillCategorize'
import { emptyStore, makeSkill, makeSkillCategory } from './fixtures'
import type { SkillDomains, SkillRelations } from '../src/lib/skillTaxonomy'

describe('effectiveSkillCategory', () => {
  it('resolves category_id through the name index', () => {
    const names = new Map([['cat1', 'Cloud']])
    expect(effectiveSkillCategory({ category_id: 'cat1' }, names)).toBe('Cloud')
  })

  it('reads as "Uncategorized" when unlinked or the link is stale', () => {
    const names = new Map([['cat1', 'Cloud']])
    expect(effectiveSkillCategory({ category_id: null }, names)).toBe('Uncategorized')
    expect(effectiveSkillCategory({ category_id: undefined }, names)).toBe('Uncategorized')
    expect(effectiveSkillCategory({ category_id: 'gone' }, names)).toBe('Uncategorized')
  })
})

describe('categoryNameIndex', () => {
  it('resolves each category id to its localized name, with a fallback', () => {
    const cats = [
      makeSkillCategory({ id: 'c1', name: { en: 'Cloud', no: 'Sky' } }),
      makeSkillCategory({ id: 'c2', name: {} }),
    ]
    const idx = categoryNameIndex(cats, 'en')
    expect(idx.get('c1')).toBe('Cloud')
    expect(idx.get('c2')).toBe('Uncategorized') // empty name falls back
    expect(categoryNameIndex(cats, 'no').get('c1')).toBe('Sky')
  })
})

const DOMAINS: SkillDomains = {
  TypeScript: 'Software Development',
  React: 'Software Development',
  Kubernetes: 'Cloud & Infrastructure',
  Terraform: 'Cloud & Infrastructure',
}

/** Resolve a skill's assigned category to its display name, for assertions. */
function catNameOf(store: { skill_categories?: { id: string; name: Record<string, string> }[] }, categoryId: string | null | undefined): string | null {
  if (!categoryId) return null
  return (store.skill_categories ?? []).find((c) => c.id === categoryId)?.name.en ?? null
}

describe('autoCategorizeSkills — exact tier', () => {
  it('fills a blank category from the library domain', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'ts', name: { en: 'TypeScript' } }))
    const { store: out, changed, assignments } = autoCategorizeSkills(store, DOMAINS)
    expect(changed).toBe(1)
    expect(catNameOf(out, out.skills[0].category_id)).toBe('Software Development')
    expect(assignments[0]).toMatchObject({ skill_id: 'ts', category: 'Software Development', tier: 'exact' })
  })

  it('matches case-insensitively on any locale value', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'k8s', name: { no: 'kubernetes' } }))
    const { store: out } = autoCategorizeSkills(store, DOMAINS)
    expect(catNameOf(out, out.skills[0].category_id)).toBe('Cloud & Infrastructure')
  })

  it('does NOT overwrite a manually-set category by default', () => {
    const store = emptyStore()
    const cat = makeSkillCategory({ id: 'my-frontend', name: { en: 'My Frontend' } })
    store.skill_categories = [cat]
    store.skills.push(makeSkill({ id: 'ts', name: { en: 'TypeScript' }, category_id: cat.id }))
    const { store: out, changed } = autoCategorizeSkills(store, DOMAINS)
    expect(changed).toBe(0)
    expect(out.skills[0].category_id).toBe(cat.id)
  })

  it('overwrites when opts.overwrite is set', () => {
    const store = emptyStore()
    const cat = makeSkillCategory({ id: 'my-frontend', name: { en: 'My Frontend' } })
    store.skill_categories = [cat]
    store.skills.push(makeSkill({ id: 'ts', name: { en: 'TypeScript' }, category_id: cat.id }))
    const { store: out, changed } = autoCategorizeSkills(store, DOMAINS, { overwrite: true })
    expect(changed).toBe(1)
    expect(catNameOf(out, out.skills[0].category_id)).toBe('Software Development')
  })

  it('leaves skills absent from the library uncategorized', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'x', name: { no: 'Løsningsarkitektur' } }))
    const { store: out, changed } = autoCategorizeSkills(store, DOMAINS)
    expect(changed).toBe(0)
    expect(out.skills[0].category_id ?? null).toBeNull()
  })

  it('reuses an existing category entity by name instead of creating a duplicate', () => {
    const store = emptyStore()
    const existing = makeSkillCategory({ id: 'sd', name: { en: 'Software Development' } })
    store.skill_categories = [existing]
    store.skills.push(makeSkill({ id: 'ts', name: { en: 'TypeScript' } }))
    const { store: out } = autoCategorizeSkills(store, DOMAINS)
    expect(out.skills[0].category_id).toBe('sd')
    expect(out.skill_categories).toHaveLength(1) // no duplicate created
  })
})

describe('autoCategorizeSkills — graph tier', () => {
  // "Løsningsarkitektur" isn't a library domain node (and won't fuzzy/semantic
  // match with no model), but it relates to skills that are — Cloud wins.
  const RELATIONS: SkillRelations = {
    Løsningsarkitektur: ['Kubernetes', 'Terraform', 'React'],
  }

  it('inherits the majority domain of graph neighbours', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'la', name: { no: 'Løsningsarkitektur' } }))
    const { store: out, changed, assignments } = autoCategorizeSkills(store, DOMAINS, { relations: RELATIONS })
    expect(changed).toBe(1)
    expect(catNameOf(out, out.skills[0].category_id)).toBe('Cloud & Infrastructure')
    expect(assignments[0].tier).toBe('graph')
  })

  it('breaks ties alphabetically', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'la', name: { no: 'Løsningsarkitektur' } }))
    // One Cloud, one Software → tie → "Cloud & Infrastructure" sorts first.
    const rel: SkillRelations = { Løsningsarkitektur: ['Kubernetes', 'React'] }
    const { store: out } = autoCategorizeSkills(store, DOMAINS, { relations: rel })
    expect(catNameOf(out, out.skills[0].category_id)).toBe('Cloud & Infrastructure')
  })

  it('prefers an exact match over the graph vote', () => {
    const store = emptyStore()
    // React is itself a library node (Software Development); the graph is ignored.
    store.skills.push(makeSkill({ id: 'r', name: { en: 'React' } }))
    const rel: SkillRelations = { React: ['Kubernetes', 'Terraform'] }
    const { store: out, assignments } = autoCategorizeSkills(store, DOMAINS, { relations: rel })
    expect(catNameOf(out, out.skills[0].category_id)).toBe('Software Development')
    expect(assignments[0].tier).toBe('exact')
  })

  it('leaves a graph node uncategorized when no neighbour has a domain', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'la', name: { no: 'Løsningsarkitektur' } }))
    const rel: SkillRelations = { Løsningsarkitektur: ['Some Unknown Skill'] }
    const { changed } = autoCategorizeSkills(store, DOMAINS, { relations: rel })
    expect(changed).toBe(0)
  })
})

describe('autoCategorizeSkills — widened matching tiers', () => {
  it('exact-matches formatting variants (normalization)', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'r', name: { en: 'React.js' } }))
    store.skills.push(makeSkill({ id: 'k', name: { en: 'Kubernetes 1.29' } }))
    const { store: out } = autoCategorizeSkills(store, DOMAINS)
    expect(catNameOf(out, out.skills.find((s) => s.id === 'r')!.category_id)).toBe('Software Development')
    expect(catNameOf(out, out.skills.find((s) => s.id === 'k')!.category_id)).toBe('Cloud & Infrastructure')
  })

  it('fuzzy-matches a typo, flagged as the fuzzy tier', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'k', name: { en: 'Kubernets' } }))
    const { assignments } = autoCategorizeSkills(store, DOMAINS)
    expect(assignments[0]).toMatchObject({ category: 'Cloud & Infrastructure', tier: 'fuzzy' })
  })

  it('semantic-matches by words when a model is supplied', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'c', name: { en: 'Cloud Infrastructure Automation' } }))
    const model = { cloud: { 'Cloud & Infrastructure': 10 } }
    const { assignments } = autoCategorizeSkills(store, DOMAINS, { model })
    expect(assignments[0]).toMatchObject({ category: 'Cloud & Infrastructure', tier: 'semantic' })
  })

  it('the semantic tier can be disabled', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'c', name: { en: 'Cloud Infrastructure Automation' } }))
    const model = { cloud: { 'Cloud & Infrastructure': 10 } }
    const { changed } = autoCategorizeSkills(store, DOMAINS, { model, semantic: false })
    expect(changed).toBe(0)
  })
})

describe('skill category persistence', () => {
  it('skillCategoryList sorts entities by sort_order (empty categories included)', () => {
    const store = emptyStore()
    store.skill_categories = [
      makeSkillCategory({ id: 'b', name: { en: 'B' }, sort_order: 1 }),
      makeSkillCategory({ id: 'a', name: { en: 'A' }, sort_order: 0 }),
    ]
    expect(skillCategoryList(store).map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('assignSkillCategory finds an existing category by id', () => {
    const store = emptyStore()
    const cat = makeSkillCategory({ id: 'cloud', name: { en: 'Cloud' } })
    store.skill_categories = [cat]
    store.skills.push(makeSkill({ id: 'a', name: { en: 'A' } }))
    const out = assignSkillCategory(store, 'a', 'cloud')
    expect(out.skills[0].category_id).toBe('cloud')
    expect(out.skill_categories).toHaveLength(1) // no duplicate
  })

  it('assignSkillCategory finds an existing category by name, case-insensitively', () => {
    const store = emptyStore()
    const cat = makeSkillCategory({ id: 'cloud', name: { en: 'Cloud' } })
    store.skill_categories = [cat]
    store.skills.push(makeSkill({ id: 'a', name: { en: 'A' } }))
    const out = assignSkillCategory(store, 'a', 'CLOUD')
    expect(out.skills[0].category_id).toBe('cloud')
    expect(out.skill_categories).toHaveLength(1)
  })

  it('assignSkillCategory creates a new category from free text and remembers it', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'a', name: { en: 'A' }, category_id: null }))
    const out = assignSkillCategory(store, 'a', 'Cloud & Infra', 'en')
    const newCat = out.skill_categories!.find((c) => c.id === out.skills[0].category_id)
    expect(newCat?.name.en).toBe('Cloud & Infra')
  })

  it('assignSkillCategory(null) clears the link without touching the category entity', () => {
    const store = emptyStore()
    const cat = makeSkillCategory({ id: 'cloud', name: { en: 'Cloud' } })
    store.skill_categories = [cat]
    store.skills.push(makeSkill({ id: 'a', name: { en: 'A' }, category_id: 'cloud' }))
    const out = assignSkillCategory(store, 'a', null)
    expect(out.skills[0].category_id).toBeNull()
    expect(out.skill_categories).toEqual([cat]) // still there
  })

  it('an emptied category persists (not removed on unassign)', () => {
    const store = emptyStore()
    const cat = makeSkillCategory({ id: 'cloud', name: { en: 'Cloud' } })
    store.skill_categories = [cat]
    store.skills.push(makeSkill({ id: 'a', name: { en: 'A' }, category_id: 'cloud' }))
    const out = assignSkillCategory(store, 'a', null)
    expect(skillCategoryList(out).map((c) => c.id)).toEqual(['cloud'])
  })

  it('deleteSkillCategory removes the entity and unassigns its skills', () => {
    const store = emptyStore()
    const cloud = makeSkillCategory({ id: 'cloud', name: { en: 'Cloud' } })
    const data = makeSkillCategory({ id: 'data', name: { en: 'Data' } })
    store.skill_categories = [cloud, data]
    store.skills.push(makeSkill({ id: 'a', name: { en: 'A' }, category_id: 'cloud' }))
    store.skills.push(makeSkill({ id: 'b', name: { en: 'B' }, category_id: 'data' }))
    const out = deleteSkillCategory(store, 'cloud')
    expect(out.skill_categories!.map((c) => c.id)).toEqual(['data'])
    expect(out.skills.find((s) => s.id === 'a')!.category_id).toBeNull()
    expect(out.skills.find((s) => s.id === 'b')!.category_id).toBe('data')
  })

  it('deleteSkillCategory is a no-op for an unknown id', () => {
    const store = emptyStore()
    const cat = makeSkillCategory({ id: 'cloud' })
    store.skill_categories = [cat]
    expect(deleteSkillCategory(store, 'nope')).toBe(store)
  })

  it('renameSkillCategory updates the localized name', () => {
    const store = emptyStore()
    store.skill_categories = [makeSkillCategory({ id: 'cloud', name: { en: 'Cloud' } })]
    const out = renameSkillCategory(store, 'cloud', { en: 'Cloud Computing', no: 'Sky' })
    expect(out.skill_categories![0].name).toEqual({ en: 'Cloud Computing', no: 'Sky' })
  })

  it('moveSkillCategory reorders and renumbers sort_order', () => {
    const store = emptyStore()
    store.skill_categories = [
      makeSkillCategory({ id: 'a', sort_order: 0 }),
      makeSkillCategory({ id: 'b', sort_order: 1 }),
      makeSkillCategory({ id: 'c', sort_order: 2 }),
    ]
    const out = moveSkillCategory(store, 'c', 'up')
    expect(out.skill_categories!.map((c) => c.id)).toEqual(['a', 'c', 'b'])
    expect(out.skill_categories!.map((c) => c.sort_order)).toEqual([0, 1, 2])
  })

  it('moveSkillCategory is a no-op at the boundary', () => {
    const store = emptyStore()
    store.skill_categories = [makeSkillCategory({ id: 'a', sort_order: 0 }), makeSkillCategory({ id: 'b', sort_order: 1 })]
    expect(moveSkillCategory(store, 'a', 'up')).toBe(store)
  })
})

describe('clearSkillCategories', () => {
  it('clears the linked category on the listed skills only', () => {
    const store = emptyStore()
    store.skill_categories = [
      makeSkillCategory({ id: 'frontend' }), makeSkillCategory({ id: 'data' }), makeSkillCategory({ id: 'cloud' }),
    ]
    store.skills.push(makeSkill({ id: 'a', name: { en: 'A' }, category_id: 'frontend' }))
    store.skills.push(makeSkill({ id: 'b', name: { en: 'B' }, category_id: 'data' }))
    store.skills.push(makeSkill({ id: 'c', name: { en: 'C' }, category_id: 'cloud' }))
    const { store: out, cleared } = clearSkillCategories(store, ['a', 'b'])
    expect(cleared).toBe(2)
    expect(out.skills.find((s) => s.id === 'a')!.category_id).toBeNull()
    expect(out.skills.find((s) => s.id === 'b')!.category_id).toBeNull()
    expect(out.skills.find((s) => s.id === 'c')!.category_id).toBe('cloud') // not listed
  })

  it('ignores skills that have no linked category (no-op count)', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'a', name: { en: 'A' }, category_id: null }))
    const { store: out, cleared } = clearSkillCategories(store, ['a'])
    expect(cleared).toBe(0)
    expect(out).toBe(store)
  })

  it('does not mutate the input store', () => {
    const store = emptyStore()
    store.skill_categories = [makeSkillCategory({ id: 'frontend' })]
    store.skills.push(makeSkill({ id: 'a', name: { en: 'A' }, category_id: 'frontend' }))
    clearSkillCategories(store, ['a'])
    expect(store.skills[0].category_id).toBe('frontend')
  })

  it('after clearing, the skill is eligible for auto-categorization again', () => {
    const store = emptyStore()
    // Wrongly pinned to a manual category the auto-categorizer would skip.
    const misc = makeSkillCategory({ id: 'misc', name: { en: 'Misc' } })
    store.skill_categories = [misc]
    store.skills.push(makeSkill({ id: 'ts', name: { en: 'TypeScript' }, category_id: 'misc' }))
    const pinned = autoCategorizeSkills(store, DOMAINS)
    expect(pinned.changed).toBe(0) // manual category is respected
    const cleared = clearSkillCategories(store, ['ts']).store
    const recat = autoCategorizeSkills(cleared, DOMAINS)
    expect(recat.changed).toBe(1)
    expect(catNameOf(recat.store, recat.store.skills[0].category_id)).toBe('Software Development')
  })
})

describe('autoCategorizeSkills — invariants', () => {
  it('is a no-op with an empty domain map', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'ts', name: { en: 'TypeScript' } }))
    const { store: out, changed } = autoCategorizeSkills(store, {})
    expect(changed).toBe(0)
    expect(out).toBe(store)
  })

  it('does not mutate the input store', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'ts', name: { en: 'TypeScript' } }))
    autoCategorizeSkills(store, DOMAINS)
    expect(store.skills[0].category_id ?? null).toBeNull()
  })
})
