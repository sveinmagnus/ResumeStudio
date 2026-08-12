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

  it('names the project by customer, then by its own name, then generically', () => {
    // The model is told which project it is looking at; an unnamed one still
    // needs a subject, or the instruction reads "extract skills from ".
    expect(buildSkillExtractPrompt(proj({ customer: { en: 'Acme' }, description: { en: 'Platform' } }), 'en'))
      .toContain('Acme')
    expect(buildSkillExtractPrompt(proj({ customer: {}, description: { en: 'Platform rebuild' } }), 'en'))
      .toContain('Platform rebuild')
    expect(buildSkillExtractPrompt(proj({ customer: {}, description: {} }), 'en'))
      .toContain('this project')
  })

  it('sends no vocabulary line when the registry is empty', () => {
    // An empty list rendered as a heading with nothing after it invites the
    // model to treat the absence as meaningful.
    const p = buildSkillExtractPrompt(proj(), 'en', [])
    expect(p).not.toMatch(/already in the registry:\s*$/m)
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

/**
 * The three buckets a suggested skill lands in.
 *
 * The panel's whole value is telling them apart: already on this item, in the
 * registry but not linked here, or genuinely new. Collapsing any two of them
 * either hides work the user still has to do or offers to add what is already
 * there.
 */
describe('resolveSuggestions — the three buckets', () => {
  const REGISTRY = [
    makeSkill({ id: 'go', name: { en: 'Go' } }),
    makeSkill({ id: 'k8s', name: { en: 'Kubernetes' } }),
  ]
  /** A project linked to the given registry skill ids. */
  const proj = (skillIds: string[]) => makeProject({
    id: 'p1',
    skills: skillIds.map((skill_id, i) => ({
      id: `ps${i}`, skill_id, name: {},
      duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: i,
    })),
  })

  it('reports a skill already linked to the item as alreadyLinked', () => {
    const out = resolveSuggestions(['Go'], proj(['go']), REGISTRY, 'en')
    expect(out.alreadyLinked.map((x) => x.label)).toEqual(['Go'])
    expect(out.existing).toEqual([])
    expect(out.novel).toEqual([])
  })

  it('reports a registry skill NOT linked here as existing, with its id', () => {
    const out = resolveSuggestions(['Kubernetes'], proj(['go']), REGISTRY, 'en')
    expect(out.existing.map((x) => x.label)).toEqual(['Kubernetes'])
    expect(out.existing[0].skillId).toBe('k8s')
    expect(out.alreadyLinked).toEqual([])
  })

  it('reports an unknown name as novel, with no id', () => {
    const out = resolveSuggestions(['Rust'], proj([]), REGISTRY, 'en')
    expect(out.novel.map((x) => x.label)).toEqual(['Rust'])
    expect(out.novel[0].skillId).toBeNull()
  })

  it('matches the registry case- and space-insensitively', () => {
    const out = resolveSuggestions(['  kubernetes  '], proj([]), REGISTRY, 'en')
    expect(out.existing).toHaveLength(1)
    expect(out.novel).toEqual([])
  })

  it('shows the REGISTRY’s spelling for an existing skill, not the model’s', () => {
    // The registry name is the curated one; echoing the model's casing would
    // make the row look like a new skill.
    const out = resolveSuggestions(['kubernetes'], proj([]), REGISTRY, 'en')
    expect(out.existing[0].label).toBe('Kubernetes')
  })

  it('keeps the model’s RAW spelling for a novel skill — there is nothing else', () => {
    // Deliberately unnormalised: the label is what the user is asked to accept,
    // and trimming it here would hide that the model sent padding.
    const out = resolveSuggestions(['  rust  '], proj([]), REGISTRY, 'en')
    expect(out.novel[0].label).toBe('  rust  ')
  })

  it('matches a registry name in ANY locale', () => {
    const s = [makeSkill({ id: 'sky', name: { no: 'Skytjenester' } })]
    const out = resolveSuggestions(['Skytjenester'], proj([]), s, 'en')
    expect(out.existing).toHaveLength(1)
  })

  it('keeps the FIRST registry entry when two normalise the same', () => {
    const s = [
      makeSkill({ id: 'first', name: { en: 'Go' } }),
      makeSkill({ id: 'second', name: { en: ' go ' } }),
    ]
    expect(resolveSuggestions(['Go'], proj([]), s, 'en').existing[0].skillId).toBe('first')
  })

  it('ignores a registry entry with no usable name', () => {
    const s = [makeSkill({ id: 'blank', name: { en: '   ' } })]
    expect(resolveSuggestions(['Go'], proj([]), s, 'en').novel).toHaveLength(1)
  })

  it('drops blank suggestions rather than offering an empty row', () => {
    const out = resolveSuggestions(['', '   ', 'Rust'], proj([]), REGISTRY, 'en')
    expect(out.novel).toHaveLength(1)
  })

  it('de-duplicates a name suggested twice', () => {
    const out = resolveSuggestions(['Rust', 'rust'], proj([]), REGISTRY, 'en')
    expect(out.novel).toHaveLength(1)
  })
})

/**
 * What the model is shown, and what the validator accepts back.
 *
 * The extraction prompt is the narrowest one in the app on purpose — one project,
 * name what its prose evidences — so every line in it is load-bearing.
 */
describe('buildSkillExtractPrompt — the evidence and the vocabulary', () => {
  it('includes the project HIGHLIGHTS as evidence', () => {
    // The bullets are where a consultant writes what they actually did; a prompt
    // built from the descriptions alone asks the model to judge half the entry.
    const p = buildSkillExtractPrompt(proj({
      highlights: [{ en: 'Introduced Terraform for the whole estate' }],
    }), 'en')
    expect(p).toContain('Introduced Terraform for the whole estate')
  })

  it('sends no vocabulary block when no registry names are passed', () => {
    expect(buildSkillExtractPrompt(proj(), 'en')).not.toMatch(/Prefer these exact names/)
    expect(buildSkillExtractPrompt(proj(), 'en', ['Go'])).toMatch(/Prefer these exact names/)
  })

  it('caps the vocabulary rather than pasting a whole large registry', () => {
    const many = Array.from({ length: 200 }, (_, i) => `Skill${i}`)
    const p = buildSkillExtractPrompt(proj(), 'en', many)
    expect(p).toContain('Skill119')
    expect(p).not.toContain('Skill120')
  })

  it('leaves no blank line where an omitted block used to be', () => {
    // The prompt is assembled from optional parts; an empty one left in place
    // reads to a small model as a section it was given nothing for.
    const p = buildSkillExtractPrompt(proj(), 'en')
    expect(p).not.toContain(String.fromCharCode(10) + String.fromCharCode(10))
  })
})

describe('validateSkillExtract — the two refusals and the default schema', () => {
  it('names a non-object reply as such, separately from a missing array', () => {
    for (const bad of [null, undefined, 'text', 42]) {
      expect(() => validateSkillExtract(bad), String(bad)).toThrow(/not a JSON object/)
    }
    expect(() => validateSkillExtract({ nope: 1 })).toThrow(/no "skills" array/)
  })

  it('stamps our own schema when the reply omits one', () => {
    // A model that answers with the array but no $schema is still a usable
    // reply; recording the string "undefined" as its schema is not.
    expect(validateSkillExtract({ skills: ['Go'] }).$schema).toBe(SKILL_EXTRACT_SCHEMA)
  })
})

describe('skillKey — the one alias rule', () => {
  it('keeps a name that is ONLY the js token', () => {
    // Dropping a trailing "js" needs something in front of it: "JS" on its own
    // is the skill, and popping it leaves an empty key that matches nothing.
    const s = [makeSkill({ id: 's-js', name: { en: 'JS' } })]
    expect(resolveSuggestions(['js'], proj(), s, 'en').existing[0]?.skillId).toBe('s-js')
  })
})

describe('resolveSuggestions — the links it reads off the project', () => {
  const REGISTRY = [makeSkill({ id: 'go', name: { en: 'Go' } })]
  const linkedTo = (skill_id: string) => makeProject({
    id: 'p1',
    skills: [{
      id: 'ps0', skill_id, name: {},
      duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0,
    }],
  })

  it('carries the registry id and the flag on an already-linked row', () => {
    // The panel uses both: the flag to show the row as explanation rather than
    // an offer, and the id to know it is the same skill.
    const [row] = resolveSuggestions(['Go'], linkedTo('go'), REGISTRY, 'en').alreadyLinked
    expect(row.skillId).toBe('go')
    expect(row.alreadyLinked).toBe(true)
  })

  it('survives a project link pointing at a deleted registry skill', () => {
    // A stale skill_id outlives the entry it named; reading its name would
    // crash the whole panel over one dangling link.
    const out = resolveSuggestions(['Go'], linkedTo('deleted-id'), REGISTRY, 'en')
    expect(out.existing.map((s) => s.skillId)).toEqual(['go'])
    expect(out.alreadyLinked).toEqual([])
  })
})

describe('registryVocabulary — what is worth telling the model about', () => {
  it('trims the name it lists', () => {
    const out = registryVocabulary([makeSkill({ id: 'a', name: { en: '  Go  ' } })], 'en')
    expect(out).toEqual(['Go'])
  })

  it('leaves out an entry with no name, and one with no matchable key', () => {
    // '123' survives as text but normalises to nothing, so it can never intern
    // a suggestion — listing it as preferred vocabulary is noise in the prompt.
    const out = registryVocabulary([
      makeSkill({ id: 'blank', name: { en: '   ' } }),
      makeSkill({ id: 'digits', name: { en: '123' } }),
      makeSkill({ id: 'real', name: { en: 'Go' } }),
    ], 'en')
    expect(out).toEqual(['Go'])
  })
})

describe('resolveSuggestions — the flag on the offered rows', () => {
  it('marks an existing and a novel row as NOT already linked', () => {
    // The flag drives whether the row is an offer or an explanation; a true here
    // would silently hide both buckets from the tick list.
    const out = resolveSuggestions(['React', 'Rust'], proj(), reg, 'en')
    expect(out.existing[0].alreadyLinked).toBe(false)
    expect(out.novel[0].alreadyLinked).toBe(false)
  })
})
