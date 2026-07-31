import { describe, it, expect } from 'vitest'
import { emptyStore, makeProject, makeSkill } from './fixtures'
import type { ResumeStore, Skill } from '../src/types'
import {
  auditCoverage, containsTerm, coverageTally, extractPostingTerms,
  validateAtsResponse, InvalidAtsResponseError,
} from '../src/lib/atsAudit'
import {
  applyHygiene, buildHygienePrompt, hasRegistryContent, hygieneImpact,
  validateHygiene, InvalidHygieneError,
} from '../src/lib/registryHygiene'
import { countSkillReferences } from '../src/lib/merge'
import {
  buildGlossary, scopeGlossary, glossaryFor, mentions, toPayload,
} from '../src/lib/glossary'

// ── B4: ATS audit ────────────────────────────────────────────────────────────

describe('term matching', () => {
  /**
   * `\b` is ASCII-oriented, which is wrong for every language this app offers
   * but English. These two cases are the reason the matcher uses Unicode
   * lookaround instead.
   */
  it('matches whole terms only, including across Norwegian inflection', () => {
    expect(containsTerm('We use Kubernetes daily', 'Kubernetes')).toBe(true)
    expect(containsTerm('kubernetes in production', 'Kubernetes')).toBe(true) // case-insensitive
    expect(containsTerm('Skydriften er god', 'Skydrift')).toBe(false)         // inflected, not a match
    expect(containsTerm('Vi driver Skydrift her', 'Skydrift')).toBe(true)
  })

  it('handles terms with regex-special characters', () => {
    expect(containsTerm('We write C++ and .NET', 'C++')).toBe(true)
    expect(containsTerm('We write C++ and .NET', '.NET')).toBe(true)
  })
})

describe('posting term extraction', () => {
  function storeWithSkills(names: string[]): ResumeStore {
    const s = emptyStore()
    s.skills = names.map((n) => makeSkill({ name: { en: n } }))
    return s
  }

  it('picks up registry skills the posting mentions', () => {
    const s = storeWithSkills(['Kubernetes', 'Terraform', 'COBOL'])
    const terms = extractPostingTerms('You will run kubernetes and terraform in production.', s, 'en')
    expect(terms).toContain('Kubernetes')
    expect(terms).toContain('Terraform')
    expect(terms).not.toContain('COBOL')
  })

  /** Sentence-initial capitals are the obvious false positive. */
  it('drops a capitalised word that also appears lowercase', () => {
    const s = emptyStore()
    const terms = extractPostingTerms('Experience matters. We value experience above all.', s, 'en')
    expect(terms).not.toContain('Experience')
  })

  /**
   * Found by running this against a real posting: "Knowledge of COBOL is a
   * plus" put "Knowledge" in the report. It gets its capital from position, not
   * from being a name.
   */
  it('drops a single capitalised word that merely starts a sentence', () => {
    const s = emptyStore()
    const terms = extractPostingTerms('Docker is required. Knowledge of COBOL is a plus.', s, 'en')
    expect(terms).not.toContain('Knowledge')
    expect(terms).toContain('COBOL')
  })

  /**
   * …but a bullet list is exactly where requirements live, so a line start must
   * NOT be treated the same way.
   */
  it('keeps a term at the start of a bullet line', () => {
    const s = emptyStore()
    const terms = extractPostingTerms('Requirements:\n- Kubernetes in production\n- Terraform', s, 'en')
    expect(terms).toContain('Kubernetes')
    expect(terms).toContain('Terraform')
  })
})

describe('coverage audit', () => {
  /**
   * The three-way status is the feature: "in your CV but this view left it out"
   * is fixed by re-including an item, with no writing at all.
   */
  it('separates present, excluded-by-this-view, and genuinely absent', () => {
    const c = auditCoverage(
      ['Kubernetes', 'Terraform', 'Fortran'],
      'Ran Kubernetes clusters.',                       // the view's export
      'Ran Kubernetes clusters. Also wrote Terraform.', // the whole CV
    )
    const byTerm = Object.fromEntries(c.terms.map((t) => [t.term, t.status]))
    expect(byTerm).toEqual({ Kubernetes: 'present', Terraform: 'elsewhere', Fortran: 'absent' })
    expect(coverageTally(c)).toEqual({ present: 1, elsewhere: 1, absent: 1 })
  })

  it('opens on the gaps, not on what is already fine', () => {
    const c = auditCoverage(['A', 'B'], 'A', 'A B')
    expect(c.terms[0].term).toBe('B') // 'elsewhere' before 'present'
  })
})

describe('ATS model reply', () => {
  const asked = ['Kubernetes', 'Terraform']

  it('keeps a quoted "covered" verdict', () => {
    const { equivalences } = validateAtsResponse({ equivalences: [
      { term: 'Kubernetes', verdict: 'covered', quote: 'Ran K8s clusters for a bank.' },
    ] }, asked)
    expect(equivalences[0]).toMatchObject({ verdict: 'covered', quote: 'Ran K8s clusters for a bank.' })
  })

  /**
   * The quote IS the evidence. An unquoted claim of coverage is exactly the
   * false reassurance that would let someone send a CV believing it says
   * something it doesn't.
   */
  it('downgrades "covered" with no quote to "phrasing"', () => {
    const { equivalences } = validateAtsResponse({ equivalences: [
      { term: 'Kubernetes', verdict: 'covered', quote: '' },
    ] }, asked)
    expect(equivalences[0].verdict).toBe('phrasing')
  })

  /** The keyword-stuffing guard: a missing term never carries a suggestion. */
  it('strips any suggestion attached to a "missing" verdict', () => {
    const { equivalences } = validateAtsResponse({ equivalences: [
      { term: 'Terraform', verdict: 'missing', suggestion: 'Just add Terraform to your skills!' },
    ] }, asked)
    expect(equivalences[0]).toMatchObject({ verdict: 'missing', suggestion: '' })
  })

  it('drops a term that was never asked about', () => {
    const { equivalences, dropped } = validateAtsResponse({ equivalences: [
      { term: 'Rust', verdict: 'covered', quote: 'x' },
    ] }, asked)
    expect(equivalences).toHaveLength(0)
    expect(dropped[0]).toMatch(/not one of the terms/i)
  })

  it('rejects a reply that is not an ATS document', () => {
    expect(() => validateAtsResponse({}, asked)).toThrow(InvalidAtsResponseError)
  })
})

// ── C4: registry hygiene ─────────────────────────────────────────────────────

describe('registry hygiene', () => {
  function storeWithDupes(): ResumeStore {
    const s = emptyStore()
    const react = makeSkill({ name: { en: 'React' } })
    const reactJs = makeSkill({ name: { en: 'React.js' } })
    s.skills = [react, reactJs]
    // Two projects use React, one uses React.js — so the counts differ and the
    // panel can show a real blast radius.
    s.projects = [
      makeProject({ skills: [{ skill_id: react.id, name: { en: 'React' }, proficiency: 3 }] }),
      makeProject({ skills: [{ skill_id: react.id, name: { en: 'React' }, proficiency: 3 }] }),
      makeProject({ skills: [{ skill_id: reactJs.id, name: { en: 'React.js' }, proficiency: 3 }] }),
    ]
    return s
  }

  const ids = (s: ResumeStore) => ({ react: s.skills[0].id, reactJs: s.skills[1].id })

  it('reports the exact consequence of a merge, from the live store', () => {
    const s = storeWithDupes()
    const { react, reactJs } = ids(s)
    const { merges } = validateHygiene({ merges: [
      { kind: 'skills', keep_id: react, drop_id: reactJs, reason: 'Same library.' },
    ] }, s, 'en')

    expect(merges[0]).toMatchObject({
      keepName: 'React', dropName: 'React.js', dropRefs: 1, keepRefs: 2,
    })
  })

  it('refuses a merge naming an entry that is not in that registry', () => {
    const s = storeWithDupes()
    const { merges, dropped } = validateHygiene({ merges: [
      { kind: 'skills', keep_id: ids(s).react, drop_id: 'ghost' },
    ] }, s, 'en')
    expect(merges).toHaveLength(0)
    expect(dropped[0]).toMatch(/isn't in skills/i)
  })

  /** Two merges touching one entry would apply the second onto a deleted row. */
  it('drops overlapping merges as ambiguous rather than guessing an order', () => {
    const s = storeWithDupes()
    const third = makeSkill({ name: { en: 'ReactJS' } })
    s.skills.push(third)
    const { react, reactJs } = ids(s)
    const { merges, dropped } = validateHygiene({ merges: [
      { kind: 'skills', keep_id: react, drop_id: reactJs },
      { kind: 'skills', keep_id: reactJs, drop_id: third.id },
    ] }, s, 'en')
    expect(merges).toHaveLength(1)
    expect(dropped[0]).toMatch(/overlaps/i)
  })

  /**
   * The user's own categorisation is never overwritten — that would be a change
   * they didn't ask for, which this feature does not do.
   */
  it('refuses to re-categorise a skill the user already placed', () => {
    const s = emptyStore()
    const placed = makeSkill({ name: { en: 'React' } })
    placed.category_id = 'cat-existing'
    s.skills = [placed]
    s.skill_categories = [{ id: 'cat-existing', resume_id: 'resume-1', name: { en: 'Frontend' }, sort_order: 0 }]

    const { categories, dropped } = validateHygiene({ categories: [
      { skill_id: placed.id, category_id: null, category_name: 'Backend' },
    ] }, s, 'en')
    expect(categories).toHaveLength(0)
    expect(dropped[0]).toMatch(/already placed/i)
  })

  it('validateHygiene returns proposals only — it cannot mutate the store', () => {
    const s = storeWithDupes()
    const before = JSON.stringify(s)
    validateHygiene({ merges: [{ kind: 'skills', keep_id: ids(s).react, drop_id: ids(s).reactJs }] }, s, 'en')
    expect(JSON.stringify(s)).toBe(before)
  })

  it('rejects a reply with neither list', () => {
    expect(() => validateHygiene({ nope: 1 }, emptyStore(), 'en')).toThrow(InvalidHygieneError)
  })

  it('applies only what is handed in, rewriting references', () => {
    const s = storeWithDupes()
    const { react, reactJs } = ids(s)
    const { merges } = validateHygiene({ merges: [
      { kind: 'skills', keep_id: react, drop_id: reactJs },
    ] }, s, 'en')

    const out = applyHygiene(s, merges, [], 'en')
    expect(out.merged).toBe(1)
    expect(out.data.skills.map((x) => x.id)).toEqual([react])
    // The third project's link now points at the survivor.
    expect(countSkillReferences(out.data, react)).toBe(3)
    // The input store is untouched — replaceData takes the new one.
    expect(s.skills).toHaveLength(2)
  })

  /**
   * The panel is non-blocking, so the store can move under a proposal. A merge
   * whose entries are gone is skipped and reported, never guessed at.
   */
  it('skips a merge whose entry disappeared since the run', () => {
    const s = storeWithDupes()
    const { react, reactJs } = ids(s)
    const { merges } = validateHygiene({ merges: [
      { kind: 'skills', keep_id: react, drop_id: reactJs },
    ] }, s, 'en')

    const edited: ResumeStore = { ...s, skills: s.skills.filter((x) => x.id !== reactJs) }
    const out = applyHygiene(edited, merges, [], 'en')
    expect(out.merged).toBe(0)
    expect(out.skipped[0]).toMatch(/no longer there/i)
  })

  it('summarises the blast radius for the confirm dialog', () => {
    const s = storeWithDupes()
    const { react, reactJs } = ids(s)
    const { merges } = validateHygiene({ merges: [
      { kind: 'skills', keep_id: react, drop_id: reactJs },
    ] }, s, 'en')
    expect(hygieneImpact(merges, [])).toMatchObject({ entriesDeleted: 1, referencesRewritten: 1 })
  })
})

/**
 * The category half of C4, and the prompt that feeds both halves.
 *
 * Categories are the cheap, reversible side of registry hygiene — but the same
 * rule applies as to merges: it only ever fills a BLANK, and it re-checks that
 * against the store it is actually writing to.
 */
describe('registry hygiene — categories and prompt', () => {
  function storeWithLooseSkills(): ResumeStore {
    const s = emptyStore()
    s.skills = [
      makeSkill({ name: { en: 'Kubernetes' } }),
      makeSkill({ name: { en: 'Terraform' } }),
    ]
    s.skill_categories = [
      { id: 'cat-cloud', resume_id: 'resume-1', name: { en: 'Cloud' }, sort_order: 0 },
    ]
    return s
  }

  it('proposes an existing category by id', () => {
    const s = storeWithLooseSkills()
    const { categories, dropped } = validateHygiene({ categories: [
      { skill_id: s.skills[0].id, category_id: 'cat-cloud', reason: 'Container orchestration.' },
    ] }, s, 'en')

    expect(dropped).toEqual([])
    expect(categories[0]).toMatchObject({
      skillName: 'Kubernetes', categoryId: 'cat-cloud',
      categoryName: 'Cloud', isNewCategory: false,
    })
  })

  it('proposes a NEW category by name, and says so', () => {
    const s = storeWithLooseSkills()
    const { categories } = validateHygiene({ categories: [
      { skill_id: s.skills[1].id, category_id: null, category_name: 'Infrastructure as code' },
    ] }, s, 'en')

    expect(categories[0]).toMatchObject({
      categoryId: null, categoryName: 'Infrastructure as code', isNewCategory: true,
    })
  })

  it('drops a proposal naming a category that does not exist', () => {
    const s = storeWithLooseSkills()
    const { categories, dropped } = validateHygiene({ categories: [
      { skill_id: s.skills[0].id, category_id: 'cat-ghost' },
    ] }, s, 'en')
    expect(categories).toHaveLength(0)
    expect(dropped[0]).toMatch(/doesn't exist/i)
  })

  it('drops a proposal with no category at all', () => {
    const s = storeWithLooseSkills()
    const { categories, dropped } = validateHygiene({ categories: [
      { skill_id: s.skills[0].id, category_id: null, category_name: '' },
    ] }, s, 'en')
    expect(categories).toHaveLength(0)
    expect(dropped[0]).toMatch(/no category name/i)
  })

  it('keeps only the first proposal for a skill', () => {
    const s = storeWithLooseSkills()
    const { categories } = validateHygiene({ categories: [
      { skill_id: s.skills[0].id, category_id: 'cat-cloud' },
      { skill_id: s.skills[0].id, category_id: null, category_name: 'Something else' },
    ] }, s, 'en')
    expect(categories).toHaveLength(1)
    expect(categories[0].categoryName).toBe('Cloud')
  })

  it('applies an existing-category proposal and creates a new one', () => {
    const s = storeWithLooseSkills()
    const { categories } = validateHygiene({ categories: [
      { skill_id: s.skills[0].id, category_id: 'cat-cloud' },
      { skill_id: s.skills[1].id, category_id: null, category_name: 'Infrastructure as code' },
    ] }, s, 'en')

    const out = applyHygiene(s, [], categories, 'en')
    expect(out.categorised).toBe(2)
    expect(out.data.skills[0].category_id).toBe('cat-cloud')
    // The new category exists and the second skill is in it.
    const created = out.data.skill_categories!.find((c) => c.name.en === 'Infrastructure as code')
    expect(created).toBeDefined()
    expect(out.data.skills[1].category_id).toBe(created!.id)
    // Input store untouched — replaceData takes the new one.
    expect(s.skills[0].category_id).toBeFalsy()
  })

  /** The panel is non-blocking: the user may categorise a skill while it sits open. */
  it('skips a category the user filled in the meantime', () => {
    const s = storeWithLooseSkills()
    const { categories } = validateHygiene({ categories: [
      { skill_id: s.skills[0].id, category_id: 'cat-cloud' },
    ] }, s, 'en')

    const edited: ResumeStore = {
      ...s,
      skills: s.skills.map((x, i) => (i === 0 ? { ...x, category_id: 'cat-mine' } : x)),
    }
    const out = applyHygiene(edited, [], categories, 'en')
    expect(out.categorised).toBe(0)
    expect(out.skipped[0]).toMatch(/categorised it in the meantime/i)
    expect(out.data.skills[0].category_id).toBe('cat-mine')
  })

  it('skips a category whose skill is gone', () => {
    const s = storeWithLooseSkills()
    const { categories } = validateHygiene({ categories: [
      { skill_id: s.skills[0].id, category_id: 'cat-cloud' },
    ] }, s, 'en')

    const edited: ResumeStore = { ...s, skills: s.skills.slice(1) }
    const out = applyHygiene(edited, [], categories, 'en')
    expect(out.categorised).toBe(0)
    expect(out.skipped[0]).toMatch(/no longer there/i)
  })

  it('counts new categories once, however many skills go in them', () => {
    const cats = [
      { key: 'a', skillId: '1', skillName: 'A', categoryId: null, categoryName: 'Cloud', isNewCategory: true, reason: '' },
      { key: 'b', skillId: '2', skillName: 'B', categoryId: null, categoryName: 'cloud', isNewCategory: true, reason: '' },
    ]
    expect(hygieneImpact([], cats)).toMatchObject({ skillsCategorised: 2, newCategories: 1 })
  })

  describe('buildHygienePrompt', () => {
    it('shows each entry with its id and how used it is', () => {
      const s = emptyStore()
      const react = makeSkill({ name: { en: 'React' } })
      s.skills = [react]
      s.projects = [makeProject({ skills: [{ skill_id: react.id, name: { en: 'React' }, proficiency: 3 }] })]

      const p = buildHygienePrompt(s, 'en')
      expect(p).toContain(react.id)
      expect(p).toContain('React')
      expect(p).toMatch(/used: 1/)
    })

    it('lists uncategorised skills and the categories available', () => {
      const p = buildHygienePrompt(storeWithLooseSkills(), 'en')
      expect(p).toContain('existing categories')
      expect(p).toContain('Cloud')
      expect(p).toContain('skills with no category')
      expect(p).toContain('Kubernetes')
    })

    it('says so plainly when there is nothing to categorise', () => {
      const s = storeWithLooseSkills()
      s.skills = s.skills.map((x) => ({ ...x, category_id: 'cat-cloud' }))
      expect(buildHygienePrompt(s, 'en')).toContain('every skill already has a category')
    })

    it('offers to invent categories when there are none', () => {
      const s = emptyStore()
      s.skills = [makeSkill({ name: { en: 'Kubernetes' } })]
      expect(buildHygienePrompt(s, 'en')).toMatch(/no categories yet/i)
    })
  })

  describe('hasRegistryContent', () => {
    it('is false when there is nothing worth tidying', () => {
      const s = emptyStore()
      expect(hasRegistryContent(s)).toBe(false)
      s.skills = [makeSkill()]
      expect(hasRegistryContent(s)).toBe(false) // one entry can't be merged with anything
    })

    it('is true once two entries exist, in any registry', () => {
      const s = emptyStore()
      s.skills = [makeSkill(), makeSkill()]
      expect(hasRegistryContent(s)).toBe(true)
    })
  })
})

// ── C3: glossary ─────────────────────────────────────────────────────────────

describe('glossary', () => {
  function bilingualStore(): ResumeStore {
    const s = emptyStore()
    s.skills = [makeSkill({ name: { no: 'Skydrift', en: 'Cloud operations' } })]
    s.work_experiences = [{
      id: 'we-1', resume_id: 'resume-1',
      employer: { no: 'Statens vegvesen', en: 'Statens vegvesen' },
      role_title: { no: 'Løsningsarkitekt', en: 'Solution architect' },
      description: {}, long_description: {}, role_ids: [],
      start: { year: 2020, month: 1 }, end: null,
      sort_order: 0, starred: false, disabled: false,
    } as unknown as ResumeStore['work_experiences'][number]]
    return s
  }

  it('harvests registry pairs and short identity fields', () => {
    const g = buildGlossary(bilingualStore(), 'no', 'en')
    expect(g.terms).toContainEqual({ from: 'Skydrift', to: 'Cloud operations', origin: 'registry' })
    expect(g.terms).toContainEqual({ from: 'Løsningsarkitekt', to: 'Solution architect', origin: 'field' })
  })

  /**
   * A name written identically in both columns is a do-not-translate
   * instruction the user already gave us.
   */
  it('collects same-in-both-columns names as do-not-translate', () => {
    const g = buildGlossary(bilingualStore(), 'no', 'en')
    expect(g.keep).toContain('Statens vegvesen')
    // …and it is not also a term pair, since there is nothing to map.
    expect(g.terms.some((t) => t.from === 'Statens vegvesen')).toBe(false)
  })

  it('mines no prose — only curated and identity fields', () => {
    const s = bilingualStore()
    s.projects = [makeProject({
      long_description: { no: 'Vi bygde en plattform.', en: 'We built a platform.' },
    })]
    const g = buildGlossary(s, 'no', 'en')
    expect(g.terms.some((t) => t.from.includes('bygde'))).toBe(false)
  })

  /**
   * Scoping is what makes this work on a small model: four relevant mappings
   * get honoured, three hundred get ignored.
   */
  it('scopes to terms that actually occur in the text', () => {
    const g = buildGlossary(bilingualStore(), 'no', 'en')
    const scoped = scopeGlossary(g, 'Jeg jobbet med Skydrift for Statens vegvesen.')
    expect(scoped.terms.map((t) => t.from)).toEqual(['Skydrift'])
    expect(scoped.keep).toEqual(['Statens vegvesen'])
    // The role title isn't in this text, so it isn't sent.
    expect(scoped.terms.some((t) => t.from === 'Løsningsarkitekt')).toBe(false)
  })

  it('returns nothing when there is nothing to say', () => {
    expect(glossaryFor(emptyStore(), 'no', 'en', 'noe tekst')).toBeUndefined()
    expect(toPayload({ terms: [], keep: [] })).toBeUndefined()
    // Same language in and out is not a translation.
    expect(buildGlossary(bilingualStore(), 'no', 'no').terms).toHaveLength(0)
  })

  it('will not match a term inside a longer Norwegian word', () => {
    expect(mentions('Skydriften vår', 'Skydrift')).toBe(false)
    expect(mentions('Vår Skydrift er god', 'Skydrift')).toBe(true)
  })
})
