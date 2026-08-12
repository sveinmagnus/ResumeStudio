import { describe, it, expect } from 'vitest'
import { emptyStore, makeProject, makeRole, makeSkill, makeResume, makeView, makeSkillCategory,
} from './fixtures'
import type { ResumeStore, ResumeView } from '../src/types'
import { buildViewSections } from '../src/lib/viewFilter'
import {
  auditCoverage, containsTerm, coverageTally, extractPostingTerms,
  validateAtsResponse, InvalidAtsResponseError, runLiteralAudit, buildAtsPrompt,
} from '../src/lib/atsAudit'
import {
  applyHygiene, buildHygienePrompt, hasRegistryContent, hygieneImpact,
  validateHygiene, InvalidHygieneError,
} from '../src/lib/registryHygiene'
import { countSkillReferences } from '../src/lib/merge'
import { resolve } from '../src/lib/locales'
import {
  buildGlossary, scopeGlossary, glossaryFor, mentions, toPayload, MAX_SCOPED_TERMS,
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

  it('never matches on an empty or blank term', () => {
    // Both would compile to a pattern that matches between any two non-letters,
    // marking terms as covered on the strength of a space. The haystack has to
    // contain such a position or the bug is invisible.
    expect(containsTerm('C++ / .NET', '')).toBe(false)
    expect(containsTerm('C++ / .NET', ' ')).toBe(false)
    expect(containsTerm('C++ / .NET', '   ')).toBe(false)
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

  it('picks up registry ROLES the posting mentions, not only skills', () => {
    // Roles are half the registry evidence and were never read here.
    const s = emptyStore()
    s.roles = [makeRole({ name: { en: 'Solutions Architect' } }), makeRole({ name: { en: 'Scrum Master' } })]
    const terms = extractPostingTerms('We need a solutions architect for the platform.', s, 'en')
    expect(terms).toContain('Solutions Architect')
    expect(terms).not.toContain('Scrum Master')
  })

  it('strips trailing punctuation off a term', () => {
    const s = emptyStore()
    s.skills = [makeSkill({ name: { en: 'Kubernetes' } })]
    // The registry name arrives clean, but a capitalised run does not: without
    // the strip the report lists "Kubernetes," and "Kubernetes" separately.
    const terms = extractPostingTerms('Stack: Kubernetes, Terraform.', s, 'en')
    expect(terms).toContain('Terraform')
    expect(terms.some((t) => /[.,]$/.test(t))).toBe(false)
  })

  it('drops boilerplate whatever its capitalisation, and bare numbers', () => {
    const s = emptyStore()
    const terms = extractPostingTerms('Requirements: 2026 Experience and Qualifications.', s, 'en')
    expect(terms).not.toContain('Requirements')
    expect(terms).not.toContain('Experience')
    expect(terms).not.toContain('Qualifications')
    // A year is not a requirement.
    expect(terms).not.toContain('2026')
  })

  it('holds terms to a sane length', () => {
    const s = emptyStore()
    const long = `L${'o'.repeat(70)}ng`
    // Mid-sentence on purpose: after a full stop the sentence-start rule would
    // drop it anyway, and the length ceiling would never be what was tested.
    const terms = extractPostingTerms(`Stack: ${long} and Go daily.`, s, 'en')
    expect(terms).toContain('Go') // exactly the two-character floor, and a real technology
    expect(terms).not.toContain(long)
  })

  it('keeps the spelling it saw first when a term repeats', () => {
    const s = emptyStore()
    // Counting the entries proves nothing — the map is keyed by the lowercased
    // term either way. Which SPELLING survives is the actual behaviour.
    const terms = extractPostingTerms('KUBERNETES everywhere. We prefer Kubernetes here.', s, 'en')
    expect(terms).toContain('KUBERNETES')
    expect(terms).not.toContain('Kubernetes')
  })

  it('reads only the first 20,000 characters of a posting', () => {
    const s = emptyStore()
    // Not preceded by a full stop, so only the cap can keep it out.
    const terms = extractPostingTerms(`${'filler filler '.repeat(2000)}using Kubernetes`, s, 'en')
    expect(terms).not.toContain('Kubernetes')
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

    it('heads only the registries that have entries', () => {
      // An empty heading invites the model to answer about a registry with
      // nothing in it, and every merge it then proposes is unresolvable.
      const s = emptyStore()
      s.skills = [makeSkill({ name: { en: 'React' } })]
      const p = buildHygienePrompt(s, 'en')
      expect(p).toContain('## skills')
      expect(p).not.toContain('## roles')
      expect(p).not.toContain('## industries')
    })

    it('skips a nameless entry rather than listing a blank row', () => {
      // A row with no name is an id the model can merge without seeing what it
      // is. (A name in ANOTHER language is fine — resolve() falls back — so
      // this is specifically the entry with nothing in any locale.)
      const s = emptyStore()
      const named = makeSkill({ name: { en: 'React' } })
      const nameless = makeSkill({ name: {} })
      const otherLanguage = makeSkill({ name: { no: 'Skydrift' } })
      s.skills = [named, nameless, otherLanguage]

      // Read the REGISTRY catalog alone: the uncategorised-skills block below
      // lists ids without filtering on name, so an unscoped assertion would
      // find it there and prove nothing.
      const p = buildHygienePrompt(s, 'en')
      const catalog = p.slice(p.indexOf('## skills'), p.indexOf('## existing categories'))
      expect(catalog).toContain(named.id)
      expect(catalog).toContain(otherLanguage.id)
      expect(catalog).not.toContain(nameless.id)
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

  it('takes a two-character term but not a one-character one', () => {
    // "IT" and "AI" are the edge the floor is set for; a single character
    // matches inside half the words in the text.
    const s = emptyStore()
    s.skills = [
      makeSkill({ name: { no: 'IT', en: 'IT-drift' } }),
      makeSkill({ name: { no: 'C', en: 'C-språket' } }),
    ]
    const from = buildGlossary(s, 'no', 'en').terms.map((t) => t.from)
    expect(from).toContain('IT')
    expect(from).not.toContain('C')
  })

  it('drops a term longer than a term could sensibly be', () => {
    const s = emptyStore()
    s.skills = [makeSkill({ name: { no: 'x'.repeat(61), en: 'Long' } })]
    expect(buildGlossary(s, 'no', 'en').terms).toEqual([])
  })

  it('ignores a "term" made only of punctuation or digits', () => {
    // The two columns must DIFFER, or the identical-value rule rejects them
    // first and the letter test is never what did the work. A model told to
    // render "2024" as "2025" is a corruption, not a glossary entry.
    const s = emptyStore()
    s.skills = [
      makeSkill({ name: { no: '2024', en: '2025' } }),
      makeSkill({ name: { no: '- -', en: '--' } }),
    ]
    expect(buildGlossary(s, 'no', 'en').terms).toEqual([])
  })

  it('flattens whitespace before comparing the two columns', () => {
    // `keep` comes from identity fields on items. The two columns are typed
    // separately, so without normalising, the same employer with a stray double
    // space reads as a pair to TRANSLATE rather than a name to leave alone.
    const s = bilingualStore()
    s.work_experiences[0].employer = { no: '  Statens   vegvesen ', en: 'Statens vegvesen' }
    const g = buildGlossary(s, 'no', 'en')
    expect(g.keep).toContain('Statens vegvesen')
    expect(g.terms.some((t) => t.from.includes('vegvesen'))).toBe(false)
  })

  it('will not match a term inside a longer Norwegian word', () => {
    expect(mentions('Skydriften vår', 'Skydrift')).toBe(false)
    expect(mentions('Vår Skydrift er god', 'Skydrift')).toBe(true)
  })
})

/**
 * B4's free first pass, end to end.
 *
 * runLiteralAudit had 8 mutants and none killed — nothing called it, even
 * though it is the half of this feature that works on an install with NO model
 * configured (§15). Its whole value rests on one comparison being like-for-
 * like: both texts come from the same builder, one through the view and one
 * through a wide-open copy of it, so `elsewhere` really means "your CV says
 * this, but THIS view leaves it out" rather than "the JSON differs from the
 * export".
 */
describe('runLiteralAudit — the pass that needs no model', () => {
  const store = (): ResumeStore => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Kari Nordmann' })
    s.skills = [makeSkill({ id: 'k8s', name: { en: 'Kubernetes' } })]
    s.projects = [
      makeProject({ id: 'p1', customer: { en: 'Acme' }, long_description: { en: 'Ran Kubernetes in production.' } }),
      makeProject({ id: 'p2', customer: { en: 'Beta' }, long_description: { en: 'Wrote a lot of Fortran.' } }),
    ]
    return s
  }
  const view = (over: Partial<ResumeView> = {}) =>
    makeView({ sections: buildViewSections(), ...over }) as ResumeView

  const statusOf = (cov: { terms: { term: string; status: string }[] }, term: string) =>
    cov.terms.find((t) => t.term.toLowerCase() === term.toLowerCase())?.status

  it('marks a term the view exports as present', () => {
    const cov = runLiteralAudit(store(), view(), 'en', 'We need Kubernetes experience.')
    expect(statusOf(cov, 'kubernetes')).toBe('present')
  })

  it('marks a term the CV has but THIS view excludes as elsewhere', () => {
    // The status worth having: fixable by re-including an item, with no
    // writing at all. It only works because the master text is rendered
    // through the same builder with the exclusions lifted.
    const excluded = view({ excluded_item_ids: ['p2'] })
    const cov = runLiteralAudit(store(), excluded, 'en', 'Fortran maintenance required.')
    expect(statusOf(cov, 'fortran')).toBe('elsewhere')
  })

  it('marks a term the CV does not have at all as absent', () => {
    // Comma-separated, because the extractor groups ADJACENT capitalised words
    // — "Deep COBOL expertise" yields the term "Deep COBOL", not "COBOL".
    const cov = runLiteralAudit(store(), view(), 'en', 'Kubernetes, Fortran and COBOL.')
    expect(statusOf(cov, 'cobol')).toBe('absent')
  })

  it('lifts starred_only for the master comparison too', () => {
    // A starred-only view hides unstarred items; without clearing the flag the
    // master text would be just as narrow and every gap would read as absent.
    const s = store()
    s.projects[0].starred = true
    const cov = runLiteralAudit(s, view({ starred_only: true }), 'en', 'Fortran maintenance required.')
    expect(statusOf(cov, 'fortran')).toBe('elsewhere')
  })

  it('flags a term the registry knows, from EITHER the skill or role registry', () => {
    // Both registries feed the known set; leaving roles out would mark a job
    // title the consultant has curated as an unrecognised keyword.
    const s = store()
    s.roles = [makeRole({ id: 'arch', name: { en: 'Architect' } })]
    const cov = runLiteralAudit(s, view(), 'en', 'Kubernetes, Architect and COBOL.')
    const known = (t: string) => cov.terms.find((x) => x.term.toLowerCase() === t)!.known
    expect(known('kubernetes')).toBe(true)
    expect(known('architect')).toBe(true)
    expect(known('cobol')).toBe(false)
  })

  it('puts the gaps first — the report is a to-do list', () => {
    const cov = runLiteralAudit(store(), view({ excluded_item_ids: ['p2'] }), 'en',
      'Kubernetes, Fortran and COBOL.')
    const order = cov.terms.map((t) => t.status)
    expect(order.indexOf('present')).toBe(order.length - 1)
    expect(order[0]).not.toBe('present')
  })

  it('reports the size of the document it actually measured', () => {
    const cov = runLiteralAudit(store(), view(), 'en', 'Kubernetes.')
    expect(cov.documentChars).toBeGreaterThan(0)
  })

  it('returns nothing to act on for an empty posting', () => {
    expect(runLiteralAudit(store(), view(), 'en', '').terms).toEqual([])
  })
})

describe('buildAtsPrompt — what the model is asked to judge', () => {
  const coverage = {
    terms: [
      { term: 'Kubernetes', status: 'present' as const, known: true },
      { term: 'Fortran', status: 'elsewhere' as const, known: false },
      { term: 'COBOL', status: 'absent' as const, known: false },
    ],
    documentChars: 100,
  }

  it('sends ONLY the terms the literal pass could not find', () => {
    // A term already in the document needs no judgement, and leaving them out
    // is what keeps this small enough for the cheap models it should run on.
    // Scoped to the TERMS TO JUDGE block: the instructions legitimately name
    // Kubernetes as a synonym example, so a whole-prompt search proves nothing.
    const p = buildAtsPrompt(coverage, 'the cv text', 'the posting', 'en')
    const judge = p.split('--- TERMS TO JUDGE ---')[1].split('---')[0]
    expect(judge).toContain('Fortran')
    expect(judge).toContain('COBOL')
    expect(judge).not.toContain('Kubernetes')
  })

  it('carries the document and the posting, so a verdict can cite them', () => {
    const p = buildAtsPrompt(coverage, 'MARKER-CV-TEXT', 'MARKER-POSTING', 'en')
    expect(p).toContain('MARKER-CV-TEXT')
    expect(p).toContain('MARKER-POSTING')
  })

  it('demands a QUOTE for a covered verdict', () => {
    // §15: a covered verdict with no supporting quote is downgraded, because
    // the quote is the evidence. The prompt has to ask for it.
    expect(buildAtsPrompt(coverage, 'x', 'y', 'en')).toMatch(/quote/i)
  })
})

/**
 * The rejections C4's validator is made of.
 *
 * A registry merge is the most destructive act in the app and the least
 * noticeable when wrong (§15), so this validator's job is to refuse things —
 * and 21 of its mutants were unreached. Each refusal below either deletes the
 * wrong entry or silently drops a proposal the user then cannot see.
 */
describe('validateHygiene — what it refuses', () => {
  const hygStore = (): ResumeStore => {
    const s = emptyStore()
    s.skills = [
      makeSkill({ id: 's1', name: { en: 'Kubernetes' } }),
      makeSkill({ id: 's2', name: { en: 'K8s' } }),
      makeSkill({ id: 's3', name: { en: 'Go' }, category_id: 'c1' }),
    ]
    s.skill_categories = [{ id: 'c1', resume_id: 'r', name: { en: 'Languages' }, sort_order: 0 } as never]
    return s
  }
  const reply = (over: Record<string, unknown>) => ({ merges: [], categories: [], ...over })
  const run = (over: Record<string, unknown>) => validateHygiene(reply(over), hygStore(), 'en')

  describe('merges', () => {
    it('refuses a merge of an entry into ITSELF', () => {
      // It would delete the entry and rewrite its references to a row that no
      // longer exists.
      const r = run({ merges: [{ kind: 'skills', keep_id: 's1', drop_id: 's1' }] })
      expect(r.merges).toHaveLength(0)
      expect(r.dropped.join(' ')).toMatch(/into itself/i)
    })

    it('refuses a merge naming a registry that does not exist', () => {
      const r = run({ merges: [{ kind: 'vegetables', keep_id: 's1', drop_id: 's2' }] })
      expect(r.merges).toHaveLength(0)
      expect(r.dropped.join(' ')).toMatch(/unknown registry/i)
    })

    it('refuses an entry that is not an object at all', () => {
      const r = run({ merges: ['just a string', null] })
      expect(r.merges).toHaveLength(0)
      expect(r.dropped).toHaveLength(2)
    })

    it('names the 1-BASED position of each rejected proposal', () => {
      // The message is how the user finds which row was skipped; a 0-based
      // index points at the wrong one.
      // Every rejection path numbers independently, so both are checked.
      expect(run({ merges: [{ kind: 'skills', keep_id: 's1', drop_id: 's1' }] }).dropped[0])
        .toContain('Merge 1')
      expect(run({ merges: ['not an object'] }).dropped[0]).toContain('Merge 1')
      expect(run({ categories: [{ skill_id: 'nope' }] }).dropped[0]).toContain('Category 1')
    })

    it('reports the reference counts of BOTH sides, not just the one being dropped', () => {
      // The confirm names how many references are rewritten; the keeper's count
      // is what tells the user which of two similar entries is the real one.
      const r = run({ merges: [{ kind: 'skills', keep_id: 's1', drop_id: 's2', reason: 'same thing' }] })
      expect(r.merges[0]).toMatchObject({
        keepId: 's1', keepName: 'Kubernetes', dropId: 's2', dropName: 'K8s', reason: 'same thing',
      })
      expect(typeof r.merges[0].dropRefs).toBe('number')
      expect(typeof r.merges[0].keepRefs).toBe('number')
    })

    it('caps the batch rather than accepting an unbounded list', () => {
      const many = Array.from({ length: 200 }, () => ({ kind: 'skills', keep_id: 's1', drop_id: 's2' }))
      const r = run({ merges: many })
      expect(r.merges.length + r.dropped.length).toBeLessThanOrEqual(60)
    })
  })

  describe('categories', () => {
    it('refuses to re-categorise a skill the user placed, and SAYS so', () => {
      // Silence here would look like the model simply had no opinion.
      const r = run({ categories: [{ skill_id: 's3', category_name: 'Backend' }] })
      expect(r.categories).toHaveLength(0)
      expect(r.dropped.join(' ')).toMatch(/already placed/i)
    })

    it('refuses a skill that is not in the registry', () => {
      const r = run({ categories: [{ skill_id: 'nope', category_name: 'Backend' }] })
      expect(r.dropped.join(' ')).toMatch(/isn't in the registry/i)
    })

    it('refuses a category id that does not exist', () => {
      const r = run({ categories: [{ skill_id: 's1', category_id: 'ghost' }] })
      expect(r.categories).toHaveLength(0)
      expect(r.dropped.join(' ')).toMatch(/doesn't exist/i)
    })

    it('resolves an EXISTING category id to its name, ignoring any name sent alongside', () => {
      const r = run({ categories: [{ skill_id: 's1', category_id: 'c1', category_name: 'Wrong' }] })
      expect(r.categories[0]).toMatchObject({ categoryName: 'Languages' })
    })

    it('accepts a brand-new category by name', () => {
      const r = run({ categories: [{ skill_id: 's1', category_name: 'Container platforms' }] })
      expect(r.categories[0]).toMatchObject({ categoryName: 'Container platforms' })
    })

    it('refuses a proposal with neither an id nor a name', () => {
      const r = run({ categories: [{ skill_id: 's1' }] })
      expect(r.categories).toHaveLength(0)
      expect(r.dropped.join(' ')).toMatch(/no category name/i)
    })

    it('keeps the FIRST proposal for a skill and silently ignores a repeat', () => {
      // A duplicate is not a user-visible problem — the first answer stands.
      const r = run({ categories: [
        { skill_id: 's1', category_name: 'First' },
        { skill_id: 's1', category_name: 'Second' },
      ] })
      expect(r.categories).toHaveLength(1)
      expect(r.categories[0]).toMatchObject({ categoryName: 'First' })
    })
  })

  it('accepts a reply carrying only ONE of the two lists', () => {
    expect(() => validateHygiene({ merges: [] }, hygStore(), 'en')).not.toThrow()
    expect(() => validateHygiene({ categories: [] }, hygStore(), 'en')).not.toThrow()
  })

  it('rejects a non-object reply outright', () => {
    for (const bad of [null, 'text', 42]) {
      expect(() => validateHygiene(bad, hygStore(), 'en')).toThrow(InvalidHygieneError)
    }
  })
})

/**
 * C3's glossary derivation and scoping.
 *
 * The glossary is invisible — it rides the ordinary Draft button with no UI
 * (§15) — so a rule that stops working is not something anyone sees. Its value
 * is being CERTAIN: it mines only data that already holds a term pair, and it
 * narrows to what the field being translated actually mentions, because a
 * 300-entry list is not something a 3B model can obey.
 */
describe('glossary — derivation and scoping', () => {
  const store = (): ResumeStore => {
    const s = emptyStore()
    s.skills = [makeSkill({ id: 's1', name: { en: 'Cloud', no: 'Sky' } })]
    s.roles = [makeRole({ id: 'r1', name: { en: 'Architect', no: 'Arkitekt' } })]
    return s
  }

  it('is empty when the two languages are the same, or either is missing', () => {
    // Nothing to translate — and a glossary mapping a term to itself would just
    // be noise in the prompt.
    // `keep` too: a same-language pair reads as "written identically in both
    // columns", so without the early return every registry name would arrive as
    // a do-not-translate instruction.
    // A store with an identity FIELD as well as registries — `keep` is mined
    // from fields only, so registries alone cannot show the difference.
    const s = store()
    s.projects = [makeProject({ id: 'p1', customer: { en: 'Statens vegvesen' } })]
    for (const [a, b] of [['en', 'en'], ['', 'no'], ['en', '']]) {
      const g = buildGlossary(s, a, b)
      expect(g.terms, `${a}->${b}`).toEqual([])
      expect(g.keep, `${a}->${b}`).toEqual([])
    }
  })

  it('mines the registries in the direction asked for', () => {
    // Skills AND roles — they are separate loops, and a job title is exactly
    // the kind of term a small model renders three different ways.
    const fwd = buildGlossary(store(), 'en', 'no')
    expect(fwd.terms).toContainEqual(expect.objectContaining({ from: 'Cloud', to: 'Sky' }))
    expect(fwd.terms).toContainEqual(expect.objectContaining({ from: 'Architect', to: 'Arkitekt' }))
    const back = buildGlossary(store(), 'no', 'en')
    expect(back.terms).toContainEqual(expect.objectContaining({ from: 'Sky', to: 'Cloud' }))
    expect(back.terms).toContainEqual(expect.objectContaining({ from: 'Arkitekt', to: 'Architect' }))
  })

  it('takes a name written IDENTICALLY in both columns as do-not-translate', () => {
    // The user already told us: they chose not to translate it.
    const s = store()
    s.projects = [makeProject({ id: 'p1', customer: { en: 'Statens vegvesen', no: 'Statens vegvesen' } })]
    expect(buildGlossary(s, 'en', 'no').keep).toContain('Statens vegvesen')
  })

  it('does NOT mine prose — that would need a model, which is the point of not doing it', () => {
    const s = store()
    s.projects = [makeProject({
      id: 'p1', customer: {},
      long_description: { en: 'Ran the migration', no: 'Kjørte migrasjonen' },
    })]
    const g = buildGlossary(s, 'en', 'no')
    expect(g.terms.map((t) => t.from)).not.toContain('Ran the migration')
  })

  it('narrows to the terms the text actually mentions', () => {
    const g = buildGlossary(store(), 'en', 'no')
    const scoped = scopeGlossary(g, 'We moved it to the Cloud.')
    expect(scoped.terms.map((t) => t.from)).toEqual(['Cloud'])
  })

  it('is empty for empty text, rather than sending everything', () => {
    const g = buildGlossary(store(), 'en', 'no')
    expect(scopeGlossary(g, '   ').terms).toEqual([])
  })

  it('puts the LONGEST match first', () => {
    // A longer term is the more specific instruction, and a small model obeys
    // the top of a list more reliably than the bottom.
    const s = emptyStore()
    s.skills = [
      makeSkill({ id: 'a', name: { en: 'Cloud', no: 'Sky' } }),
      makeSkill({ id: 'b', name: { en: 'Cloud architecture', no: 'Skyarkitektur' } }),
    ]
    const scoped = scopeGlossary(buildGlossary(s, 'en', 'no'), 'Our Cloud architecture is good.')
    expect(scoped.terms[0].from).toBe('Cloud architecture')
  })
})


/**
 * The ATS validator's downgrade rules, and the glossary's scoping cap.
 */
describe('validateAtsResponse — the downgrade rules', () => {
  const asked = ['Kubernetes', 'Fortran']
  const reply = (equivalences: unknown[]) => ({ $schema: 'resumestudio-ats/v1', equivalences })

  it('drops a verdict about a term nobody asked about', () => {
    // The model invented it, so it is not in the posting — reporting it would
    // put a requirement on screen that the employer never stated.
    const out = validateAtsResponse(reply([
      { term: 'Kubernetes', verdict: 'covered', quote: 'Ran Kubernetes.' },
      { term: 'Nonesuch', verdict: 'covered', quote: 'x' },
    ]), asked)
    expect(out.equivalences.map((e) => e.term)).toEqual(['Kubernetes'])
  })

  it('matches the asked term case-insensitively', () => {
    const out = validateAtsResponse(reply([
      { term: 'kubernetes', verdict: 'covered', quote: 'Ran Kubernetes.' },
    ]), asked)
    expect(out.equivalences).toHaveLength(1)
  })

  it('downgrades a COVERED verdict with no quote', () => {
    // The quote IS the evidence; an unquoted claim of coverage is the false
    // reassurance that lets someone send a CV believing it says something it
    // does not.
    const out = validateAtsResponse(reply([
      { term: 'Kubernetes', verdict: 'covered', quote: '' },
    ]), asked)
    expect(out.equivalences[0].verdict).not.toBe('covered')
  })

  it('keeps a covered verdict that carries a quote', () => {
    const out = validateAtsResponse(reply([
      { term: 'Kubernetes', verdict: 'covered', quote: 'Ran Kubernetes in production.' },
    ]), asked)
    expect(out.equivalences[0].verdict).toBe('covered')
  })

  it('does not require a quote for the other verdicts', () => {
    const out = validateAtsResponse(reply([
      { term: 'Kubernetes', verdict: 'missing' },
      { term: 'Fortran', verdict: 'phrasing', suggestion: 'Name it in the Acme project.' },
    ]), asked)
    expect(out.equivalences.map((e) => e.verdict)).toEqual(['missing', 'phrasing'])
  })

  it('treats an unknown verdict as missing rather than guessing upward', () => {
    const out = validateAtsResponse(reply([
      { term: 'Kubernetes', verdict: 'probably', quote: 'x' },
    ]), asked)
    expect(out.equivalences[0].verdict).toBe('missing')
  })

  it('rejects a reply that is not an object or has no equivalences array', () => {
    expect(() => validateAtsResponse(null, asked)).toThrow(InvalidAtsResponseError)
    expect(() => validateAtsResponse({ $schema: 'resumestudio-ats/v1' }, asked))
      .toThrow(InvalidAtsResponseError)
  })

  it('skips an entry that is not an object', () => {
    const out = validateAtsResponse(reply(['nonsense', null, { term: 'Kubernetes', verdict: 'missing' }]), asked)
    expect(out.equivalences).toHaveLength(1)
  })
})

describe('scopeGlossary — the cap', () => {
  const store = (n: number): ResumeStore => {
    const s = emptyStore()
    s.skills = Array.from({ length: n }, (_, i) =>
      makeSkill({ id: `s${i}`, name: { en: `Term${i}`, no: `Uttrykk${i}` } }))
    return s
  }

  it('caps how many terms reach the prompt', () => {
    // A 300-entry glossary is not something a 3B model can obey; the cap is what
    // makes the mechanism usable at all.
    const g = buildGlossary(store(60), 'en', 'no')
    expect(g.terms.length).toBeGreaterThan(MAX_SCOPED_TERMS)
    const text = Array.from({ length: 60 }, (_, i) => `Term${i}`).join(' ')
    expect(scopeGlossary(g, text).terms.length).toBe(MAX_SCOPED_TERMS)
  })

  it('keeps the longest matches when it caps', () => {
    const s = emptyStore()
    s.skills = [
      makeSkill({ id: 'a', name: { en: 'Cloud', no: 'Sky' } }),
      makeSkill({ id: 'b', name: { en: 'Cloud architecture', no: 'Skyarkitektur' } }),
    ]
    const scoped = scopeGlossary(buildGlossary(s, 'en', 'no'), 'Our Cloud architecture works.')
    expect(scoped.terms[0].from).toBe('Cloud architecture')
  })

  it('matches a term only on a word boundary', () => {
    // 'Go' must not match inside 'Google', or every CV mentioning Google gets a
    // do-not-translate instruction for the wrong term.
    const s = emptyStore()
    // A DIFFERENT translation, so the pair lands in `terms` rather than in the
    // do-not-translate list (identical names go there instead).
    s.skills = [makeSkill({ id: 'go', name: { en: 'Go', no: 'Golang' } })]
    const g = buildGlossary(s, 'en', 'no')
    expect(scopeGlossary(g, 'We used Google Cloud.').terms).toEqual([])
    expect(scopeGlossary(g, 'We used Go.').terms.map((t) => t.from)).toEqual(['Go'])
  })
})

/**
 * C4's apply step and its blast-radius summary.
 *
 * applyHygiene is the one place this feature mutates anything, and a registry
 * merge is the most destructive act in the app (§15). The confirm dialog names
 * totals that come from hygieneImpact, so those numbers have to be the ones the
 * apply actually produces.
 */
describe('applyHygiene and hygieneImpact', () => {
  const store = (): ResumeStore => {
    const s = emptyStore()
    s.resume = makeResume({ id: 'r1', full_name: 'X' })
    s.skills = [
      makeSkill({ id: 'keep', name: { en: 'Kubernetes' } }),
      makeSkill({ id: 'drop', name: { en: 'K8s' } }),
      makeSkill({ id: 'other', name: { en: 'Go' } }),
    ]
    s.projects = [makeProject({
      id: 'p1', customer: { en: 'Acme' },
      skills: [
        { id: 'ps1', skill_id: 'drop', name: { en: 'K8s' }, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 0 },
        { id: 'ps2', skill_id: 'other', name: { en: 'Go' }, duration_in_years: 0, offset_in_years: 0, total_duration_in_years: 0, sort_order: 1 },
      ],
    })]
    return s
  }
  const merge = () => ({
    key: 'merge:skills:drop', kind: 'skills' as const,
    keepId: 'keep', keepName: 'Kubernetes', dropId: 'drop', dropName: 'K8s',
    dropRefs: 1, keepRefs: 0, reason: '',
  })

  it('applies ONLY what is handed in', () => {
    // Nothing is pre-ticked in the UI, so an empty selection must be a no-op.
    const s = store()
    const out = applyHygiene(s, [], [], 'en').data
    expect(out.skills.map((x) => x.id).sort()).toEqual(['drop', 'keep', 'other'])
  })

  it('deletes the dropped entry and rewrites its references', () => {
    const out = applyHygiene(store(), [merge()], [], 'en').data
    expect(out.skills.map((x) => x.id).sort()).toEqual(['keep', 'other'])
    expect(out.projects[0].skills.map((ps) => ps.skill_id).sort()).toEqual(['keep', 'other'])
  })

  it('updates the denormalised snapshot name on a rewritten link', () => {
    // The link carries a copy of the name at link time; leaving it stale shows
    // the deleted spelling in every export.
    const out = applyHygiene(store(), [merge()], [], 'en').data
    const link = out.projects[0].skills.find((ps) => ps.skill_id === 'keep')!
    expect(resolve(link.name, 'en')).toBe('Kubernetes')
  })

  it('leaves an unrelated reference alone', () => {
    const out = applyHygiene(store(), [merge()], [], 'en').data
    expect(out.projects[0].skills.some((ps) => ps.skill_id === 'other')).toBe(true)
  })

  it('skips a merge whose entry has disappeared since the run', () => {
    // The panel is non-blocking, so the registry may have changed underneath it.
    const s = store()
    s.skills = s.skills.filter((x) => x.id !== 'drop')
    expect(() => applyHygiene(s, [merge()], [], 'en').data).not.toThrow()
    expect(applyHygiene(s, [merge()], [], 'en').data.skills.map((x) => x.id).sort())
      .toEqual(['keep', 'other'])
  })

  it('assigns a category, creating it when it does not exist yet', () => {
    const out = applyHygiene(store(), [], [{
      key: 'cat:other', skillId: 'other', skillName: 'Go',
      categoryId: null, categoryName: 'Languages',
    }], 'en').data
    const cat = out.skill_categories!.find((c) => resolve(c.name, 'en') === 'Languages')!
    expect(cat).toBeDefined()
    expect(out.skills.find((x) => x.id === 'other')!.category_id).toBe(cat.id)
  })

  it('reuses an existing category rather than creating a second', () => {
    const s = store()
    s.skill_categories = [makeSkillCategory({ id: 'c1', name: { en: 'Languages' } })]
    const out = applyHygiene(s, [], [{
      key: 'cat:other', skillId: 'other', skillName: 'Go',
      categoryId: 'c1', categoryName: 'Languages',
    }], 'en').data
    expect(out.skill_categories).toHaveLength(1)
    expect(out.skills.find((x) => x.id === 'other')!.category_id).toBe('c1')
  })

  it('counts exactly what the confirm dialog promises', () => {
    // The dialog names these totals before anything is applied; they have to
    // match what the apply then does.
    const impact = hygieneImpact([merge()], [{
      key: 'cat:other', skillId: 'other', skillName: 'Go',
      categoryId: null, categoryName: 'Languages',
    }])
    expect(impact).toMatchObject({
      entriesDeleted: 1, referencesRewritten: 1, skillsCategorised: 1,
    })
    expect(impact.newCategories).toBeGreaterThanOrEqual(0)
  })

  it('counts nothing for an empty selection', () => {
    expect(hygieneImpact([], [])).toMatchObject({
      entriesDeleted: 0, referencesRewritten: 0, skillsCategorised: 0, newCategories: 0,
    })
  })
})

/**
 * Pulling terms out of a pasted posting.
 *
 * B4's free first pass has no model behind it: it finds the words worth checking
 * by looking for registry names and for capitalised runs. Both halves of that
 * heuristic are load-bearing — too eager and the report is a wall of sentence
 * openers, too shy and it misses the technology the posting is actually about.
 */
describe('extractPostingTerms — which words a posting offers', () => {
  const terms = (posting: string, store = emptyStore()) => extractPostingTerms(posting, store, 'en')

  it('takes a capitalised name, including a two- or three-word one', () => {
    expect(terms('We use Kubernetes and Azure DevOps here.')).toContain('Kubernetes')
    expect(terms('We use Kubernetes and Azure DevOps here.')).toContain('Azure DevOps')
    expect(terms('Experience with Amazon Web Services required.')).toContain('Amazon Web Services')
  })

  it('drops a capitalised word that also appears in lower case', () => {
    // "Tooling" at the start of a sentence and "tooling" mid-sentence are the
    // same ordinary word, not a requirement.
    expect(terms('Tooling matters. We value tooling here.')).not.toContain('Tooling')
  })

  it('normalises a registry name before offering it', () => {
    // Registry names reach the list directly, so their own padding and trailing
    // punctuation is what has to be cleaned up.
    const store = emptyStore()
    store.skills = [
      makeSkill({ id: 's1', name: { en: ' Go .' } }),
      makeSkill({ id: 's2', name: { en: 'Node.js..' } }),
    ]
    // The posting has to mention each name as the registry spells it, or the
    // entry is never offered at all.
    const out = extractPostingTerms('We use  Go . and Node.js.. daily.', store, 'en')
    expect(out).toContain('Go')
    expect(out).toContain('Node.js')
    expect(out.some((t) => t !== t.trim())).toBe(false)
    expect(out).not.toContain('Node.js.')
  })

  it('keeps a term of exactly the length limit', () => {
    const store = emptyStore()
    const sixty = `Go${'x'.repeat(58)}`
    store.skills = [makeSkill({ id: 's1', name: { en: sixty } })]
    expect(extractPostingTerms(`We use ${sixty} here.`, store, 'en')).toContain(sixty)
  })

  it('drops a registry entry that is only a number', () => {
    // A year is not a requirement, however it got into the registry.
    const store = emptyStore()
    store.skills = [makeSkill({ id: 's1', name: { en: '2020' } }), makeSkill({ id: 's2', name: { en: '2020x' } })]
    const out = extractPostingTerms('Since 2020 and 2020x we shipped.', store, 'en')
    expect(out).not.toContain('2020')
    expect(out).toContain('2020x')
  })

  it('drops a single capitalised word that merely starts a sentence', () => {
    // "Knowledge of COBOL is a plus" gets its capital from position.
    const out = terms('We need people. Knowledge of COBOL is a plus.')
    expect(out).not.toContain('Knowledge')
    expect(out).toContain('COBOL')
  })

  it('KEEPS a capitalised word at the start of a bullet line', () => {
    // A newline is deliberately not a sentence boundary: bullet lists are where
    // requirements actually live, so treating line starts as sentence starts
    // would throw all of them away.
    const posting = 'Requirements:\nKubernetes in production\nTerraform for infrastructure'
    expect(terms(posting)).toContain('Kubernetes')
    expect(terms(posting)).toContain('Terraform')
  })

  it('keeps a registry term whatever its position or case in the posting', () => {
    const store = emptyStore()
    store.skills = [makeSkill({ id: 's1', name: { en: 'Go' } })]
    // "Go" would be dropped as a sentence opener on the capitalisation rule
    // alone; being in the registry is what saves it.
    expect(terms('Go is used throughout. we also write go daily.', store)).toContain('Go')
  })

  it('reads a registry name in the requested locale', () => {
    const store = emptyStore()
    store.skills = [makeSkill({ id: 's1', name: { en: 'Spreadsheets', no: 'Regneark' } })]
    expect(extractPostingTerms('Vi bruker regneark mye.', store, 'no')).toContain('Regneark')
  })

  it('lists each term once, however often the posting repeats it', () => {
    const out = terms('Kubernetes, Kubernetes and more Kubernetes.')
    expect(out.filter((t) => t === 'Kubernetes')).toHaveLength(1)
  })

  it('strips the punctuation a sentence leaves on the END of a term', () => {
    expect(terms('Experience with Docker?!')).toContain('Docker')
    expect(terms('We use Kubernetes, daily.')).toContain('Kubernetes')
    expect(terms('Tooling: (Terraform)')).toContain('Terraform')
  })

  it('does not let one term span a sentence boundary', () => {
    // A full stop is a word character to the run pattern ("Node.js"), so without
    // a cut "Kubernetes. Also Terraform" reads as a single requirement.
    const out = terms('We use Kubernetes. Also Terraform, daily.')
    expect(out).toContain('Kubernetes')
    expect(out.some((t) => /[.!?]\s/.test(t))).toBe(false)
  })

  it('drops a term of one character and one absurdly long run', () => {
    // A single letter matches half the CV; a 60-plus-character "term" is a
    // sentence that happened to be capitalised.
    expect(terms('X marks the spot.')).not.toContain('X')
    const long = `Kubernetes ${'Verylongword'.repeat(6)}`
    expect(terms(long).some((t) => t.length > 60)).toBe(false)
  })

  it('drops a bare number but keeps a term that merely contains one', () => {
    // "2020" is a date, not a requirement; "3D" and "S3" are technologies.
    const out = terms('Since 2020 we have used S3 and 3D rendering.')
    expect(out).not.toContain('2020')
    expect(out).toContain('S3')
  })

  it('drops only SINGLE words on the also-lowercase rule', () => {
    // "azure" appearing in prose must not disqualify the multi-word product name.
    const out = terms('We run azure things. Azure DevOps is our pipeline.')
    expect(out).toContain('Azure DevOps')
    expect(out).not.toContain('Azure')
  })

  it('keeps a capitalised term that OPENS the posting', () => {
    // There is no sentence before it, so the look-behind must not treat the
    // start of the text as a full stop.
    expect(terms('Kubernetes experience is required.')).toContain('Kubernetes')
  })

  it('needs whitespace after the full stop to call it a sentence start', () => {
    // "3.5" and "node.js" carry a dot with no space; the word after it is not a
    // sentence opener.
    expect(terms('We need Node.js and Kubernetes.')).toContain('Node.js')
  })

  it('caps the list rather than handing over a whole posting', () => {
    const many = Array.from({ length: 200 }, (_, i) => `Term${i}`).join(' ')
    expect(terms(many).length).toBeLessThanOrEqual(60)
  })
})

/**
 * The glossary is derived per call from data the user already curated, and it
 * rides the ordinary Draft path (CLAUDE.md §15, C3). What it must never do is
 * spend prompt space on pairs that say nothing, or let a guessed pair overwrite a
 * curated one.
 */
describe('buildGlossary — which pairs are worth sending', () => {
  const store = (over: Partial<ResumeStore> = {}) => ({ ...emptyStore(), ...over }) as ResumeStore

  it('takes a registry pair written in both languages', () => {
    const out = buildGlossary(store({
      skills: [makeSkill({ id: 's1', name: { en: 'Spreadsheets', no: 'Regneark' } })],
    }), 'en', 'no')
    expect(out.terms).toContainEqual(expect.objectContaining({ from: 'Spreadsheets', to: 'Regneark' }))
  })

  it('skips a pair that is IDENTICAL in both languages — it teaches nothing', () => {
    const out = buildGlossary(store({
      skills: [makeSkill({ id: 's1', name: { en: 'Kubernetes', no: 'Kubernetes' } })],
    }), 'en', 'no')
    expect(out.terms.map((t) => t.from)).not.toContain('Kubernetes')
    // The same word on an item's identity field DOES become a do-not-translate
    // instruction — that is where `keep` is harvested from.
    const withItem = buildGlossary(store({
      projects: [makeProject({ id: 'p1', customer: { en: 'Kubernetes', no: 'Kubernetes' } })],
    }), 'en', 'no')
    expect(withItem.keep).toContain('Kubernetes')
  })

  it('ignores case when deciding a pair is identical', () => {
    const out = buildGlossary(store({
      skills: [makeSkill({ id: 's1', name: { en: 'Kubernetes', no: 'kubernetes' } })],
    }), 'en', 'no')
    expect(out.terms.map((t) => t.from)).not.toContain('Kubernetes')
  })

  it('skips a pair with a missing half', () => {
    const out = buildGlossary(store({
      skills: [
        makeSkill({ id: 's1', name: { en: 'Only English' } }),
        makeSkill({ id: 's2', name: { no: 'Bare norsk' } }),
      ],
    }), 'en', 'no')
    expect(out.terms).toEqual([])
  })

  it('lets a REGISTRY pair win over a field pair for the same term', () => {
    // The registry names are curated; a field pair is whatever the two columns
    // happen to say, so it must not overwrite one.
    const out = buildGlossary(store({
      skills: [makeSkill({ id: 's1', name: { en: 'Customer', no: 'Kunde' } })],
      projects: [makeProject({ id: 'p1', customer: { en: 'Customer', no: 'Oppdragsgiver' } })],
    }), 'en', 'no')
    const pair = out.terms.find((t) => t.from.toLowerCase() === 'customer')!
    expect(pair.to).toBe('Kunde')
  })

  it('does not let a second field pair overwrite the first', () => {
    const out = buildGlossary(store({
      projects: [
        makeProject({ id: 'p1', customer: { en: 'Bank', no: 'Banken' } }),
        makeProject({ id: 'p2', customer: { en: 'Bank', no: 'Sparebanken' } }),
      ],
    }), 'en', 'no')
    expect(out.terms.filter((t) => t.from.toLowerCase() === 'bank')).toHaveLength(1)
    expect(out.terms.find((t) => t.from.toLowerCase() === 'bank')!.to).toBe('Banken')
  })

  it('collects a name written identically in both columns as do-not-translate', () => {
    const out = buildGlossary(store({
      projects: [makeProject({ id: 'p1', customer: { en: 'Statens vegvesen', no: 'Statens vegvesen' } })],
    }), 'en', 'no')
    expect(out.keep).toContain('Statens vegvesen')
  })

  it('does NOT collect a name the user actually translated', () => {
    // "Bank"/"Banken" is a term pair, not a do-not-translate instruction; keeping
    // it would tell the model to leave the Norwegian column in English.
    const out = buildGlossary(store({
      projects: [makeProject({ id: 'p1', customer: { en: 'Bank', no: 'Banken' } })],
    }), 'en', 'no')
    expect(out.keep).not.toContain('Bank')
    expect(out.terms).toContainEqual(expect.objectContaining({ from: 'Bank', to: 'Banken' }))
  })

  it('collects a name that only the SOURCE column has as do-not-translate', () => {
    // A name filled in one column and left empty in the other is a name the user
    // has not translated — which is itself the instruction.
    const out = buildGlossary(store({
      projects: [makeProject({ id: 'p1', customer: { en: 'NAV', no: '' } })],
    }), 'en', 'no')
    expect(out.keep).toContain('NAV')
  })

  it('lists a kept name once, however many items carry it', () => {
    const out = buildGlossary(store({
      projects: [
        makeProject({ id: 'p1', customer: { en: 'NAV', no: 'NAV' } }),
        makeProject({ id: 'p2', customer: { en: 'NAV', no: 'NAV' } }),
      ],
    }), 'en', 'no')
    expect(out.keep.filter((k) => k === 'NAV')).toHaveLength(1)
  })
})
