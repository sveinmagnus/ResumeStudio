import { describe, it, expect } from 'vitest'
import {
  emptyStore, makeCertification, makeCourse, makeEducation, makeKQ, makeProject, makeView,
  makeWork, makeKeyCompetency,
} from './fixtures'
import type { KeyCompetency, ResumeStore } from '../src/types'
import { buildCvDigest, buildBilingualDigest, itemLabel, itemFacts } from '../src/lib/cvDigest'
import { CV_SECTIONS, fieldOf, fieldsOf, isAdvisorSection, itemsOf } from '../src/lib/cvFields'
import { validateFindings, InvalidFindingsError, FINDINGS_SCHEMA } from '../src/lib/assistFindings'
import {
  validateProposals, applyProposals, InvalidProposalsError,
} from '../src/lib/assistProposals'
import {
  validateMining, applyAchievements, buildMiningPrompt, InvalidMiningError,
  MINING_SCHEMA, MINING_SECTIONS, type Achievement,
} from '../src/lib/achievementMining'
import { validateProfileDraft, applyProfileDraft, buildProfilePrompt } from '../src/lib/profileGenerator'
import { tidyIntro, buildIntroPrompt, DEFAULT_INTRO_FOCUS } from '../src/lib/introDraft'
import { buildCvReviewPrompt } from '../src/lib/cvReview'
import { buildViewSections } from '../src/lib/viewFilter'
import { buildVoicePassPrompt } from '../src/lib/voicePass'

/** A store with one project carrying text in both languages. */
function storeWithProject(over: Partial<Parameters<typeof makeProject>[0]> = {}): ResumeStore {
  const s = emptyStore()
  s.projects = [makeProject({
    customer: { en: 'Acme', no: 'Acme' },
    description: { en: 'Payments platform' },
    long_description: { en: 'Was responsible for various work.', no: 'Ansvarlig for arbeid.' },
    ...over,
  })]
  return s
}

const pid = (s: ResumeStore) => s.projects[0].id

describe('cvFields', () => {
  it('knows which sections and fields the advisors may touch', () => {
    const s = emptyStore()
    expect(isAdvisorSection('projects', s)).toBe(true)
    // The registries are names, not prose — deliberately invisible here.
    expect(isAdvisorSection('skills', s)).toBe(false)
    expect(isAdvisorSection('nope', s)).toBe(false)

    expect(fieldOf('projects', 'long_description')?.prose).toBe(true)
    // Identity fields are readable but must never be rewritten.
    expect(fieldOf('projects', 'customer')?.prose).toBe(false)
    expect(fieldOf('projects', 'nonsense')).toBeNull()
  })

  it('excludes disabled items, as every export does', () => {
    const s = storeWithProject()
    expect(itemsOf(s, 'projects')).toHaveLength(1)
    s.projects[0].disabled = true
    expect(itemsOf(s, 'projects')).toHaveLength(0)
  })

  /**
   * The field map is a table, and a table with only spot checks can lose or
   * mistype an entry silently. Two properties matter and neither is visible in
   * a single lookup: a key that doesn't exist on the item makes any proposal
   * naming it unwritable, and an identity field marked `prose` becomes
   * rewritable — which is how an employer's name gets "improved".
   */
  it('names only keys that exist on the section it belongs to', () => {
    // The summary fields are optional on their types and are absent until
    // something writes one, so they can't be required to exist on a fixture.
    const optional = new Set(['summary_short', 'short_description'])
    const s = {
      ...emptyStore(),
      key_qualifications: [makeKQ()], key_competencies: [], projects: [makeProject()],
      work_experiences: [makeWork()], educations: [makeEducation()], courses: [makeCourse()],
      certifications: [makeCertification()],
    } as ResumeStore
    for (const section of CV_SECTIONS) {
      const [item] = itemsOf(s, section)
      if (!item) continue // sections with no fixture here are covered elsewhere
      for (const f of fieldsOf(section)) {
        if (optional.has(f.key)) continue
        expect(f.key in item, `${section}.${f.key}`).toBe(true)
      }
    }
  })

  it('marks every identity field as non-prose', () => {
    // The rewriting passes only ever touch prose. These are the fields whose
    // value is a fact about someone, not a way of saying something.
    const identity: Array<[string, string]> = [
      ['projects', 'customer'], ['projects', 'description'],
      ['work_experiences', 'employer'], ['work_experiences', 'role_title'],
      ['educations', 'school'], ['educations', 'degree'],
      ['positions', 'name'], ['positions', 'organisation'],
      ['courses', 'name'], ['certifications', 'name'], ['certifications', 'organiser'],
      ['publications', 'title'], ['publications', 'publisher'],
      ['key_qualifications', 'tag_line'], ['key_competencies', 'title'],
    ]
    for (const [section, key] of identity) {
      expect(fieldOf(section, key)?.prose, `${section}.${key}`).toBe(false)
    }
  })

  it('covers the content sections and no registry or language section', () => {
    // A registry name is a shared vocabulary entry, and CEFR levels are not
    // prose at all; a rewrite pass reaching either has nothing useful to say.
    expect([...CV_SECTIONS].sort()).toEqual([
      'certifications', 'courses', 'educations', 'honor_awards', 'key_competencies',
      'key_qualifications', 'positions', 'presentations', 'projects', 'publications',
      'recommendations', 'work_experiences',
    ])
  })
})

describe('buildCvDigest', () => {
  it('carries the real item id and the prose, and skips empty sections', () => {
    const s = storeWithProject()
    const digest = buildCvDigest(s, { locale: 'en' })
    expect(digest).toContain(`id: ${pid(s)}`)
    expect(digest).toContain('Was responsible for various work.')
    expect(digest).toContain('## projects')
    // Nothing else has items, so nothing else appears.
    expect(digest).not.toContain('## educations')
  })

  it('labels an item from its identity fields, not its description', () => {
    const s = storeWithProject()
    expect(itemLabel('projects', s.projects[0] as unknown as Record<string, unknown>, 'en'))
      .toBe('Acme — Payments platform')
  })

  /**
   * Dates orient the model in time — "which of these is the recent one" is a
   * question several advisors answer. An ongoing role has to read as ongoing;
   * showing a blank end would make current work look finished.
   */
  it('dates each item, marking an ongoing one as present', () => {
    const s = emptyStore()
    s.work_experiences = [
      makeWork({ id: 'w1', employer: { en: 'Past' }, start: { year: 2019, month: 6 }, end: { year: 2021, month: 3 } }),
      makeWork({ id: 'w2', employer: { en: 'Now' }, start: { year: 2021, month: null }, end: null }),
      makeWork({ id: 'w3', employer: { en: 'Undated' }, start: null, end: null }),
    ]
    const digest = buildCvDigest(s, { locale: 'en' })
    expect(digest).toContain('2019-06 → 2021-03')  // month padded to two digits
    expect(digest).toContain('2021 → present')     // year-only start, still open
    // An item with no dates at all says nothing about time — neither an open
    // range nor a pair of question marks.
    expect(digest).not.toContain('?')
  })

  it('caps a long field rather than sending the whole essay', () => {
    const s = storeWithProject({ long_description: { en: 'x'.repeat(4000) } })
    const digest = buildCvDigest(s, { locale: 'en', maxFieldChars: 100 })
    expect(digest).toContain(`${'x'.repeat(100)}…`)
    expect(digest).not.toContain('x'.repeat(101))
  })

  it('leaves out the short fields when the pass ignores them', () => {
    const s = storeWithProject({ short_description: { en: 'A short line.' } })
    expect(buildCvDigest(s, { locale: 'en', includeShort: true })).toContain('A short line.')
    expect(buildCvDigest(s, { locale: 'en', includeShort: false })).not.toContain('A short line.')
  })
})

describe('buildBilingualDigest', () => {
  /**
   * The whole point of the cross-language pass: it must read the RAW locale
   * slots. Going through resolve() would show the English text in the Norwegian
   * column and report perfect agreement — the opposite of the answer.
   */
  it('shows an empty second column as empty rather than falling back', () => {
    const s = storeWithProject({ long_description: { en: 'Only English here.' } })
    const digest = buildBilingualDigest(s, 'en', 'no')
    expect(digest).toContain('en: Only English here.')
    expect(digest).toContain('no: (empty)')
    expect(digest).not.toMatch(/no: Only English here\./)
  })

  it('skips fields empty in both languages', () => {
    const s = storeWithProject({ long_description: {}, short_description: {} })
    expect(buildBilingualDigest(s, 'en', 'no')).not.toContain('long_description')
  })
})

describe('validateFindings', () => {
  const ok = (findings: unknown[]) => ({ $schema: FINDINGS_SCHEMA, findings })

  it('resolves a good finding and labels it', () => {
    const s = storeWithProject()
    const { findings, dropped } = validateFindings(ok([{
      severity: 'high', kind: 'missing-outcome', section: 'projects', item_id: pid(s),
      title: 'No outcome', detail: 'Says what, never what came of it.', ask: 'What shipped?',
    }]), s, 'en')
    expect(dropped).toHaveLength(0)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      severity: 'high', section: 'projects', itemId: pid(s), itemLabel: 'Acme — Payments platform',
      ask: 'What shipped?',
    })
  })

  /**
   * A model that invents one id has still produced useful findings; failing the
   * whole run wastes the call. Drops are surfaced, never silent.
   */
  it('drops unresolvable references instead of failing the run', () => {
    const s = storeWithProject()
    const { findings, dropped } = validateFindings(ok([
      { section: 'projects', item_id: 'made-up', title: 'Ghost', detail: 'x' },
      { section: 'not_a_section', item_id: null, title: 'Ghost 2', detail: 'x' },
      { section: 'projects', item_id: pid(s), title: 'Real', detail: 'y' },
    ]), s, 'en')
    expect(findings.map((f) => f.title)).toEqual(['Real'])
    expect(dropped).toHaveLength(2)
  })

  it('accepts a section-level finding (item_id null)', () => {
    const s = storeWithProject()
    const { findings } = validateFindings(ok([
      { section: 'projects', item_id: null, title: 'Thin section', detail: 'Only one project.' },
    ]), s, 'en')
    expect(findings[0].itemId).toBeNull()
  })

  it('sorts most severe first', () => {
    const s = storeWithProject()
    const { findings } = validateFindings(ok([
      { severity: 'low', section: 'projects', item_id: null, title: 'L', detail: 'x' },
      { severity: 'high', section: 'projects', item_id: null, title: 'H', detail: 'x' },
      { severity: 'medium', section: 'projects', item_id: null, title: 'M', detail: 'x' },
    ]), s, 'en')
    expect(findings.map((f) => f.title)).toEqual(['H', 'M', 'L'])
  })

  it('rejects a reply that is not a findings document', () => {
    const s = emptyStore()
    expect(() => validateFindings({ nope: true }, s, 'en')).toThrow(InvalidFindingsError)
    expect(() => validateFindings('text', s, 'en')).toThrow(InvalidFindingsError)
  })

  /**
   * Two different failures with two different fixes: a reply that isn't an
   * object at all (the model wrote prose) versus one shaped right but carrying
   * no findings array. Asserting only the error TYPE cannot tell them apart.
   */
  it('says which of the two malformed replies it got', () => {
    const s = emptyStore()
    expect(() => validateFindings(null, s, 'en')).toThrow(/not a JSON object/i)
    expect(() => validateFindings('text', s, 'en')).toThrow(/not a JSON object/i)
    expect(() => validateFindings({ nope: true }, s, 'en')).toThrow(/no "findings" array/i)
  })

  it('keeps a finding that has only one of title and detail', () => {
    const s = storeWithProject()
    const { findings, dropped } = validateFindings(ok([
      { section: 'projects', item_id: null, detail: 'Detail but no title.' },
      { section: 'projects', item_id: null, title: 'Title but no detail' },
      { section: 'projects', item_id: null, title: '   ', detail: '' },
    ]), s, 'en')

    expect(dropped).toEqual(['Finding 3 had no text.'])
    // A missing title falls back to the head of the detail, so the panel always
    // has something to show in the collapsed row.
    expect(findings.map((f) => f.title)).toEqual(['Detail but no title.', 'Title but no detail'])
  })

  it('numbers each drop and names the section it could not find', () => {
    const s = storeWithProject()
    const { dropped } = validateFindings(ok([
      'not an object',
      { section: '', item_id: null, title: 'T', detail: 'd' },
      { section: 'nope', item_id: null, title: 'T', detail: 'd' },
    ]), s, 'en')
    expect(dropped).toEqual([
      'Finding 1 was not an object.',
      'Finding 2 named an unknown section ("—").',
      'Finding 3 named an unknown section ("nope").',
    ])
  })

  it('reads "null" and blank ids as "about the whole section"', () => {
    // Models write the string "null" for an absent id surprisingly often;
    // treating it as an id would drop a perfectly good section-level finding.
    const s = storeWithProject()
    const { findings, dropped } = validateFindings(ok([
      { section: 'projects', item_id: 'null', title: 'A', detail: 'x' },
      { section: 'projects', item_id: '   ', title: 'B', detail: 'x' },
      { section: 'projects', item_id: `  ${pid(s)}  `, title: 'C', detail: 'x' },
    ]), s, 'en')

    expect(dropped).toHaveLength(0)
    expect(findings.map((f) => f.itemId)).toEqual([null, null, pid(s)])
  })

  it('trims and caps model text, and defaults severity and kind', () => {
    const s = storeWithProject()
    const { findings } = validateFindings(ok([{
      severity: 'catastrophic', section: 'projects', item_id: null,
      title: `  ${'t'.repeat(250)}  `, detail: `  ${'d'.repeat(1200)}  `,
    }]), s, 'en')

    expect(findings[0].title).toBe('t'.repeat(200))
    expect(findings[0].detail).toBe('d'.repeat(1000))
    // An unknown severity must not sort as if it were the worst thing found.
    expect(findings[0]).toMatchObject({ severity: 'medium', kind: 'note' })
  })

  it('caps a flood of findings', () => {
    const s = storeWithProject()
    const many = Array.from({ length: 70 }, (_, n) => ({
      section: 'projects', item_id: null, title: `T${n}`, detail: 'x',
    }))
    expect(validateFindings(ok(many), s, 'en').findings).toHaveLength(60)
  })
})

describe('validateProposals', () => {
  const ok = (edits: unknown[]) => ({ edits })

  it('accepts a prose rewrite and carries the original for comparison', () => {
    const s = storeWithProject()
    const { proposals, dropped } = validateProposals(ok([{
      section: 'projects', item_id: pid(s), field: 'long_description',
      proposed: 'Ran various work.', why: 'Cut filler.',
    }]), s, 'en')
    expect(dropped).toHaveLength(0)
    expect(proposals[0]).toMatchObject({
      field: 'long_description', current: 'Was responsible for various work.',
      proposed: 'Ran various work.', locale: 'en',
    })
  })

  /**
   * The guard that matters most: a rewritten customer name reads perfectly and
   * is a factual error.
   */
  it('refuses to rewrite an identity field', () => {
    const s = storeWithProject()
    const { proposals, dropped } = validateProposals(ok([{
      section: 'projects', item_id: pid(s), field: 'customer', proposed: 'Acme Corporation',
    }]), s, 'en')
    expect(proposals).toHaveLength(0)
    expect(dropped[0]).toMatch(/not free prose/i)
  })

  it('ignores a no-op edit', () => {
    const s = storeWithProject()
    const { proposals } = validateProposals(ok([{
      section: 'projects', item_id: pid(s), field: 'long_description',
      proposed: 'Was responsible for various work.',
    }]), s, 'en')
    expect(proposals).toHaveLength(0)
  })

  it('rejects a reply with no edits array', () => {
    expect(() => validateProposals({}, emptyStore(), 'en')).toThrow(InvalidProposalsError)
  })
})

describe('applyProposals', () => {
  it('writes only the named locale slot and leaves the other alone', () => {
    const s = storeWithProject()
    const { proposals } = validateProposals({ edits: [{
      section: 'projects', item_id: pid(s), field: 'long_description', proposed: 'Ran the work.',
    }] }, s, 'en')

    const { data, applied, skipped } = applyProposals(s, proposals)
    expect(applied).toBe(1)
    expect(skipped).toHaveLength(0)
    expect(data.projects[0].long_description.en).toBe('Ran the work.')
    expect(data.projects[0].long_description.no).toBe('Ansvarlig for arbeid.')
    // The input store is untouched — replaceData takes the new one.
    expect(s.projects[0].long_description.en).toBe('Was responsible for various work.')
  })

  it('says which of the two malformed replies it got', () => {
    const s = emptyStore()
    expect(() => validateProposals(null, s, 'en')).toThrow(/not a JSON object/i)
    expect(() => validateProposals('text', s, 'en')).toThrow(/not a JSON object/i)
    expect(() => validateProposals({ nope: true }, s, 'en')).toThrow(/no "edits" array/i)
  })

  it('numbers every drop and names what it could not resolve', () => {
    const s = storeWithProject()
    const { proposals, dropped } = validateProposals({ edits: [
      'not an object',
      { section: '', item_id: pid(s), field: 'long_description', proposed: 'x' },
      { section: 'projects', item_id: 'gone', field: 'long_description', proposed: 'x' },
      { section: 'projects', item_id: pid(s), field: 'nonsense', proposed: 'x' },
      { section: 'projects', item_id: pid(s), field: 'long_description', proposed: '   ' },
    ] }, s, 'en')

    expect(proposals).toHaveLength(0)
    expect(dropped).toEqual([
      'Edit 1 was not an object.',
      'Edit 2 named an unknown section ("—").',
      "Edit 3 pointed at an item that isn't in projects.",
      'Edit 4 named an unknown field ("nonsense").',
      'Edit 5 had no replacement text.',
    ])
  })

  /**
   * The guard that matters: a rewritten customer name reads perfectly and is a
   * lie. Highlights are prose but a list, which needs an op this doesn't have.
   */
  it('refuses identity fields and list fields by name', () => {
    const s = storeWithProject()
    const { dropped } = validateProposals({ edits: [
      { section: 'projects', item_id: pid(s), field: 'customer', proposed: 'Globex' },
      { section: 'projects', item_id: pid(s), field: 'highlights', proposed: 'A bullet' },
    ] }, s, 'en')
    expect(dropped).toEqual([
      'Edit 1 tried to rewrite "Customer", which is not free prose.',
      'Edit 2 tried to rewrite "Highlights", which is not free prose.',
    ])
  })

  it('drops an edit that proposes the text already there', () => {
    const s = storeWithProject()
    const { proposals, dropped } = validateProposals({ edits: [{
      section: 'projects', item_id: pid(s), field: 'long_description',
      proposed: 'Was responsible for various work.',
    }] }, s, 'en')
    // Not a drop with a reason — there is nothing wrong with it, it is just
    // not an edit, and reporting it as a problem would be noise.
    expect(proposals).toHaveLength(0)
    expect(dropped).toHaveLength(0)
  })

  it('compares normalised text, so padding alone is not an edit', () => {
    // Both sides are trimmed before the no-op check. Without that, a model
    // echoing the text back with different surrounding space would look like a
    // rewrite and be offered as one. (The markup half of this normalisation is
    // richToPlain's own business, and needs a DOM this suite does not run in.)
    const s = storeWithProject({ long_description: { en: '  Ran the platform.  ' } })
    const { proposals } = validateProposals({ edits: [{
      section: 'projects', item_id: pid(s), field: 'long_description', proposed: 'Ran the platform.',
    }] }, s, 'en')
    expect(proposals).toHaveLength(0)
  })

  it('trims and caps the proposed text', () => {
    const s = storeWithProject()
    const { proposals } = validateProposals({ edits: [{
      section: 'projects', item_id: pid(s), field: 'long_description',
      proposed: `  ${'p'.repeat(4500)}  `, why: `  ${'w'.repeat(250)}  `,
    }] }, s, 'en')
    expect(proposals[0].proposed).toBe('p'.repeat(4000))
    expect(proposals[0].why).toBe('w'.repeat(200))
  })

  it('skips a proposal for a section or item that has gone', () => {
    const s = storeWithProject()
    const { proposals } = validateProposals({ edits: [{
      section: 'projects', item_id: pid(s), field: 'long_description', proposed: 'Ran the work.',
    }] }, s, 'en')

    const noSection = { ...s, projects: undefined } as unknown as ResumeStore
    expect(applyProposals(noSection, proposals).skipped).toHaveLength(1)

    const noItem = { ...s, projects: [] }
    expect(applyProposals(noItem, proposals).skipped).toHaveLength(1)
  })

  it('returns the very same store when nothing was accepted', () => {
    const s = storeWithProject()
    const out = applyProposals(s, [])
    expect(out.data).toBe(s)
    expect(out).toMatchObject({ applied: 0, skipped: [] })
  })

  it('caps a runaway reply rather than validating all of it', () => {
    const s = storeWithProject()
    const many = Array.from({ length: 90 }, (_, n) => ({
      section: 'projects', item_id: pid(s), field: 'long_description', proposed: `Rewrite ${n}.`,
    }))
    expect(validateProposals({ edits: many }, s, 'en').proposals).toHaveLength(80)
  })

  /**
   * The panel is non-blocking, so the user can keep editing while it's open.
   * Overwriting an edit they made after the run is the one unrecoverable
   * outcome here, so a changed field means skip, not apply.
   */
  it('skips a proposal whose source text changed since the run', () => {
    const s = storeWithProject()
    const { proposals } = validateProposals({ edits: [{
      section: 'projects', item_id: pid(s), field: 'long_description', proposed: 'Ran the work.',
    }] }, s, 'en')

    const edited = structuredClone(s)
    edited.projects[0].long_description.en = 'I rewrote this myself in the meantime.'

    const { applied, skipped, data } = applyProposals(edited, proposals)
    expect(applied).toBe(0)
    expect(skipped).toHaveLength(1)
    expect(data.projects[0].long_description.en).toBe('I rewrote this myself in the meantime.')
  })
})

describe('achievement mining', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    target: 'highlight', section: 'projects', text: 'Cut release time to a day',
    evidence: 'We moved from weekly to daily releases.', ...over,
  })

  it('asks for the schema by name, and mines only the sections describing work', () => {
    const s = storeWithProject()
    s.educations = [makeEducation({ description: { en: 'Studied things at length.' } })]

    // Written out rather than compared to the constant: `toContain(MINING_SCHEMA)`
    // passes trivially if the constant is ever emptied.
    expect(MINING_SCHEMA).toBe('resumestudio-achievements/v1')
    expect(MINING_SECTIONS).toEqual(['projects', 'work_experiences', 'positions'])

    const prompt = buildMiningPrompt(s, 'en')
    expect(prompt).toContain('"$schema":"resumestudio-achievements/v1"')
    expect(prompt).toContain('## projects')
    // Education is prose too, but nothing there is an achievement to promote.
    expect(prompt).not.toContain('## educations')
  })

  it('refuses a reply that is not an object or carries no achievements array', () => {
    const s = storeWithProject()
    expect(() => validateMining(null, s, 'en')).toThrow(InvalidMiningError)
    expect(() => validateMining('{}', s, 'en')).toThrow(/not a JSON object/i)
    expect(() => validateMining({}, s, 'en')).toThrow(/no "achievements" array/i)
    expect(() => validateMining({ achievements: {} }, s, 'en')).toThrow(/no "achievements" array/i)
  })

  /**
   * Every drop is reported with the entry number the user can count to, so a
   * reply that half-worked can be checked against what was sent.
   */
  it('drops what it cannot place, naming the entry and the reason', () => {
    const s = storeWithProject()
    const { achievements, dropped } = validateMining({
      achievements: [
        'not an object',
        entry({ section: 'nope', item_id: pid(s) }),
        entry({ section: '', item_id: pid(s) }),
        entry({ item_id: 'no-such-item' }),
        entry({ item_id: pid(s), text: '   ' }),
        entry({ item_id: pid(s), text: 42 }),
      ],
    }, s, 'en')

    expect(achievements).toHaveLength(0)
    expect(dropped).toEqual([
      'Entry 1 was not an object.',
      'Entry 2 named an unknown section ("nope").',
      'Entry 3 named an unknown section ("—").',
      "Entry 4 pointed at an item that isn't in projects.",
      'Entry 5 had no text.',
      // A non-string is missing text, not a crash.
      'Entry 6 had no text.',
    ])
  })

  it('drops a highlight aimed at a section that has none, but keeps a competency', () => {
    const s = storeWithProject()
    s.work_experiences = [makeWork({ long_description: { en: 'Ran the platform team.' } })]
    const item_id = s.work_experiences[0].id

    const bad = validateMining({
      achievements: [entry({ section: 'work_experiences', item_id })],
    }, s, 'en')
    expect(bad.achievements).toHaveLength(0)
    expect(bad.dropped[0]).toBe('Entry 1 proposed a highlight for work_experiences, which has no highlights.')

    // The same item is a fine source for a competency — that lands in the library.
    const ok = validateMining({
      achievements: [entry({ target: 'competency', section: 'work_experiences', item_id, detail: 'Leads teams.' })],
    }, s, 'en')
    expect(ok.achievements).toHaveLength(1)
  })

  it('trims and caps model text, and keeps a detail only for a competency', () => {
    const s = storeWithProject()
    const { achievements } = validateMining({
      achievements: [
        entry({ item_id: pid(s), text: `  ${'x'.repeat(400)}  `, detail: 'meaningless on a highlight' }),
        entry({ target: 'competency', item_id: pid(s), detail: '  Owns delivery cadence.  ' }),
      ],
    }, s, 'en')

    expect(achievements[0].text).toBe('x'.repeat(300))
    expect(achievements[0].detail).toBe('')
    expect(achievements[1].detail).toBe('Owns delivery cadence.')
  })

  it('caps a flood of proposals rather than applying all of them', () => {
    const s = storeWithProject()
    const many = Array.from({ length: 45 }, () => entry({ item_id: pid(s) }))
    expect(validateMining({ achievements: many }, s, 'en').achievements).toHaveLength(40)
  })

  it('drops any proposal that quotes no supporting text', () => {
    const s = storeWithProject()
    const { achievements, dropped } = validateMining({
      achievements: [
        entry({ item_id: pid(s), evidence: '' }),
        entry({ item_id: pid(s) }),
      ],
    }, s, 'en')
    expect(achievements).toHaveLength(1)
    expect(dropped[0]).toMatch(/quoted no supporting text/i)
  })

  it('appends a highlight without touching the description it came from', () => {
    const s = storeWithProject()
    const { achievements } = validateMining({ achievements: [entry({ item_id: pid(s) })] }, s, 'en')
    const { data, highlights } = applyAchievements(s, achievements, 'en')
    expect(highlights).toBe(1)
    expect(data.projects[0].highlights).toEqual([{ en: 'Cut release time to a day' }])
    expect(data.projects[0].long_description.en).toBe('Was responsible for various work.')
  })

  it('does not stack a duplicate highlight on a re-run', () => {
    const s = storeWithProject()
    const { achievements } = validateMining({ achievements: [entry({ item_id: pid(s) })] }, s, 'en')
    const once = applyAchievements(s, achievements, 'en').data
    const twice = applyAchievements(once, achievements, 'en')
    expect(twice.highlights).toBe(0)
    expect(twice.data.projects[0].highlights).toHaveLength(1)
  })

  it('hands back the very same store when nothing was accepted', () => {
    const s = storeWithProject()
    const out = applyAchievements(s, [], 'en')
    // Same reference, not a copy: an empty apply must not look like an edit.
    expect(out.data).toBe(s)
    expect(out).toMatchObject({ highlights: 0, competencies: 0 })
  })

  it('ignores an achievement whose section or item no longer exists', () => {
    const s = storeWithProject()
    const base: Achievement = {
      key: 'k', target: 'highlight', section: 'projects', itemId: pid(s),
      itemLabel: 'Acme', text: 'New line', detail: '', evidence: 'Evidence.',
    }
    const out = applyAchievements(s, [
      { ...base, section: 'not_a_section' },
      { ...base, itemId: 'deleted-since-the-run' },
    ], 'en')

    expect(out.highlights).toBe(0)
    expect(out.data.projects[0].highlights ?? []).toHaveLength(0)
  })

  it('leaves a language column out rather than writing an empty one', () => {
    const s = storeWithProject()
    const { achievements } = validateMining({ achievements: [entry({ item_id: pid(s) })] }, s, 'en')
    // Nothing configured to translate with → the panel hands over blanks.
    const blank: Achievement = { ...achievements[0], translations: { no: { text: '   ', detail: '' } } }

    const { data } = applyAchievements(s, [blank], 'en')
    expect(data.projects[0].highlights?.[0]).toEqual({ en: 'Cut release time to a day' })
  })

  it('joins a new competency to the resume its siblings belong to', () => {
    const s = storeWithProject()
    s.resume.id = 'resume-99'
    const mine = () => validateMining({
      achievements: [entry({ target: 'competency', item_id: pid(s), detail: 'Owns cadence.' })],
    }, s, 'en').achievements

    // Empty library: nothing to copy from, so the open resume's own id.
    expect(applyAchievements(s, mine(), 'en').data.key_competencies[0].resume_id).toBe('resume-99')

    // An existing row wins — the library is what new entries are joining.
    const withLibrary: ResumeStore = {
      ...s,
      key_competencies: [{
        id: 'comp-0', resume_id: 'resume-7', title: { en: 'Existing' }, description: {},
        sort_order: 0, starred: false, disabled: false,
      } as KeyCompetency],
    }
    const grown = applyAchievements(withLibrary, mine(), 'en').data.key_competencies
    expect(grown[1].resume_id).toBe('resume-7')
    // Appended at the end, ordered after what was already there.
    expect(grown[1].sort_order).toBe(1)

    // A store with no resume record at all still applies, with no id to inherit.
    const orphan = { ...s, resume: undefined } as unknown as ResumeStore
    expect(applyAchievements(orphan, mine(), 'en').data.key_competencies[0].resume_id).toBe('')
  })

  it('creates a competency unstarred, at the end, and in no profile bundle', () => {
    const s = storeWithProject()
    s.key_qualifications = [{
      id: 'kq-1', resume_id: 'resume-1', label: {}, tag_line: { en: 'Architect' },
      summary: {}, key_points: [], competency_ids: [],
      sort_order: 0, starred: false, disabled: false, internal_notes: null,
    }]
    const { achievements } = validateMining({
      achievements: [entry({ target: 'competency', item_id: pid(s), detail: 'Owns delivery cadence.' })],
    }, s, 'en')

    const { data, competencies } = applyAchievements(s, achievements, 'en')
    expect(competencies).toBe(1)
    const created = data.key_competencies[0]
    expect(created).toMatchObject({ starred: false, disabled: false })
    expect(created.description.en).toBe('Owns delivery cadence.')
    // Joining a bundle would change what every view built on that profile exports.
    expect(data.key_qualifications[0].competency_ids).toEqual([])
  })
})

describe('profile generator', () => {
  function withLibrary(): ResumeStore {
    const s = storeWithProject()
    const c: KeyCompetency = {
      id: 'comp-1', resume_id: 'resume-1', title: { en: 'Cloud architecture' },
      description: { en: 'Designs cloud platforms.' }, sort_order: 0,
      starred: false, disabled: false,
    }
    s.key_competencies = [c]
    return s
  }

  const draftReply = (bundle: unknown[]) => ({
    profiles: [{
      tag_line: 'Cloud architect, public sector', summary: 'Builds public cloud platforms.',
      summary_short: 'Cloud architect.', rationale: 'For procurement readers.',
      evidence: ['Acme — Payments platform'], bundle,
    }],
  })

  it('offers the library as referenceable ids, and says when there is none', () => {
    // The model can only reuse a competency it was shown, and a bare heading
    // with nothing under it invites it to invent ids instead of proposing new
    // ones properly.
    const withOne = buildProfilePrompt(withLibrary(), 'en', { brief: 'Public sector work', count: 2 })
    // Read the LIBRARY block alone. The CV digest further down lists the same
    // competency in the same shape, so an unscoped assertion passes even when
    // the library block is empty — which is what it is guarding against.
    const library = withOne.slice(
      withOne.indexOf('--- COMPETENCY LIBRARY ---'),
      withOne.indexOf('--- CV ---'),
    )
    expect(library).toContain('- id: comp-1')
    expect(library).toContain('title: Cloud architecture')
    expect(library).toContain('description: Designs cloud platforms.')

    expect(buildProfilePrompt(storeWithProject(), 'en', { brief: 'x', count: 2 }))
      .toMatch(/library is empty/)
  })

  it('hides a disabled competency from the catalog', () => {
    // Disabled is a soft delete everywhere else; offering one here would put it
    // back into a profile bundle.
    const s = withLibrary()
    s.key_competencies[0].disabled = true
    expect(buildProfilePrompt(s, 'en', { brief: 'x', count: 2 })).toMatch(/library is empty/)
  })

  it('holds the requested profile count inside its bounds', () => {
    const s = withLibrary()
    const asked = (count: number) =>
      /Draft (\d+) ALTERNATIVE profiles/.exec(buildProfilePrompt(s, 'en', { brief: 'x', count }))?.[1]

    // Zero is not a request, and the panel's own field can reach it.
    expect(asked(0)).toBe('1')
    // …and a large number must not turn one run into fifty drafts.
    expect(Number(asked(99))).toBeLessThanOrEqual(6)
    expect(asked(2)).toBe('2')
  })

  it('reuses a library competency by id and marks a proposed one as new', () => {
    const s = withLibrary()
    const { profiles, dropped } = validateProfileDraft(
      draftReply([
        { id: 'comp-1' },
        { id: null, title: 'Public procurement', description: 'Knows the process.' },
      ]), s, 'en')
    expect(dropped).toHaveLength(0)
    expect(profiles[0].bundle).toEqual([
      { id: 'comp-1', title: 'Cloud architecture', description: 'Designs cloud platforms.', isNew: false },
      { id: null, title: 'Public procurement', description: 'Knows the process.', isNew: true },
    ])
  })

  /**
   * An id that doesn't resolve is a hallucination, not a new competency — a
   * genuine proposal comes back with id null. Creating one would duplicate
   * something already in the library.
   */
  it('drops a bundle entry naming a competency that does not exist', () => {
    const s = withLibrary()
    const { profiles, dropped } = validateProfileDraft(draftReply([{ id: 'ghost' }]), s, 'en')
    expect(profiles[0].bundle).toHaveLength(0)
    expect(dropped[0]).toMatch(/isn't in the library/i)
  })

  it('appends the profile last and creates only the new competencies', () => {
    const s = withLibrary()
    const { profiles } = validateProfileDraft(
      draftReply([{ id: 'comp-1' }, { id: null, title: 'Public procurement', description: 'x' }]), s, 'en')

    const next = applyProfileDraft(s, profiles[0], 'en')
    expect(next.key_competencies).toHaveLength(2)
    expect(next.key_qualifications).toHaveLength(1)
    const added = next.key_qualifications[0]
    expect(added.tag_line.en).toBe('Cloud architect, public sector')
    // Bundle order is preserved, and the reused id is the original.
    expect(added.competency_ids[0]).toBe('comp-1')
    expect(added.competency_ids).toHaveLength(2)
    // Not starred: a view picks the FIRST non-disabled profile, so a generated
    // one must not quietly become what every existing view presents.
    expect(added.starred).toBe(false)
  })
})

describe('tidyIntro', () => {
  it('strips fences, labels and wrapping quotes but keeps paragraphs', () => {
    expect(tidyIntro('```\nHello there.\n```')).toBe('Hello there.')
    expect(tidyIntro('Here is the introduction: Hello there.')).toBe('Hello there.')
    expect(tidyIntro('"Hello there."')).toBe('Hello there.')
    // Unlike tidyLine, more than one line survives.
    expect(tidyIntro('One.\n\nTwo.')).toBe('One.\n\nTwo.')
  })
})

describe('buildIntroPrompt', () => {
  const viewOf = (over: Parameters<typeof makeView>[0] = {}) =>
    makeView({ sections: buildViewSections(), ...over })

  it('shows only what THIS version contains, and asks for the stated length', () => {
    const s = storeWithProject()
    s.key_qualifications = [makeKQ({
      tag_line: { en: 'Platform architect' }, summary: { en: 'Builds payment platforms.' },
    })]
    // In the master CV but excluded from this view.
    s.educations = [makeEducation({ description: { en: 'Studied computing.' } })]

    const view = viewOf({
      sections: buildViewSections().map((sec) => (
        sec.key === 'educations' ? { ...sec, detail: 'off' as const } : sec
      )),
    })
    const line = buildIntroPrompt(s, view, 'en', { audience: 'A bank CTO', length: 'line' })
    expect(line).toContain('A bank CTO')
    expect(line).toMatch(/ONE sentence/)
    expect(line).toContain('Platform architect')
    // The profile is quoted so the model can avoid restating it.
    expect(line).toContain('Builds payment platforms.')
    // The evidence is the FILTERED document. The master CV has an education
    // this view leaves out, and promising what the reader cannot find below is
    // exactly what the prompt tells the model not to do.
    expect(line).toContain('## projects')
    expect(line).not.toContain('## educations')

    const para = buildIntroPrompt(s, viewOf(), 'en', { audience: '', length: 'paragraph' })
    expect(para).toMatch(/2–4 sentences/)
    // No audience stated is said out loud, rather than leaving a blank line.
    expect(para).toMatch(/not stated/)
  })

  it('leaves out the profile blocks when the view presents no profile', () => {
    const prompt = buildIntroPrompt(storeWithProject(), viewOf(), 'en', DEFAULT_INTRO_FOCUS)
    expect(prompt).not.toContain('PROFILE TAG LINE')
    expect(prompt).not.toContain('do not restate')
  })

  it('caps the profile it quotes rather than pasting an essay', () => {
    const s = storeWithProject()
    // Plain text on purpose: flattening markup needs a DOM this suite lacks.
    s.key_qualifications = [makeKQ({ summary: { en: 'x'.repeat(2000) } })]
    const prompt = buildIntroPrompt(s, viewOf(), 'en', DEFAULT_INTRO_FOCUS)
    expect(prompt).toContain('x'.repeat(800))
    expect(prompt).not.toContain('x'.repeat(801))
  })
})

describe('prompt builders', () => {
  it('the review names the registry skills so unregistered ones can be spotted', () => {
    const s = storeWithProject()
    s.skills = [{
      id: 'sk-1', resume_id: 'resume-1', name: { en: 'Kubernetes' },
      total_duration_in_years: 0, proficiency: 3, is_highlighted: false,
      created_at: new Date().toISOString(),
    }]
    const prompt = buildCvReviewPrompt(s, 'en')
    expect(prompt).toContain('Kubernetes')
    expect(prompt).toContain(FINDINGS_SCHEMA)
  })

  it('the review says so plainly when the skill registry is empty', () => {
    // An empty list rendered as nothing would leave the model reading the
    // heading with no items under it, and inventing "missing" skills freely.
    const prompt = buildCvReviewPrompt(storeWithProject(), 'en')
    expect(prompt).toContain('(none yet)')
  })

  it('the review lists skills in the language being reviewed', () => {
    const s = storeWithProject()
    s.skills = [{
      id: 'sk-1', resume_id: 'resume-1', name: { en: 'Cloud architecture', no: 'Skyarkitektur' },
      total_duration_in_years: 0, proficiency: 3, is_highlighted: false,
      created_at: new Date().toISOString(),
    }]
    expect(buildCvReviewPrompt(s, 'no')).toContain('Skyarkitektur')
  })

  /**
   * The voice pass writes, so the prompt must enumerate exactly which fields it
   * may touch — an identity field must never appear in that list.
   */
  it('the voice pass lists only prose fields as editable', () => {
    const prompt = buildVoicePassPrompt(storeWithProject(), 'en')
    expect(prompt).toMatch(/projects: long_description, short_description/)
    expect(prompt).not.toMatch(/projects:.*customer/)
  })

  it('the voice pass omits a section with no editable prose at all', () => {
    // A section listed with an empty field list reads as "you may rewrite
    // anything here" — the opposite of what an empty list means. The field
    // block is the two-space-indented "  section: a, b" lines.
    const prompt = buildVoicePassPrompt(storeWithProject(), 'en')
    expect(prompt).not.toMatch(/^ {2}\w+:\s*$/m)
  })

  it('the voice pass shows the short fields it is allowed to rewrite', () => {
    // includeShort is on for this pass specifically: the short description is
    // one of the fields being rewritten, so the model has to see its current
    // value or it writes a replacement blind.
    const s = storeWithProject({ short_description: { en: 'A terse line.' } })
    expect(buildVoicePassPrompt(s, 'en')).toContain('A terse line.')
  })
})

/**
 * WHICH fields are identity, exhaustively.
 *
 * `prose: false` is the flag that stops an assist rewriting a customer's name,
 * an employer, a school or a job title (§15: readable, never rewritable). The
 * existing checks spot-check two of them, so flipping any of the other 21 —
 * which is a one-character edit — leaves an A2 run free to "improve" the name
 * of the company someone worked for.
 *
 * Listing them is a table assertion, and that is the point: the table IS the
 * rule, and no property test can tell an identity field from a prose one.
 */
describe('cvFields — the identity fields an assist may never rewrite', () => {
  const IDENTITY: ReadonlyArray<[string, string]> = [
    ['key_qualifications', 'tag_line'],
    ['key_competencies', 'title'],
    ['projects', 'customer'],
    ['projects', 'description'],
    ['work_experiences', 'employer'],
    ['work_experiences', 'role_title'],
    ['positions', 'name'],
    ['positions', 'organisation'],
    ['educations', 'school'],
    ['educations', 'degree'],
    ['courses', 'name'],
    ['courses', 'program'],
    ['certifications', 'name'],
    ['certifications', 'organiser'],
    ['presentations', 'title'],
    ['presentations', 'event'],
    ['publications', 'title'],
    ['publications', 'publisher'],
    ['honor_awards', 'name'],
    ['honor_awards', 'issuer'],
    ['honor_awards', 'for_work'],
    ['recommendations', 'recommender_title'],
    ['recommendations', 'relationship'],
  ]

  it.each(IDENTITY)('%s.%s is identity, not prose', (section, key) => {
    expect(fieldOf(section, key)?.prose).toBe(false)
  })

  it('has exactly these identity fields and no others', () => {
    // The other direction: a prose field newly marked `prose: false` would make
    // a real description unrewritable, and the per-field checks above cannot
    // see that.
    const actual = CV_SECTIONS.flatMap((s) =>
      fieldsOf(s).filter((f) => !f.prose).map((f) => `${s}.${f.key}`)).sort()
    expect(actual).toEqual(IDENTITY.map(([s, k]) => `${s}.${k}`).sort())
  })

  it('marks highlights as the only LIST field', () => {
    // `list` changes how a value is read and written; a single-value field
    // marked as a list reads as an array of characters.
    const lists = CV_SECTIONS.flatMap((s) =>
      fieldsOf(s).filter((f) => f.list).map((f) => `${s}.${f.key}`))
    expect(lists).toEqual(['projects.highlights'])
  })

  it('gives every field a distinct, non-empty label', () => {
    // The label is what the review UI shows beside a proposed change; a blank
    // or duplicated one makes two proposals indistinguishable.
    for (const s of CV_SECTIONS) {
      const labels = fieldsOf(s).map((f) => f.label)
      expect(labels.every((l) => l.trim().length > 0), s).toBe(true)
      expect(new Set(labels).size, s).toBe(labels.length)
    }
  })

  it('gives every section at least one rewritable field', () => {
    // A section of nothing but identity fields would appear in the advisors'
    // digest and accept no proposal — a menu entry that does nothing.
    for (const s of CV_SECTIONS) {
      expect(fieldsOf(s).some((f) => f.prose), s).toBe(true)
    }
  })
})

/**
 * D1's remaining validation branches (16 mutants unreached).
 *
 * The competency bundle is where this one can do damage: a profile OWNS an
 * ordered bundle (§4), so a bad entry either duplicates something already in
 * the shared library or attaches a competency that does not exist.
 */
describe('validateProfileDraft — the bundle rules', () => {
  const s = (): ResumeStore => {
    const store = emptyStore()
    store.key_competencies = [
      // Plain, not markup: the flattening goes through richToPlain's DOMParser
      // and this file runs in node. That path is pinned in the richText suite.
      makeKeyCompetency({ id: 'c1', title: { en: 'Architecture' }, description: { en: 'Designs systems.' } }),
      makeKeyCompetency({ id: 'c2', title: { en: 'Retired' }, disabled: true }),
    ]
    return store
  }
  const draft = (bundle: unknown[], over: Record<string, unknown> = {}) =>
    validateProfileDraft(
      { profiles: [{ tag_line: 'Architect', summary: 'Long summary.', bundle, ...over }] },
      s(), 'en',
    )

  it('resolves an existing competency to its live title and description', () => {
    // Resolved from the LIBRARY, not from whatever the model sent alongside
    // the id — otherwise a draft can quietly restate an existing competency.
    const b = draft([{ id: 'c1', title: 'Wrong', description: 'Also wrong' }]).profiles[0].bundle[0]
    expect(b).toMatchObject({ id: 'c1', title: 'Architecture', isNew: false })
    expect(b.description).toBe('Designs systems.')
  })

  it('treats a DISABLED competency as not in the library', () => {
    // Attaching one would put a competency the user retired back into a view.
    const r = draft([{ id: 'c2' }])
    expect(r.profiles[0].bundle).toHaveLength(0)
    expect(r.dropped.join(' ')).toMatch(/isn't in the library/i)
  })

  it('drops an unresolvable id instead of inventing a competency for it', () => {
    // A genuine proposal comes back with id null; an id that does not resolve
    // is a hallucination, and creating one would duplicate the library.
    const r = draft([{ id: 'ghost', title: 'Made up' }])
    expect(r.profiles[0].bundle).toHaveLength(0)
    expect(r.dropped.join(' ')).toMatch(/isn't in the library/i)
  })

  it('accepts a NEW competency proposed with no id', () => {
    const b = draft([{ title: 'Platform engineering', description: 'Builds platforms.' }]).profiles[0].bundle[0]
    expect(b).toMatchObject({ id: null, title: 'Platform engineering', isNew: true })
  })

  it('skips a new entry with no title at all', () => {
    expect(draft([{ description: 'orphan' }]).profiles[0].bundle).toHaveLength(0)
  })

  it('keeps an existing competency ONCE even if proposed twice', () => {
    // The bundle is ordered and a duplicate would render the same block twice.
    expect(draft([{ id: 'c1' }, { id: 'c1' }]).profiles[0].bundle).toHaveLength(1)
  })

  it('ignores a bundle entry that is not an object, without failing the profile', () => {
    const r = draft(['nonsense', null, { id: 'c1' }])
    expect(r.profiles[0].bundle).toHaveLength(1)
  })

  it('tolerates a missing or non-array bundle', () => {
    expect(validateProfileDraft(
      { profiles: [{ tag_line: 'A', summary: 'B' }] }, s(), 'en',
    ).profiles[0].bundle).toEqual([])
  })

  describe('the profile itself', () => {
    it('needs a tag line OR a summary, not both', () => {
      const only = (p: Record<string, unknown>) =>
        validateProfileDraft({ profiles: [p] }, s(), 'en')
      expect(only({ tag_line: 'Architect' }).profiles).toHaveLength(1)
      expect(only({ summary: 'Long summary.' }).profiles).toHaveLength(1)
      const neither = only({ rationale: 'because' })
      expect(neither.profiles).toHaveLength(0)
      expect(neither.dropped.join(' ')).toMatch(/no tag line or summary/i)
    })

    it('keeps the evidence quotes, capped, and drops the empty ones', () => {
      // §15: no invented facts — the evidence is what ties a draft to the CV.
      const r = validateProfileDraft({ profiles: [{
        tag_line: 'A', summary: 'B',
        evidence: ['ran the migration', '', '   ', ...Array(20).fill('more')],
      }] }, s(), 'en')
      expect(r.profiles[0].evidence[0]).toBe('ran the migration')
      expect(r.profiles[0].evidence).not.toContain('')
      expect(r.profiles[0].evidence.length).toBeLessThanOrEqual(12)
    })

    it('defaults evidence to an empty list when it is not an array', () => {
      expect(validateProfileDraft(
        { profiles: [{ tag_line: 'A', summary: 'B', evidence: 'nope' }] }, s(), 'en',
      ).profiles[0].evidence).toEqual([])
    })

    it('says so when the reply parsed but held nothing usable', () => {
      // An empty result with no explanation looks like the run silently failed.
      const r = validateProfileDraft({ profiles: [] }, s(), 'en')
      expect(r.profiles).toHaveLength(0)
      expect(r.dropped.join(' ')).toMatch(/no usable profiles/i)
    })

    it('rejects a reply that is not an object, or has no profiles array', () => {
      expect(() => validateProfileDraft(null, s(), 'en')).toThrow(/not a JSON object/i)
      expect(() => validateProfileDraft({ nope: [] }, s(), 'en')).toThrow(/no "profiles" array/i)
    })
  })
})

/**
 * itemFacts — 9 mutants, none covered.
 *
 * It is what GROUNDS a from-scratch description: a model asked to write about a
 * project has nothing to go on but the customer, the name, the dates and the
 * skills. If a fact stops being emitted the model does not fail, it invents —
 * which is the one thing the assists must never do (§15).
 */
describe('cvDigest — itemFacts', () => {
  it('emits every identity field as a labelled line, and no prose', () => {
    const facts = itemFacts('projects', {
      id: 'p1',
      customer: { en: 'Acme Bank' },
      description: { en: 'Payments platform' },
      long_description: { en: 'A long prose description that must not appear.' },
    }, 'en')
    expect(facts).toContain('Customer: Acme Bank')
    expect(facts).toContain('Project name: Payments platform')
    expect(facts.join(' ')).not.toContain('long prose description')
  })

  it('appends the date range as its own fact', () => {
    const facts = itemFacts('projects', {
      id: 'p1', customer: { en: 'Acme' },
      start: { year: 2020, month: 1 }, end: { year: 2021, month: 6 },
    }, 'en')
    expect(facts.some((f) => f.startsWith('Dates: '))).toBe(true)
    expect(facts[facts.length - 1]).toMatch(/^Dates: /)
  })

  it('omits the date line entirely for an undated item', () => {
    // "Dates: " with nothing after it is a fact about nothing.
    const facts = itemFacts('projects', { id: 'p1', customer: { en: 'Acme' } }, 'en')
    expect(facts.some((f) => f.startsWith('Dates'))).toBe(false)
  })

  it('skips a field that is empty rather than emitting a bare label', () => {
    const facts = itemFacts('projects', { id: 'p1', customer: { en: 'Acme' }, description: {} }, 'en')
    expect(facts).toEqual(['Customer: Acme'])
  })

  it('resolves each fact in the requested locale', () => {
    const facts = itemFacts('projects', { id: 'p1', customer: { en: 'Acme', no: 'Akme' } }, 'no')
    expect(facts).toContain('Customer: Akme')
  })

  it('is empty for a section the advisors do not know', () => {
    expect(itemFacts('skills', { id: 's1', name: { en: 'Go' } }, 'en')).toEqual([])
  })
})

