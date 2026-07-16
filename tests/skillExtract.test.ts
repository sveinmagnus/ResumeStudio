/**
 * @vitest-environment jsdom
 *
 * jsdom: the prompt builder runs long descriptions through richToPlain, which
 * uses DOMParser.
 */
import { describe, it, expect } from 'vitest'
import {
  buildSkillExtractPrompt, validateSkillExtract, resolveSuggestions, registryVocabulary,
  InvalidSkillExtractError, SKILL_EXTRACT_SCHEMA,
} from '../src/lib/skillExtract'
import { makeProject, makeSkill } from './fixtures'
import type { Project, Skill } from '../src/types'

const reg: Skill[] = [
  makeSkill({ id: 's-react', name: { en: 'React' } }),
  makeSkill({ id: 's-ts', name: { en: 'TypeScript' } }),
  makeSkill({ id: 's-k8s', name: { en: 'Kubernetes' } }),
]

const proj = (over: Partial<Project> = {}): Project => makeProject({
  customer: { en: 'Acme' },
  long_description: { en: '<p>Built services with TypeScript on Kubernetes.</p>' },
  ...over,
})

describe('buildSkillExtractPrompt()', () => {
  it('includes the project prose and asks for the schema', () => {
    const p = buildSkillExtractPrompt(proj(), 'en')
    expect(p).toContain('Built services with TypeScript on Kubernetes.')
    expect(p).toContain(SKILL_EXTRACT_SCHEMA)
  })

  it('strips rich-text markup rather than feeding the model HTML', () => {
    expect(buildSkillExtractPrompt(proj(), 'en')).not.toContain('<p>')
  })

  it('tells the model not to infer — a padded CV has to be defended', () => {
    expect(buildSkillExtractPrompt(proj(), 'en')).toMatch(/do not infer or pad/i)
  })

  it('seeds the registry vocabulary so the model reaches for existing names', () => {
    const p = buildSkillExtractPrompt(proj(), 'en', ['React', 'TypeScript'])
    expect(p).toContain('React, TypeScript')
  })

  it('survives an empty project without throwing', () => {
    const p = buildSkillExtractPrompt(proj({ customer: {}, description: {}, long_description: {} }), 'en')
    expect(p).toContain('(no description)')
  })
})

describe('validateSkillExtract()', () => {
  it('accepts a well-formed reply', () => {
    expect(validateSkillExtract({ $schema: SKILL_EXTRACT_SCHEMA, skills: ['React'] }).skills).toEqual(['React'])
  })

  it('trims and drops blank / non-string entries', () => {
    expect(validateSkillExtract({ skills: ['  React  ', '', 42, null, 'Go'] }).skills).toEqual(['React', 'Go'])
  })

  it('rejects a reply with no skills array', () => {
    expect(() => validateSkillExtract({ nope: 1 })).toThrow(InvalidSkillExtractError)
    expect(() => validateSkillExtract('text')).toThrow(InvalidSkillExtractError)
  })

  it('rejects an empty list rather than reporting success with nothing', () => {
    expect(() => validateSkillExtract({ skills: [] })).toThrow(InvalidSkillExtractError)
  })
})

describe('resolveSuggestions() — interning against the registry', () => {
  it('resolves a variant spelling onto the EXISTING registry skill', () => {
    // The whole point: no near-duplicate registry entries.
    const r = resolveSuggestions(['react.js', 'TYPESCRIPT'], proj(), reg, 'en')
    expect(r.existing.map((s) => s.label)).toEqual(['React', 'TypeScript'])
    expect(r.existing.map((s) => s.skillId)).toEqual(['s-react', 's-ts'])
    expect(r.novel).toEqual([])
  })

  it('shows the registry spelling, not the model\'s', () => {
    // That's the name the CV will actually render.
    expect(resolveSuggestions(['react.js'], proj(), reg, 'en').existing[0].label).toBe('React')
  })

  it('interns the .js family either way round', () => {
    // The single alias rule: a trailing "js" token is dropped on both sides.
    const r = resolveSuggestions(['React.js'], proj(), reg, 'en')
    expect(r.existing[0]?.skillId).toBe('s-react')

    // …and the mirror case: registry says "Node.js", model says "Node".
    const nodeReg = [makeSkill({ id: 's-node', name: { en: 'Node.js' } })]
    expect(resolveSuggestions(['Node'], proj(), nodeReg, 'en').existing[0]?.skillId).toBe('s-node')
  })

  it('does NOT collapse distinct skills that merely share a head', () => {
    // The reason there's no fuzzy/subset matching: merging these would corrupt
    // the shared registry far worse than an extra suggestion the user ignores.
    const r2 = [makeSkill({ id: 's-spring', name: { en: 'Spring' } }), makeSkill({ id: 's-java', name: { en: 'Java' } })]
    const r = resolveSuggestions(['Spring Boot', 'JavaScript'], proj(), r2, 'en')
    expect(r.existing).toEqual([])
    expect(r.novel.map((s) => s.label)).toEqual(['Spring Boot', 'JavaScript'])
  })

  it('offers a genuinely new name as a novel registry addition', () => {
    const r = resolveSuggestions(['Rust'], proj(), reg, 'en')
    expect(r.novel.map((s) => s.label)).toEqual(['Rust'])
    expect(r.novel[0].skillId).toBeNull()
  })

  it('separates skills the project already links', () => {
    const p = proj({
      skills: [{ id: 'ps1', skill_id: 's-ts', name: {}, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0 }],
    })
    const r = resolveSuggestions(['TypeScript', 'React'], p, reg, 'en')
    expect(r.alreadyLinked.map((s) => s.label)).toEqual(['TypeScript'])
    // Only the un-linked one is offered.
    expect(r.existing.map((s) => s.label)).toEqual(['React'])
  })

  it('dedupes variants of the same skill within one reply', () => {
    const r = resolveSuggestions(['React', 'react.js', 'REACT'], proj(), reg, 'en')
    expect(r.existing).toHaveLength(1)
  })

  it('matches a registry name in ANY locale', () => {
    // A skill named only in Norwegian still interns — the registry is shared
    // across locales, so a match must be too.
    const nb = [makeSkill({ id: 's-db', name: { no: 'Databaser' } })]
    const r = resolveSuggestions(['databaser'], proj(), nb, 'no')
    expect(r.existing[0].skillId).toBe('s-db')
    expect(r.novel).toEqual([])
  })

  it('ignores empty / unmatchable names', () => {
    const r = resolveSuggestions(['', '   ', '123'], proj(), reg, 'en')
    expect(r.existing).toEqual([])
    expect(r.novel).toEqual([])
  })
})

describe('registryVocabulary()', () => {
  it('lists each registry skill once in the editing locale', () => {
    expect(registryVocabulary(reg, 'en')).toEqual(['React', 'TypeScript', 'Kubernetes'])
  })

  it('drops duplicates that normalize to the same key', () => {
    const dup = [...reg, makeSkill({ id: 'x', name: { en: 'react' } })]
    expect(registryVocabulary(dup, 'en').filter((n) => /react/i.test(n))).toHaveLength(1)
  })
})
