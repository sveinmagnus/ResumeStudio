import { describe, it, expect } from 'vitest'
import {
  buildCanonicalMap, canonicalizeName, normalizeImportedSkills,
} from '../src/lib/skillNormalize'
import { emptyStore, makeSkill, makeProject } from './fixtures'
import type { ProjectSkill } from '../src/types'

const TAXONOMY = ['TypeScript', 'Kubernetes', 'React', 'Agile Software Development']

describe('buildCanonicalMap', () => {
  it('maps lowercased names to canonical spelling, first-wins on dupes', () => {
    const map = buildCanonicalMap(['TypeScript', ' typescript ', 'React'])
    expect(map.get('typescript')).toBe('TypeScript')
    expect(map.get('react')).toBe('React')
  })
})

describe('canonicalizeName', () => {
  const map = buildCanonicalMap(TAXONOMY)

  it.each([
    ['typescript', 'TypeScript'],
    ['TYPESCRIPT', 'TypeScript'],
    ['  TypeScript  ', 'TypeScript'],
    ['kubernetes', 'Kubernetes'],
  ])('canonicalizes %j -> %j', (input, expected) => {
    expect(canonicalizeName(input, map)).toBe(expected)
  })

  it('collapses internal whitespace before matching', () => {
    expect(canonicalizeName('Agile   Software  Development', map)).toBe('Agile Software Development')
  })

  it('leaves names not in the library untouched (only cleans whitespace)', () => {
    expect(canonicalizeName('Løsningsarkitektur', map)).toBe('Løsningsarkitektur')
    expect(canonicalizeName('  Some  Niche Skill ', map)).toBe('Some Niche Skill')
  })

  it('never fuzzy-matches a typo onto a different skill', () => {
    expect(canonicalizeName('kubernates', map)).toBe('kubernates') // not "Kubernetes"
    expect(canonicalizeName('TypeScrpt', map)).toBe('TypeScrpt')
  })
})

const ps = (skill_id: string, name: Record<string, string>): ProjectSkill => ({
  id: `ps-${skill_id}-${name.en ?? ''}`, skill_id, name,
  duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0,
})

describe('normalizeImportedSkills', () => {
  it('canonicalizes registry names and rebuilds denormalized copies', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'ts', name: { en: 'typescript' } }))
    store.skills.push(makeSkill({ id: 'k8s', name: { en: 'KUBERNETES' } }))
    store.projects.push(makeProject({ id: 'p1', skills: [ps('ts', { en: 'typescript' })] }))

    const { store: out, changed } = normalizeImportedSkills(store, TAXONOMY)
    expect(changed).toBe(2)
    expect(out.skills.find((s) => s.id === 'ts')!.name).toEqual({ en: 'TypeScript' })
    expect(out.skills.find((s) => s.id === 'k8s')!.name).toEqual({ en: 'Kubernetes' })
    // Denormalized copies follow the registry.
    expect(out.projects[0].skills[0].name).toEqual({ en: 'TypeScript' })
  })

  it('does not mutate the input store', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'ts', name: { en: 'typescript' } }))
    normalizeImportedSkills(store, TAXONOMY)
    expect(store.skills[0].name).toEqual({ en: 'typescript' })
  })

  it('leaves non-library skills exactly as imported', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'x', name: { no: 'Løsningsarkitektur' } }))
    const { store: out, changed } = normalizeImportedSkills(store, TAXONOMY)
    expect(changed).toBe(0)
    expect(out.skills[0].name).toEqual({ no: 'Løsningsarkitektur' })
  })

  it('canonicalizes orphan project skills (no skill_id) directly', () => {
    const store = emptyStore()
    store.projects.push(makeProject({ id: 'p1', skills: [ps('', { en: 'react' })] }))
    const { store: out } = normalizeImportedSkills(store, TAXONOMY)
    expect(out.projects[0].skills[0].name).toEqual({ en: 'React' })
  })

  it('is a no-op with an empty taxonomy', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'ts', name: { en: 'typescript' } }))
    const { store: out, changed } = normalizeImportedSkills(store, [])
    expect(changed).toBe(0)
    expect(out).toBe(store)
  })

  // ── Classification stamping (F12 pt4) ──────────────────────────────────────
  const CLASS = { TypeScript: 'Technical', Kubernetes: 'Technical', Scrum: 'Management' }

  it('stamps the authoritative classification on a canonicalized skill', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'ts', name: { en: 'typescript' } }))
    const { store: out } = normalizeImportedSkills(store, TAXONOMY, CLASS)
    expect(out.skills[0].name).toEqual({ en: 'TypeScript' })
    expect(out.skills[0].classification).toBe('Technical')
  })

  it('does not overwrite an existing classification', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'ts', name: { en: 'TypeScript' }, classification: 'Custom' }))
    const { store: out } = normalizeImportedSkills(store, TAXONOMY, CLASS)
    expect(out.skills[0].classification).toBe('Custom')
  })

  it('leaves classification unset for skills absent from the library', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'x', name: { no: 'Løsningsarkitektur' } }))
    const { store: out } = normalizeImportedSkills(store, TAXONOMY, CLASS)
    expect(out.skills[0].classification).toBeUndefined()
  })

  it('stamps classification even when the name needed no canonicalization', () => {
    const store = emptyStore()
    store.skills.push(makeSkill({ id: 'k8s', name: { en: 'Kubernetes' } }))
    const { store: out, changed } = normalizeImportedSkills(store, TAXONOMY, CLASS)
    expect(changed).toBe(0) // name already canonical
    expect(out.skills[0].classification).toBe('Technical')
  })

  it('canonicalizes a matching value regardless of its locale key', () => {
    const store = emptyStore()
    // A skill stored under a non-English locale that still spells a library name.
    store.skills.push(makeSkill({ id: 'ts', name: { no: 'typescript' } }))
    const { store: out } = normalizeImportedSkills(store, TAXONOMY)
    expect(out.skills[0].name).toEqual({ no: 'TypeScript' })
  })
})
