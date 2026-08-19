import { describe, it, expect } from 'vitest'
import {
  SECTION_CATALOG, summaryTitleMeta, isEmptyItemView,
  type CatalogCtx, type ItemView,
} from '../src/lib/sectionCatalog'
import { extrasFor } from '../src/lib/sectionExtras'
import {
  makeProject, makeWork, makeEducation, makeKQ, makeReference,
  makeSpokenLanguage, makeKeyCompetency, makeRecommendation,
} from './fixtures'

const html: CatalogCtx = { locale: 'en', hideDates: false, target: 'html' }
const docx: CatalogCtx = { locale: 'en', hideDates: false, target: 'docx' }
const item = (over: Record<string, unknown>) => over as Record<string, unknown>

describe('SECTION_CATALOG — coverage', () => {
  const EXPORTABLE = [
    'projects', 'key_qualifications', 'key_competencies', 'recommendations',
    'work_experiences', 'educations', 'courses', 'certifications', 'positions',
    'spoken_languages', 'technology_categories', 'presentations',
    'honor_awards', 'publications', 'references',
  ]

  it('has a descriptor with title + full for every exportable section', () => {
    for (const key of EXPORTABLE) {
      expect(SECTION_CATALOG[key], key).toBeDefined()
      expect(SECTION_CATALOG[key].title, `${key}.title`).toBeTypeOf('function')
      expect(SECTION_CATALOG[key].full, `${key}.full`).toBeTypeOf('function')
    }
  })

  it('registries have titles but no renderers (never exported as sections)', () => {
    for (const key of ['skills', 'roles']) {
      expect(SECTION_CATALOG[key].title).toBeTypeOf('function')
      expect(SECTION_CATALOG[key].full).toBeUndefined()
      expect(SECTION_CATALOG[key].summary).toBeUndefined()
    }
  })
})

describe('positions — type excluded from summary, kept in full', () => {
  const pos = item({
    name: { en: 'Board Member' },
    organisation: { en: 'Cartavio AS' },
    position_type: 'board_member',
    start: { year: 2020, month: 1 }, end: { year: 2022, month: 6 },
  })

  it('summary omits the position type (not an item-layout slot)', () => {
    const s = SECTION_CATALOG.positions.summary!(pos, html)!
    expect(s.parts.map((p) => p.key)).not.toContain('role')
    expect(s.parts.find((p) => p.key === 'title')?.value).toBe('Board Member')
    expect(s.parts.find((p) => p.key === 'org')?.value).toBe('Cartavio AS')
    const { meta } = summaryTitleMeta(s)
    expect(meta.join(' · ')).not.toMatch(/Board member/i)
  })

  it('full detail excludes the type (editor-only, never exported)', () => {
    const v = SECTION_CATALOG.positions.full!(pos, html)!
    // Only the role NAME shows; the TYPE label ('Board member') is withheld —
    // so meta is exactly the role name, not [name, type].
    expect(v.meta).toEqual(['Board Member'])
  })
})

describe('summaryTitleMeta — flattening the slots for the plain renderers', () => {
  const parts = (parts: Array<{ key: string; value: string }>) =>
    summaryTitleMeta({ parts, sep: '—' } as never)

  it('lifts the title out and joins start/end into one range at the end', () => {
    // The two date slots exist so the HTML renderer can tabulate them; every
    // other target wants one "2020 – 2022" string, ordered after the meta.
    const { title, meta } = parts([
      { key: 'title', value: 'Engineer' },
      { key: 'start', value: '2020' },
      { key: 'org', value: 'BigCo' },
      { key: 'end', value: '2022' },
    ])
    expect(title).toBe('Engineer')
    expect(meta).toEqual(['BigCo', '2020 – 2022'])
  })

  it('shows a one-sided range without a dangling separator', () => {
    expect(parts([{ key: 'title', value: 'T' }, { key: 'start', value: '2020' }]).meta)
      .toEqual(['2020'])
    expect(parts([{ key: 'title', value: 'T' }, { key: 'end', value: 'Present' }]).meta)
      .toEqual(['Present'])
  })

  it('adds nothing for an empty slot, and no range when there are no dates', () => {
    const { title, meta } = parts([
      { key: 'title', value: 'T' },
      { key: 'org', value: '' },
      { key: 'role', value: 'Lead' },
      { key: 'start', value: '' },
      { key: 'end', value: '' },
    ])
    expect(title).toBe('T')
    expect(meta).toEqual(['Lead'])
  })
})

describe('work / education summary — Title = role/degree, Org = employer/school', () => {
  it('work summary puts the position title in Title and the employer in Org', () => {
    const w = makeWork({
      employer: { en: 'BigCo' }, role_title: { en: 'Engineer' },
      start: { year: 2020, month: 1 }, end: { year: 2022, month: 6 },
    })
    const s = SECTION_CATALOG.work_experiences.summary!(w, html)!
    expect(s.parts.find((p) => p.key === 'title')?.value).toBe('Engineer')
    expect(s.parts.find((p) => p.key === 'org')?.value).toBe('BigCo')
  })

  it('work summary falls back to the employer as Title when no role is recorded', () => {
    const w = makeWork({ employer: { en: 'BigCo' }, role_title: {} })
    const s = SECTION_CATALOG.work_experiences.summary!(w, html)!
    expect(s.parts.find((p) => p.key === 'title')?.value).toBe('BigCo')
    expect(s.parts.find((p) => p.key === 'org')).toBeUndefined()
  })

  it('education summary puts the degree in Title and the school in Org', () => {
    const e = makeEducation({ school: { en: 'NTNU' }, degree: { en: 'MSc Computer Science' } })
    const s = SECTION_CATALOG.educations.summary!(e, html)!
    expect(s.parts.find((p) => p.key === 'title')?.value).toBe('MSc Computer Science')
    expect(s.parts.find((p) => p.key === 'org')?.value).toBe('NTNU')
  })

  it('project summary puts the role in Title and the client in Org', () => {
    const p = makeProject({
      customer: { en: 'AcmeCo' },
      roles: [{ id: 'pr1', role_id: 'r1', name: { en: 'Architect' }, sort_order: 0, disabled: false }],
    }) as unknown as Record<string, unknown>
    const s = SECTION_CATALOG.projects.summary!(p, html)!
    expect(s.parts.find((pt) => pt.key === 'title')?.value).toBe('Architect')
    expect(s.parts.find((pt) => pt.key === 'org')?.value).toBe('AcmeCo')
  })
})

describe('projects — anonymization (both render paths)', () => {
  const anonProject = makeProject({
    customer: { en: 'Real Client AS' },
    customer_anonymized: { en: 'Large Nordic Bank' },
    use_anonymized: true,
  }) as unknown as Record<string, unknown>

  it('full() uses the anonymized customer when use_anonymized is set', () => {
    for (const ctx of [html, docx]) {
      const v = SECTION_CATALOG.projects.full!(anonProject, ctx)!
      expect(v.title).toBe('Large Nordic Bank')
      expect(v.title).not.toContain('Real Client')
    }
  })

  it('summary() uses the anonymized customer too', () => {
    const s = SECTION_CATALOG.projects.summary!(anonProject, html)!
    // The client is the Org slot now; it must be the alias, never the real name.
    const all = [summaryTitleMeta(s).title, ...summaryTitleMeta(s).meta].join(' ')
    expect(all).toContain('Large Nordic Bank')
    expect(all).not.toContain('Real Client')
  })

  it('never falls back to the real name when the alias is missing', () => {
    const p = makeProject({
      customer: { en: 'Secret Client' }, customer_anonymized: {}, use_anonymized: true,
      description: { en: 'A delivery project' },
    }) as unknown as Record<string, unknown>
    const v = SECTION_CATALOG.projects.full!(p, html)!
    expect(v.title).not.toContain('Secret Client')
    expect(v.title).toBe('A delivery project')
  })

  it('editor title() keeps showing the real customer (item list context)', () => {
    expect(SECTION_CATALOG.projects.title(anonProject, 'en')).toBe('Real Client AS')
  })
})

describe('projects — the optional groups, and what stays per-target', () => {
  const p = makeProject({
    customer: { en: 'Acme' },
    industries: [{ id: 'pi1', industry_id: 'ind1', name: { en: 'Finance' }, sort_order: 0 }],
    description: { en: 'Short desc' },
    long_description: { en: 'Long desc' },
    team_size: 5,
    highlights: [{ en: 'Cut costs 20%' }],
  }) as unknown as Record<string, unknown>

  const withGroups = (target: 'html' | 'docx', ...extras: string[]): CatalogCtx =>
    ({ locale: 'en', hideDates: false, target, extras: new Set(extras) })

  it('leaves team size and highlights out until the view asks — on both targets', () => {
    for (const ctx of [html, docx]) {
      const v = SECTION_CATALOG.projects.full!(p, ctx)!
      expect(v.meta).toContain('Finance')
      expect(v.meta.join(' ')).not.toContain('Team of')
      expect(v.points).toHaveLength(0)
      expect(v.body).toBe('Long desc')
    }
  })

  it('adds them for both targets once the groups are on', () => {
    for (const target of ['html', 'docx'] as const) {
      const v = SECTION_CATALOG.projects.full!(p, withGroups(target, 'metrics', 'highlights', 'lead'))!
      expect(v.meta).toContain('Team of 5')
      expect(v.points.map((pt) => pt.body)).toContain('Cut costs 20%')
      expect(v.plainBody).toBe('Short desc')
    }
  })

  it('keeps the paged heading larger than the preview one', () => {
    expect(SECTION_CATALOG.projects.full!(p, docx)!.titleStyle).toBe('large')
    expect(SECTION_CATALOG.projects.full!(p, html)!.titleStyle).toBe('body')
  })

  it('declares no per-target sort — item order is one decision for all of them', () => {
    // A `docxSortByStart` flag used to live here, promising that DOCX sorted
    // projects by start date while the preview kept the arranged order. No
    // renderer had read it since ordering moved into viewSectionPlan, so it
    // documented a divergence that did not exist. Order now comes from the
    // view's per-section sort, once, for every adapter.
    expect('docxSortByStart' in SECTION_CATALOG.projects).toBe(false)
  })
})

describe('key_qualifications — disabled points filtered (both paths)', () => {
  const kq = makeKQ({
    key_points: [
      { id: 'k1', name: { en: 'Visible' }, long_description: { en: 'shown' }, sort_order: 0 },
      { id: 'k2', name: { en: 'Hidden' }, long_description: { en: 'not shown' }, sort_order: 1, disabled: true },
    ] as never,
  }) as unknown as Record<string, unknown>

  it.each([['html', html], ['docx', docx]] as const)('%s drops disabled key points', (_n, ctx) => {
    const v = SECTION_CATALOG.key_qualifications.full!(kq, ctx)!
    expect(v.points.map((p) => p.label)).toEqual(['Visible'])
  })

  it('uses the tag line as the heading on every target, shown only when opted in', () => {
    const k = makeKQ({ label: { en: 'Senior Dev' }, tag_line: { en: 'Tagline' } }) as unknown as Record<string, unknown>
    // Default: tag line hidden (it doubles as the resume title) — no heading.
    expect(SECTION_CATALOG.key_qualifications.full!(k, html)!.title).toBe('')
    expect(SECTION_CATALOG.key_qualifications.full!(k, docx)!.title).toBe('')
    // Opt in via ctx.kq.tagline. It is the heading on BOTH targets now: the
    // paged path used to demote it to a meta line, which read as a different CV.
    const shown = { tagline: true, short: false, long: true }
    for (const target of [html, docx]) {
      expect(SECTION_CATALOG.key_qualifications.full!(k, { ...target, kq: shown })!.title).toBe('Tagline')
    }
  })
})

describe('key_qualifications — Summary vs Full mode', () => {
  // alwaysFull, so both modes route through full(); the mode arrives as kq.
  const kq = makeKQ({
    summary: { en: 'The long profile.' }, summary_short: { en: 'The short summary.' },
    key_points: [{ id: 'p', name: { en: 'A point' }, long_description: { en: 'detail' }, sort_order: 0 }],
  }) as unknown as Record<string, unknown>
  const summaryMode: CatalogCtx = { ...html, kq: { label: true, tagline: true, short: true, long: false } }
  const fullMode: CatalogCtx = { ...html, kq: { label: true, tagline: true, short: false, long: true } }

  it('is alwaysFull so Summary mode still routes through full()', () => {
    expect(SECTION_CATALOG.key_qualifications.alwaysFull).toBe(true)
  })

  it('Summary mode shows the short summary and no key points', () => {
    const v = SECTION_CATALOG.key_qualifications.full!(kq, summaryMode)!
    expect(v.body).toContain('The short summary.')
    expect(v.body).not.toContain('The long profile.')
    expect(v.points).toEqual([])
  })

  it('Full mode shows the long profile and its key points', () => {
    const v = SECTION_CATALOG.key_qualifications.full!(kq, fullMode)!
    expect(v.body).toContain('The long profile.')
    expect(v.body).not.toContain('The short summary.')
    expect(v.points.map((p) => p.label)).toEqual(['A point'])
  })
})

describe('hideDates blanks all date output', () => {
  it('range and date fields go empty when hideDates is set', () => {
    const noDates: CatalogCtx = { ...html, hideDates: true }
    const w = makeWork({ start: { year: 2020, month: 1 }, end: null }) as unknown as Record<string, unknown>
    const v = SECTION_CATALOG.work_experiences.full!(w, noDates)!
    expect(v.meta.join(' ')).not.toContain('2020')
    const s = SECTION_CATALOG.work_experiences.summary!(w, noDates)!
    expect(summaryTitleMeta(s).meta.join(' ')).not.toContain('2020')
  })

  it('emits no date slots at all, not blank ones', () => {
    // A blank slot still occupies a column in the tabulated HTML layout, so a
    // dateless view would render a ragged empty column down the page.
    const noDates: CatalogCtx = { ...html, hideDates: true }
    const w = makeWork({ start: { year: 2020, month: 1 }, end: { year: 2022, month: 6 } }) as unknown as Record<string, unknown>
    const s = SECTION_CATALOG.work_experiences.summary!(w, noDates)!
    expect(s.parts.map((p) => p.key)).not.toContain('start')
    expect(s.parts.map((p) => p.key)).not.toContain('end')
  })

  it('shows an ongoing role as Present, and a dateless one as nothing', () => {
    // `end: null` means ongoing everywhere in the model — but only when there
    // is a start; an item with no dates at all must not claim to be running.
    const ongoing = makeWork({ start: { year: 2020, month: 1 }, end: null }) as unknown as Record<string, unknown>
    const ongoingParts = SECTION_CATALOG.work_experiences.summary!(ongoing, html)!.parts
    expect(ongoingParts.find((p) => p.key === 'end')?.value).toBeTruthy()

    const undated = makeWork({ start: null, end: null }) as unknown as Record<string, unknown>
    const undatedParts = SECTION_CATALOG.work_experiences.summary!(undated, html)!.parts
    expect(undatedParts.map((p) => p.key)).not.toContain('start')
    expect(undatedParts.map((p) => p.key)).not.toContain('end')
  })
})

describe('references — include_in_exports gate', () => {
  it('summary and full return null for a private reference', () => {
    const ref = makeReference({ include_in_exports: false }) as unknown as Record<string, unknown>
    expect(SECTION_CATALOG.references.summary!(ref, html)).toBeNull()
    expect(SECTION_CATALOG.references.full!(ref, docx)).toBeNull()
  })

  it('adds contact lines on every target once the group is on', () => {
    const ref = makeReference({
      include_in_exports: true, name: 'Kari', email: 'kari@x.no', phone: '999',
    }) as unknown as Record<string, unknown>
    const withContact = (target: 'html' | 'docx'): CatalogCtx =>
      ({ locale: 'en', hideDates: false, target, extras: new Set(['contact']) })
    expect(SECTION_CATALOG.references.full!(ref, html)!.extraLines).toEqual([])
    expect(SECTION_CATALOG.references.full!(ref, docx)!.extraLines).toEqual([])
    for (const target of ['html', 'docx'] as const) {
      expect(SECTION_CATALOG.references.full!(ref, withContact(target))!.extraLines).toContain('kari@x.no')
    }
  })
})

describe('layout kinds', () => {
  // Languages is a deliberate special case — every mode is a line, and they
  // differ only by how much Europass detail rides along. See the descriptor.
  describe('spoken_languages', () => {
    const norwegian = (cefr?: Record<string, string>) => makeSpokenLanguage({
      name: { en: 'Norwegian' }, level: { en: 'Native' }, cefr,
    }) as unknown as Record<string, unknown>

    it('summary is name + level only — no passport on the scan line', () => {
      const s = SECTION_CATALOG.spoken_languages.summary!(
        norwegian({ listening: 'C2', reading: 'C2', writing: 'C1' }), html,
      )!
      expect(s.parts.find((p) => p.key === 'title')?.value).toBe('Norwegian')
      expect(s.parts.find((p) => p.key === 'role')?.value).toBe('Native')
      expect(s.parts.find((p) => p.key === 'org')?.value).toBeFalsy()
    })

    it('summary gains a passport PART when the grid asks, for its own column', () => {
      const s = SECTION_CATALOG.spoken_languages.summary!(
        norwegian({ listening: 'C2', reading: 'C2', writing: 'C1' }),
        { ...html, detail: 'tabulated' },
      )!
      // Level and passport are separate parts ⇒ separate columns.
      expect(s.parts.find((p) => p.key === 'role')?.value).toBe('Native')
      expect(s.parts.find((p) => p.key === 'org')?.value)
        .toBe('Understanding: C2\nWritten: C1')
    })

    it('full keeps a single passport value on the line', () => {
      const v = SECTION_CATALOG.spoken_languages.full!(
        norwegian({ listening: 'B2', reading: 'B2', spoken_interaction: 'B2', spoken_production: 'B2', writing: 'B2' }),
        html,
      )!
      expect(v.layout).toBe('inline')
      expect(v.title).toBe('Norwegian')
      expect(v.meta).toEqual(['Native', 'B2'])
      expect(v.extraLines).toEqual([])
    })

    it('full drops a split passport onto its own lines', () => {
      const v = SECTION_CATALOG.spoken_languages.full!(
        norwegian({ listening: 'C2', reading: 'C2', writing: 'C1' }), html,
      )!
      expect(v.meta).toEqual(['Native'])
      expect(v.extraLines).toEqual(['Understanding: C2', 'Written: C1'])
    })

    it('full with no passport is just name + level', () => {
      const v = SECTION_CATALOG.spoken_languages.full!(norwegian(), html)!
      expect(v.meta).toEqual(['Native'])
      expect(v.extraLines).toEqual([])
    })
  })

  it('recommendations render as a quote with attribution', () => {
    const r = makeRecommendation({
      recommender_name: 'Jane Boss', recommender_title: { en: 'CTO' },
      text: { en: 'Excellent' }, relationship: { en: 'Manager' },
    }) as unknown as Record<string, unknown>
    const v = SECTION_CATALOG.recommendations.full!(r, html)!
    expect(v.layout).toBe('quote')
    expect(v.body).toBe('Excellent')
    expect(v.attribution.startsWith('Jane Boss, CTO')).toBe(true)
    expect(v.attributionMeta).toContain('(Manager)')
  })

  it('recommendation summary trails the relationship after the company in parens', () => {
    const r = makeRecommendation({
      recommender_name: 'Jane Boss', recommender_title: { en: 'CTO' },
      recommender_company: 'BigCo', relationship: { en: 'Was my manager' },
    }) as unknown as Record<string, unknown>
    const s = summaryTitleMeta(SECTION_CATALOG.recommendations.summary!(r, html)!)
    expect(s.title).toBe('Jane Boss')
    expect(s.meta[0]).toBe('CTO, BigCo (Was my manager)')
  })

  it('recommendation summary omits the parens when no relationship is set', () => {
    const r = makeRecommendation({
      recommender_name: 'Jane Boss', recommender_title: { en: 'CTO' },
      recommender_company: 'BigCo', relationship: {},
    }) as unknown as Record<string, unknown>
    const s = summaryTitleMeta(SECTION_CATALOG.recommendations.summary!(r, html)!)
    expect(s.meta[0]).toBe('CTO, BigCo')
  })

  it('technology_categories use the colon summary separator', () => {
    const cat = item({ name: { en: 'Languages' }, skills: [{ name: { en: 'TS' } }, { name: { en: 'Go' } }] })
    const s = SECTION_CATALOG.technology_categories.summary!(cat, html)!
    expect(s.sep).toBe(':')
    expect(summaryTitleMeta(s).meta).toEqual(['TS, Go'])
  })

  it('technology_categories full() skips empty categories', () => {
    expect(SECTION_CATALOG.technology_categories.full!(item({ name: {}, skills: [] }), html)).toBeNull()
  })

  it('professional summary renders the enabled parts (tag line + short/long)', () => {
    const kq = {
      label: { en: 'Leadership' }, tag_line: { en: 'Builds teams' },
      summary: { en: 'The long version.' }, summary_short: { en: 'The short version.' },
      key_points: [],
    } as unknown as Record<string, unknown>

    // Default: long body; tag line HIDDEN (it doubles as the resume title).
    const def = SECTION_CATALOG.key_qualifications.full!(kq, html)!
    expect(def.title).toBe('')
    expect(def.body).toContain('The long version.')
    expect(def.body).not.toContain('The short version.')

    // Tag line opted in + Full → it shows as the heading.
    const withTag = SECTION_CATALOG.key_qualifications.full!(kq, {
      ...html, kq: { tagline: true, short: false, long: true },
    })!
    expect(withTag.title).toBe('Builds teams')

    // Short only (Summary mode): the short body, still no tag line.
    const shortOnly = SECTION_CATALOG.key_qualifications.full!(kq, {
      ...html, kq: { tagline: false, short: true, long: false },
    })!
    expect(shortOnly.title).toBe('')
    expect(shortOnly.body).toContain('The short version.')
    expect(shortOnly.body).not.toContain('The long version.')
  })
})

describe('editor titles and subtitles (parity with the old switches)', () => {
  it.each([
    ['projects', makeProject({ customer: {}, description: {} }), 'Untitled project'],
    ['key_qualifications', makeKQ({ label: {} }), 'Untitled profile'],
    ['key_competencies', makeKeyCompetency({ title: {} }), 'Untitled competency'],
    ['recommendations', makeRecommendation({ recommender_name: '' }), 'Recommendation'],
    ['work_experiences', makeWork({ employer: {} }), 'Untitled employer'],
    ['educations', makeEducation({ school: {} }), 'Untitled school'],
    ['references', makeReference({ name: '' }), 'Unnamed'],
  ] as const)('%s falls back to its placeholder title', (key, it_, expected) => {
    expect(SECTION_CATALOG[key].title(it_ as unknown as Record<string, unknown>, 'en')).toBe(expected)
  })

  it('work subtitle combines role and range', () => {
    const w = makeWork({
      role_title: { en: 'Engineer' }, start: { year: 2020, month: 1 }, end: null,
    }) as unknown as Record<string, unknown>
    expect(SECTION_CATALOG.work_experiences.subtitle!(w, 'en')).toBe('Engineer · Jan 2020 – Present')
  })
})

/**
 * The five simple sections — each had ~30-40 mutants and exactly one killed,
 * because the only thing asserting anything about them is the "has a
 * descriptor" check at the top of this file. Their `full`/`summary` bodies were
 * never called.
 *
 * What is worth pinning is not that they return a title — it is the two things
 * that DIFFER between them and from the sections already covered: the per-target
 * branch (`ctx.target === 'html'` drops extraLines, because the HTML renderer
 * links the item rather than printing a bare URL beneath it) and the hideDates
 * contract that anonymized views rely on.
 */
describe('the simple sections', () => {
  const text: CatalogCtx = { locale: 'en', hideDates: false, target: 'text' }
  const noDates: CatalogCtx = { locale: 'en', hideDates: true, target: 'docx' }
  /** Same target, with the section's optional groups switched on. */
  const withAll = (base: CatalogCtx, ...keys: string[]): CatalogCtx =>
    ({ ...base, extras: new Set(keys) })

  describe('certifications', () => {
    const cert = item({
      name: { en: 'AWS Solutions Architect' },
      organiser: { en: 'Amazon' },
      issued: { year: 2022, month: 3 },
      expires: { year: 2025, month: 3 },
      credential_url: 'https://verify.example/abc',
      description: { en: 'Professional level.' },
    })

    it('carries the name, organiser, issue date and body', () => {
      const v = SECTION_CATALOG.certifications.full!(cert, docx)!
      expect(v.title).toBe('AWS Solutions Architect')
      expect(v.meta).toEqual(['Amazon'])
      expect(v.body).toBe('Professional level.')
      expect(v.date).toContain('2022')
    })

    it('appends the expiry to the date only when the group asks', () => {
      expect(SECTION_CATALOG.certifications.full!(cert, docx)!.date).not.toMatch(/expires/)
      for (const target of [docx, html]) {
        expect(SECTION_CATALOG.certifications.full!(cert, withAll(target, 'expiry'))!.date)
          .toMatch(/expires/)
      }
    })

    it('emits the credential URL as an extra line only when the group asks', () => {
      expect(SECTION_CATALOG.certifications.full!(cert, docx)!.extraLines).toEqual([])
      for (const target of [docx, html]) {
        expect(SECTION_CATALOG.certifications.full!(cert, withAll(target, 'links'))!.extraLines)
          .toEqual(['https://verify.example/abc'])
      }
    })

    it('drops the expiry along with the issue date when the view hides dates', () => {
      // hideDates blanks the issue date; the expiry is appended to it and must
      // go with it, or an anonymized export still prints a year.
      expect(SECTION_CATALOG.certifications.full!(cert, withAll(noDates, 'expiry'))!.date).toBe('')
    })

    it('falls back to a generic label rather than an empty summary title', () => {
      const s = SECTION_CATALOG.certifications.summary!(item({}), docx)!
      expect(s.parts.find((p) => p.key === 'title')?.value).toBe('Certification')
    })
  })

  describe('courses (a RANGE since shape v11)', () => {
    const course = item({
      name: { en: 'Advanced Kubernetes' }, program: { en: 'CNCF' },
      start: { year: 2023, month: 1 }, end: { year: 2023, month: 6 },
      description: { en: 'Six months.' },
    })

    it('renders start-end, not a single completion date', () => {
      const v = SECTION_CATALOG.courses.full!(course, docx)!
      expect(v.date).toContain('2023')
      expect(v.date).toMatch(/–/)
      expect(v.meta).toEqual(['CNCF'])
    })

    it('splits the range into separate summary parts', () => {
      const s = SECTION_CATALOG.courses.summary!(course, docx)!
      const at = (k: string) => s.parts.find((p) => p.key === k)?.value
      expect(at('title')).toBe('Advanced Kubernetes')
      expect(at('org')).toBe('CNCF')
      expect(at('start')).toBeTruthy()
      expect(at('end')).toBeTruthy()
    })

    it('marks an ongoing course as present rather than blank', () => {
      const s = SECTION_CATALOG.courses.summary!(item({ ...course, end: null }), docx)!
      expect(s.parts.find((p) => p.key === 'end')?.value).toBeTruthy()
    })

    it('blanks the range when the view hides dates', () => {
      expect(SECTION_CATALOG.courses.full!(course, noDates)!.date).toBe('')
      const s = SECTION_CATALOG.courses.summary!(course, noDates)!
      expect(s.parts.find((p) => p.key === 'start')?.value ?? '').toBe('')
    })
  })

  describe('presentations (a RANGE since shape v13)', () => {
    const talk = item({
      title: { en: 'Scaling Postgres' }, event: { en: 'JavaZone' },
      start: { year: 2024, month: 9 }, end: { year: 2024, month: 9 },
      url: 'https://talks.example/pg', description: { en: 'A talk.' },
    })

    it('uses the event as meta and the range as the date', () => {
      const v = SECTION_CATALOG.presentations.full!(talk, docx)!
      expect(v.title).toBe('Scaling Postgres')
      expect(v.meta).toEqual(['JavaZone'])
      expect(v.date).toContain('2024')
    })

    it('emits the talk URL as an extra line only when the group asks', () => {
      expect(SECTION_CATALOG.presentations.full!(talk, text)!.extraLines).toEqual([])
      expect(SECTION_CATALOG.presentations.full!(talk, withAll(text, 'links'))!.extraLines)
        .toEqual(['https://talks.example/pg'])
    })

    it('omits the extra line when there is no URL', () => {
      const v = SECTION_CATALOG.presentations.full!(item({ ...talk, url: '' }), withAll(docx, 'links'))!
      expect(v.extraLines ?? []).toEqual([])
    })
  })

  describe('honor_awards', () => {
    const award = item({
      name: { en: 'Employee of the Year' }, issuer: { en: 'Cartavio AS' },
      date: { year: 2021, month: 12 }, description: { en: 'For the migration.' },
    })

    it('uses the issuer as meta and the award date as the date', () => {
      const v = SECTION_CATALOG.honor_awards.full!(award, docx)!
      expect(v.title).toBe('Employee of the Year')
      expect(v.meta).toEqual(['Cartavio AS'])
      expect(v.date).toContain('2021')
      expect(v.body).toBe('For the migration.')
    })

    it('drops the issuer from meta when absent, rather than leaving a blank', () => {
      const v = SECTION_CATALOG.honor_awards.full!(item({ ...award, issuer: {} }), docx)!
      expect(v.meta).toEqual([])
    })

    it('blanks the date when the view hides dates', () => {
      expect(SECTION_CATALOG.honor_awards.full!(award, noDates)!.date).toBe('')
    })
  })

  describe('publications', () => {
    const paper = item({
      title: { en: 'On Sharding' }, publisher: { en: 'ACM' },
      publication_type: 'article', co_authors: ['Ada Lovelace', 'Alan Turing'],
      date: { year: 2020, month: 5 }, abstract: { en: 'We shard.' },
      url: 'https://doi.example/1',
    })

    it('combines publisher and type into one line', () => {
      expect(SECTION_CATALOG.publications.full!(paper, docx)!.meta[0]).toBe('ACM (Article)')
    })

    it('keeps the type alone when there is no publisher, and vice versa', () => {
      expect(SECTION_CATALOG.publications.full!(item({ ...paper, publisher: {} }), docx)!.meta[0])
        .toBe('(Article)')
      expect(SECTION_CATALOG.publications.full!(item({ ...paper, publication_type: '' }), docx)!.meta[0])
        .toBe('ACM')
    })

    it('lists co-authors as their own meta line', () => {
      expect(SECTION_CATALOG.publications.full!(paper, docx)!.meta)
        .toEqual(['ACM (Article)', 'With Ada Lovelace, Alan Turing'])
    })

    it('omits the co-author line entirely when the paper is solo', () => {
      const v = SECTION_CATALOG.publications.full!(item({ ...paper, co_authors: [] }), docx)!
      expect(v.meta).toEqual(['ACM (Article)'])
    })

    it('uses the abstract as the body', () => {
      expect(SECTION_CATALOG.publications.full!(paper, docx)!.body).toBe('We shard.')
    })

    it('emits the URL as an extra line only when the group asks', () => {
      expect(SECTION_CATALOG.publications.full!(paper, docx)!.extraLines).toEqual([])
      expect(SECTION_CATALOG.publications.full!(paper, withAll(docx, 'links'))!.extraLines)
        .toEqual(['https://doi.example/1'])
    })
  })
})

/**
 * The EDITOR-facing labels — title() and subtitle().
 *
 * 115 unreached mutants in this file, and this is most of them. These are what
 * the View editor's item list and the global search show, and unlike the render
 * paths they deliberately show RAW data (no anonymization), so nothing else
 * exercises them. A fallback that resolves wrongly gives the consultant a list
 * of rows all reading "Untitled".
 */
describe('SECTION_CATALOG — editor titles and subtitles', () => {
  const TITLES: Array<[string, Record<string, unknown>, string]> = [
    ['projects', { customer: { en: 'Acme' }, description: { en: 'Payments' } }, 'Acme'],
    ['projects', { customer: {}, description: { en: 'Payments' } }, 'Payments'],
    ['projects', { customer: {}, description: {} }, 'Untitled project'],
    ['key_qualifications', { tag_line: { en: 'Architect' } }, 'Architect'],
    ['key_qualifications', { tag_line: {} }, 'Untitled profile'],
    ['key_competencies', { title: { en: 'Cloud' } }, 'Cloud'],
    ['key_competencies', { title: {} }, 'Untitled competency'],
    ['work_experiences', { employer: { en: 'Acme' } }, 'Acme'],
    ['work_experiences', { employer: {} }, 'Untitled employer'],
    ['educations', { school: { en: 'NTNU' } }, 'NTNU'],
    ['educations', { school: {} }, 'Untitled school'],
    ['courses', { name: { en: 'K8s 101' } }, 'K8s 101'],
    ['courses', { name: {} }, 'Untitled'],
    ['certifications', { name: { en: 'AWS SA' } }, 'AWS SA'],
    ['positions', { organisation: { en: 'Cartavio' }, name: { en: 'Board member' } }, 'Cartavio'],
    ['positions', { organisation: {}, name: { en: 'Board member' } }, 'Board member'],
    ['positions', { organisation: {}, name: {} }, 'Untitled'],
    ['spoken_languages', { name: { en: 'Norwegian' } }, 'Norwegian'],
    ['technology_categories', { name: { en: 'Languages' } }, 'Languages'],
    ['presentations', { title: { en: 'Scaling' } }, 'Scaling'],
    ['honor_awards', { name: { en: 'Award' } }, 'Award'],
    ['publications', { title: { en: 'On Sharding' } }, 'On Sharding'],
    ['references', { name: 'Jane Boss' }, 'Jane Boss'],
    ['references', { name: '' }, 'Unnamed'],
    ['skills', { name: { en: 'Go' } }, 'Go'],
    ['skills', { name: {} }, 'Unnamed skill'],
    ['roles', { name: { en: 'Architect' } }, 'Architect'],
    ['roles', { name: {} }, 'Unnamed role'],
    ['industries', { name: { en: 'Banking' } }, 'Banking'],
    ['industries', { name: {} }, 'Unnamed industry'],
  ]

  it.each(TITLES)('%s titles %j as %j', (key, itm, expected) => {
    expect(SECTION_CATALOG[key].title(item(itm), 'en')).toBe(expected)
  })

  it('resolves an editor title in the requested locale', () => {
    expect(SECTION_CATALOG.projects.title(item({ customer: { en: 'Acme', no: 'Akme' } }), 'no'))
      .toBe('Akme')
  })

  describe('subtitles', () => {
    const dated = { start: { year: 2020, month: 1 }, end: { year: 2021, month: 6 } }

    it('shows a project’s RAW range, unaffected by hideDates', () => {
      // The editor list always shows dates — hiding them is a per-view export
      // setting, and the consultant needs to tell two rows apart regardless.
      expect(SECTION_CATALOG.projects.subtitle!(item(dated), 'en')).toMatch(/2020/)
    })

    it('joins an employment’s role and range with a middot', () => {
      expect(SECTION_CATALOG.work_experiences.subtitle!(item({ role_title: { en: 'Architect' }, ...dated }), 'en'))
        .toMatch(/^Architect · /)
    })

    it('omits the middot when an employment has no range', () => {
      expect(SECTION_CATALOG.work_experiences.subtitle!(item({ role_title: { en: 'Architect' } }), 'en'))
        .toBe('Architect')
    })

    it('joins an education’s degree and range', () => {
      expect(SECTION_CATALOG.educations.subtitle!(item({ degree: { en: 'MSc' }, ...dated }), 'en'))
        .toMatch(/^MSc · /)
      expect(SECTION_CATALOG.educations.subtitle!(item({ degree: { en: 'MSc' } }), 'en')).toBe('MSc')
    })

    it('joins a position’s name, TYPE and range', () => {
      const s = SECTION_CATALOG.positions.subtitle!(
        item({ name: { en: 'Board member' }, position_type: 'board_member', ...dated }), 'en')
      expect(s).toContain('Board member')
      expect(s).toMatch(/·.*·/)
    })

    it('drops the type from a position subtitle when it has none', () => {
      expect(SECTION_CATALOG.positions.subtitle!(item({ name: { en: 'Advisor' } }), 'en')).toBe('Advisor')
    })

    it('shows a certification’s organiser and a presentation’s event', () => {
      expect(SECTION_CATALOG.certifications.subtitle!(item({ organiser: { en: 'Amazon' } }), 'en')).toBe('Amazon')
      expect(SECTION_CATALOG.presentations.subtitle!(item({ event: { en: 'JavaZone' } }), 'en')).toBe('JavaZone')
    })

    it('shows a recommendation’s title and company', () => {
      const s = SECTION_CATALOG.recommendations.subtitle!(
        item({ recommender_title: { en: 'CTO' }, recommender_company: 'BigCo' }), 'en')
      expect(s).toContain('CTO')
      expect(s).toContain('BigCo')
    })

    it('leaves out the absent half of a recommendation subtitle', () => {
      expect(SECTION_CATALOG.recommendations.subtitle!(
        item({ recommender_title: { en: 'CTO' }, recommender_company: '' }), 'en')).toBe('CTO')
    })
  })
})

/**
 * The extra fields — each is one line in an exported document, and each was
 * unreached. They are the details a reader looks for: a grade, a credential
 * link, an allocation, a contact route for a reference.
 */
describe('SECTION_CATALOG — the extra render details', () => {
  const text: CatalogCtx = { locale: 'en', hideDates: false, target: 'text' }
  /** These details are all optional groups now — this switches them on. */
  const on = (base: CatalogCtx, ...keys: string[]): CatalogCtx =>
    ({ ...base, extras: new Set(keys) })

  it('emits an education grade as an extra line on every target, once asked', () => {
    const withGrade = item({ school: { en: 'NTNU' }, degree: { en: 'MSc' }, grade: 'A' })
    for (const target of [docx, html]) {
      expect(SECTION_CATALOG.educations.full!(withGrade, on(target, 'grade'))!.extraLines)
        .toEqual([expect.stringContaining('A')])
      expect(SECTION_CATALOG.educations.full!(withGrade, target)!.extraLines).toEqual([])
    }
  })

  it('omits the grade line when there is no grade', () => {
    expect(SECTION_CATALOG.educations.full!(item({ school: { en: 'NTNU' } }), on(docx, 'grade'))!.extraLines)
      .toEqual([])
  })

  it('shows an employment’s type as meta, humanised', () => {
    // Stored as a snake_case enum; printed with a space.
    const v = SECTION_CATALOG.work_experiences.full!(
      item({ employer: { en: 'Acme' }, employment_type: 'full_time' }), on(docx, 'employment_type'))!
    expect(v.meta).toContain('full time')
  })

  it('omits the employment-type meta when unset', () => {
    expect(SECTION_CATALOG.work_experiences.full!(item({ employer: { en: 'Acme' } }), on(docx, 'employment_type'))!.meta)
      .toEqual([])
  })

  it('heads an employment with the employer and puts the role below it', () => {
    // The paged targets used to fold the role into the heading and the preview
    // did not, so the same CV read differently depending on the button pressed.
    for (const target of [docx, html]) {
      const v = SECTION_CATALOG.work_experiences.full!(
        item({ employer: { en: 'Acme' }, role_title: { en: 'Architect' } }), target)!
      expect(v.title).toBe('Acme')
      expect(v.meta).toEqual(['Architect'])
    }
    expect(SECTION_CATALOG.work_experiences.full!(item({ employer: {}, role_title: {} }), docx)!.title)
      .toBe('Employer')
  })

  it('shows a project’s allocation when set', () => {
    const v = SECTION_CATALOG.projects.full!(
      item({ customer: { en: 'Acme' }, percent_allocated: 60 }), on(docx, 'metrics'))!
    expect(v.meta.join(' ')).toContain('60')
    const none = SECTION_CATALOG.projects.full!(item({ customer: { en: 'Acme' } }), on(docx, 'metrics'))!
    expect(none.meta.join(' ')).not.toContain('60')
  })

  it('carries a project’s highlights as points, dropping the empty ones', () => {
    const v = SECTION_CATALOG.projects.full!(item({
      customer: { en: 'Acme' },
      highlights: [{ en: 'Cut build time' }, {}, { en: 'Shipped it' }],
    }), on(docx, 'highlights'))!
    expect(v.points.map((p) => p.body)).toEqual(['Cut build time', 'Shipped it'])
  })

  it('lists a project’s roles, industries and skills as tags', () => {
    const v = SECTION_CATALOG.projects.full!(item({
      customer: { en: 'Acme' },
      roles: [{ name: { en: 'Architect' } }, { name: { en: 'Gone' }, disabled: true }],
      industries: [{ name: { en: 'Banking' } }],
      skills: [{ name: { en: 'Go' } }],
    }), docx)!
    const all = [...v.tags, ...v.meta].join(' | ')
    expect(all).toContain('Architect')
    expect(all).toContain('Go')
    // A disabled role is out of every export.
    expect(all).not.toContain('Gone')
  })

  it('carries a profile’s key points, skipping the disabled ones', () => {
    const v = SECTION_CATALOG.key_qualifications.full!(item({
      summary: { en: 'Long summary.' },
      key_points: [
        { name: { en: 'Cloud' }, long_description: { en: 'Ran it.' } },
        { name: { en: 'Gone' }, long_description: { en: 'x' }, disabled: true },
      ],
    }), docx)!
    expect(v.points.map((p) => p.label)).toEqual(['Cloud'])
  })

  it('renders a competency’s title and description, and nothing for an empty one', () => {
    expect(SECTION_CATALOG.key_competencies.full!(
      item({ title: { en: 'Cloud' }, description: { en: 'Ran it.' } }), docx))
      .toMatchObject({ title: 'Cloud', body: 'Ran it.' })
    expect(SECTION_CATALOG.key_competencies.full!(item({ title: {}, description: {} }), docx)).toBeNull()
  })

  describe('references', () => {
    const ref = (over: Record<string, unknown> = {}) => item({
      name: 'Jane Boss', title: 'CTO', company: 'BigCo',
      relationship: { en: 'Worked together' }, email: 'jane@x.io', phone: '+47 900',
      include_in_exports: true, ...over,
    })

    it('is omitted entirely unless include_in_exports is set', () => {
      // A reference is a named third party who consented to be listed; exporting
      // one that has not opted in is the mistake this flag exists to prevent.
      expect(SECTION_CATALOG.references.full!(ref({ include_in_exports: false }), docx)).toBeNull()
      expect(SECTION_CATALOG.references.summary!(ref({ include_in_exports: false }), docx)).toBeNull()
      expect(SECTION_CATALOG.references.full!(ref(), docx)).not.toBeNull()
    })

    it('lists title and company as meta, and contact details as extra lines', () => {
      const v = SECTION_CATALOG.references.full!(ref(), on(text, 'contact'))!
      expect(v.meta).toEqual(['CTO', 'BigCo'])
      expect(v.extraLines).toEqual(['Worked together', 'jane@x.io', '+47 900'])
    })

    it('withholds the contact details until the view asks, on every target', () => {
      // Someone else's inbox and phone number: the default is to leave them out.
      for (const target of [html, text]) {
        const v = SECTION_CATALOG.references.full!(ref(), target)!
        expect(v.meta).toEqual(['CTO', 'BigCo'])
        expect(v.extraLines).toEqual([])
      }
    })

    it('drops an absent contact route rather than leaving a blank line', () => {
      const v = SECTION_CATALOG.references.full!(ref({ email: '', phone: '' }), on(text, 'contact'))!
      expect(v.extraLines).toEqual(['Worked together'])
    })
  })

  it('lists a publication’s co-authors, ignoring a non-array', () => {
    expect(SECTION_CATALOG.publications.full!(
      item({ title: { en: 'P' }, co_authors: 'Ada' }), docx)!.meta.join(' '))
      .not.toContain('With')
  })
})

/**
 * Content parity across the render adapters.
 *
 * The catalog used to carry a different SET OF FACTS per target: the DOCX shape
 * printed a project's team size, allocation and highlights while the HTML
 * preview dropped them — so the preview could not show a consultant what their
 * PDF would contain — and the ATS text export, which asks for the same shape as
 * the preview, quietly shipped less than either. `ctx.target` now selects
 * LAYOUT ONLY (title sizing and spacing). These tests hold that line: a
 * descriptor that starts branching content on the target again fails here.
 *
 * The optional facts moved to per-view groups instead (lib/sectionExtras), so
 * they read the same in every export and the user decides which ship.
 */
describe('SECTION_CATALOG — every target carries the same facts', () => {
  /** Every section, populated with each optional field its groups can expose. */
  const POPULATED: Array<[string, Record<string, unknown>]> = [
    ['projects', {
      customer: { en: 'Acme' }, description: { en: 'Short' }, long_description: { en: '<p>Long</p>' },
      highlights: [{ en: 'Shipped it' }], skills: [{ name: { en: 'Go' }, sort_order: 0 }],
      roles: [{ name: { en: 'Architect' }, sort_order: 0 }],
      industries: [{ name: { en: 'Banking' }, sort_order: 0 }],
      team_size: 5, percent_allocated: 80, external_url: 'https://case', location_country_code: 'NO',
      start: { year: 2020, month: 1 }, end: null,
    }],
    ['work_experiences', {
      employer: { en: 'Acme' }, role_title: { en: 'Architect' }, long_description: { en: '<p>Did work</p>' },
      employment_type: 'permanent', company_size_local: '~50', company_size_national: '200',
      company_size_global: '40,000', company_url: 'https://acme',
      start: { year: 2020, month: 1 }, end: null,
    }],
    ['educations', {
      school: { en: 'NTNU' }, degree: { en: 'MSc' }, description: { en: 'Studied' }, grade: 'A',
      exchange: true, start: { year: 2010, month: 8 }, end: { year: 2013, month: 6 },
    }],
    ['certifications', {
      name: { en: 'AWS SA' }, organiser: { en: 'AWS' }, description: {},
      issued: { year: 2024, month: 1 }, expires: { year: 2027, month: 1 }, credential_url: 'https://verify/x',
    }],
    ['presentations', { title: { en: 'A talk' }, event: { en: 'Testfest' }, description: {}, url: 'https://talk' }],
    ['publications', { title: { en: 'A paper' }, publisher: { en: 'ACM' }, abstract: {}, url: 'https://paper' }],
    ['references', {
      name: 'Ada', title: 'CTO', company: 'Acme', include_in_exports: true,
      relationship: { en: 'Former manager' }, email: 'ada@acme.no', phone: '+47 1',
      linkedin_url: 'https://linkedin/ada',
    }],
    ['recommendations', {
      recommender_name: 'Ada', recommender_title: { en: 'CTO' }, recommender_company: 'Acme',
      relationship: { en: 'Manager' }, text: { en: '<p>Great</p>' },
      date: { year: 2023, month: 4 }, contact_url: 'https://rec',
    }],
    ['honor_awards', {
      name: { en: 'Best paper' }, issuer: { en: 'ACM' }, description: { en: 'Won' },
      for_work: { en: 'The Phoenix migration' }, date: { year: 2022, month: 5 },
    }],
    ['courses', { name: { en: 'Kubernetes' }, program: { en: 'CNCF' }, description: { en: 'Learned' }, end: { year: 2024, month: 2 } }],
    ['positions', { name: { en: 'Board member' }, organisation: { en: 'Cartavio' }, description: { en: 'Served' }, start: { year: 2020, month: 1 }, end: null }],
    ['key_competencies', { title: { en: 'Architecture' }, description: { en: 'Designs systems' } }],
    ['technology_categories', { name: { en: 'Cloud' }, skills: [{ name: { en: 'AWS' }, sort_order: 0 }] }],
    ['spoken_languages', { name: { en: 'Norwegian' }, level: { en: 'Native' } }],
    ['key_qualifications', { tag_line: { en: 'Architect' }, summary: { en: '<p>Long</p>' }, summary_short: { en: 'Short' }, key_points: [] }],
  ]

  /** Every group the section declares — the maximal-content configuration. */
  const allExtras = (key: string): ReadonlySet<string> => new Set(extrasFor(key).map((g) => g.key))

  const ctxFor = (target: 'html' | 'docx', key: string): CatalogCtx => ({
    locale: 'en', hideDates: false, dateFormat: 'month-year', target,
    extras: allExtras(key), kq: { tagline: true, short: false, long: true },
  })

  /** The item view minus the two properties that are legitimately per-target. */
  const contentOf = (v: ItemView): Omit<ItemView, 'titleStyle' | 'spacingBefore'> => {
    const { titleStyle: _t, spacingBefore: _s, ...content } = v
    return content
  }

  it.each(POPULATED)('carries identical content for %s on both targets', (key, item) => {
    const html = SECTION_CATALOG[key].full!(item as never, ctxFor('html', key))!
    const docx = SECTION_CATALOG[key].full!(item as never, ctxFor('docx', key))!
    expect(contentOf(html)).toEqual(contentOf(docx))
  })

  it('still lets the targets differ in title sizing and spacing', () => {
    // Parity is about FACTS, not layout: a paged export gives a project a
    // larger heading and room above it, and should keep doing so.
    const project = POPULATED[0][1]
    const docx = SECTION_CATALOG.projects.full!(project as never, ctxFor('docx', 'projects'))!
    const html = SECTION_CATALOG.projects.full!(project as never, ctxFor('html', 'projects'))!
    expect(docx.titleStyle).toBe('large')
    expect(docx.spacingBefore).toBeGreaterThan(0)
    expect(html.titleStyle).toBe('body')
    expect(html.spacingBefore).toBe(0)
  })

  it('leaves every declared group with something to switch on', () => {
    // A group that changes no output is a checkbox that lies.
    for (const [key, item] of POPULATED) {
      const off = SECTION_CATALOG[key].full!(item as never, {
        locale: 'en', hideDates: false, dateFormat: 'month-year', target: 'docx',
        kq: { tagline: true, short: false, long: true },
      })!
      for (const g of extrasFor(key)) {
        const on = SECTION_CATALOG[key].full!(item as never, {
          locale: 'en', hideDates: false, dateFormat: 'month-year', target: 'docx',
          extras: new Set([g.key]), kq: { tagline: true, short: false, long: true },
        })!
        expect(on, `${key}/${g.key}`).not.toEqual(off)
      }
    }
  })
})

describe('SECTION_CATALOG — optional content groups', () => {
  const ctx = (extras?: string[]): CatalogCtx => ({
    locale: 'en', hideDates: false, dateFormat: 'month-year', target: 'docx',
    extras: extras ? new Set(extras) : undefined,
  })

  const project = {
    customer: { en: 'Acme' }, description: { en: 'Short' }, long_description: { en: '<p>Long</p>' },
    highlights: [{ en: 'Shipped it' }], skills: [], roles: [], industries: [],
    team_size: 5, percent_allocated: 80, external_url: 'https://case', location_country_code: 'NO',
    start: { year: 2020, month: 1 }, end: null,
  }
  const full = (key: string, item: Record<string, unknown>, extras?: string[]) =>
    SECTION_CATALOG[key].full!(item as never, ctx(extras))!

  it('ships nothing optional when the view enables nothing', () => {
    // The default for every section, and why enabling is the safe direction: a
    // view saved by an older build renders the core facts and no surprises.
    const v = full('projects', project)
    expect(v.meta).toEqual([])
    expect(v.points).toEqual([])
    expect(v.extraLines).toEqual([])
    expect(v.plainBody).toBe('')
  })

  it('adds team size and allocation only with the metrics group', () => {
    expect(full('projects', project, ['metrics']).meta).toEqual(['Team of 5', '80% allocation'])
  })

  it('adds highlights only with the highlights group', () => {
    expect(full('projects', project, ['highlights']).points).toEqual([{ label: '', body: 'Shipped it' }])
  })

  it('names the country rather than printing its code', () => {
    // Intl already knows the fifteen offered locales, so no country table here.
    expect(full('projects', project, ['location']).meta).toEqual(['Norway'])
  })

  it('keeps a short-only description visible whether or not the lead-in is on', () => {
    // Otherwise the lead-in group would decide whether a project written only
    // in short form renders at all.
    const shortOnly = { ...project, long_description: {} }
    expect(full('projects', shortOnly).body).toBe('Short')
    expect(full('projects', shortOnly, ['lead']).plainBody).toBe('Short')
  })

  it('holds referee contact details back until the view asks for them', () => {
    const ref = {
      name: 'Ada', title: 'CTO', company: 'Acme', include_in_exports: true,
      relationship: { en: 'Former manager' }, email: 'ada@acme.no', phone: '+47 1',
      linkedin_url: 'https://linkedin/ada',
    }
    expect(full('references', ref).extraLines).toEqual([])
    expect(full('references', ref, ['contact']).extraLines)
      .toEqual(['Former manager', 'ada@acme.no', '+47 1'])
    expect(full('references', ref, ['links']).extraLines).toEqual(['https://linkedin/ada'])
  })

  it('joins the headcounts into one line rather than three', () => {
    const w = {
      employer: { en: 'Acme' }, role_title: { en: 'Architect' }, long_description: {},
      company_size_local: '~50', company_size_global: '40,000', start: null, end: null,
    }
    expect(full('work_experiences', w, ['company_size']).extraLines)
      .toEqual(['Company size: ~50 (local) · 40,000 (global)'])
  })

  it('localizes the certification expiry instead of printing English into every language', () => {
    const cert = {
      name: { en: 'AWS SA' }, organiser: { en: 'AWS' }, description: {},
      issued: { year: 2024, month: 1 }, expires: { year: 2027, month: 1 },
    }
    const no: CatalogCtx = {
      locale: 'no', hideDates: false, dateFormat: 'month-year', target: 'docx',
      extras: new Set(['expiry']),
    }
    expect(SECTION_CATALOG.certifications.full!(cert as never, no)!.date).toContain('utløper')
  })
})

describe('SECTION_CATALOG — the title a nameless item falls back to', () => {
  const ctx: CatalogCtx = { locale: 'en', hideDates: false, dateFormat: 'month-year', target: 'html' }

  it('names an untitled item per section rather than showing an empty heading', () => {
    const cases: Array<[string, string]> = [
      ['key_competencies', 'Untitled competency'],
      ['courses', 'Untitled'],
      ['certifications', 'Untitled'],
      ['publications', 'Untitled'],
      ['technology_categories', 'Untitled'],
      ['recommendations', 'Recommendation'],
      ['references', 'Unnamed'],
    ]
    for (const [key, expected] of cases) {
      expect(SECTION_CATALOG[key].title({} as never, 'en'), key).toBe(expected)
    }
  })

  it('names an untitled item in the SUMMARY line too, with its own wording', () => {
    const summaryTitle = (key: string, item: Record<string, unknown> = {}) =>
      summaryTitleMeta(SECTION_CATALOG[key].summary!(item as never, ctx)!).title
    expect(summaryTitle('key_competencies')).toBe('Competency')
    expect(summaryTitle('courses')).toBe('Course')
    expect(summaryTitle('technology_categories')).toBe('Category')
    expect(summaryTitle('honor_awards')).toBe('Award')
    expect(summaryTitle('references', { include_in_exports: true })).toBe('Reference')
  })

  it('prefers the item\u2019s own name over the fallback', () => {
    expect(SECTION_CATALOG.references.title({ name: 'Ada' } as never, 'en')).toBe('Ada')
    expect(SECTION_CATALOG.key_competencies.title({ title: { en: 'Cloud' } } as never, 'en')).toBe('Cloud')
    expect(summaryTitleMeta(
      SECTION_CATALOG.references.summary!({ name: 'Ada', include_in_exports: true } as never, ctx)!,
    ).title).toBe('Ada')
  })
})

describe('SECTION_CATALOG — the HTML view carries its own facts', () => {
  const html: CatalogCtx = { locale: 'en', hideDates: false, dateFormat: 'month-year', target: 'html' }
  const full = (key: string, item: Record<string, unknown>) =>
    SECTION_CATALOG[key].full!(item as never, html)!

  it('gives an education its degree, dates and body — and no empty meta entry', () => {
    const withDegree = full('educations', {
      school: { en: 'NTNU' }, degree: { en: 'MSc' }, description: { en: 'Studied' },
      start: { year: 2010, month: 8 }, end: { year: 2013, month: 6 },
    })
    expect(withDegree.title).toBe('NTNU')
    expect(withDegree.meta).toEqual(['MSc'])
    expect(withDegree.body).toBe('Studied')
    expect(withDegree.date).toContain('2010')

    // A missing degree leaves NO meta line rather than a blank one.
    expect(full('educations', { school: { en: 'NTNU' }, degree: {}, description: {} }).meta).toEqual([])
  })

  it('gives a certification its issuer and issue date, and no empty meta entry', () => {
    const cert = full('certifications', {
      name: { en: 'AWS SA' }, organiser: { en: 'AWS' }, description: {},
      issued: { year: 2024, month: 1 },
    })
    expect(cert.title).toBe('AWS SA')
    expect(cert.meta).toEqual(['AWS'])
    expect(cert.date).toContain('2024')
    expect(full('certifications', { name: { en: 'AWS SA' }, organiser: {}, description: {} }).meta).toEqual([])
  })

  it('gives an employment its role as meta, and no empty meta entry', () => {
    expect(full('work_experiences', {
      employer: { en: 'Acme' }, role_title: { en: 'Architect' }, long_description: {},
    }).meta).toEqual(['Architect'])
    expect(full('work_experiences', {
      employer: { en: 'Acme' }, role_title: {}, long_description: {},
    }).meta).toEqual([])
  })

  it('heads a position with its ORGANISATION, falling back to the position name', () => {
    // The organisation is the heading everywhere else too (projects, employment,
    // education); the role name goes on the line below.
    const both = full('positions', {
      name: { en: 'Board member' }, organisation: { en: 'Cartavio' }, description: {},
    })
    expect(both.title).toBe('Cartavio')
    expect(both.meta).toEqual(['Board member'])

    const noOrg = full('positions', {
      name: { en: 'Board member' }, organisation: {}, description: {},
    })
    expect(noOrg.title).toBe('Board member')
    // The name is the heading now, so it is not repeated below it.
    expect(noOrg.meta).toEqual([])
  })
})

/**
 * Every section's SUMMARY view, exercised once per section.
 *
 * The summary functions are the one-line form used by the ATS text, Markdown and
 * tabulated renderers. Several of them had no test at all — the catalog's
 * coverage check only asserted that `full` exists — so an emptied `summaryOf`
 * call or an inverted title fallback went unnoticed.
 */
describe('SECTION_CATALOG — every summary line', () => {
  const ctx: CatalogCtx = { locale: 'en', hideDates: false, target: 'text' }
  const summary = (key: string, it: Record<string, unknown>) =>
    SECTION_CATALOG[key].summary!(it as never, ctx)!
  const values = (key: string, it: Record<string, unknown>) =>
    summary(key, it).parts.map((p) => p.value)
  const titleOf = (key: string, it: Record<string, unknown>) =>
    summary(key, it).parts.find((p) => p.key === 'title')!.value

  const POPULATED: Array<[string, Record<string, unknown>, string, string]> = [
    // Projects put the ROLE in the title slot and the client in the org slot,
    // falling back to the description when no role is linked.
    ['projects', { customer: { en: 'Acme' }, description: { en: 'Payments' }, roles: [{ name: { en: 'Architect' } }] }, 'Architect', 'Acme'],
    ['work_experiences', { employer: { en: 'Cartavio' }, role_title: { en: 'Architect' } }, 'Architect', 'Cartavio'],
    ['educations', { school: { en: 'NTNU' }, degree: { en: 'MSc' } }, 'MSc', 'NTNU'],
    ['courses', { name: { en: 'Kubernetes' }, program: { en: 'Cloud track' } }, 'Kubernetes', 'Cloud track'],
    ['certifications', { name: { en: 'AWS SA' }, organiser: { en: 'Amazon' } }, 'AWS SA', 'Amazon'],
    ['positions', { name: { en: 'Board member' }, organisation: { en: 'Rowing Club' } }, 'Board member', 'Rowing Club'],
    ['presentations', { title: { en: 'Scaling up' }, event: { en: 'JavaZone' } }, 'Scaling up', 'JavaZone'],
    ['publications', { title: { en: 'On merging' }, publisher: { en: 'IEEE' } }, 'On merging', 'IEEE'],
    ['honor_awards', { name: { en: 'Best paper' }, issuer: { en: 'ACM' } }, 'Best paper', 'ACM'],
    ['spoken_languages', { name: { en: 'Norwegian' }, level: { en: 'Native' } }, 'Norwegian', 'Native'],
    ['key_competencies', { title: { en: 'Cloud architecture' } }, 'Cloud architecture', ''],
    ['recommendations', { recommender_name: 'Jane Boss', recommender_title: { en: 'CTO' } }, 'Jane Boss', 'CTO'],
    ['references', { name: 'Ola Hansen', title: 'CTO', include_in_exports: true }, 'Ola Hansen', 'CTO'],
  ]

  it.each(POPULATED)('%s puts its anchor in the title slot and its org beside it', (key, it, title, org) => {
    const vals = values(key, it)
    expect(titleOf(key, it)).toBe(title)
    if (org) expect(vals.join(' | ')).toContain(org)
  })

  const FALLBACKS: Array<[string, Record<string, unknown>, string]> = [
    ['projects', {}, 'Project'],
    ['work_experiences', {}, 'Role'],
    ['educations', {}, 'Education'],
    ['courses', {}, 'Course'],
    ['certifications', {}, 'Certification'],
    ['positions', {}, 'Role'],
    ['presentations', {}, 'Presentation'],
    ['publications', {}, 'Publication'],
    ['honor_awards', {}, 'Award'],
    ['spoken_languages', {}, 'Language'],
    ['key_competencies', {}, 'Competency'],
    ['recommendations', {}, 'Recommendation'],
    ['references', { include_in_exports: true }, 'Reference'],
  ]

  it.each(FALLBACKS)('%s names an empty item rather than showing a blank line', (key, it, fallback) => {
    // A blank title slot renders as a bare dash or an empty bullet, which reads
    // as a rendering fault rather than as an item nobody filled in.
    expect(titleOf(key, it)).toBe(fallback)
  })

  it('carries the date range into the summary where the section has one', () => {
    const vals = values('work_experiences', {
      employer: { en: 'Cartavio' }, role_title: { en: 'Architect' },
      start: { year: 2020, month: 1 }, end: { year: 2021, month: 6 },
    })
    expect(vals.join(' | ')).toMatch(/2020/)
    expect(vals.join(' | ')).toMatch(/2021/)
  })

  it('gives the Skills Showcase a colon separator and its skills as the org slot', () => {
    const s = summary('technology_categories', {
      name: { en: 'Cloud' },
      skills: [{ name: { en: 'Kubernetes' } }, { name: { en: 'Terraform' } }],
    })
    expect(s.sep).toBe(':')
    expect(s.parts.find((p) => p.key === 'title')!.value).toBe('Cloud')
    expect(s.parts.find((p) => p.key === 'org')!.value).toBe('Kubernetes, Terraform')
  })

  it('names an empty showcase group Category', () => {
    expect(titleOf('technology_categories', {})).toBe('Category')
  })
})

/**
 * No descriptor may emit an EMPTY meta entry.
 *
 * `meta`, `extraLines` and `attributionMeta` are joined by the renderers with
 * their own separators — " · " in the text and DOCX paths, a middot span in the
 * HTML one. An empty entry therefore surfaces as a dangling separator: "Acme · "
 * or " · 2020". Every descriptor filters its own array for that reason, and none
 * of those filters was asserted.
 */
describe.each(['text', 'html', 'docx'] as const)(
  'SECTION_CATALOG (%s) — no descriptor emits a blank meta entry', (target) => {
  const ctx: CatalogCtx = { locale: 'en', hideDates: false, target }
  const view = (key: string, it: Record<string, unknown>) => SECTION_CATALOG[key].full!(it as never, ctx)!

  /** One item per section with SOME meta parts filled and others deliberately empty. */
  const HALF_FILLED: Array<[string, Record<string, unknown>]> = [
    ['projects', { customer: { en: 'Acme' }, roles: [{ name: { en: 'Architect' } }], industries: [], long_description: { en: 'Ran it.' } }],
    ['projects', { customer: { en: 'Acme' }, roles: [], industries: [{ name: { en: 'Finance' } }] }],
    ['work_experiences', { employer: { en: 'Cartavio' }, role_title: {} }],
    ['educations', { school: { en: 'NTNU' }, degree: {} }],
    ['courses', { name: { en: 'Kubernetes' }, program: {} }],
    ['certifications', { name: { en: 'AWS SA' }, organiser: {} }],
    ['positions', { organisation: { en: 'Rowing Club' }, name: {} }],
    ['positions', { organisation: {}, name: { en: 'Board member' } }],
    ['presentations', { title: { en: 'Scaling up' }, event: {} }],
    ['publications', { title: { en: 'On merging' }, publisher: {}, authors: {} }],
    ['honor_awards', { name: { en: 'Best paper' }, issuer: {} }],
    ['spoken_languages', { name: { en: 'Norwegian' }, level: {} }],
    ['key_qualifications', { tag_line: {}, summary: { en: 'Builds things.' }, key_points: [] }],
    ['recommendations', { recommender_name: 'Jane Boss', recommender_title: {}, relationship: {}, text: { en: 'Great.' } }],
    ['references', { name: 'Ola Hansen', title: '', company: 'BigCo', include_in_exports: true }],
    ['references', { name: 'Ola Hansen', title: 'CTO', company: '', include_in_exports: true }],
  ]

  it.each(HALF_FILLED)('%s (#%#) leaves no empty entry behind', (key, it) => {
    const v = view(key, it)
    expect(v.meta.filter((m) => !m)).toEqual([])
    expect(v.extraLines.filter((l) => !l)).toEqual([])
    expect(v.attributionMeta.filter((m) => !m)).toEqual([])
    expect(v.points.filter((pt) => !pt.body && !pt.label)).toEqual([])
  })

  it('still CARRIES the meta parts that are filled', () => {
    // The other half of the same guard: filtering must not empty the array.
    expect(view('educations', { school: { en: 'NTNU' }, degree: { en: 'MSc' } }).meta).toContain('MSc')
    expect(view('courses', { name: { en: 'K8s' }, program: { en: 'Cloud track' } }).meta).toContain('Cloud track')
    expect(view('certifications', { name: { en: 'AWS' }, organiser: { en: 'Amazon' } }).meta).toContain('Amazon')
    expect(view('presentations', { title: { en: 'T' }, event: { en: 'JavaZone' } }).meta).toContain('JavaZone')
    expect(view('positions', { organisation: { en: 'Club' }, name: { en: 'Member' } }).meta).toContain('Member')
    expect(view('references', { name: 'O', title: 'CTO', company: 'BigCo', include_in_exports: true }).meta)
      .toEqual(['CTO', 'BigCo'])
  })
})

describe('SECTION_CATALOG — the descriptors that decline to render', () => {
  const ctx: CatalogCtx = { locale: 'en', hideDates: false, target: 'text' }
  const full = (key: string, it: Record<string, unknown>) => SECTION_CATALOG[key].full!(it as never, ctx)

  it('renders a key competency with only ONE of title and body', () => {
    // `!title && !body` — either alone is a usable block; requiring both would
    // drop a competency whose description the user has not written yet.
    expect(full('key_competencies', { title: { en: 'Cloud' }, description: {} })).not.toBeNull()
    expect(full('key_competencies', { title: {}, description: { en: 'Runs clouds.' } })).not.toBeNull()
    expect(full('key_competencies', { title: {}, description: {} })).toBeNull()
  })

  it('renders a showcase group with a name OR skills, not only with both', () => {
    expect(full('technology_categories', { name: { en: 'Cloud' }, skills: [] })).not.toBeNull()
    expect(full('technology_categories', { name: {}, skills: [{ name: { en: 'Go' } }] })).not.toBeNull()
    expect(full('technology_categories', { name: {}, skills: [] })).toBeNull()
  })

  it('shows a certification expiry only when dates are shown AND one exists', () => {
    const withExpiry = { name: { en: 'AWS SA' }, issued: { year: 2020, month: 1 }, expires: { year: 2023, month: 1 } }
    const wantExpiry = { ...ctx, extras: new Set(['expiry']) }
    expect(SECTION_CATALOG.certifications.full!(withExpiry as never, wantExpiry)!.date).toMatch(/2023/)
    // Off by default, like every optional group.
    expect(full('certifications', withExpiry)!.date).not.toMatch(/2023/)

    const hidden = SECTION_CATALOG.certifications.full!(withExpiry as never, { ...wantExpiry, hideDates: true })!
    expect(hidden.date).toBe('')

    const noExpiry = SECTION_CATALOG.certifications.full!(
      { name: { en: 'AWS SA' }, issued: { year: 2020, month: 1 }, expires: null } as never, wantExpiry)!
    expect(noExpiry.date).not.toMatch(/–/)
  })
})

describe('SECTION_CATALOG — the name lists a project draws on', () => {
  const ctx: CatalogCtx = { locale: 'en', hideDates: false, target: 'text' }
  const full = (it: Record<string, unknown>) => SECTION_CATALOG.projects.full!(it as never, ctx)!
  const summary = (it: Record<string, unknown>) => SECTION_CATALOG.projects.summary!(it as never, ctx)!

  it('drops a DISABLED role from the names, and a blank one', () => {
    // A soft-deleted role link is out of every export; listing it here would put
    // a name in the meta line that appears nowhere else in the CV.
    const v = full({
      customer: { en: 'Acme' },
      roles: [
        { name: { en: 'Architect' } },
        { name: { en: 'Ghost' }, disabled: true },
        { name: {} },
      ],
    })
    expect(v.meta.join(' ')).toContain('Architect')
    expect(v.meta.join(' ')).not.toContain('Ghost')
    expect(v.meta.filter((m) => !m)).toEqual([])
  })

  it('drops a blank industry and a blank skill name', () => {
    const v = full({
      customer: { en: 'Acme' },
      industries: [{ name: { en: 'Finance' } }, { name: {} }],
      skills: [{ name: { en: 'Go' } }, { name: {} }],
    })
    expect(v.meta.join(' ')).toContain('Finance')
    expect(v.tags).toEqual(['Go'])
  })

  it('reads a project with no roles, industries or skills at all', () => {
    const v = full({ customer: { en: 'Acme' } })
    expect(v.tags).toEqual([])
    expect(v.meta.filter((m) => !m)).toEqual([])
  })

  it('puts the customer in the ORG slot only when the title came from elsewhere', () => {
    // With no role and no description the customer IS the title; repeating it as
    // the org would print "Acme — Acme".
    const withRole = summary({ customer: { en: 'Acme' }, roles: [{ name: { en: 'Architect' } }] })
    expect(withRole.parts.find((p) => p.key === 'org')?.value).toBe('Acme')

    const bare = summary({ customer: { en: 'Acme' } })
    expect(bare.parts.find((p) => p.key === 'title')!.value).toBe('Acme')
    expect(bare.parts.find((p) => p.key === 'org')).toBeUndefined()
  })

  it('does not repeat the DESCRIPTION line when it is already the title', () => {
    // With no customer the description becomes the title; printing it again as
    // the lead-in line would show the same sentence twice. Only meaningful with
    // the lead-in group on — that is what promotes the short description.
    const lead = (over: Record<string, unknown>) =>
      SECTION_CATALOG.projects.full!(over as never, { ...ctx, extras: new Set(['lead']) })!
    const same = lead({ customer: {}, description: { en: 'Payments platform' } })
    expect(same.title).toBe('Payments platform')
    expect(same.plainBody).toBe('')

    const different = lead({ customer: { en: 'Acme' }, description: { en: 'Payments platform' } })
    expect(different.title).toBe('Acme')
    expect(different.plainBody).toBe('Payments platform')
  })
})

describe('SECTION_CATALOG — a profile’s key points', () => {
  const ctx: CatalogCtx = { locale: 'en', hideDates: false, target: 'text', kq: { tagline: false, short: false, long: true } }
  const full = (it: Record<string, unknown>) => SECTION_CATALOG.key_qualifications.full!(it as never, ctx)!

  it('keeps a point with only a label or only a body, and drops an empty one', () => {
    // Either half alone is a usable bullet; requiring both would silently drop a
    // heading the user has not written the detail for yet.
    const v = full({
      summary: { en: 'Builds things.' },
      key_points: [
        { name: { en: 'Delivery' }, long_description: {} },
        { name: {}, long_description: { en: 'Ships on time.' } },
        { name: {}, long_description: {} },
        { name: { en: 'Hidden' }, long_description: { en: 'x' }, disabled: true },
      ],
    })
    expect(v.points.map((pt) => pt.label)).toEqual(['Delivery', ''])
    expect(v.points.map((pt) => pt.body)).toEqual(['', 'Ships on time.'])
  })

  it('reads a profile with no key_points array at all', () => {
    expect(full({ summary: { en: 'Builds things.' } }).points).toEqual([])
  })
})

describe('SECTION_CATALOG — co-authors and the date slot', () => {
  const ctx: CatalogCtx = { locale: 'en', hideDates: false, target: 'text' }

  it('drops a blank co-author name, and says nothing when there are none', () => {
    const line = (co: unknown) =>
      SECTION_CATALOG.publications.full!({ title: { en: 'T' }, co_authors: co } as never, ctx)!.meta.join(' | ')
    expect(line(['Ada', '', 'Grace'])).toContain('With Ada, Grace')
    expect(line(['', ''])).not.toContain('With')
    expect(line(undefined)).not.toContain('With')
  })

  it('emits no date part at all when the section has no date', () => {
    // `summaryOf` only pushes a part when the slot has a value; an empty date
    // part becomes a column in the tabulated grid that every row leaves blank.
    const s = SECTION_CATALOG.key_competencies.summary!({ title: { en: 'Cloud' } } as never, ctx)!
    expect(s.parts.some((p) => p.key === 'date')).toBe(false)
  })

  it('blanks BOTH date parts when dates are hidden', () => {
    const s = SECTION_CATALOG.work_experiences.summary!(
      { employer: { en: 'Acme' }, role_title: { en: 'Architect' }, start: { year: 2020, month: 1 }, end: { year: 2021, month: 1 } } as never,
      { ...ctx, hideDates: true })!
    expect(s.parts.some((p) => p.key === 'start' || p.key === 'end')).toBe(false)
  })
})

// ─── Mutation-audit additions ─────────────────────────────────────────────────

describe('SECTION_CATALOG — the blank shape every item view starts from', () => {
  it('gives an item that fills no list slot empty lists, not populated ones', () => {
    // Every adapter renders `meta`/`tags`/`points`/`extraLines`/`attributionMeta`
    // unconditionally; a default that arrived non-empty would print a stray
    // segment under an item that never asked for one, in all four exports.
    const v = SECTION_CATALOG.key_competencies.full!(
      item({ title: { en: 'Cloud' }, description: { en: 'Runs clouds.' } }) as never, html)!
    expect(v).toEqual({
      layout: 'default',
      title: 'Cloud',
      date: '',
      meta: [],
      body: 'Runs clouds.',
      plainBody: '',
      extraLines: [],
      tags: [],
      tagsLabel: '',
      points: [],
      attribution: '',
      attributionMeta: [],
      titleStyle: 'body',
      spacingBefore: 60,
    })
  })
})

describe('SECTION_CATALOG — the single-date slot', () => {
  it('emits a date PART, keyed date, for the sections that carry one date', () => {
    // The tabulated grid columns by part key: a date arriving without its key,
    // or not arriving at all, silently drops the year from every awards /
    // certification / publication row.
    const award = SECTION_CATALOG.honor_awards.summary!(
      item({ name: { en: 'Best paper' }, date: { year: 2021, month: 5 } }) as never, html)!
    expect(award.parts).toContainEqual({ key: 'date', value: expect.stringContaining('2021') })

    const cert = SECTION_CATALOG.certifications.summary!(
      item({ name: { en: 'AWS SA' }, issued: { year: 2019, month: 3 } }) as never, html)!
    expect(cert.parts).toContainEqual({ key: 'date', value: expect.stringContaining('2019') })

    const rec = SECTION_CATALOG.recommendations.summary!(
      item({ recommender_name: 'Jane Boss', date: { year: 2018, month: 1 } }) as never, html)!
    expect(rec.parts).toContainEqual({ key: 'date', value: expect.stringContaining('2018') })
  })
})

describe('SECTION_CATALOG — a project’s joined name lists', () => {
  const proj = (over: Record<string, unknown>, ctx: CatalogCtx = html) =>
    SECTION_CATALOG.projects.full!(item(over) as never, ctx)!

  it('joins only the role names that survive, with no trailing separator', () => {
    // The names are comma-JOINED into one meta segment, so a dropped role that
    // is merely blanked instead of removed still leaves its comma behind —
    // "Architect, " reads as a truncated second role in every export.
    const v = proj({ customer: { en: 'Acme' }, roles: [{ name: { en: 'Architect' } }, { name: {} }] })
    expect(v.meta).toEqual(['Architect'])
  })

  it('joins only the industry names that survive', () => {
    const v = proj({ customer: { en: 'Acme' }, industries: [{ name: { en: 'Finance' } }, { name: {} }] })
    expect(v.meta).toEqual(['Finance'])
  })

  it('anchors the summary on the roles alone when one of them is nameless', () => {
    const s = SECTION_CATALOG.projects.summary!(
      item({ customer: { en: 'Acme' }, roles: [{ name: { en: 'Architect' } }, { name: {} }] }) as never, html)!
    expect(s.parts.find((p) => p.key === 'title')!.value).toBe('Architect')
  })

  it('gives a project with no highlights no bullet points, even when the view asks for them', () => {
    // Highlights are an opt-in group now, and become bullets under the project.
    // Inventing one for a project that recorded none puts a line in the export
    // with nothing in it.
    const withGroup = { ...docx, extras: new Set(['highlights']) }
    expect(proj({ customer: { en: 'Acme' } }, withGroup).points).toEqual([])
    expect(proj({ customer: { en: 'Acme' }, highlights: [{ en: 'Cut build time in half.' }] }, withGroup).points)
      .toEqual([{ label: '', body: 'Cut build time in half.' }])
    // …and nothing at all when the view did not ask.
    expect(proj({ customer: { en: 'Acme' }, highlights: [{ en: 'Cut build time in half.' }] }, docx).points)
      .toEqual([])
  })
})

describe('SECTION_CATALOG — a profile’s tag line as meta', () => {
  const kq = { tagline: true, short: false, long: true }

  it('adds no meta segment for a profile that has no tag line', () => {
    // DOCX renders the tag line as a meta line; an empty one shows as a bare
    // separator above the profile prose.
    const v = SECTION_CATALOG.key_qualifications.full!(
      item({ tag_line: {}, summary: { en: 'Builds things.' } }) as never, { ...docx, kq })!
    expect(v.meta).toEqual([])
    expect(v.title).toBe('')
  })

  it('carries the tag line as the TITLE when the view asks for it', () => {
    // The target no longer decides which facts an item carries — the tag line is
    // the profile's heading on every export, and meta stays empty.
    for (const base of [docx, html]) {
      const v = SECTION_CATALOG.key_qualifications.full!(
        item({ tag_line: { en: 'Cloud architect' }, summary: { en: 'Builds things.' } }) as never,
        { ...base, kq })!
      expect(v.title).toBe('Cloud architect')
      expect(v.meta).toEqual([])
    }
  })

  it('keeps the HTML profile’s meta empty — the tag line is its heading there', () => {
    const shown = SECTION_CATALOG.key_qualifications.full!(
      item({ tag_line: { en: 'Cloud architect' }, summary: { en: 'Builds things.' } }) as never, { ...html, kq })!
    expect(shown.title).toBe('Cloud architect')
    expect(shown.meta).toEqual([])

    const hidden = SECTION_CATALOG.key_qualifications.full!(
      item({ tag_line: { en: 'Cloud architect' }, summary: { en: 'Builds things.' } }) as never,
      { ...html, kq: { tagline: false, short: false, long: true } })!
    expect(hidden.title).toBe('')
    expect(hidden.meta).toEqual([])
  })
})

describe('SECTION_CATALOG — a recommendation’s attribution', () => {
  const rec = (over: Record<string, unknown>) => item(over) as never

  it('joins title and company without a dangling comma when one is missing', () => {
    // The attribution is what names the person vouching; a trailing "CTO, "
    // reads as a company the reader is expected to supply.
    const onlyTitle = SECTION_CATALOG.recommendations.summary!(
      rec({ recommender_name: 'Jane Boss', recommender_title: { en: 'CTO' } }), html)!
    expect(onlyTitle.parts.find((p) => p.key === 'org')!.value).toBe('CTO')

    const onlyCompany = SECTION_CATALOG.recommendations.summary!(
      rec({ recommender_name: 'Jane Boss', recommender_company: 'BigCo' }), html)!
    expect(onlyCompany.parts.find((p) => p.key === 'org')!.value).toBe('BigCo')
  })

  it('builds the quote attribution from the parts that exist, and only those', () => {
    expect(SECTION_CATALOG.recommendations.full!(
      rec({ recommender_name: 'Jane Boss', recommender_title: { en: 'CTO' }, text: { en: 'Great.' } }), html)!.attribution)
      .toBe('Jane Boss, CTO')

    // A quote whose speaker is unnamed still attributes to the role — but must
    // not open with the comma that a missing name would otherwise leave.
    expect(SECTION_CATALOG.recommendations.full!(
      rec({ recommender_title: { en: 'CTO' }, recommender_company: 'BigCo', text: { en: 'Great.' } }), html)!.attribution)
      .toBe('CTO, BigCo')

    expect(SECTION_CATALOG.recommendations.full!(
      rec({ recommender_name: 'Jane Boss', text: { en: 'Great.' } }), html)!.attribution)
      .toBe('Jane Boss')
  })
})

describe('SECTION_CATALOG — employment prose and DOCX ordering', () => {
  it('prefers the long description and falls back to the short one', () => {
    // The two fields are alternatives, not a pair: showing neither (or the
    // wrong one) empties the body of every job in the CV.
    const both = SECTION_CATALOG.work_experiences.full!(
      item({ employer: { en: 'Acme' }, long_description: { en: 'Ran the platform.' }, description: { en: 'Ran it.' } }) as never, html)!
    expect(both.body).toBe('Ran the platform.')

    const shortOnly = SECTION_CATALOG.work_experiences.full!(
      item({ employer: { en: 'Acme' }, description: { en: 'Ran it.' } }) as never, html)!
    expect(shortOnly.body).toBe('Ran it.')

    const neither = SECTION_CATALOG.work_experiences.full!(item({ employer: { en: 'Acme' } }) as never, html)!
    expect(neither.body).toBe('')
  })

  it('does not ask one target to sort employment differently from another', () => {
    // A per-target sort flag is exactly the drift the extras rework removed: the
    // arranged order is the user's, and every export has to honour the same one.
    expect(SECTION_CATALOG.work_experiences.docxSortByStart).toBeUndefined()
  })
})

describe('SECTION_CATALOG — courses', () => {
  it('subtitles a course with its raw date range in the View editor list', () => {
    // The editor list is how the consultant tells two runs of the same course
    // apart; without the range the rows are indistinguishable.
    const sub = SECTION_CATALOG.courses.subtitle!(
      item({ start: { year: 2020, month: 1 }, end: { year: 2021, month: 6 } }) as never, 'en')
    expect(sub).toMatch(/2020/)
    expect(sub).toMatch(/2021/)
  })

  it('renders the course name as the title and its description as the body', () => {
    const v = SECTION_CATALOG.courses.full!(
      item({ name: { en: 'Kubernetes' }, description: { en: 'Two weeks of it.' }, program: { en: 'Cloud track' } }) as never, html)!
    expect(v.title).toBe('Kubernetes')
    expect(v.body).toBe('Two weeks of it.')
    expect(v.meta).toEqual(['Cloud track'])
  })
})

describe('SECTION_CATALOG — certification expiry and credential link', () => {
  const cert = { name: { en: 'AWS SA' }, issued: { year: 2019, month: 3 } }

  it('says nothing about expiry for a certification that never expires', () => {
    // The mention is parenthetical text glued onto the issue date; emitting it
    // unconditionally prints "(expires )" beside every permanent certificate.
    const withExpiry = { ...docx, extras: new Set(['expiry']) }
    const issued = SECTION_CATALOG.certifications.full!(item(cert) as never, html)!.date
    expect(issued).not.toBe('')
    expect(SECTION_CATALOG.certifications.full!(item(cert) as never, withExpiry)!.date).toBe(issued)
    expect(SECTION_CATALOG.certifications.full!(
      { ...cert, expires: { year: 2023, month: 3 } } as never, withExpiry)!.date).toMatch(/2023/)
    // Not asked for → the issue date alone, whatever the certificate carries.
    expect(SECTION_CATALOG.certifications.full!(
      { ...cert, expires: { year: 2023, month: 3 } } as never, docx)!.date).toBe(issued)
  })

  it('adds no credential line for a certification without a credential URL', () => {
    const withLinks = { ...docx, extras: new Set(['links']) }
    expect(SECTION_CATALOG.certifications.full!(item(cert) as never, withLinks)!.extraLines).toEqual([])
    expect(SECTION_CATALOG.certifications.full!(
      { ...cert, credential_url: 'https://example.test/c/1' } as never, withLinks)!.extraLines)
      .toEqual(['https://example.test/c/1'])
    // Links are opt-in: a view that did not ask gets none.
    expect(SECTION_CATALOG.certifications.full!(
      { ...cert, credential_url: 'https://example.test/c/1' } as never, docx)!.extraLines).toEqual([])
  })
})

describe('SECTION_CATALOG — the skills showcase group', () => {
  it('carries the category name as the title and its skills as unlabelled tags', () => {
    // The showcase IS the tag list; a group that renders its name without its
    // skills (or vice versa) is an empty heading in every export.
    const v = SECTION_CATALOG.technology_categories.full!(
      item({ name: { en: 'Cloud' }, skills: [{ name: { en: 'Go' } }, { name: { en: 'Rust' } }] }) as never, html)!
    expect(v.title).toBe('Cloud')
    expect(v.tags).toEqual(['Go', 'Rust'])
    // No "Skills: " prefix here — the group's own name already says what they are.
    expect(v.tagsLabel).toBe('')
  })
})

describe('SECTION_CATALOG — publications', () => {
  const pub = {
    title: { en: 'On merging' },
    abstract: { en: 'A study.' },
    publisher: { en: 'IEEE' },
    publication_type: 'research',
    date: { year: 2022, month: 4 },
    co_authors: ['Ada'],
  }

  it('subtitles a publication with its publisher and type in the editor list', () => {
    // The View editor lists publications by title alone otherwise, and a
    // consultant with an article and a talk of the same name cannot pick.
    expect(SECTION_CATALOG.publications.subtitle!(item(pub) as never, 'en'))
      .toBe('IEEE (Research Publication)')
  })

  it('gives the HTML publication its title, abstract, date and publisher line', () => {
    // HTML/PDF is the preview the consultant checks before sending; an item
    // that renders as an empty block there ships as one.
    const v = SECTION_CATALOG.publications.full!(item(pub) as never, html)!
    expect(v.title).toBe('On merging')
    expect(v.body).toBe('A study.')
    expect(v.date).toMatch(/2022/)
    expect(v.meta).toEqual(['IEEE (Research Publication)', 'With Ada'])
  })

  it('adds no link line for a publication without a URL', () => {
    const withLinks = { ...docx, extras: new Set(['links']) }
    expect(SECTION_CATALOG.publications.full!(item(pub) as never, withLinks)!.extraLines).toEqual([])
    expect(SECTION_CATALOG.publications.full!(
      { ...pub, url: 'https://example.test/p' } as never, withLinks)!.extraLines)
      .toEqual(['https://example.test/p'])
    expect(SECTION_CATALOG.publications.full!(
      { ...pub, url: 'https://example.test/p' } as never, docx)!.extraLines).toEqual([])
  })
})

describe('SECTION_CATALOG — a reference’s name and affiliation', () => {
  const ref = { name: 'Ola Hansen', include_in_exports: true }

  it('names the referee on both render paths', () => {
    // The name is the whole point of a reference entry; losing it leaves a
    // contact block the reader cannot attribute to anyone.
    expect(SECTION_CATALOG.references.full!(item(ref) as never, html)!.title).toBe('Ola Hansen')
    expect(SECTION_CATALOG.references.full!(item(ref) as never, docx)!.title).toBe('Ola Hansen')
  })

  it('joins title and company without a dangling comma when one is missing', () => {
    const onlyTitle = SECTION_CATALOG.references.summary!(item({ ...ref, title: 'CTO' }) as never, html)!
    expect(onlyTitle.parts.find((p) => p.key === 'org')!.value).toBe('CTO')

    const onlyCompany = SECTION_CATALOG.references.summary!(item({ ...ref, company: 'BigCo' }) as never, html)!
    expect(onlyCompany.parts.find((p) => p.key === 'org')!.value).toBe('BigCo')

    const both = SECTION_CATALOG.references.summary!(item({ ...ref, title: 'CTO', company: 'BigCo' }) as never, html)!
    expect(both.parts.find((p) => p.key === 'org')!.value).toBe('CTO, BigCo')
  })
})

/**
 * The emptiness rule every adapter asks instead of inventing its own.
 *
 * A descriptor may legitimately return a view with nothing in it — a profile in
 * summary mode whose short summary was never written. The paged and text
 * adapters then emit no paragraphs and the section disappears; the HTML adapter
 * used to build a div of whitespace, which is truthy, so the preview showed a
 * heading the exports did not have. The predicate that fixed that had no test
 * of its own: the mutation report could turn it into a constant either way.
 */
describe('isEmptyItemView', () => {
  const blank = (): ItemView => ({
    layout: 'default', title: '', date: '', meta: [], body: '', plainBody: '',
    extraLines: [], tags: [], tagsLabel: '', points: [], attribution: '',
    attributionMeta: [], titleStyle: 'body', spacingBefore: 0,
  })

  it('is empty when every slot is', () => {
    expect(isEmptyItemView(blank())).toBe(true)
  })

  it('is NOT empty when any single slot carries something', () => {
    // One case per slot: an OR where an AND belongs (or a dropped clause) makes
    // a whole class of item vanish from the preview and only the preview.
    const filled: Array<[string, Partial<ItemView>]> = [
      ['title', { title: 'Acme' }],
      ['date', { date: '2024' }],
      ['body', { body: '<p>Text</p>' }],
      ['plainBody', { plainBody: 'Short line' }],
      ['attribution', { attribution: 'Ada Lovelace' }],
      ['meta', { meta: ['Tech lead'] }],
      ['extraLines', { extraLines: ['https://example.test'] }],
      ['tags', { tags: ['Go'] }],
      ['points (label)', { points: [{ label: 'Team', body: '' }] }],
      ['points (body)', { points: [{ label: '', body: 'Six people' }] }],
      ['attributionMeta', { attributionMeta: ['(former manager)'] }],
    ]
    for (const [name, over] of filled) {
      expect(isEmptyItemView({ ...blank(), ...over }), name).toBe(false)
    }
  })

  it('ignores the slots that are styling rather than content', () => {
    // A blank item still carries a layout and a title size; counting those
    // would make every item non-empty and the guard a no-op.
    expect(isEmptyItemView({ ...blank(), layout: 'quote' })).toBe(true)
    expect(isEmptyItemView({ ...blank(), titleStyle: 'large', spacingBefore: 140 })).toBe(true)
    // The tags LABEL without any tag is a label for nothing.
    expect(isEmptyItemView({ ...blank(), tagsLabel: 'Skills: ' })).toBe(true)
  })

  it('reads a list of empty strings as nothing, not as something', () => {
    // `meta` and `extraLines` routinely hold blanks for absent facts; a
    // length check instead of a content check would keep every item.
    expect(isEmptyItemView({ ...blank(), meta: ['', ''], extraLines: [''] })).toBe(true)
    expect(isEmptyItemView({ ...blank(), attributionMeta: ['', ''] })).toBe(true)
    expect(isEmptyItemView({ ...blank(), points: [{ label: '', body: '' }] })).toBe(true)
  })
})
