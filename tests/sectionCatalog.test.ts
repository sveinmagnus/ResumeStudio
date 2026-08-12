import { describe, it, expect } from 'vitest'
import { SECTION_CATALOG, summaryTitleMeta, type CatalogCtx } from '../src/lib/sectionCatalog'
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

describe('projects — per-target drift stays explicit', () => {
  const p = makeProject({
    customer: { en: 'Acme' },
    industries: [{ id: 'pi1', industry_id: 'ind1', name: { en: 'Finance' }, sort_order: 0 }],
    description: { en: 'Short desc' },
    long_description: { en: 'Long desc' },
    team_size: 5,
    highlights: [{ en: 'Cut costs 20%' }],
  }) as unknown as Record<string, unknown>

  it('html: date folded into meta, no team size or highlights', () => {
    const v = SECTION_CATALOG.projects.full!(p, html)!
    expect(v.meta).toContain('Finance')
    expect(v.meta.join(' ')).not.toContain('Team of')
    expect(v.points).toHaveLength(0)
    expect(v.body).toBe('Long desc')
  })

  it('docx: separate date slot, team size in meta, highlights as points', () => {
    const v = SECTION_CATALOG.projects.full!(p, docx)!
    expect(v.meta).toContain('Team of 5')
    expect(v.points.map((pt) => pt.body)).toContain('Cut costs 20%')
    expect(v.plainBody).toBe('Short desc')
    expect(v.titleStyle).toBe('large')
  })

  it('docx sorts by start date, html keeps store order (flag)', () => {
    expect(SECTION_CATALOG.projects.docxSortByStart).toBe(true)
    expect(SECTION_CATALOG.educations.docxSortByStart).toBeUndefined()
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

  it('uses the tag line as the heading, shown only when opted in (label is gone)', () => {
    const k = makeKQ({ label: { en: 'Senior Dev' }, tag_line: { en: 'Tagline' } }) as unknown as Record<string, unknown>
    // Default: tag line hidden (it doubles as the resume title) — no heading/meta.
    expect(SECTION_CATALOG.key_qualifications.full!(k, html)!.title).toBe('')
    expect(SECTION_CATALOG.key_qualifications.full!(k, docx)!.meta).toEqual([])
    // Opt in via ctx.kq.tagline → html title / docx meta carry the tag line.
    const shown = { tagline: true, short: false, long: true }
    expect(SECTION_CATALOG.key_qualifications.full!(k, { ...html, kq: shown })!.title).toBe('Tagline')
    expect(SECTION_CATALOG.key_qualifications.full!(k, { ...docx, kq: shown })!.meta).toEqual(['Tagline'])
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

  it('docx adds contact lines, html does not (historic drift)', () => {
    const ref = makeReference({
      include_in_exports: true, name: 'Kari', email: 'kari@x.no', phone: '999',
    }) as unknown as Record<string, unknown>
    expect(SECTION_CATALOG.references.full!(ref, html)!.extraLines).toEqual([])
    expect(SECTION_CATALOG.references.full!(ref, docx)!.extraLines).toContain('kari@x.no')
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

    it('appends the expiry to the date — but only away from HTML', () => {
      expect(SECTION_CATALOG.certifications.full!(cert, docx)!.date).toMatch(/expires/)
      expect(SECTION_CATALOG.certifications.full!(cert, html)!.date).not.toMatch(/expires/)
    })

    it('emits the credential URL as an extra line away from HTML', () => {
      expect(SECTION_CATALOG.certifications.full!(cert, docx)!.extraLines)
        .toEqual(['https://verify.example/abc'])
      expect(SECTION_CATALOG.certifications.full!(cert, html)!.extraLines ?? []).toEqual([])
    })

    it('drops the expiry along with the issue date when the view hides dates', () => {
      // hideDates blanks the issue date; the expiry is appended to it and must
      // go with it, or an anonymized export still prints a year.
      expect(SECTION_CATALOG.certifications.full!(cert, noDates)!.date).toBe('')
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

    it('emits the talk URL as an extra line away from HTML', () => {
      expect(SECTION_CATALOG.presentations.full!(talk, text)!.extraLines).toEqual(['https://talks.example/pg'])
      expect(SECTION_CATALOG.presentations.full!(talk, html)!.extraLines ?? []).toEqual([])
    })

    it('omits the extra line when there is no URL', () => {
      const v = SECTION_CATALOG.presentations.full!(item({ ...talk, url: '' }), docx)!
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

    it('emits the URL as an extra line away from HTML', () => {
      expect(SECTION_CATALOG.publications.full!(paper, docx)!.extraLines).toEqual(['https://doi.example/1'])
      expect(SECTION_CATALOG.publications.full!(paper, html)!.extraLines ?? []).toEqual([])
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

  it('emits an education grade as an extra line, away from HTML', () => {
    const withGrade = item({ school: { en: 'NTNU' }, degree: { en: 'MSc' }, grade: 'A' })
    expect(SECTION_CATALOG.educations.full!(withGrade, docx)!.extraLines)
      .toEqual([expect.stringContaining('A')])
    expect(SECTION_CATALOG.educations.full!(withGrade, html)!.extraLines ?? []).toEqual([])
  })

  it('omits the grade line when there is no grade', () => {
    expect(SECTION_CATALOG.educations.full!(item({ school: { en: 'NTNU' } }), docx)!.extraLines ?? [])
      .toEqual([])
  })

  it('shows an employment’s type as meta, humanised', () => {
    // Stored as a snake_case enum; printed with a space.
    const v = SECTION_CATALOG.work_experiences.full!(
      item({ employer: { en: 'Acme' }, employment_type: 'full_time' }), docx)!
    expect(v.meta).toContain('full time')
  })

  it('omits the employment-type meta when unset', () => {
    expect(SECTION_CATALOG.work_experiences.full!(item({ employer: { en: 'Acme' } }), docx)!.meta)
      .toEqual([])
  })

  it('combines employer and role into the employment title, with a fallback', () => {
    expect(SECTION_CATALOG.work_experiences.full!(
      item({ employer: { en: 'Acme' }, role_title: { en: 'Architect' } }), docx)!.title)
      .toBe('Acme — Architect')
    expect(SECTION_CATALOG.work_experiences.full!(item({ employer: {}, role_title: {} }), docx)!.title)
      .toBe('Employer')
  })

  it('shows a project’s allocation when set', () => {
    const v = SECTION_CATALOG.projects.full!(
      item({ customer: { en: 'Acme' }, percent_allocated: 60 }), docx)!
    expect(v.meta.join(' ')).toContain('60')
    const none = SECTION_CATALOG.projects.full!(item({ customer: { en: 'Acme' } }), docx)!
    expect(none.meta.join(' ')).not.toContain('60')
  })

  it('carries a project’s highlights as points, dropping the empty ones', () => {
    const v = SECTION_CATALOG.projects.full!(item({
      customer: { en: 'Acme' },
      highlights: [{ en: 'Cut build time' }, {}, { en: 'Shipped it' }],
    }), docx)!
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
      const v = SECTION_CATALOG.references.full!(ref(), text)!
      expect(v.meta).toEqual(['CTO', 'BigCo'])
      expect(v.extraLines).toEqual(['Worked together', 'jane@x.io', '+47 900'])
    })

    it('withholds the contact details from the HTML preview', () => {
      const v = SECTION_CATALOG.references.full!(ref(), html)!
      expect(v.meta).toEqual(['CTO', 'BigCo'])
      expect(v.extraLines ?? []).toEqual([])
    })

    it('drops an absent contact route rather than leaving a blank line', () => {
      const v = SECTION_CATALOG.references.full!(ref({ email: '', phone: '' }), text)!
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
 * Where the two render targets genuinely differ.
 *
 * Four descriptors carry extra lines or a different heading for the paged
 * targets (DOCX/PDF) than for the HTML preview, because a page can afford a URL
 * or a grade on its own line and a scrolling preview would just look noisy.
 * Three others used to branch on the target and produce the same object either
 * way; those branches are gone, and these tests are what says the remaining
 * differences are deliberate.
 */
describe('SECTION_CATALOG — html versus the paged targets', () => {
  const ctxFor = (target: 'html' | 'docx'): CatalogCtx =>
    ({ locale: 'en', hideDates: false, dateFormat: 'month-year', target })

  const fullFor = (key: string, item: Record<string, unknown>, target: 'html' | 'docx') =>
    SECTION_CATALOG[key].full!(item as never, ctxFor(target))!

  it('gives an education its grade only on a page', () => {
    const item = {
      school: { en: 'NTNU' }, degree: { en: 'MSc' }, description: { en: 'Studied' },
      grade: 'A', start: { year: 2010, month: 8 }, end: { year: 2013, month: 6 },
    }
    expect(fullFor('educations', item, 'docx').extraLines).toEqual(['Grade: A'])
    expect(fullFor('educations', item, 'html').extraLines ?? []).toEqual([])
  })

  it('gives a certification its credential link only on a page, and its expiry in the date', () => {
    const item = {
      name: { en: 'AWS SA' }, organiser: { en: 'AWS' }, description: {},
      issued: { year: 2024, month: 1 }, expires: { year: 2027, month: 1 },
      credential_url: 'https://verify/x',
    }
    const paged = fullFor('certifications', item, 'docx')
    const html = fullFor('certifications', item, 'html')
    expect(paged.extraLines).toEqual(['https://verify/x'])
    expect(html.extraLines ?? []).toEqual([])
    // The HTML preview shows the issue date alone; a page shows the expiry too.
    expect(paged.date.length).toBeGreaterThan(html.date.length)
  })

  it('gives a presentation and a publication their URL only on a page', () => {
    const talk = { title: { en: 'A talk' }, event: { en: 'Testfest' }, description: {}, url: 'https://talk' }
    expect(fullFor('presentations', talk, 'docx').extraLines).toEqual(['https://talk'])
    expect(fullFor('presentations', talk, 'html').extraLines ?? []).toEqual([])

    const paper = { title: { en: 'A paper' }, publisher: { en: 'ACM' }, abstract: {}, url: 'https://paper' }
    expect(fullFor('publications', paper, 'docx').extraLines).toEqual(['https://paper'])
    expect(fullFor('publications', paper, 'html').extraLines ?? []).toEqual([])
  })

  it('gives a reference its contact lines only on a page', () => {
    const item = {
      name: 'Ada', title: 'CTO', company: 'Acme', include_in_exports: true,
      relationship: { en: 'Former manager' }, email: 'ada@acme.no', phone: '+47 1',
    }
    expect(fullFor('references', item, 'docx').extraLines)
      .toEqual(['Former manager', 'ada@acme.no', '+47 1'])
    expect(fullFor('references', item, 'html').extraLines ?? []).toEqual([])
  })

  it('joins employer and role into one heading on a page, and keeps them apart in HTML', () => {
    const item = {
      employer: { en: 'Acme' }, role_title: { en: 'Architect' }, long_description: { en: 'Did work' },
      employment_type: 'permanent', start: { year: 2020, month: 1 }, end: null,
    }
    const paged = fullFor('work_experiences', item, 'docx')
    const html = fullFor('work_experiences', item, 'html')
    expect(paged.title).toBe('Acme — Architect')
    expect(paged.titleStyle).toBe('large')
    expect(paged.meta).toEqual(['permanent'])
    expect(html.title).toBe('Acme')
    expect(html.meta).toEqual(['Architect'])
  })

  it('renders the same object for a course, a position and an award whatever the target', () => {
    // These three carry no page-only extras; the descriptors say so once rather
    // than branching to the same answer twice.
    const cases: Array<[string, Record<string, unknown>]> = [
      ['courses', { name: { en: 'Kubernetes' }, program: { en: 'CNCF' }, description: { en: 'Learned' }, end: { year: 2024, month: 2 } }],
      ['positions', { name: { en: 'Board member' }, organisation: { en: 'Cartavio' }, description: { en: 'Served' }, start: { year: 2020, month: 1 }, end: null }],
      ['honor_awards', { name: { en: 'Best paper' }, issuer: { en: 'ACM' }, description: { en: 'Won' }, date: { year: 2022, month: 5 } }],
    ]
    for (const [key, item] of cases) {
      expect(fullFor(key, item, 'html'), key).toEqual(fullFor(key, item, 'docx'))
    }
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
