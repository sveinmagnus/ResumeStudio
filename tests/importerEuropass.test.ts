/**
 * @vitest-environment jsdom
 */
// jsdom: the XML path parses via DOMParser (same dependency as lib/richText).
import { describe, it, expect } from 'vitest'
import {
  isEuropassJson, isEuropassXml, parseEuropassDate,
  importFromEuropassJson, importFromEuropassXml,
} from '../src/lib/importerEuropass'

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
  const store = importFromEuropassJson(PROFILE_JSON)

  it('maps identity + contact under the profile language', () => {
    expect(store.resume?.full_name).toBe('Kari Nordmann')
    expect(store.resume?.email).toBe('kari@example.no')
    expect(store.resume?.phone).toBe('+47 99988877')
    expect(store.resume?.default_locale).toBe('no') // nb → no
    expect(store.resume?.title).toEqual({ no: 'Senior rådgiver' })
    expect(store.resume?.place_of_residence).toEqual({ no: 'Oslo, Norway' })
  })

  it('puts aboutMe into a leading key qualification', () => {
    expect(store.key_qualifications[0]?.summary).toEqual({ no: 'Erfaren konsulent.' })
  })

  it('maps work experiences with ongoing + string/object occupation forms', () => {
    expect(store.work_experiences).toHaveLength(2)
    const [current, old] = store.work_experiences
    expect(current.employer).toEqual({ no: 'Konsulenthuset AS' })
    expect(current.role_title).toEqual({ no: 'Seniorkonsulent' })
    expect(current.start).toEqual({ year: 2019, month: 8 })
    expect(current.end).toBeNull()
    expect(old.role_title).toEqual({ no: 'Utvikler' })
    expect(old.end).toEqual({ year: 2019, month: 7 })
  })

  it('maps education and language skills (mother tongue = Native)', () => {
    expect(store.educations[0].school).toEqual({ no: 'Universitetet i Oslo' })
    expect(store.educations[0].degree).toEqual({ no: 'Master i informatikk' })
    expect(store.spoken_languages.map((l) => l.name.no)).toEqual(['Norwegian', 'English'])
    expect(store.spoken_languages[0].level).toEqual({ no: 'Native' })
    expect(store.spoken_languages[1].level).toEqual({ no: 'C1' })
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
  const store = importFromEuropassXml(SKILLS_PASSPORT_XML)

  it('maps identity, contact and headline', () => {
    expect(store.resume?.full_name).toBe('Ola Hansen')
    expect(store.resume?.email).toBe('ola@example.no')
    expect(store.resume?.phone).toBe('+47 41122334')
    expect(store.resume?.title).toEqual({ en: 'Software architect' })
    expect(store.resume?.place_of_residence).toEqual({ en: 'Bergen' })
  })

  it('maps work experience with the XML month form and Current=true', () => {
    const w = store.work_experiences[0]
    expect(w.employer).toEqual({ en: 'Plattform AS' })
    expect(w.role_title).toEqual({ en: 'Architect' })
    expect(w.start).toEqual({ year: 2016, month: 3 })
    expect(w.end).toBeNull()
  })

  it('maps education and the linguistic skill lists', () => {
    expect(store.educations[0].school).toEqual({ en: 'NTNU' })
    expect(store.educations[0].end).toEqual({ year: 2013, month: 6 })
    expect(store.spoken_languages.map((l) => l.name.en)).toEqual(['Norwegian', 'English'])
    expect(store.spoken_languages[1].level).toEqual({ en: 'C2' })
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
