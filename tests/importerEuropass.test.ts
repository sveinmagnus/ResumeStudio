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
