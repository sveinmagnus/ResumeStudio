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
import { emptyStore, makeResume, makeWork, makeView, makeSpokenLanguage,
} from './fixtures'
import { buildViewSections } from '../src/lib/viewFilter'
import type { Education, ResumeStore, SpokenLanguage } from '../src/types'

function makeEducation(over: Partial<Education> = {}): Education {
  return {
    id: 'e1', resume_id: 'r1',
    school: { en: 'NTNU' }, degree: { en: 'MSc Computer Science' },
    description: {}, grade: null, exchange: false,
    start: { year: 2004, month: 8 }, end: { year: 2009, month: 6 },
    sort_order: 0, starred: false, disabled: false,
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

  it('writes no Period at all for an undated item', () => {
    // An empty <Period/> is not valid against the schema and reads to an
    // importer as "a period with no dates", which is not what "undated" means.
    const store = fullStore()
    store.work_experiences = [makeWork({
      id: 'w-undated', employer: { en: 'Undated Co' }, start: null, end: null,
    })]
    const xml = exportEuropassXml(store, view(), 'en')
    expect(xml).toContain('Undated Co')
    expect(xml).not.toContain('<Period/>')
    expect(xml).not.toContain('<Period></Period>')
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
/**
 * The Europass exporter's per-entry fallbacks — it round-trips the importer,
 * so a field that stops being written is a field an export/import cycle loses.
 */
describe('exportEuropassXml — per-entry fallbacks', () => {
  const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml')
  const store = (w: Partial<Parameters<typeof makeWork>[0]>): ResumeStore => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Kari Nordmann' })
    s.work_experiences = [makeWork({ id: 'w1', employer: { en: 'Acme' }, ...w })]
    return s
  }
  const xmlFor = (w: Partial<Parameters<typeof makeWork>[0]>) =>
    parse(exportEuropassXml(store(w), makeView({ sections: buildViewSections() }), 'en'))
  const textOf = (doc: Document, tag: string) =>
    Array.from(doc.getElementsByTagName(tag)).map((e) => e.textContent)

  it('prefers the long description and falls back to the short one', () => {
    // Europass has ONE free-text field per entry; without the fallback an entry
    // with only a short description exports with no activities at all.
    expect(textOf(xmlFor({ long_description: { en: 'Long text' }, description: { en: 'Short text' } }), 'Activities'))
      .toEqual(['Long text'])
    expect(textOf(xmlFor({ long_description: {}, description: { en: 'Short text' } }), 'Activities'))
      .toEqual(['Short text'])
  })

  it('writes no Activities element when neither is filled', () => {
    expect(textOf(xmlFor({ long_description: {}, description: {} }), 'Activities')).toEqual([])
  })

  it('marks an ongoing role with Current, not with an absent To', () => {
    // The importer keys `end: null` off exactly this, so dropping it makes a
    // current role read as undated on the way back in.
    const doc = xmlFor({ start: { year: 2020, month: 3 }, end: null })
    expect(textOf(doc, 'Current')).toEqual(['true'])
    expect(doc.getElementsByTagName('To')).toHaveLength(0)
    expect(doc.getElementsByTagName('From')).toHaveLength(1)
  })

  it('does NOT mark a closed role as current', () => {
    const doc = xmlFor({ start: { year: 2020, month: 3 }, end: { year: 2021, month: 6 } })
    expect(textOf(doc, 'Current')).toEqual([])
    expect(doc.getElementsByTagName('To')).toHaveLength(1)
  })

  it('does not call an undated-but-open role current either', () => {
    // No start and no end is missing data, not an ongoing job.
    const doc = xmlFor({ start: null, end: null })
    expect(doc.getElementsByTagName('Period')).toHaveLength(0)
  })

  it('emits the employer website only when there is one', () => {
    expect(xmlFor({ company_url: 'https://acme.test' }).getElementsByTagName('Website')).toHaveLength(1)
    expect(xmlFor({ company_url: null }).getElementsByTagName('Website')).toHaveLength(0)
  })
})

/**
 * The per-element guards.
 *
 * Europass is a schema: an element that appears with nothing in it, or is absent
 * when the schema wants it, is a document a reader rejects rather than a document
 * that looks slightly wrong. Every one of these decides whether an element is
 * written at all, and the round-trip tests above cannot see them because they
 * only assert what came BACK.
 */
describe('exportEuropassXml — element presence', () => {
  const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml')
  const build = (build: (s: ResumeStore) => void, locale = 'en') => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Kari Nordmann' })
    build(s)
    return parse(exportEuropassXml(s, makeView({ sections: buildViewSections() }), locale))
  }
  const count = (doc: Document, tag: string) => doc.getElementsByTagName(tag).length
  const text = (doc: Document, tag: string) =>
    Array.from(doc.getElementsByTagName(tag)).map((e) => e.textContent)

  describe('periods', () => {
    it('writes only the ends it has', () => {
      const startOnly = build((s) => {
        s.work_experiences = [makeWork({ id: 'w1', employer: { en: 'Acme' }, start: { year: 2020, month: 1 }, end: null })]
      })
      expect(count(startOnly, 'From')).toBe(1)
      expect(count(startOnly, 'To')).toBe(0)
    })

    it('omits the month attribute when only a year is known', () => {
      const doc = build((s) => {
        s.work_experiences = [makeWork({ id: 'w1', employer: { en: 'Acme' }, start: { year: 2020, month: null }, end: null })]
      })
      const from = doc.getElementsByTagName('From')[0]
      expect(from.getAttribute('year')).toBe('2020')
      expect(from.hasAttribute('month')).toBe(false)
    })

    it('never marks an education as ongoing', () => {
      // Europass has no Current for education in this exporter; an open range
      // simply has no To.
      const doc = build((s) => {
        s.educations = [makeEducation({ id: 'e1', school: { en: 'NTNU' }, start: { year: 2014, month: 8 }, end: null })]
      })
      expect(count(doc, 'Current')).toBe(0)
      expect(count(doc, 'To')).toBe(0)
    })
  })

  describe('work experience', () => {
    it('omits the Position element when there is no role title', () => {
      const doc = build((s) => {
        s.work_experiences = [makeWork({ id: 'w1', employer: { en: 'Acme' }, role_title: {} })]
      })
      expect(count(doc, 'Position')).toBe(0)
    })

    it('flattens the activities text out of its markup', () => {
      const doc = build((s) => {
        s.work_experiences = [makeWork({
          id: 'w1', employer: { en: 'Acme' },
          long_description: { en: '<p>Ran <b>the</b> migration.</p>' },
        })]
      })
      expect(text(doc, 'Activities')).toEqual(['Ran the migration.'])
    })

    it('writes the Employer block for a URL alone, and omits Name then', () => {
      const doc = build((s) => {
        s.work_experiences = [makeWork({ id: 'w1', employer: {}, company_url: 'https://acme.test' })]
      })
      expect(count(doc, 'Website')).toBe(1)
      expect(count(doc, 'Name')).toBe(0)
    })

    it('omits the Employer block entirely with neither a name nor a URL', () => {
      const doc = build((s) => {
        s.work_experiences = [makeWork({ id: 'w1', employer: {}, role_title: { en: 'Architect' }, company_url: null })]
      })
      expect(count(doc, 'Employer')).toBe(0)
    })
  })

  describe('education', () => {
    it('omits Title and Organisation when the fields are empty', () => {
      const doc = build((s) => {
        s.educations = [makeEducation({ id: 'e1', school: {}, degree: {}, description: { en: 'Studied.' } })]
      })
      expect(count(doc, 'Title')).toBe(0)
      expect(count(doc, 'Organisation')).toBe(0)
    })

    it('flattens the education description too', () => {
      const doc = build((s) => {
        s.educations = [makeEducation({ id: 'e1', school: { en: 'NTNU' }, description: { en: '<p>Studied <i>hard</i>.</p>' } })]
      })
      expect(text(doc, 'Activities')).toEqual(['Studied hard.'])
    })
  })

  describe('languages', () => {
    it('writes a free-text level as a Listening proficiency, and omits it when blank', () => {
      const withLevel = build((s) => {
        s.spoken_languages = [makeSpokenLanguage({ id: 'l1', name: { en: 'German' }, level: { en: 'B2' } })]
      })
      expect(text(withLevel, 'Listening')).toEqual(['B2'])

      const without = build((s) => {
        s.spoken_languages = [makeSpokenLanguage({ id: 'l1', name: { en: 'German' }, level: {} })]
      })
      expect(count(without, 'ProficiencyLevel')).toBe(0)
    })

    it('recognises a native level case- and space-insensitively', () => {
      for (const level of ['Native', ' native ', 'NATIVE']) {
        const doc = build((s) => {
          s.spoken_languages = [makeSpokenLanguage({ id: 'l1', name: { en: 'Norwegian' }, level: { en: level } })]
        })
        expect(count(doc, 'MotherTongue'), level).toBe(1)
      }
    })
  })

  describe('personal information', () => {
    it('splits the full name into FirstName and Surname on the LAST space', () => {
      const doc = build((s) => { s.resume = makeResume({ full_name: 'Kari Anne Nordmann' }) })
      expect(text(doc, 'FirstName')).toEqual(['Kari Anne'])
      expect(text(doc, 'Surname')).toEqual(['Nordmann'])
    })

    it('carries a single-word name as the first name, with no surname', () => {
      const doc = build((s) => { s.resume = makeResume({ full_name: 'Kari' }) })
      // No Surname element at all — a single-word name has no surname to write.
      expect(text(doc, 'FirstName')).toEqual(['Kari'])
      expect(text(doc, 'Surname')).toEqual([])
    })

    it('omits the name block for a blank or whitespace-only name', () => {
      const doc = build((s) => { s.resume = makeResume({ full_name: '   ' }) })
      expect(count(doc, 'FirstName')).toBe(0)
    })

    it('writes each contact route only when present', () => {
      const both = build((s) => {
        s.resume = makeResume({ full_name: 'Kari', email: 'k@x.io', phone: '+47 900' })
      })
      expect(count(both, 'Email')).toBe(1)
      expect(count(both, 'Telephone')).toBe(1)

      const neither = build((s) => {
        s.resume = makeResume({ full_name: 'Kari', email: '', phone: null })
      })
      expect(count(neither, 'Email')).toBe(0)
      expect(count(neither, 'Telephone')).toBe(0)
    })
  })
})

/**
 * Europass is a SCHEMA, not a layout: every block is optional and a consumer
 * reads the ones that are there. So an element emitted around an empty value is
 * not cosmetic — `<Activities></Activities>` claims the entry described itself
 * and said nothing, and the importer round-trips that back as a blank field.
 */
describe('exportEuropassXml — an empty value means an ABSENT element', () => {
  const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml')
  const build = (fill: (s: ResumeStore) => void, locale = 'en') => {
    const s = emptyStore()
    s.resume = makeResume({ full_name: 'Kari Nordmann' })
    fill(s)
    return parse(exportEuropassXml(s, makeView({ sections: buildViewSections() }), locale))
  }
  const count = (doc: Document, tag: string) => doc.getElementsByTagName(tag).length
  const text = (doc: Document, tag: string) =>
    Array.from(doc.getElementsByTagName(tag)).map((e) => e.textContent)

  it('writes a period that has only an END date', () => {
    // An education finished in a year whose start nobody recorded is ordinary,
    // and dropping the one date it has loses the entry\u2019s whole timeline.
    const doc = build((s) => {
      s.educations = [makeEducation({ id: 'e1', school: { en: 'NTNU' }, start: null, end: { year: 2016, month: 6 } })]
    })
    expect(count(doc, 'Period')).toBe(1)
    expect(count(doc, 'From')).toBe(0)
    expect(doc.getElementsByTagName('To')[0].getAttribute('year')).toBe('2016')
  })

  it('omits the Period entirely for an entry with no dates at all', () => {
    const doc = build((s) => {
      s.educations = [makeEducation({ id: 'e1', school: { en: 'NTNU' }, start: null, end: null })]
      s.work_experiences = [makeWork({ id: 'w1', employer: { en: 'Acme' }, start: null, end: null })]
    })
    expect(count(doc, 'Period')).toBe(0)
  })

  it('trims the activities text, from either description field', () => {
    const long = build((s) => {
      s.work_experiences = [makeWork({ id: 'w1', employer: { en: 'Acme' }, long_description: { en: '  Ran it.  ' } })]
    })
    expect(text(long, 'Activities')).toEqual(['Ran it.'])

    const short = build((s) => {
      s.work_experiences = [makeWork({
        id: 'w1', employer: { en: 'Acme' }, long_description: {}, description: { en: '  Ran it.  ' },
      })]
    })
    expect(text(short, 'Activities')).toEqual(['Ran it.'])

    const educated = build((s) => {
      s.educations = [makeEducation({ id: 'e1', school: { en: 'NTNU' }, description: { en: '  Studied.  ' } })]
    })
    expect(text(educated, 'Activities')).toEqual(['Studied.'])
  })

  it('omits Activities for an entry that describes itself nowhere', () => {
    const doc = build((s) => {
      s.educations = [makeEducation({ id: 'e1', school: { en: 'NTNU' }, description: {} })]
      s.work_experiences = [makeWork({ id: 'w1', employer: { en: 'Acme' }, long_description: {}, description: {} })]
    })
    expect(count(doc, 'Activities')).toBe(0)
  })

  it('puts the company URL in the Contact element the schema expects', () => {
    const doc = build((s) => {
      s.work_experiences = [makeWork({ id: 'w1', employer: { en: 'Acme' }, company_url: 'https://acme.test' })]
    })
    const website = doc.getElementsByTagName('Website')[0]
    expect(website.getElementsByTagName('Contact')[0]?.textContent).toBe('https://acme.test')
  })

  it('reads the Norwegian and long-form spellings of a mother tongue', () => {
    for (const level of ['morsm\u00e5l', 'Mother tongue']) {
      const doc = build((s) => {
        s.spoken_languages = [makeLang({ id: 'l1', name: { en: 'Norwegian' }, level: { en: level } })]
      })
      expect(count(doc, 'MotherTongue'), level).toBe(1)
      expect(count(doc, 'ForeignLanguage'), level).toBe(0)
    }
  })

  it('trims a free-text proficiency level', () => {
    const doc = build((s) => {
      s.spoken_languages = [makeLang({ id: 'l1', name: { en: 'German' }, level: { en: '  B2  ' } })]
    })
    expect(text(doc, 'Listening')).toEqual(['B2'])
  })

  it('leaves out a disabled or nameless language', () => {
    const doc = build((s) => {
      s.spoken_languages = [
        makeLang({ id: 'l1', name: { en: 'German' }, level: { en: 'B2' }, disabled: true }),
        makeLang({ id: 'l2', name: { en: '   ' }, level: { en: 'C1' } }),
      ]
    })
    expect(count(doc, 'Skills')).toBe(0)
  })

  it('writes only the language list it has entries for', () => {
    const motherOnly = build((s) => {
      s.spoken_languages = [makeLang({ id: 'l1', name: { en: 'Norwegian' }, level: { en: 'Native' } })]
    })
    expect(count(motherOnly, 'MotherTongueList')).toBe(1)
    expect(count(motherOnly, 'ForeignLanguageList')).toBe(0)

    const foreignOnly = build((s) => {
      s.spoken_languages = [makeLang({ id: 'l1', name: { en: 'German' }, level: { en: 'B2' } })]
    })
    expect(count(foreignOnly, 'MotherTongueList')).toBe(0)
    expect(count(foreignOnly, 'ForeignLanguageList')).toBe(1)
  })

  it('omits the list elements for a section with nothing in it', () => {
    const doc = build(() => {})
    expect(count(doc, 'WorkExperienceList')).toBe(0)
    expect(count(doc, 'EducationList')).toBe(0)
    expect(count(doc, 'Skills')).toBe(0)
  })

  it('splits a name on a RUN of whitespace, not each space in it', () => {
    const doc = build((s) => { s.resume = makeResume({ full_name: 'Kari  Nordmann' }) })
    expect(text(doc, 'FirstName')).toEqual(['Kari'])
    expect(text(doc, 'Surname')).toEqual(['Nordmann'])
  })

  it('omits each identification block whose field is empty', () => {
    const doc = build((s) => {
      s.resume = makeResume({
        full_name: 'Kari', email: '', phone: null, website_url: '',
        place_of_residence: {}, nationality: {}, title: {},
      })
    })
    expect(count(doc, 'ContactInfo')).toBe(0)
    expect(count(doc, 'Address')).toBe(0)
    expect(count(doc, 'Demographics')).toBe(0)
    expect(count(doc, 'Headline')).toBe(0)
  })

  it('omits Identification entirely when the resume record says nothing', () => {
    const doc = build((s) => {
      s.resume = makeResume({
        full_name: '   ', email: '', phone: null, website_url: '',
        place_of_residence: {}, nationality: {}, title: {},
      })
    })
    expect(count(doc, 'Identification')).toBe(0)
  })

  it('exports a store with no resume record at all', () => {
    const s = { ...emptyStore(), resume: undefined } as unknown as ResumeStore
    const doc = parse(exportEuropassXml(s, makeView({ sections: buildViewSections() }), 'en'))
    expect(count(doc, 'LearnerInfo')).toBe(1)
    expect(count(doc, 'Identification')).toBe(0)
  })
})
