import { describe, it, expect } from 'vitest'
import {
  parseCsv, csvObjects, parseLinkedInDate, isLinkedInExport, importFromLinkedIn,
} from '../src/lib/importerLinkedIn'

// ─── CSV parser ───────────────────────────────────────────────────────────────

describe('parseCsv', () => {
  it.each([
    ['a,b,c', [['a', 'b', 'c']]],
    ['a,b\nc,d', [['a', 'b'], ['c', 'd']]],
    ['a,"b,c",d', [['a', 'b,c', 'd']]],
    ['a,"line1\nline2",c', [['a', 'line1\nline2', 'c']]],
    ['a,"she said ""hi""",c', [['a', 'she said "hi"', 'c']]],
    ['a,b\r\nc,d\r\n', [['a', 'b'], ['c', 'd']]],
    ['a,,c', [['a', '', 'c']]],
  ])('parses %j', (input, expected) => {
    expect(parseCsv(input)).toEqual(expected)
  })
})

describe('csvObjects', () => {
  it('maps rows onto trimmed header keys', () => {
    const rows = csvObjects('Name , Level\nNorwegian, Native\n')
    expect(rows).toEqual([{ Name: 'Norwegian', Level: 'Native' }])
  })

  it('returns [] for headers-only or empty text', () => {
    expect(csvObjects('Name,Level\n')).toEqual([])
    expect(csvObjects('')).toEqual([])
  })

  it('tolerates short rows (missing trailing fields become empty)', () => {
    const rows = csvObjects('A,B,C\n1,2\n')
    expect(rows).toEqual([{ A: '1', B: '2', C: '' }])
  })
})

// ─── Date strings ─────────────────────────────────────────────────────────────

describe('parseLinkedInDate', () => {
  it.each([
    ['Mar 2020', { year: 2020, month: 3 }],
    ['Sep 2015', { year: 2015, month: 9 }],
    ['2020', { year: 2020, month: null }],
    ['', null],
    [undefined, null],
    ['garbage', null],
  ])('%j → %j', (input, expected) => {
    expect(parseLinkedInDate(input)).toEqual(expected)
  })
})

// ─── Full import ──────────────────────────────────────────────────────────────

const FILES: Record<string, string> = {
  'Profile.csv':
    'First Name,Last Name,Headline,Summary,Geo Location\n' +
    'Svein,Sørensen,"Senior Consultant","20 years of experience","Oslo, Norway"\n',
  'Email Addresses.csv':
    'Email Address,Confirmed,Primary,Updated On\n' +
    'old@x.no,Yes,No,1/1/20\nsm@cartavio.no,Yes,Yes,1/1/24\n',
  'PhoneNumbers.csv': 'Extension,Number,Type\n,+47 913 04 810,Mobile\n',
  'Positions.csv':
    'Company Name,Title,Description,Location,Started On,Finished On\n' +
    'Cartavio AS,Principal Consultant,"Led delivery, advised boards",Oslo,Jan 2018,\n' +
    'OldCorp,Developer,Built things,Bergen,Aug 2010,Dec 2017\n',
  'Education.csv':
    'School Name,Start Date,End Date,Notes,Degree Name,Activities\n' +
    'NTNU,1998,2003,,M.Sc. Computer Science,\n',
  'Skills.csv': 'Name\nTypeScript\nArchitecture\nTypeScript\n',
  'Languages.csv': 'Name,Proficiency\nNorwegian,Native or bilingual proficiency\n',
  'Certifications.csv':
    'Name,Url,Authority,Started On,Finished On\n' +
    'CKA,https://example.com/cka,CNCF,Mar 2022,Mar 2025\n',
  'Projects.csv':
    'Title,Description,Url,Started On,Finished On\n' +
    'Payment platform,"Modernised the stack",https://example.com,Feb 2021,Nov 2022\n',
  'Recommendations_Received.csv':
    'First Name,Last Name,Company,Job Title,Text,Creation Date,Status\n' +
    'Jane,Boss,BigCo,CTO,"Outstanding consultant",1/1/23,VISIBLE\n',
}

describe('isLinkedInExport', () => {
  it('recognises the export by its signature CSVs, even under a folder', () => {
    expect(isLinkedInExport(FILES)).toBe(true)
    expect(isLinkedInExport({ 'Basic_LinkedInDataExport/Profile.csv': FILES['Profile.csv'] })).toBe(true)
    expect(isLinkedInExport({ 'random.csv': 'a,b\n1,2' })).toBe(false)
  })
})

describe('importFromLinkedIn', () => {
  const store = importFromLinkedIn(FILES)

  it('builds the profile with primary email, phone and headline title', () => {
    expect(store.resume?.full_name).toBe('Svein Sørensen')
    expect(store.resume?.email).toBe('sm@cartavio.no') // Primary=Yes wins
    expect(store.resume?.phone).toBe('+47 913 04 810')
    expect(store.resume?.title).toEqual({ en: 'Senior Consultant' })
    expect(store.resume?.place_of_residence).toEqual({ en: 'Oslo, Norway' })
  })

  it('turns the summary into a leading key qualification', () => {
    expect(store.key_qualifications).toHaveLength(1)
    expect(store.key_qualifications[0].summary).toEqual({ en: '20 years of experience' })
  })

  it('maps positions with month-precision dates and ongoing end', () => {
    expect(store.work_experiences).toHaveLength(2)
    const [current, old] = store.work_experiences
    expect(current.employer).toEqual({ en: 'Cartavio AS' })
    expect(current.start).toEqual({ year: 2018, month: 1 })
    expect(current.end).toBeNull()
    expect(old.end).toEqual({ year: 2017, month: 12 })
  })

  it('maps education with year-only dates', () => {
    expect(store.educations[0].school).toEqual({ en: 'NTNU' })
    expect(store.educations[0].degree).toEqual({ en: 'M.Sc. Computer Science' })
    expect(store.educations[0].start).toEqual({ year: 1998, month: null })
  })

  it('dedupes skills into the registry', () => {
    expect(store.skills.map((s) => s.name.en)).toEqual(['TypeScript', 'Architecture'])
  })

  it('maps languages, certifications (with url + expiry) and projects', () => {
    expect(store.spoken_languages[0].name).toEqual({ en: 'Norwegian' })
    const cert = store.certifications[0]
    expect(cert.name).toEqual({ en: 'CKA' })
    expect(cert.organiser).toEqual({ en: 'CNCF' })
    expect(cert.credential_url).toBe('https://example.com/cka')
    expect(cert.expires).toEqual({ year: 2025, month: 3 })
    const project = store.projects[0]
    expect(project.description).toEqual({ en: 'Payment platform' })
    expect(project.long_description).toEqual({ en: 'Modernised the stack' })
    expect(project.external_url).toBe('https://example.com')
  })

  it('maps received recommendations with the LinkedIn source marker', () => {
    const rec = store.recommendations[0]
    expect(rec.recommender_name).toBe('Jane Boss')
    expect(rec.recommender_title).toBe('CTO')
    expect(rec.text).toEqual({ en: 'Outstanding consultant' })
    expect(rec.source).toBe('LinkedIn')
  })

  it('is total: an export with only a profile still imports', () => {
    const minimal = importFromLinkedIn({ 'Profile.csv': FILES['Profile.csv'] })
    expect(minimal.resume?.full_name).toBe('Svein Sørensen')
    expect(minimal.work_experiences).toEqual([])
    expect(minimal.views).toEqual([])
  })

  it('finds files case-insensitively under folder prefixes', () => {
    const nested = importFromLinkedIn({
      'Basic_LinkedInDataExport_01-01-2026/profile.csv': FILES['Profile.csv'],
    })
    expect(nested.resume?.full_name).toBe('Svein Sørensen')
  })
})
