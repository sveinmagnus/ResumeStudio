/**
 * @vitest-environment jsdom
 */
// jsdom: the XML path parses via DOMParser (same dependency as lib/richText).
import { describe, it, expect } from 'vitest'
import {
  isEuropassJson, isEuropassXml, parseEuropassDate,
  importFromEuropassJson, importFromEuropassXml,
} from '../src/lib/importerEuropass'

/**
 * Import once, but not until a test asks for it.
 *
 * A shared fixture built in the describe body runs during COLLECTION, so an
 * importer that throws takes the entire file down before a single test is
 * registered — and a file that registered no tests reports no failures, which
 * reads exactly like a suite that passed.
 */
function memoized<T>(build: () => T): () => T {
  let cached: T | undefined
  return () => (cached ??= build())
}

// ─── Dates ────────────────────────────────────────────────────────────────────

describe('parseEuropassDate', () => {
  it.each([
    ['2018-06', { year: 2018, month: 6 }],
    ['2018-06-15', { year: 2018, month: 6 }],
    ['2018', { year: 2018, month: null }],
    [{ year: 2018, month: 6 }, { year: 2018, month: 6 }],
    [{ year: '2018', month: '--06' }, { year: 2018, month: 6 }], // XML attribute form
    [{ year: '2018', month: '' }, { year: 2018, month: null }],
    [null, null],
    ['junk', null],
    // A two-digit year is a parse failure, not the year 18 — Europass emits
    // four digits, and 18 would sort a role before every other item.
    [{ year: '18' }, null],
    [{ year: 999 }, null],
    [{ year: 1000 }, { year: 1000, month: null }],
    // Non-digits are STRIPPED, not parsed: an annotated year still yields the
    // year rather than failing.
    [{ year: '2018 (approx)' }, { year: 2018, month: null }],
    // Out-of-range months drop to null rather than shifting the year.
    [{ year: '2018', month: '13' }, { year: 2018, month: null }],
    [{ year: '2018', month: '00' }, { year: 2018, month: null }],
    [{ year: '2018', month: '--01' }, { year: 2018, month: 1 }],
    [{ year: '2018', month: '--12' }, { year: 2018, month: 12 }],
  ])('%j → %j', (input, expected) => {
    expect(parseEuropassDate(input)).toEqual(expected)
  })
})

// ─── Detection ────────────────────────────────────────────────────────────────

describe('detection', () => {
  it('isEuropassJson matches the profile export and the XML-converted shape', () => {
    expect(isEuropassJson({ profile: { personalInformation: {} } })).toBe(true)
    expect(isEuropassJson({ SkillsPassport: {} })).toBe(true)
    expect(isEuropassJson({ resumes: [] })).toBe(false)
    expect(isEuropassJson(null)).toBe(false)
  })

  it('isEuropassXml sniffs the SkillsPassport root tag', () => {
    expect(isEuropassXml('<?xml version="1.0"?><SkillsPassport xmlns="...">')).toBe(true)
    expect(isEuropassXml('<html></html>')).toBe(false)
  })

  it('needs a real SkillsPassport TAG, not the word in the document', () => {
    // The pattern allows whitespace after '<' (some tools emit it) but the
    // name must end at a tag boundary — otherwise any file mentioning the
    // word, or a <SkillsPassportSummary>, is routed to this importer.
    expect(isEuropassXml('<  SkillsPassport>')).toBe(true)
    expect(isEuropassXml('<p>Exported from SkillsPassport</p>')).toBe(false)
    // The word followed by a space, but with no tag opening it.
    expect(isEuropassXml('Exported from SkillsPassport v3')).toBe(false)
    expect(isEuropassXml('<SkillsPassportSummary>')).toBe(false)
    expect(isEuropassXml('')).toBe(false)
  })

  it('does not mistake an array or a profile that is not an object', () => {
    // Both halves of the profile guard: dispatch is by shape, and routing a
    // non-Europass file here produces an empty resume rather than an error.
    expect(isEuropassJson([{ profile: { personalInformation: {} } }])).toBe(false)
    expect(isEuropassJson({ profile: 'text' })).toBe(false)
    expect(isEuropassJson({ profile: [{ personalInformation: {} }] })).toBe(false)
    expect(isEuropassJson({ profile: {} })).toBe(false)
  })
})

// ─── JSON path ────────────────────────────────────────────────────────────────

const PROFILE_JSON = {
  profile: {
    preference: { profileLanguage: 'nb', headline: 'Senior rådgiver' },
    personalInformation: {
      firstName: 'Kari',
      lastName: 'Nordmann',
      emails: ['kari@example.no'],
      phones: [{ phoneNumber: '+47 99988877' }],
      nationalities: ['Norwegian'],
      addresses: [{ city: 'Oslo', country: 'Norway' }],
    },
    aboutMe: 'Erfaren konsulent.',
    workExperiences: [
      {
        employer: 'Konsulenthuset AS',
        occupation: { label: 'Seniorkonsulent' },
        startDate: '2019-08',
        ongoing: true,
        mainActivities: 'Rådgivning og arkitektur',
      },
      { employer: 'GammelJobb', position: 'Utvikler', startDate: '2012', endDate: '2019-07' },
    ],
    educationTrainings: [
      {
        organisationName: 'Universitetet i Oslo',
        qualification: 'Master i informatikk',
        startDate: '2007-08',
        endDate: '2012-06',
      },
    ],
    languageSkills: {
      motherTongues: [{ language: 'Norwegian' }],
      otherLanguages: [{ language: 'English', listening: 'C1' }],
    },
  },
}

describe('importFromEuropassJson', () => {
  // Called from inside each test, never at describe-body level: an importer
  // that throws while the file is being COLLECTED takes the whole suite with
  // it, and a suite that never ran reports no failures at all.
  const store = memoized(() => importFromEuropassJson(PROFILE_JSON))

  it('maps identity + contact under the profile language', () => {
    expect(store().resume?.full_name).toBe('Kari Nordmann')
    expect(store().resume?.email).toBe('kari@example.no')
    expect(store().resume?.phone).toBe('+47 99988877')
    expect(store().resume?.default_locale).toBe('no') // nb → no
    expect(store().resume?.title).toEqual({ no: 'Senior rådgiver' })
    expect(store().resume?.place_of_residence).toEqual({ no: 'Oslo, Norway' })
  })

  it('puts aboutMe into a leading key qualification', () => {
    expect(store().key_qualifications[0]?.summary).toEqual({ no: 'Erfaren konsulent.' })
  })

  it('maps work experiences with ongoing + string/object occupation forms', () => {
    expect(store().work_experiences).toHaveLength(2)
    const [current, old] = store().work_experiences
    expect(current.employer).toEqual({ no: 'Konsulenthuset AS' })
    expect(current.role_title).toEqual({ no: 'Seniorkonsulent' })
    expect(current.start).toEqual({ year: 2019, month: 8 })
    expect(current.end).toBeNull()
    expect(old.role_title).toEqual({ no: 'Utvikler' })
    expect(old.end).toEqual({ year: 2019, month: 7 })
  })

  it('maps education and language skills (mother tongue = Native)', () => {
    expect(store().educations[0].school).toEqual({ no: 'Universitetet i Oslo' })
    expect(store().educations[0].degree).toEqual({ no: 'Master i informatikk' })
    expect(store().spoken_languages.map((l) => l.name.no)).toEqual(['Norwegian', 'English'])
    expect(store().spoken_languages[0].level).toEqual({ no: 'Native' })
    expect(store().spoken_languages[1].level).toEqual({ no: 'C1' })
  })

  it('is total: an empty profile still yields a valid store', () => {
    const empty = importFromEuropassJson({ profile: { personalInformation: {} } })
    expect(empty.resume?.full_name).toBe('')
    expect(empty.work_experiences).toEqual([])
  })
})

// ─── XML path ─────────────────────────────────────────────────────────────────

const SKILLS_PASSPORT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<SkillsPassport locale="en">
  <LearnerInfo>
    <Identification>
      <PersonName><FirstName>Ola</FirstName><Surname>Hansen</Surname></PersonName>
      <ContactInfo>
        <Address><Contact><Municipality>Bergen</Municipality></Contact></Address>
        <Email><Contact>ola@example.no</Contact></Email>
        <Telephone><Contact>+47 41122334</Contact></Telephone>
      </ContactInfo>
      <Demographics><Nationality><Label>Norwegian</Label></Nationality></Demographics>
    </Identification>
    <Headline><Description><Label>Software architect</Label></Description></Headline>
    <WorkExperienceList>
      <WorkExperience>
        <Period>
          <From year="2016" month="--03"/>
          <Current>true</Current>
        </Period>
        <Position><Label>Architect</Label></Position>
        <Activities>Designing platforms</Activities>
        <Employer><Name>Plattform AS</Name></Employer>
      </WorkExperience>
    </WorkExperienceList>
    <EducationList>
      <Education>
        <Period><From year="2008"/><To year="2013" month="--06"/></Period>
        <Title>M.Sc. Engineering</Title>
        <Organisation><Name>NTNU</Name></Organisation>
      </Education>
    </EducationList>
    <Skills>
      <Linguistic>
        <MotherTongueList>
          <MotherTongue><Description><Label>Norwegian</Label></Description></MotherTongue>
        </MotherTongueList>
        <ForeignLanguageList>
          <ForeignLanguage>
            <Description><Label>English</Label></Description>
            <ProficiencyLevel><Listening>C2</Listening></ProficiencyLevel>
          </ForeignLanguage>
        </ForeignLanguageList>
      </Linguistic>
    </Skills>
  </LearnerInfo>
</SkillsPassport>`

describe('importFromEuropassXml', () => {
  const store = memoized(() => importFromEuropassXml(SKILLS_PASSPORT_XML))

  it('maps identity, contact and headline', () => {
    expect(store().resume?.full_name).toBe('Ola Hansen')
    expect(store().resume?.email).toBe('ola@example.no')
    expect(store().resume?.phone).toBe('+47 41122334')
    expect(store().resume?.title).toEqual({ en: 'Software architect' })
    expect(store().resume?.place_of_residence).toEqual({ en: 'Bergen' })
  })

  it('maps work experience with the XML month form and Current=true', () => {
    const w = store().work_experiences[0]
    expect(w.employer).toEqual({ en: 'Plattform AS' })
    expect(w.role_title).toEqual({ en: 'Architect' })
    expect(w.start).toEqual({ year: 2016, month: 3 })
    expect(w.end).toBeNull()
  })

  it('maps education and the linguistic skill lists', () => {
    expect(store().educations[0].school).toEqual({ en: 'NTNU' })
    expect(store().educations[0].end).toEqual({ year: 2013, month: 6 })
    expect(store().spoken_languages.map((l) => l.name.en)).toEqual(['Norwegian', 'English'])
    expect(store().spoken_languages[1].level).toEqual({ en: 'C2' })
  })

  it('is total: garbage XML yields an empty-but-valid store', () => {
    const empty = importFromEuropassXml('<SkillsPassport></SkillsPassport>')
    expect(empty.resume?.full_name).toBe('')
    expect(empty.work_experiences).toEqual([])
  })
})

/**
 * The shape tolerance the JSON path is built out of.
 *
 * Europass exports vary by version and by which fields the person filled in:
 * the same value arrives as a bare string in one file and as `{ name }` or
 * `{ label }` in another. Every one of those fallbacks is an `||` or `??`
 * chain, and mutating any link leaves an import that still succeeds and
 * silently drops a field. Nothing exercised the alternate shapes.
 */
describe('importFromEuropassJson — the alternate shapes real exports use', () => {
  const profile = (over: Record<string, unknown>) => importFromEuropassJson({
    profile: { personalInformation: { firstName: 'Kari', lastName: 'Nordmann' }, ...over },
  } as never)

  describe('work experience', () => {
    const work = (w: Record<string, unknown>) => profile({ workExperiences: [w] }).work_experiences

    it('reads the employer as a bare string or as { name }', () => {
      expect(work({ employer: 'Acme AS' })[0].employer.en).toBe('Acme AS')
      expect(work({ employer: { name: 'Acme AS' } })[0].employer.en).toBe('Acme AS')
    })

    it('reads the role from occupation, occupation.label, or position', () => {
      expect(work({ occupation: 'Architect' })[0].role_title.en).toBe('Architect')
      expect(work({ occupation: { label: 'Architect' } })[0].role_title.en).toBe('Architect')
      expect(work({ position: 'Architect' })[0].role_title.en).toBe('Architect')
    })

    it('takes the description from whichever of the three fields is present', () => {
      expect(work({ employer: 'A', mainActivities: 'Did things' })[0].description.en).toBe('Did things')
      expect(work({ employer: 'A', summary: 'Did things' })[0].description.en).toBe('Did things')
      expect(work({ employer: 'A', description: 'Did things' })[0].description.en).toBe('Did things')
    })

    it('prefers mainActivities when several are present', () => {
      // The chain is ordered; a different winner changes what the CV says.
      expect(work({ employer: 'A', mainActivities: 'first', summary: 'second' })[0].description.en)
        .toBe('first')
    })

    it('reads the dates from startDate/endDate or from/to', () => {
      expect(work({ employer: 'A', startDate: '2020-03', endDate: '2021-06' })[0].start)
        .toEqual({ year: 2020, month: 3 })
      const alt = work({ employer: 'A', from: '2020-03', to: '2021-06' })[0]
      expect(alt.start).toEqual({ year: 2020, month: 3 })
      expect(alt.end).toEqual({ year: 2021, month: 6 })
    })

    it('treats ongoing:true as an open end, overriding any endDate present', () => {
      const w = work({ employer: 'A', startDate: '2020', endDate: '2021', ongoing: true })[0]
      expect(w.end).toBeNull()
    })

    it('skips an entry with neither an employer nor a role', () => {
      // Europass files carry blank rows; importing them adds items with no
      // heading that the consultant then has to find and delete.
      expect(work({ mainActivities: 'orphan text' })).toHaveLength(0)
      expect(work({ employer: 'A' })).toHaveLength(1)
      expect(work({ occupation: 'A' })).toHaveLength(1)
    })
  })

  describe('education', () => {
    const edu = (e: Record<string, unknown>) => profile({ educationTrainings: [e] }).educations

    it('reads the school from organisationName, organisation.name or school', () => {
      expect(edu({ organisationName: 'NTNU' })[0].school.en).toBe('NTNU')
      expect(edu({ organisation: { name: 'NTNU' } })[0].school.en).toBe('NTNU')
      expect(edu({ school: 'NTNU' })[0].school.en).toBe('NTNU')
    })

    it('reads the degree from qualification, title or degree', () => {
      expect(edu({ qualification: 'MSc' })[0].degree.en).toBe('MSc')
      expect(edu({ title: 'MSc' })[0].degree.en).toBe('MSc')
      expect(edu({ degree: 'MSc' })[0].degree.en).toBe('MSc')
    })

    it('falls back from description to mainSubjects', () => {
      expect(edu({ school: 'N', mainSubjects: 'Maths' })[0].description.en).toBe('Maths')
    })

    it('merges the two array names an export may use', () => {
      // Older files say educations, newer ones educationTrainings; a file with
      // both must not lose either half.
      const store = importFromEuropassJson({
        profile: {
          personalInformation: { firstName: 'K' },
          educationTrainings: [{ school: 'A' }],
          educations: [{ school: 'B' }],
        },
      } as never)
      expect(store.educations.map((e) => e.school.en)).toEqual(['A', 'B'])
    })

    it('skips an entry with neither a school nor a degree', () => {
      expect(edu({ description: 'orphan' })).toHaveLength(0)
    })
  })

  describe('personal information', () => {
    it('joins the name from its two parts', () => {
      expect(profile({}).resume!.full_name).toBe('Kari Nordmann')
    })

    it('reads an email whether the array holds strings or objects', () => {
      expect(importFromEuropassJson({ profile: { personalInformation: { emails: ['a@x.io'] } } } as never)
        .resume!.email).toBe('a@x.io')
      expect(importFromEuropassJson({ profile: { personalInformation: { emails: [{ email: 'a@x.io' }] } } } as never)
        .resume!.email).toBe('a@x.io')
    })

    it('reads a phone whether the array holds strings or objects', () => {
      expect(importFromEuropassJson({ profile: { personalInformation: { phones: ['+47 900'] } } } as never)
        .resume!.phone).toBe('+47 900')
      expect(importFromEuropassJson({ profile: { personalInformation: { phones: [{ phoneNumber: '+47 900' }] } } } as never)
        .resume!.phone).toBe('+47 900')
    })

    it('joins city and country, and omits the comma when only one is given', () => {
      const at = (addr: Record<string, unknown>) =>
        importFromEuropassJson({ profile: { personalInformation: { addresses: [addr] } } } as never)
          .resume!.place_of_residence.en
      expect(at({ city: 'Oslo', country: 'Norway' })).toBe('Oslo, Norway')
      expect(at({ city: 'Oslo' })).toBe('Oslo')
      expect(at({ country: 'Norway' })).toBe('Norway')
    })

    it('takes the headline from preference.headline or personalInformation.headline', () => {
      expect(profile({ preference: { headline: 'Architect' } }).resume!.title.en).toBe('Architect')
      expect(importFromEuropassJson({
        profile: { personalInformation: { firstName: 'K', headline: 'Architect' } },
      } as never).resume!.title.en).toBe('Architect')
    })

    it('turns aboutMe into a profile, from either shape', () => {
      expect(profile({ aboutMe: 'I build systems.' }).key_qualifications[0].summary.en)
        .toBe('I build systems.')
      expect(profile({ aboutMe: { description: 'I build systems.' } }).key_qualifications[0].summary.en)
        .toBe('I build systems.')
    })

    it('adds NO profile when there is nothing to say', () => {
      expect(profile({}).key_qualifications).toHaveLength(0)
    })
  })
})

/**
 * The remaining live survivors, checked against the current suite rather than
 * the report: the date parser's own bounds, the XML path's ongoing marker, and
 * the language lists.
 */
describe('importerEuropass — parser bounds and the XML language lists', () => {
  describe('parseEuropassDate month bounds', () => {
    it('accepts the two edges and rejects just outside them', () => {
      // The string form takes "YYYY-MM"; a month of 00 or 13 is data corruption
      // and must become null rather than a 13th month nobody can render.
      expect(parseEuropassDate('2020-01')).toEqual({ year: 2020, month: 1 })
      expect(parseEuropassDate('2020-12')).toEqual({ year: 2020, month: 12 })
      expect(parseEuropassDate('2020-00')).toEqual({ year: 2020, month: null })
      expect(parseEuropassDate('2020-13')).toEqual({ year: 2020, month: null })
    })

    it('keeps the year when the month is out of range', () => {
      // Losing the whole date over a bad month is worse than losing the month.
      expect(parseEuropassDate('2020-99')).toEqual({ year: 2020, month: null })
    })

    it('trims surrounding whitespace before matching', () => {
      expect(parseEuropassDate('  2020-06  ')).toEqual({ year: 2020, month: 6 })
    })

    it('needs the year ANCHORED at the start', () => {
      // "v2020" is a version string, not a date.
      expect(parseEuropassDate('v2020-06')).toBeNull()
    })
  })

  describe('the XML path', () => {
    const xml = (body: string) =>
      `<?xml version="1.0"?><SkillsPassport><LearnerInfo>${body}</LearnerInfo></SkillsPassport>`

    it('reads Period > Current as the ongoing marker, case-exactly', () => {
      // The exporter writes <Current>true</Current>; anything else is a closed
      // period, and treating it as ongoing would show a finished job as current.
      const ongoing = importFromEuropassXml(xml(`<WorkExperienceList><WorkExperience>
        <Employer><Name>Acme</Name></Employer>
        <Period><From year="2020" month="--01"/><Current>true</Current></Period>
      </WorkExperience></WorkExperienceList>`), 'en')
      expect(ongoing.work_experiences[0].end).toBeNull()

      const closed = importFromEuropassXml(xml(`<WorkExperienceList><WorkExperience>
        <Employer><Name>Acme</Name></Employer>
        <Period><From year="2020" month="--01"/><To year="2021" month="--06"/></Period>
      </WorkExperience></WorkExperienceList>`), 'en')
      expect(closed.work_experiences[0].end).toEqual({ year: 2021, month: 6 })
    })

    it('does not treat a non-"true" Current as ongoing', () => {
      const store = importFromEuropassXml(xml(`<WorkExperienceList><WorkExperience>
        <Employer><Name>Acme</Name></Employer>
        <Period><From year="2020" month="--01"/><Current>false</Current><To year="2021" month="--06"/></Period>
      </WorkExperience></WorkExperienceList>`), 'en')
      expect(store.work_experiences[0].end).toEqual({ year: 2021, month: 6 })
    })

    it('puts a mother tongue in the list as Native', () => {
      const store = importFromEuropassXml(xml(
        `<MotherTongueList><MotherTongue><Description><Label>Norwegian</Label></Description></MotherTongue></MotherTongueList>`,
      ), 'en')
      expect(store.spoken_languages[0]).toMatchObject({
        name: { en: 'Norwegian' }, level: { en: 'Native' },
      })
    })

    it('skips a mother tongue with no label rather than adding a blank row', () => {
      const store = importFromEuropassXml(xml(
        `<MotherTongueList><MotherTongue><Description><Label>  </Label></Description></MotherTongue></MotherTongueList>`,
      ), 'en')
      expect(store.spoken_languages).toEqual([])
    })

    it('reads a foreign language level from Listening, falling back to the group', () => {
      const withListening = importFromEuropassXml(xml(
        `<ForeignLanguageList><ForeignLanguage><Description><Label>German</Label></Description>
          <ProficiencyLevel><Listening>B2</Listening></ProficiencyLevel>
        </ForeignLanguage></ForeignLanguageList>`,
      ), 'en')
      expect(withListening.spoken_languages[0].level.en).toBe('B2')

      const groupOnly = importFromEuropassXml(xml(
        `<ForeignLanguageList><ForeignLanguage><Description><Label>German</Label></Description>
          <ProficiencyLevel>B1</ProficiencyLevel>
        </ForeignLanguage></ForeignLanguageList>`,
      ), 'en')
      expect(groupOnly.spoken_languages[0].level.en).toBe('B1')
    })

    it('numbers the languages in document order across both lists', () => {
      const store = importFromEuropassXml(xml(
        `<MotherTongueList><MotherTongue><Description><Label>Norwegian</Label></Description></MotherTongue></MotherTongueList>
         <ForeignLanguageList><ForeignLanguage><Description><Label>German</Label></Description></ForeignLanguage></ForeignLanguageList>`,
      ), 'en')
      expect(store.spoken_languages.map((l) => l.sort_order)).toEqual([0, 1])
    })
  })
})

describe('importerEuropass — education dates and value coercion', () => {
  const profile = (over: Record<string, unknown>) => importFromEuropassJson({
    profile: { personalInformation: { firstName: 'Kari' }, ...over },
  } as never)
  const edu = (e: Record<string, unknown>) => profile({ educationTrainings: [e] }).educations[0]

  it('reads an education’s dates from startDate/endDate or from/to', () => {
    // Older exports use from/to; dropping either alternative silently undates
    // half a CV.
    expect(edu({ school: 'NTNU', startDate: '2014-08', endDate: '2019-06' }))
      .toMatchObject({ start: { year: 2014, month: 8 }, end: { year: 2019, month: 6 } })
    expect(edu({ school: 'NTNU', from: '2014-08', to: '2019-06' }))
      .toMatchObject({ start: { year: 2014, month: 8 }, end: { year: 2019, month: 6 } })
  })

  it('treats an ongoing education as open-ended, overriding any end date', () => {
    expect(edu({ school: 'NTNU', startDate: '2014-08', endDate: '2019-06', ongoing: true }).end)
      .toBeNull()
  })

  it('only "true" opens the range — not false, and not a truthy string', () => {
    // A studied-and-finished degree must not read as still in progress.
    expect(edu({ school: 'NTNU', endDate: '2019-06', ongoing: false }).end)
      .toEqual({ year: 2019, month: 6 })
    expect(edu({ school: 'NTNU', endDate: '2019-06', ongoing: 'yes' }).end)
      .toEqual({ year: 2019, month: 6 })
  })

  it('trims whitespace out of every string it reads', () => {
    // Europass exports carry padded values; an untrimmed name shows up
    // indented in the header and sorts wrongly in the picker.
    const store = importFromEuropassJson({
      profile: { personalInformation: { firstName: '  Kari  ', lastName: ' Nordmann ' } },
    } as never)
    expect(store.resume!.full_name).toBe('Kari Nordmann')
  })
})

/**
 * An imported store is a WHOLE store: every section the app knows about has to
 * exist and be empty, because the editor, the migrations and the view builder all
 * read them straight away. A section left undefined — or filled with something —
 * fails at the first render, not at the import.
 */
describe('importFromEuropass — the store it hands back is complete and otherwise empty', () => {
  const XML = `<?xml version="1.0"?><SkillsPassport>
    <LearnerInfo>
      <Identification><PersonName><FirstName>Ada</FirstName><Surname>Lovelace</Surname></PersonName></Identification>
      <WorkExperienceList><WorkExperience>
        <Period><From year="2020" month="--01"/><Current>true</Current></Period>
        <Employer><Name>Acme</Name></Employer>
        <Position><Label>Architect</Label></Position>
      </WorkExperience></WorkExperienceList>
    </LearnerInfo></SkillsPassport>`

  const EMPTY_SECTIONS = [
    'skills', 'roles', 'industries', 'key_qualifications', 'key_competencies',
    'recommendations', 'projects', 'courses', 'certifications', 'skill_categories',
    'cover_letters', 'positions', 'presentations', 'honor_awards', 'publications',
    'references', 'views',
  ] as const

  it('leaves every section it does not import EMPTY, from the XML path', () => {
    const store = importFromEuropassXml(XML)
    for (const key of EMPTY_SECTIONS) {
      expect(store[key], key).toEqual([])
    }
    // And the one it does import is filled.
    expect(store.work_experiences).toHaveLength(1)
  })

  it('leaves every section it does not import EMPTY, from the JSON path', () => {
    const store = importFromEuropassJson({
      profile: {
        preference: { profileLanguage: 'en' },
        personalInformation: { firstName: 'Ada', lastName: 'Lovelace' },
        workExperiences: [{ employer: 'Acme', position: 'Architect', startDate: '2020-01', ongoing: true }],
      },
    })
    for (const key of EMPTY_SECTIONS) {
      expect(store[key], key).toEqual([])
    }
    expect(store.work_experiences).toHaveLength(1)
  })
})

describe('importFromEuropassXml — an entry needs a name of some kind', () => {
  const xmlWith = (inner: string) => `<?xml version="1.0"?><SkillsPassport><LearnerInfo>
    ${inner}
  </LearnerInfo></SkillsPassport>`

  const work = (employer: string, position: string) => xmlWith(`<WorkExperienceList><WorkExperience>
    ${employer ? `<Employer><Name>${employer}</Name></Employer>` : ''}
    ${position ? `<Position><Label>${position}</Label></Position>` : ''}
    <Activities>Did the work</Activities>
  </WorkExperience></WorkExperienceList>`)

  const education = (school: string, title: string) => xmlWith(`<EducationList><Education>
    ${school ? `<Organisation><Name>${school}</Name></Organisation>` : ''}
    ${title ? `<Title>${title}</Title>` : ''}
  </Education></EducationList>`)

  it('keeps an employment with only an employer, and one with only a position', () => {
    // Either half identifies the row; requiring both would drop real entries
    // from an export that only filled one of them.
    expect(importFromEuropassXml(work('Acme', '')).work_experiences).toHaveLength(1)
    expect(importFromEuropassXml(work('', 'Architect')).work_experiences).toHaveLength(1)
  })

  it('skips an employment with neither', () => {
    expect(importFromEuropassXml(work('', '')).work_experiences).toEqual([])
  })

  it('keeps an education with only a school, and one with only a title', () => {
    expect(importFromEuropassXml(education('NTNU', '')).educations).toHaveLength(1)
    expect(importFromEuropassXml(education('', 'MSc')).educations).toHaveLength(1)
  })

  it('skips an education with neither', () => {
    expect(importFromEuropassXml(education('', '')).educations).toEqual([])
  })
})

/**
 * The europa.eu JSON profile export.
 *
 * Its field names moved between versions, so every value is read from a list of
 * candidate keys and coerced through three tiny helpers. A helper that stops
 * guarding turns a nested object into "[object Object]" in the CV, or throws on
 * a field the export happens to leave null.
 */
describe('importFromEuropassJson — the field-shape coercions', () => {
  const imported = (profile: Record<string, unknown>) =>
    importFromEuropassJson({ profile } as never)

  it('reads an employer given as a string OR as a nested object', () => {
    const flat = imported({ workExperiences: [{ employer: 'Cartavio', occupation: 'Architect' }] })
    expect(flat.work_experiences[0].employer).toEqual({ en: 'Cartavio' })

    const nested = imported({ workExperiences: [{ employer: { name: 'Cartavio' }, occupation: 'Architect' }] })
    expect(nested.work_experiences[0].employer).toEqual({ en: 'Cartavio' })
  })

  it('reads an occupation from a label, and falls back to position', () => {
    expect(imported({ workExperiences: [{ employer: 'A', occupation: { label: 'Architect' } }] })
      .work_experiences[0].role_title).toEqual({ en: 'Architect' })
    expect(imported({ workExperiences: [{ employer: 'A', position: 'Architect' }] })
      .work_experiences[0].role_title).toEqual({ en: 'Architect' })
  })

  it('reads a number where a string was expected rather than dropping it', () => {
    // Grades and years arrive as numbers in some exports.
    expect(imported({ educationTrainings: [{ organisationName: 'NTNU', qualification: 2019 }] })
      .educations[0].degree).toEqual({ en: '2019' })
  })

  it('ignores a value that is neither string nor number', () => {
    expect(imported({ workExperiences: [{ employer: true, occupation: ['x'] }] }).work_experiences).toEqual([])
  })

  it('treats a non-object entry as an empty one instead of throwing', () => {
    expect(() => imported({ workExperiences: ['not an object', null, 42] })).not.toThrow()
    expect(imported({ workExperiences: ['not an object'] }).work_experiences).toEqual([])
  })

  it('treats a non-array collection as empty', () => {
    expect(() => imported({ workExperiences: { employer: 'A' } })).not.toThrow()
    expect(imported({ workExperiences: { employer: 'A' } }).work_experiences).toEqual([])
  })

  it('skips an entry with neither an employer nor a title', () => {
    const store = imported({ workExperiences: [{ startDate: '2020-01' }, { employer: 'A' }] })
    expect(store.work_experiences).toHaveLength(1)
  })
})

describe('importFromEuropassJson — dates and the ongoing flag', () => {
  const first = (over: Record<string, unknown>) =>
    importFromEuropassJson({ profile: { workExperiences: [{ employer: 'A', ...over }] } } as never)
      .work_experiences[0]

  it('reads a year with a month, and a bare year', () => {
    expect(first({ startDate: '2019-06' }).start).toEqual({ year: 2019, month: 6 })
    expect(first({ startDate: '2019' }).start).toEqual({ year: 2019, month: null })
  })

  it('drops a month outside 1..12 but keeps the year', () => {
    expect(first({ startDate: '2019-00' }).start).toEqual({ year: 2019, month: null })
    expect(first({ startDate: '2019-13' }).start).toEqual({ year: 2019, month: null })
    expect(first({ startDate: '2019-01' }).start).toEqual({ year: 2019, month: 1 })
    expect(first({ startDate: '2019-12' }).start).toEqual({ year: 2019, month: 12 })
  })

  it('reads an ONGOING entry as an open end, whatever end date it also carries', () => {
    expect(first({ startDate: '2019', ongoing: true, endDate: '2021' }).end).toBeNull()
    expect(first({ startDate: '2019', endDate: '2021' }).end).toEqual({ year: 2021, month: null })
  })

  it('accepts the alternate from/to key names', () => {
    expect(first({ from: '2019-03', to: '2020-04' })).toMatchObject({
      start: { year: 2019, month: 3 }, end: { year: 2020, month: 4 },
    })
  })
})

describe('importFromEuropassJson — the imported defaults and the language list', () => {
  const imported = (profile: Record<string, unknown>) => importFromEuropassJson({ profile } as never)

  it('imports every row enabled and unstarred', () => {
    const store = imported({
      aboutMe: 'I build systems.',
      workExperiences: [{ employer: 'A' }],
      educationTrainings: [{ organisationName: 'NTNU' }],
      languageSkills: { motherTongues: ['Norwegian'] },
    })
    expect(store.key_qualifications[0]).toMatchObject({ starred: false, disabled: false })
    expect(store.work_experiences[0]).toMatchObject({ starred: false, disabled: false })
    expect(store.educations[0]).toMatchObject({ starred: false, disabled: false, exchange: false })
    expect(store.spoken_languages[0].disabled).toBe(false)
  })

  it('numbers the languages upward across the two lists', () => {
    // Mother tongues and other languages are separate arrays that share one
    // sequence; restarting or counting backwards puts them in the wrong order.
    const store = imported({
      languageSkills: {
        motherTongues: ['Norwegian'],
        otherLanguages: [{ language: 'English', listening: 'C2' }, { language: 'German', level: 'B1' }],
      },
    })
    expect(store.spoken_languages.map((l) => l.sort_order)).toEqual([0, 1, 2])
    expect(store.spoken_languages.map((l) => l.name.en)).toEqual(['Norwegian', 'English', 'German'])
  })

  it('marks a mother tongue Native and leaves an unlevelled language blank', () => {
    const store = imported({
      languageSkills: { motherTongues: ['Norwegian'], otherLanguages: [{ language: 'German' }] },
    })
    expect(store.spoken_languages[0].level).toEqual({ en: 'Native' })
    expect(store.spoken_languages[1].level).toEqual({})
  })

  it('skips a language entry with no name', () => {
    const store = imported({ languageSkills: { motherTongues: [{}, 'Norwegian'], otherLanguages: [{ level: 'B1' }] } })
    expect(store.spoken_languages.map((l) => l.name.en)).toEqual(['Norwegian'])
  })

  it('reads the about-me text as the opening profile, and adds none without it', () => {
    expect(imported({ aboutMe: { description: 'I build systems.' } }).key_qualifications[0].summary)
      .toEqual({ en: 'I build systems.' })
    expect(imported({}).key_qualifications).toEqual([])
  })
})

/**
 * The XML import path, read from a hand-written SkillsPassport.
 *
 * Real Europass files are pretty-printed, so EVERY text node arrives wrapped in
 * whitespace — the trims are not defensive, they are the normal case. A value
 * that keeps its padding lands in the CV with a leading space and sorts wrongly
 * everywhere it is compared.
 */
describe('importFromEuropassXml — a pretty-printed document', () => {
  const XML = `<?xml version="1.0" encoding="UTF-8"?>
<SkillsPassport locale="en">
  <Locale>en</Locale>
  <LearnerInfo>
    <Identification>
      <PersonName>
        <FirstName>  Kari  </FirstName>
        <Surname>  Nordmann  </Surname>
      </PersonName>
      <ContactInfo>
        <Email><Contact>  kari@work.test  </Contact></Email>
        <Telephone><Contact>  +47 900 00 000  </Contact></Telephone>
      </ContactInfo>
    </Identification>
    <WorkExperienceList>
      <WorkExperience>
        <Period>
          <From year="2018" month="--06"/>
          <To year="2020" month="--09"/>
          <Current>  true  </Current>
        </Period>
        <Position><Label>  Principal Consultant  </Label></Position>
        <Activities>  Led the rebuild.  </Activities>
        <Employer><Name>  Cartavio AS  </Name></Employer>
      </WorkExperience>
      <WorkExperience>
        <Period>
          <From year="2014"/>
          <To year="2018" month="--03"/>
        </Period>
        <Position><Label>Developer</Label></Position>
        <Employer><Name>Old Co</Name></Employer>
      </WorkExperience>
    </WorkExperienceList>
    <EducationList>
      <Education>
        <Period><From year="2010"/><To year="2014"/></Period>
        <Title>  MSc Computer Science  </Title>
        <Organisation><Name>  NTNU  </Name></Organisation>
      </Education>
    </EducationList>
    <Skills>
      <Linguistic>
        <MotherTongueList>
          <MotherTongue><Description><Label>  Norwegian  </Label></Description></MotherTongue>
        </MotherTongueList>
        <ForeignLanguageList>
          <ForeignLanguage>
            <Description><Label>  English  </Label></Description>
            <ProficiencyLevel><Listening>  C2  </Listening></ProficiencyLevel>
          </ForeignLanguage>
          <ForeignLanguage>
            <Description><Label>German</Label></Description>
          </ForeignLanguage>
          <ForeignLanguage>
            <ProficiencyLevel><Listening>A1</Listening></ProficiencyLevel>
          </ForeignLanguage>
        </ForeignLanguageList>
      </Linguistic>
    </Skills>
  </LearnerInfo>
</SkillsPassport>`

  const store = () => importFromEuropassXml(XML)

  it('trims the identity fields it reads', () => {
    const r = store().resume!
    expect(r.full_name).toBe('Kari Nordmann')
    expect(r.email).toBe('kari@work.test')
    expect(r.phone).toBe('+47 900 00 000')
  })

  it('trims every text value on an entry', () => {
    const w = store().work_experiences[0]
    expect(w.employer).toEqual({ en: 'Cartavio AS' })
    expect(w.role_title).toEqual({ en: 'Principal Consultant' })
    expect(w.description).toEqual({ en: 'Led the rebuild.' })
    expect(store().educations[0].school).toEqual({ en: 'NTNU' })
    expect(store().educations[0].degree).toEqual({ en: 'MSc Computer Science' })
  })

  it('reads a padded <Current>true</Current> as an OPEN end, ignoring any To', () => {
    // The importer keys `end: null` off exactly this element; a comparison that
    // does not trim reads "  true  " as not-true and dates the row as finished
    // from the To element it should have ignored.
    expect(store().work_experiences[0].end).toBeNull()
    expect(store().work_experiences[0].start).toEqual({ year: 2018, month: 6 })
  })

  it('reads a closed period from its two dates', () => {
    expect(store().work_experiences[1]).toMatchObject({
      start: { year: 2014, month: null }, end: { year: 2018, month: 3 },
    })
  })

  it('imports every row enabled and unstarred', () => {
    const s = store()
    expect(s.work_experiences[0]).toMatchObject({ starred: false, disabled: false })
    expect(s.educations[0]).toMatchObject({ starred: false, disabled: false, exchange: false })
    for (const l of s.spoken_languages) expect(l.disabled, l.name.en).toBe(false)
  })

  it('leaves the per-item link lists empty', () => {
    expect(store().work_experiences[0].role_ids).toEqual([])
  })

  it('numbers the languages upward across both lists, mother tongue first', () => {
    const langs = store().spoken_languages
    // The fourth entry has a level but no name at all, and is dropped.
    expect(langs.map((l) => l.name.en)).toEqual(['Norwegian', 'English', 'German'])
    expect(langs.map((l) => l.sort_order)).toEqual([0, 1, 2])
    expect(langs[0].level).toEqual({ en: 'Native' })
    expect(langs[1].level).toEqual({ en: 'C2' })
    expect(langs[2].level).toEqual({})
  })
})

/**
 * The two coercions the Europass importer runs everything through, and the XML
 * fields nothing asserted.
 *
 * Europass files come from a government portal and from third-party editors, so
 * the shapes vary: dates arrive as "2019", "2019-06" or nonsense, and the JSON
 * export nests objects where the XML nests elements. Both readers are total —
 * a malformed value has to degrade to "nothing here" rather than throw.
 */
describe('importFromEuropassXml — the date parser', () => {
  const xml = (period: string) => `<?xml version="1.0"?><SkillsPassport><LearnerInfo>
    <WorkExperienceList><WorkExperience>
      <Employer><Name>Acme</Name></Employer>${period}
    </WorkExperience></WorkExperienceList>
  </LearnerInfo></SkillsPassport>`
  const work = (period: string) => importFromEuropassXml(xml(period)).work_experiences[0]

  it('reads a year with a month, and a year on its own', () => {
    expect(work('<Period><From year="2019" month="--06"/></Period>').start).toEqual({ year: 2019, month: 6 })
    expect(work('<Period><From year="2019"/></Period>').start).toEqual({ year: 2019, month: null })
  })

  it('drops a month outside 1-12 rather than the whole date', () => {
    // The year is the part a reader needs; losing it over a bad month drops the
    // entry out of every date sort.
    expect(work('<Period><From year="2019" month="--00"/></Period>').start).toEqual({ year: 2019, month: null })
    expect(work('<Period><From year="2019" month="--13"/></Period>').start).toEqual({ year: 2019, month: null })
  })

  it('reads an open period from Current, not from an absent To', () => {
    const open = work('<Period><From year="2019"/><Current>true</Current></Period>')
    expect(open.end).toBeNull()
    const closed = work('<Period><From year="2019"/><To year="2021" month="--03"/></Period>')
    expect(closed.end).toEqual({ year: 2021, month: 3 })
  })

  it('reads no period at all as no dates', () => {
    const none = work('')
    expect(none.start).toBeNull()
    expect(none.end).toBeNull()
  })
})

describe('importFromEuropassXml — the identity block', () => {
  const xml = (ident: string) => `<?xml version="1.0"?><SkillsPassport><LearnerInfo>
    <Identification>${ident}</Identification>
  </LearnerInfo></SkillsPassport>`
  const resumeOf = (ident: string) => importFromEuropassXml(xml(ident)).resume!

  it('joins the two name halves, and copes with only one', () => {
    expect(resumeOf('<PersonName><FirstName>Kari</FirstName><Surname>Nordmann</Surname></PersonName>').full_name)
      .toBe('Kari Nordmann')
    expect(resumeOf('<PersonName><FirstName>Kari</FirstName></PersonName>').full_name).toBe('Kari')
    expect(resumeOf('<PersonName><Surname>Nordmann</Surname></PersonName>').full_name).toBe('Nordmann')
  })

  it('reads the contact fields out of their nested Contact elements', () => {
    const r = resumeOf(`<ContactInfo>
      <Email><Contact>kari@work.test</Contact></Email>
      <Telephone><Contact>+47 900</Contact></Telephone>
      <Address><Contact><Municipality>Oslo</Municipality></Contact></Address>
    </ContactInfo>`)
    expect(r.email).toBe('kari@work.test')
    expect(r.phone).toBe('+47 900')
    expect(r.place_of_residence).toEqual({ en: 'Oslo' })
  })

  it('nulls an absent phone rather than storing an empty string', () => {
    // The header renders a contact line per non-null field; an empty string
    // prints a bare label with nothing after it.
    expect(resumeOf('<ContactInfo><Email><Contact>k@x.io</Contact></Email></ContactInfo>').phone).toBeNull()
  })

  it('reads the nationality label', () => {
    expect(resumeOf('<Demographics><Nationality><Label>Norwegian</Label></Nationality></Demographics>').nationality)
      .toEqual({ en: 'Norwegian' })
  })
})

describe('importFromEuropassXml — foreign language levels', () => {
  const xml = (body: string) => `<?xml version="1.0"?><SkillsPassport><LearnerInfo><Skills><Linguistic>
    <ForeignLanguageList><ForeignLanguage>
      <Description><Label>German</Label></Description>${body}
    </ForeignLanguage></ForeignLanguageList>
  </Linguistic></Skills></LearnerInfo></SkillsPassport>`
  const lang = (body: string) => importFromEuropassXml(xml(body)).spoken_languages[0]

  it('prefers the Listening level, falling back to the block itself', () => {
    expect(lang('<ProficiencyLevel><Listening>B2</Listening></ProficiencyLevel>').level).toEqual({ en: 'B2' })
    expect(lang('<ProficiencyLevel>C1</ProficiencyLevel>').level).toEqual({ en: 'C1' })
  })

  it('leaves the level EMPTY rather than storing a blank string', () => {
    // An empty localized map means "not stated"; a blank string renders as a
    // dash with nothing after it in every export.
    expect(lang('').level).toEqual({})
  })
})

/**
 * The rows a Europass import writes out by hand.
 *
 * Neither path has a source for the link lists or the flags, so every one of
 * them is a literal in the mapper. Each is load-bearing: a seeded link list
 * points at a registry entry that does not exist and every renderer resolves
 * those ids, a row that lands disabled is missing from every export with no
 * visible cause, and a resume whose locale list is empty offers the consultant
 * no language to edit in.
 */
describe('importFromEuropass — the lists and flags a fresh import starts with', () => {
  it('supports the one language it detected, from either path', () => {
    const fromJson = importFromEuropassJson({
      profile: { preference: { profileLanguage: 'nb' }, personalInformation: { firstName: 'Kari' } },
    })
    expect(fromJson.resume!.default_locale).toBe('no')
    expect(fromJson.resume!.supported_locales).toEqual(['no'])

    const fromXml = importFromEuropassXml(
      '<?xml version="1.0"?><SkillsPassport locale="nb"><LearnerInfo/></SkillsPassport>',
    )
    expect(fromXml.resume!.default_locale).toBe('no')
    expect(fromXml.resume!.supported_locales).toEqual(['no'])
  })

  it('links the opening profile to no competencies and no key points', () => {
    const store = importFromEuropassJson({ profile: { aboutMe: 'I build systems.' } })
    expect(store.key_qualifications[0].competency_ids).toEqual([])
    expect(store.key_qualifications[0].key_points).toEqual([])
  })

  it('links a JSON work experience to no roles until the user does', () => {
    const store = importFromEuropassJson({ profile: { workExperiences: [{ employer: 'Acme' }] } })
    expect(store.work_experiences[0].role_ids).toEqual([])
  })

  it('imports a non-native language enabled, like every other row', () => {
    const store = importFromEuropassJson({
      profile: { languageSkills: { otherLanguages: [{ language: 'German', listening: 'B1' }] } },
    })
    expect(store.spoken_languages[0]).toMatchObject({ name: { en: 'German' }, disabled: false })
  })
})

describe('importFromEuropassXml — where the document states its language', () => {
  it('prefers the Locale ELEMENT when the root carries no locale attribute', () => {
    // Europass 3.x writes the language as a child element; reading only the
    // attribute silently imports a Norwegian CV as English, and every field
    // then lands in a locale column the consultant is not editing.
    const store = importFromEuropassXml(
      '<?xml version="1.0"?><SkillsPassport><Locale>no</Locale><LearnerInfo/></SkillsPassport>',
    )
    expect(store.resume!.default_locale).toBe('no')
  })

  it('falls back to the root attribute when there is no Locale element', () => {
    const store = importFromEuropassXml(
      '<?xml version="1.0"?><SkillsPassport locale="sv"><LearnerInfo/></SkillsPassport>',
    )
    expect(store.resume!.default_locale).toBe('se')
  })

  it('settles on English when the document states no language at all', () => {
    const store = importFromEuropassXml('<?xml version="1.0"?><SkillsPassport><LearnerInfo/></SkillsPassport>')
    expect(store.resume!.default_locale).toBe('en')
  })
})

describe('importFromEuropassXml — the two shapes an email arrives in', () => {
  const resumeOf = (contact: string) => importFromEuropassXml(
    `<?xml version="1.0"?><SkillsPassport><LearnerInfo><Identification><ContactInfo>${contact}</ContactInfo></Identification></LearnerInfo></SkillsPassport>`,
  ).resume!

  it('reads the address straight off Email when there is no nested Contact', () => {
    // Older exports put the address in the element itself. Dropping the
    // fallback leaves the consultant with a CV that lists no way to reach them.
    expect(resumeOf('<Email>ola@example.no</Email>').email).toBe('ola@example.no')
  })

  it('still prefers the nested Contact when both could be read', () => {
    expect(resumeOf('<Email><Contact>ola@example.no</Contact></Email>').email).toBe('ola@example.no')
  })

  it('leaves the address EMPTY rather than undefined when there is no email at all', () => {
    expect(resumeOf('<Telephone><Contact>+47 900</Contact></Telephone>').email).toBe('')
  })
})

/**
 * The coercion helpers in front of the JSON path.
 *
 * A Europass export is written by someone else's exporter, and the shapes drift:
 * a field that is usually a string arrives as a number, an object arrives as an
 * array, a whole branch is absent. These three helpers are the only thing between
 * that and a property read on undefined — and an importer that throws does not
 * degrade, it takes the whole import screen down with nothing imported.
 */
describe('importFromEuropassJson — shapes the exporter had no business sending', () => {
  it('imports an empty document without throwing', () => {
    expect(() => importFromEuropassJson({})).not.toThrow()
    const store = importFromEuropassJson({})
    expect(store.projects).toEqual([])
    expect(store.work_experiences).toEqual([])
  })

  it('survives every branch being the WRONG kind', () => {
    // Objects where arrays belong and arrays where objects belong: each helper
    // substitutes the empty shape rather than letting the read reach undefined.
    const wrong = {
      profile: {
        personalInformation: [],
        workExperience: {},
        education: 'none',
        skills: 42,
        aboutMe: [],
      },
    }
    expect(() => importFromEuropassJson(wrong)).not.toThrow()
    expect(importFromEuropassJson(wrong).work_experiences).toEqual([])
  })

  it('reads a NUMBER where a string was expected rather than dropping it', () => {
    // Some exporters emit a bare year or a numeric identifier. Coercing keeps the
    // value; a type check that only accepts strings silently loses it.
    const store = importFromEuropassJson({
      profile: { personalInformation: { firstName: 'Kari', lastName: 2 } },
    })
    expect(store.resume?.full_name).toBe('Kari 2')
  })

  it('trims a padded string field', () => {
    const store = importFromEuropassJson({
      profile: { personalInformation: { firstName: '  Kari  ', lastName: 'Nordmann' } },
    })
    expect(store.resume?.full_name).toBe('Kari Nordmann')
  })
})

describe('importFromEuropassXml — an element the document does not have', () => {
  it('reads a missing element as empty rather than throwing', () => {
    // querySelector returns null for anything absent, and Europass documents omit
    // whole blocks routinely — a non-optional read here would fail the import on
    // the first CV that leaves out a phone number.
    const bare = '<?xml version="1.0"?><SkillsPassport><LearnerInfo></LearnerInfo></SkillsPassport>'
    expect(() => importFromEuropassXml(bare)).not.toThrow()
    const store = importFromEuropassXml(bare)
    expect(store.resume?.full_name).toBe('')
    expect(store.resume?.email).toBe('')
  })
})
