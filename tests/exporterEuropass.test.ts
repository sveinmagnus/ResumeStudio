/**
 * @vitest-environment jsdom
 *
 * jsdom: the exporter builds a DOM tree and serializes it (and the round-trip
 * assertions parse it back with the importer's DOMParser).
 *
 * The centrepiece is the round-trip: export a store to Europass XML, read it
 * back with importFromEuropassXml, and assert the content survived. That checks
 * the two halves agree far better than asserting element names by hand — if
 * either side drifts, the pair stops matching.
 */
import { describe, it, expect } from 'vitest'
import { exportEuropassXml } from '../src/lib/exporterEuropass'
import { importFromEuropassXml, isEuropassXml } from '../src/lib/importerEuropass'
import { emptyStore, makeResume, makeWork, makeView } from './fixtures'
import { buildViewSections } from '../src/lib/viewFilter'
import type { Education, ResumeStore, SpokenLanguage } from '../src/types'

function makeEducation(over: Partial<Education> = {}): Education {
  return {
    id: 'e1', resume_id: 'r1',
    school: { en: 'NTNU' }, degree: { en: 'MSc Computer Science' },
    description: {}, grade: null, exchange: false,
    start: { year: 2004, month: 8 }, end: { year: 2009, month: 6 },
    skill_tags: [], sort_order: 0, starred: false, disabled: false,
    ...over,
  }
}

function makeLang(over: Partial<SpokenLanguage> = {}): SpokenLanguage {
  return {
    id: 'l1', resume_id: 'r1',
    name: { en: 'English' }, level: { en: 'Fluent' },
    sort_order: 0, disabled: false,
    ...over,
  }
}

/** A store with something in every section Europass models. */
function fullStore(): ResumeStore {
  return {
    ...emptyStore(),
    resume: makeResume({
      full_name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '+47 900 00 000',
      title: { en: 'Solutions Architect' },
      nationality: { en: 'Norwegian' },
      place_of_residence: { en: 'Oslo' },
    }),
    work_experiences: [
      makeWork({
        id: 'w1', employer: { en: 'Cartavio AS' }, role_title: { en: 'Principal Consultant' },
        long_description: { en: '<p>Led the <strong>platform</strong> rebuild.</p>' },
        start: { year: 2018, month: 6 }, end: null,
      }),
    ],
    educations: [makeEducation()],
    spoken_languages: [
      makeLang({ id: 'l0', name: { en: 'Norwegian' }, level: { en: 'Native' } }),
      makeLang({ id: 'l1', name: { en: 'English' }, cefr: { listening: 'C2', writing: 'C1' } }),
    ],
  }
}

const view = () => makeView({ sections: buildViewSections() })

describe('exportEuropassXml', () => {
  it('emits a SkillsPassport document the importer recognises', () => {
    const xml = exportEuropassXml(fullStore(), view(), 'en')
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(isEuropassXml(xml)).toBe(true)
  })

  it('round-trips identity, work, education and languages back through the importer', () => {
    const xml = exportEuropassXml(fullStore(), view(), 'en')
    const back = importFromEuropassXml(xml)

    expect(back.resume?.full_name).toBe('Ada Lovelace')
    expect(back.resume?.email).toBe('ada@example.com')
    expect(back.resume?.phone).toBe('+47 900 00 000')
    expect(back.resume?.title.en).toBe('Solutions Architect')
    expect(back.resume?.nationality.en).toBe('Norwegian')
    expect(back.resume?.place_of_residence.en).toBe('Oslo')

    expect(back.work_experiences).toHaveLength(1)
    expect(back.work_experiences[0].employer.en).toBe('Cartavio AS')
    expect(back.work_experiences[0].role_title.en).toBe('Principal Consultant')

    expect(back.educations).toHaveLength(1)
    expect(back.educations[0].school.en).toBe('NTNU')
    expect(back.educations[0].degree.en).toBe('MSc Computer Science')

    expect(back.spoken_languages.map((l) => l.name.en)).toEqual(['Norwegian', 'English'])
  })

  it('round-trips dates, including an ongoing role', () => {
    const back = importFromEuropassXml(exportEuropassXml(fullStore(), view(), 'en'))
    expect(back.work_experiences[0].start).toEqual({ year: 2018, month: 6 })
    // <Current>true</Current> — an open-ended period, not a missing To.
    expect(back.work_experiences[0].end).toBeNull()
    expect(back.educations[0].start).toEqual({ year: 2004, month: 8 })
    expect(back.educations[0].end).toEqual({ year: 2009, month: 6 })
  })

  it('writes months as the gMonth fragment Europass uses', () => {
    const xml = exportEuropassXml(fullStore(), view(), 'en')
    expect(xml).toContain('month="--06"')
    expect(xml).not.toContain('month="6"')
  })

  it('flattens rich text — the schema carries no markup', () => {
    const xml = exportEuropassXml(fullStore(), view(), 'en')
    expect(xml).toContain('Led the platform rebuild.')
    expect(xml).not.toContain('<strong>')
  })

  it('splits the stored full name into FirstName + Surname', () => {
    const xml = exportEuropassXml(fullStore(), view(), 'en')
    expect(xml).toContain('<FirstName>Ada</FirstName>')
    expect(xml).toContain('<Surname>Lovelace</Surname>')
  })

  it('carries a single-word name with no surname rather than dropping it', () => {
    const s = fullStore()
    s.resume!.full_name = 'Prince'
    const back = importFromEuropassXml(exportEuropassXml(s, view(), 'en'))
    expect(back.resume?.full_name).toBe('Prince')
  })

  it('puts a native speaker in MotherTongueList and the rest in ForeignLanguageList', () => {
    const xml = exportEuropassXml(fullStore(), view(), 'en')
    expect(/<MotherTongueList>[\s\S]*Norwegian[\s\S]*<\/MotherTongueList>/.test(xml)).toBe(true)
    expect(/<ForeignLanguageList>[\s\S]*English[\s\S]*<\/ForeignLanguageList>/.test(xml)).toBe(true)
  })

  it('emits the structured CEFR self-assessment when there is one', () => {
    const xml = exportEuropassXml(fullStore(), view(), 'en')
    expect(xml).toContain('<Listening>C2</Listening>')
    expect(xml).toContain('<Writing>C1</Writing>')
    // Unset categories are simply absent, not blank.
    expect(xml).not.toContain('<Reading>')
  })

  it('falls back to the free-text level when no CEFR map exists', () => {
    const s = fullStore()
    s.spoken_languages = [makeLang({ name: { en: 'German' }, level: { en: 'Conversational' } })]
    expect(exportEuropassXml(s, view(), 'en')).toContain('<Listening>Conversational</Listening>')
  })

  it('respects the view — an excluded item does not reach the XML', () => {
    const v = makeView({ sections: buildViewSections(), excluded_item_ids: ['w1'] })
    const back = importFromEuropassXml(exportEuropassXml(fullStore(), v, 'en'))
    expect(back.work_experiences).toHaveLength(0)
  })

  it('respects the view — a section switched off does not reach the XML', () => {
    const v = makeView({
      sections: buildViewSections().map((s) => s.key === 'educations' ? { ...s, detail: 'off' as const } : s),
    })
    const back = importFromEuropassXml(exportEuropassXml(fullStore(), v, 'en'))
    expect(back.educations).toHaveLength(0)
    expect(back.work_experiences).toHaveLength(1)
  })

  it('exports the locale it was asked for', () => {
    const s = fullStore()
    s.resume!.title = { en: 'Architect', no: 'Arkitekt' }
    const back = importFromEuropassXml(exportEuropassXml(s, view(), 'no'))
    expect(back.resume?.title.no).toBe('Arkitekt')
  })

  it('survives an empty store without emitting a malformed document', () => {
    const xml = exportEuropassXml(emptyStore(), view(), 'en')
    expect(isEuropassXml(xml)).toBe(true)
    const back = importFromEuropassXml(xml)
    expect(back.work_experiences).toEqual([])
    expect(back.spoken_languages).toEqual([])
  })

  // ─── Escaping (the reason this builds a DOM instead of a string) ──────────

  it('escapes XML metacharacters in content rather than corrupting the document', () => {
    const s = fullStore()
    s.resume!.full_name = 'Ada <Lovelace> & Co'
    s.work_experiences[0].employer = { en: 'Ben & Jerry <Ltd>' }
    const xml = exportEuropassXml(s, view(), 'en')

    // Raw metacharacters never survive into markup…
    expect(xml).not.toContain('<Lovelace>')
    expect(xml).toContain('&amp;')
    // …and the document still parses, with the text intact.
    const back = importFromEuropassXml(xml)
    expect(back.work_experiences[0].employer.en).toBe('Ben & Jerry <Ltd>')
  })

  it('cannot be made to inject elements from field content', () => {
    // The attack a hand-rolled template would allow: close the element and open
    // your own. The serializer escapes it into text, so it round-trips verbatim.
    const s = fullStore()
    s.work_experiences[0].role_title = { en: '</Position></WorkExperience><Injected>x' }
    const xml = exportEuropassXml(s, view(), 'en')
    expect(xml).not.toContain('<Injected>')

    const back = importFromEuropassXml(xml)
    expect(back.work_experiences).toHaveLength(1)
    expect(back.work_experiences[0].role_title.en).toBe('</Position></WorkExperience><Injected>x')
  })

  it('escapes attribute-bearing content too', () => {
    const s = fullStore()
    s.resume!.website_url = 'https://x.example/?a=1&b="2"'
    const xml = exportEuropassXml(s, view(), 'en')
    expect(xml).toContain('&amp;')
    expect(() => importFromEuropassXml(xml)).not.toThrow()
  })
})
