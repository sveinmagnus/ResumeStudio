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

  it('full detail still shows the type', () => {
    const v = SECTION_CATALOG.positions.full!(pos, html)!
    expect(v.meta).toContain('Board member')
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
    expect(summaryTitleMeta(s).title).toBe('Large Nordic Bank')
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

  it('docx renders the tag line instead of the label heading (historic drift)', () => {
    const k = makeKQ({ label: { en: 'Senior Dev' }, tag_line: { en: 'Tagline' } }) as unknown as Record<string, unknown>
    expect(SECTION_CATALOG.key_qualifications.full!(k, html)!.title).toBe('Senior Dev')
    const d = SECTION_CATALOG.key_qualifications.full!(k, docx)!
    expect(d.title).toBe('')
    expect(d.meta).toEqual(['Tagline'])
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
  it('spoken_languages renders inline and ignores summary mode', () => {
    const l = makeSpokenLanguage({ name: { en: 'Norwegian' }, level: { en: 'Native' } }) as unknown as Record<string, unknown>
    expect(SECTION_CATALOG.spoken_languages.alwaysFull).toBe(true)
    const v = SECTION_CATALOG.spoken_languages.full!(l, html)!
    expect(v.layout).toBe('inline')
    expect(v.meta).toEqual(['Native'])
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

  it('professional summary renders only the enabled parts (label/tagline/short/long)', () => {
    const kq = {
      label: { en: 'Leadership' }, tag_line: { en: 'Builds teams' },
      summary: { en: 'The long version.' }, summary_short: { en: 'The short version.' },
      key_points: [],
    } as unknown as Record<string, unknown>

    // Default: label + tagline + long; short hidden.
    const def = SECTION_CATALOG.key_qualifications.full!(kq, html)!
    expect(def.title).toBe('Leadership')
    expect(def.meta).toContain('Builds teams')
    expect(def.body).toContain('The long version.')
    expect(def.body).not.toContain('The short version.')

    // Short only; heading + tagline off.
    const shortOnly = SECTION_CATALOG.key_qualifications.full!(kq, {
      ...html, kq: { label: false, tagline: false, short: true, long: false },
    })!
    expect(shortOnly.title).toBe('')
    expect(shortOnly.meta).not.toContain('Builds teams')
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
