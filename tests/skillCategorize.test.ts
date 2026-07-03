import { describe, it, expect } from 'vitest'
import {
  autoCategorizeSkills, clearSkillCategories, effectiveSkillCategory,
} from '../src/lib/skillCategorize'
import { emptyStore, makeSkill } from './fixtures'
import type { SkillDomains, SkillRelations } from '../src/lib/skillTaxonomy'

describe('effectiveSkillCategory', () => {
  it('returns the explicit category when set (including a literal "Technical")', () => {
    expect(effectiveSkillCategory({ category: 'Cloud' })).toBe('Cloud')
    expect(effectiveSkillCategory({ category: 'Technical' })).toBe('Technical')
  })

  it('reads as "Uncategorized" when the category is empty (no type fallback)', () => {
    expect(effectiveSkillCategory({ category: null })).toBe('Uncategorized')
    expect(effectiveSkillCategory({ category: '' })).toBe('Uncategorized')
    expect(effectiveSkillCategory({ category: '  ' })).toBe('Uncategorized')
    expect(effectiveSkillCategory({ category: undefined })).toBe('Uncategorized')
  })
})

const DOMAINS: SkillDomains = {
  TypeScript: 'Software Development',
  React: 'Software Development',
  Kubernetes: 'Cloud & Infrastructure',
  Terraform: 'Cloud & Infrastructure',
}

describe('autoCategorizeSkills — Tier 1 (exact match)', () => {
  it('fills a blank category from the library domain', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'ts', name: { en: 'TypeScript' } }))
    const { store: out, changed, assignments } = autoCategorizeSkills(store, DOMAINS)
    expect(changed).toBe(1)
    expect(out.skills[0].category).toBe('Software Development')
    expect(assignments[0]).toMatchObject({ skill_id: 'ts', category: 'Software Development', tier: 'exact' })
  })

  it('matches case-insensitively on any locale value', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'k8s', name: { no: 'kubernetes' } }))
    const { store: out } = autoCategorizeSkills(store, DOMAINS)
    expect(out.skills[0].category).toBe('Cloud & Infrastructure')
  })

  it('does NOT overwrite a manually-set category by default', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'ts', name: { en: 'TypeScript' }, category: 'My Frontend' }))
    const { store: out, changed } = autoCategorizeSkills(store, DOMAINS)
    expect(changed).toBe(0)
    expect(out.skills[0].category).toBe('My Frontend')
  })

  it('overwrites when opts.overwrite is set', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'ts', name: { en: 'TypeScript' }, category: 'My Frontend' }))
    const { store: out, changed } = autoCategorizeSkills(store, DOMAINS, { overwrite: true })
    expect(changed).toBe(1)
    expect(out.skills[0].category).toBe('Software Development')
  })

  it('leaves skills absent from the library uncategorized', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'x', name: { no: 'Løsningsarkitektur' } }))
    const { store: out, changed } = autoCategorizeSkills(store, DOMAINS)
    expect(changed).toBe(0)
    expect(out.skills[0].category ?? null).toBeNull()
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
    expect(out.skills[0].category).toBe('Cloud & Infrastructure')
    expect(assignments[0].tier).toBe('graph')
  })

  it('breaks ties alphabetically', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'la', name: { no: 'Løsningsarkitektur' } }))
    // One Cloud, one Software → tie → "Cloud & Infrastructure" sorts first.
    const rel: SkillRelations = { Løsningsarkitektur: ['Kubernetes', 'React'] }
    const { store: out } = autoCategorizeSkills(store, DOMAINS, { relations: rel })
    expect(out.skills[0].category).toBe('Cloud & Infrastructure')
  })

  it('prefers an exact match over the graph vote', () => {
    const store = emptyStore()
    // React is itself a library node (Software Development); the graph is ignored.
    store.skills.push(makeSkill({ id: 'r', name: { en: 'React' } }))
    const rel: SkillRelations = { React: ['Kubernetes', 'Terraform'] }
    const { store: out, assignments } = autoCategorizeSkills(store, DOMAINS, { relations: rel })
    expect(out.skills[0].category).toBe('Software Development')
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
    expect(out.skills.find((s) => s.id === 'r')!.category).toBe('Software Development')
    expect(out.skills.find((s) => s.id === 'k')!.category).toBe('Cloud & Infrastructure')
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

describe('clearSkillCategories', () => {
  it('clears the explicit category on the listed skills only', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'a', name: { en: 'A' }, category: 'Frontend' }))
    store.skills.push(makeSkill({ id: 'b', name: { en: 'B' }, category: 'Data' }))
    store.skills.push(makeSkill({ id: 'c', name: { en: 'C' }, category: 'Cloud' }))
    const { store: out, cleared } = clearSkillCategories(store, ['a', 'b'])
    expect(cleared).toBe(2)
    expect(out.skills.find((s) => s.id === 'a')!.category).toBeNull()
    expect(out.skills.find((s) => s.id === 'b')!.category).toBeNull()
    expect(out.skills.find((s) => s.id === 'c')!.category).toBe('Cloud') // not listed
  })

  it('ignores skills that have no explicit category (no-op count)', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'a', name: { en: 'A' }, category: null }))
    const { store: out, cleared } = clearSkillCategories(store, ['a'])
    expect(cleared).toBe(0)
    expect(out).toBe(store)
  })

  it('does not mutate the input store', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'a', name: { en: 'A' }, category: 'Frontend' }))
    clearSkillCategories(store, ['a'])
    expect(store.skills[0].category).toBe('Frontend')
  })

  it('after clearing, the skill is eligible for auto-categorization again', () => {
    const store = emptyStore()
    // Wrongly pinned to a manual category the auto-categorizer would skip.
    store.skills.push(makeSkill({ id: 'ts', name: { en: 'TypeScript' }, category: 'Misc' }))
    const pinned = autoCategorizeSkills(store, DOMAINS)
    expect(pinned.changed).toBe(0) // manual category is respected
    const cleared = clearSkillCategories(store, ['ts']).store
    const recat = autoCategorizeSkills(cleared, DOMAINS)
    expect(recat.changed).toBe(1)
    expect(recat.store.skills[0].category).toBe('Software Development')
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
    expect(store.skills[0].category ?? null).toBeNull()
  })
})
