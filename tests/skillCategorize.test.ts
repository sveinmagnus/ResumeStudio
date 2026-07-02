import { describe, it, expect } from 'vitest'
import { autoCategorizeSkills, effectiveSkillCategory } from '../src/lib/skillCategorize'
import { emptyStore, makeSkill } from './fixtures'
import type { SkillDomains, SkillRelations } from '../src/lib/skillTaxonomy'

describe('effectiveSkillCategory', () => {
  it('returns the explicit category when set', () => {
    expect(effectiveSkillCategory({ category: 'Cloud', skill_type: 'technical' })).toBe('Cloud')
  })

  it('falls back to the title-cased type label when no category', () => {
    expect(effectiveSkillCategory({ category: null, skill_type: 'technical' })).toBe('Technical')
    expect(effectiveSkillCategory({ category: '', skill_type: 'methodology' })).toBe('Methodology')
    expect(effectiveSkillCategory({ category: '  ', skill_type: 'soft' })).toBe('Soft')
    expect(effectiveSkillCategory({ category: undefined, skill_type: 'domain' })).toBe('Domain')
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
    expect(assignments[0]).toMatchObject({ skill_id: 'ts', category: 'Software Development', tier: 1 })
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
    const { store: out, changed } = autoCategorizeSkills(store, DOMAINS, undefined, { overwrite: true })
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

describe('autoCategorizeSkills — Tier 2 (graph vote)', () => {
  // "Løsningsarkitektur" isn't a library domain node, but it relates to skills
  // that are — two Cloud, one Software → Cloud wins.
  const RELATIONS: SkillRelations = {
    Løsningsarkitektur: ['Kubernetes', 'Terraform', 'React'],
  }

  it('inherits the majority domain of graph neighbours', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'la', name: { no: 'Løsningsarkitektur' } }))
    const { store: out, changed, assignments } = autoCategorizeSkills(store, DOMAINS, RELATIONS)
    expect(changed).toBe(1)
    expect(out.skills[0].category).toBe('Cloud & Infrastructure')
    expect(assignments[0].tier).toBe(2)
  })

  it('breaks ties alphabetically', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'la', name: { no: 'Løsningsarkitektur' } }))
    // One Cloud, one Software → tie → "Cloud & Infrastructure" sorts first.
    const rel: SkillRelations = { Løsningsarkitektur: ['Kubernetes', 'React'] }
    const { store: out } = autoCategorizeSkills(store, DOMAINS, rel)
    expect(out.skills[0].category).toBe('Cloud & Infrastructure')
  })

  it('prefers an exact Tier 1 match over the graph vote', () => {
    const store = emptyStore()
    // React is itself a library node (Software Development); the graph is ignored.
    store.skills.push(makeSkill({ id: 'r', name: { en: 'React' } }))
    const rel: SkillRelations = { React: ['Kubernetes', 'Terraform'] }
    const { store: out, assignments } = autoCategorizeSkills(store, DOMAINS, rel)
    expect(out.skills[0].category).toBe('Software Development')
    expect(assignments[0].tier).toBe(1)
  })

  it('leaves a graph node uncategorized when no neighbour has a domain', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'la', name: { no: 'Løsningsarkitektur' } }))
    const rel: SkillRelations = { Løsningsarkitektur: ['Some Unknown Skill'] }
    const { changed } = autoCategorizeSkills(store, DOMAINS, rel)
    expect(changed).toBe(0)
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
