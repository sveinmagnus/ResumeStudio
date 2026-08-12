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
    // A file that ends mid-row still yields that row — LinkedIn's exports do
    // not always end with a newline, and dropping the last row loses a job.
    ['a,b\nc,d', [['a', 'b'], ['c', 'd']]],
    ['a,b\n', [['a', 'b']]],
    // A trailing empty field is a field, not an absence.
    ['a,b,', [['a', 'b', '']]],
    // A row of empty fields is still a row at this level; csvObjects drops it.
    [',,', [['', '', '']]],
    // A quoted field containing a comma AND a quote, mid-row.
    ['x,"a,""b""",y', [['x', 'a,"b"', 'y']]],
  ])('parses %j', (input, expected) => {
    expect(parseCsv(input)).toEqual(expected)
  })

  it('returns nothing at all for empty input', () => {
    // Not [['']] — an empty file has no rows, and a phantom row becomes a
    // phantom header that swallows the real one.
    expect(parseCsv('')).toEqual([])
  })

  it('accumulates characters in order, inside quotes and out', () => {
    // The two field accumulations are separate statements; either can be lost
    // while the other keeps the parser looking healthy on short inputs.
    expect(parseCsv('abc,"d,ef"')).toEqual([['abc', 'd,ef']])
    expect(parseCsv('"multi word",plain text')).toEqual([['multi word', 'plain text']])
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

  it('skips blank lines wherever they occur', () => {
    // LinkedIn's exports carry blank separator lines. Kept, each becomes an
    // object of empty strings — and a blank line before the header makes the
    // header itself the first data row.
    expect(csvObjects('A,B\n\n1,2\n\n3,4\n')).toEqual([
      { A: '1', B: '2' }, { A: '3', B: '4' },
    ])
    expect(csvObjects('\nA,B\n1,2\n')).toEqual([{ A: '1', B: '2' }])
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
    expect(rec.recommender_title).toEqual({ en: 'CTO' })
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

/** LinkedIn writes "Mar 2020" or a bare year; 12 mutants, none of them edges. */
describe('parseLinkedInDate — the month table and the edges', () => {
  it('reads a month name and a year', () => {
    expect(parseLinkedInDate('Mar 2020')).toEqual({ year: 2020, month: 3 })
    expect(parseLinkedInDate('December 2021')).toEqual({ year: 2021, month: 12 })
    expect(parseLinkedInDate('jan 1999')).toEqual({ year: 1999, month: 1 })
  })

  it('reads every month abbreviation', () => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    months.forEach((m, i) => {
      expect(parseLinkedInDate(`${m} 2020`), m).toEqual({ year: 2020, month: i + 1 })
    })
  })

  it('reads a bare year', () => {
    expect(parseLinkedInDate('2020')).toEqual({ year: 2020, month: null })
  })

  it('keeps the year when the month word is not one', () => {
    // Losing the whole date over an unreadable month is worse than losing the
    // month; LinkedIn exports carry localised month names.
    expect(parseLinkedInDate('Mai 2020')).toEqual({ year: 2020, month: null })
  })

  it('is null for empty, missing and unparseable input', () => {
    expect(parseLinkedInDate('')).toBeNull()
    expect(parseLinkedInDate(undefined)).toBeNull()
    expect(parseLinkedInDate('Present')).toBeNull()
    expect(parseLinkedInDate('99')).toBeNull()
  })

  it('tolerates extra whitespace', () => {
    expect(parseLinkedInDate('  Mar   2020 ')).toEqual({ year: 2020, month: 3 })
  })
})

/**
 * The LinkedIn zip's per-file mapping.
 *
 * A LinkedIn export is a folder of CSVs whose columns are named for LinkedIn's
 * own UI, not ours, and several sections are skipped or joined conditionally.
 * A wrong condition here imports a row that should have been dropped, or drops
 * one that mattered — neither of which fails, both of which the consultant only
 * finds by reading the imported CV.
 */
describe('importFromLinkedIn — the file mappings', () => {
  /** A zip-like map of filename → CSV text. */
  const zip = (files: Record<string, string>) => importFromLinkedIn(files)
  const csv = (header: string, ...rows: string[]) => [header, ...rows].join('\n')

  it('skips blank CSV lines rather than importing empty rows', () => {
    const store = zip({
      'Positions.csv': csv('Company Name,Title', 'Acme,Architect', '   ,   ', ',', 'Beta,Dev'),
    })
    expect(store.work_experiences.map((w) => w.employer.en)).toEqual(['Acme', 'Beta'])
  })

  it('joins the profile name from its two parts, skipping an absent half', () => {
    expect(zip({ 'Profile.csv': csv('First Name,Last Name', 'Kari,Nordmann') }).resume!.full_name)
      .toBe('Kari Nordmann')
    expect(zip({ 'Profile.csv': csv('First Name,Last Name', 'Kari,') }).resume!.full_name)
      .toBe('Kari')
  })

  it('prefers the email marked PRIMARY over the first one listed', () => {
    // LinkedIn lists every address ever added; taking the first would put a
    // long-dead university address on the CV.
    const store = zip({
      'Email Addresses.csv': csv(
        'Email Address,Primary',
        'old@uni.test,No',
        'kari@work.test,Yes',
      ),
    })
    expect(store.resume!.email).toBe('kari@work.test')
  })

  it('reads the primary flag case-insensitively', () => {
    expect(zip({
      'Email Addresses.csv': csv('Email Address,Primary', 'old@uni.test,No', 'kari@work.test,YES'),
    }).resume!.email).toBe('kari@work.test')
  })

  it('falls back to the first email when none is marked primary', () => {
    expect(zip({
      'Email Addresses.csv': csv('Email Address,Primary', 'kari@work.test,No'),
    }).resume!.email).toBe('kari@work.test')
  })

  it('turns the profile Summary into a profile, and adds none without one', () => {
    expect(zip({ 'Profile.csv': csv('Summary', 'I build systems.') })
      .key_qualifications[0].summary.en).toBe('I build systems.')
    expect(zip({ 'Profile.csv': csv('Summary', '') }).key_qualifications).toEqual([])
  })

  it('trims every value it reads, and drops one that is only whitespace', () => {
    const store = zip({ 'Positions.csv': csv('Company Name,Title', '"  Acme  ","   "') })
    expect(store.work_experiences[0].employer).toEqual({ en: 'Acme' })
    expect(store.work_experiences[0].role_title).toEqual({})
  })

  it('skips a position with neither a company nor a title', () => {
    const store = zip({
      'Positions.csv': csv('Company Name,Title,Description', 'Acme,,x', ',,orphan', ',Dev,y'),
    })
    expect(store.work_experiences).toHaveLength(2)
  })

  it('takes an education description from Notes, falling back to Activities', () => {
    const notes = zip({ 'Education.csv': csv('School Name,Notes,Activities', 'NTNU,From notes,From activities') })
    expect(notes.educations[0].description.en).toBe('From notes')
    const activities = zip({ 'Education.csv': csv('School Name,Notes,Activities', 'NTNU,,From activities') })
    expect(activities.educations[0].description.en).toBe('From activities')
  })

  it('skips a project with neither a title nor a description', () => {
    const store = zip({
      'Projects.csv': csv('Title,Description', 'Payments,x', ',', ',Only a description'),
    })
    expect(store.projects).toHaveLength(2)
  })

  it('joins a recommender’s name and keeps the company as a plain string', () => {
    const store = zip({
      'Recommendations_Received.csv': csv(
        'First Name,Last Name,Job Title,Company,Text',
        'Jane,Boss,CTO,BigCo,Excellent.',
      ),
    })
    expect(store.recommendations[0]).toMatchObject({
      recommender_name: 'Jane Boss', recommender_company: 'BigCo',
    })
  })

  it('nulls an absent recommender company rather than leaving an empty string', () => {
    const store = zip({
      'Recommendations_Received.csv': csv('First Name,Last Name,Company,Text', 'Jane,Boss,,Excellent.'),
    })
    expect(store.recommendations[0].recommender_company).toBeNull()
  })

  it('skips a recommendation with no text — there is nothing to quote', () => {
    const store = zip({
      'Recommendations_Received.csv': csv('First Name,Last Name,Text', 'Jane,Boss,'),
    })
    expect(store.recommendations).toEqual([])
  })

  it('imports an item as enabled and unstarred, not disabled', () => {
    // A row arriving disabled would be invisible in every export, so the
    // consultant would never see what they imported.
    const store = zip({ 'Positions.csv': csv('Company Name,Title', 'Acme,Architect') })
    expect(store.work_experiences[0]).toMatchObject({ disabled: false, starred: false })
  })
})

describe('parseLinkedInDate — the year bound', () => {
  it('accepts a year ABOVE 1000 and rejects 1000 itself', () => {
    // The bound is strict here (> 1000), unlike Europass's >= 1000. Neither
    // matters for real CVs; what matters is that three digits — a page number
    // or a truncated field — is not read as a date.
    expect(parseLinkedInDate('1001')).toEqual({ year: 1001, month: null })
    expect(parseLinkedInDate('1000')).toBeNull()
    expect(parseLinkedInDate('999')).toBeNull()
    expect(parseLinkedInDate('Jan 1001')).toEqual({ year: 1001, month: 1 })
    expect(parseLinkedInDate('Jan 1000')).toBeNull()
  })

  it('rejects a fractional year', () => {
    expect(parseLinkedInDate('2020.5')).toBeNull()
  })

  it('needs exactly two parts for the month form', () => {
    // "Mar 12 2020" is not a LinkedIn date; taking the first two words would
    // read the day as a year.
    expect(parseLinkedInDate('Mar 12 2020')).toBeNull()
  })
})

describe('importFromLinkedIn — imported defaults and absent columns', () => {
  const zip = (files: Record<string, string>) => importFromLinkedIn(files)
  const csv = (header: string, ...rows: string[]) => [header, ...rows].join('\n')

  it('survives an Email Addresses file with no Primary column at all', () => {
    // Older exports omit it; reading .toLowerCase() off undefined would throw
    // and take the whole import down.
    expect(() => zip({ 'Email Addresses.csv': csv('Email Address', 'kari@work.test') })).not.toThrow()
    expect(zip({ 'Email Addresses.csv': csv('Email Address', 'kari@work.test') }).resume!.email)
      .toBe('kari@work.test')
  })

  it('imports an education as neither graded nor an exchange term', () => {
    // LinkedIn carries neither field; guessing either would state something the
    // source never said.
    const e = zip({ 'Education.csv': csv('School Name', 'NTNU') }).educations[0]
    expect(e).toMatchObject({ grade: null, exchange: false })
  })

  it('imports a skill as not highlighted', () => {
    // Highlighting drives the Skills Showcase; importing everything highlighted
    // would fill it with the whole registry.
    const s = zip({ 'Skills.csv': csv('Name', 'Go') }).skills[0]
    expect(s.is_highlighted).toBe(false)
  })

  it('imports a language as enabled', () => {
    const l = zip({ 'Languages.csv': csv('Name,Proficiency', 'Norwegian,Native') }).spoken_languages[0]
    expect(l.disabled).toBe(false)
  })

  it('imports a project with anonymization OFF', () => {
    // use_anonymized:true would export the alias — and the alias is empty on an
    // imported project, so the customer would vanish from the CV.
    const p = zip({ 'Projects.csv': csv('Title,Description', 'Payments,Did it') }).projects[0]
    expect(p).toMatchObject({ use_anonymized: false, customer: {}, customer_anonymized: {} })
  })

  it('joins a recommender name without a leading or trailing space', () => {
    const only = (row: string) => zip({
      'Recommendations_Received.csv': csv('First Name,Last Name,Text', row),
    }).recommendations[0].recommender_name
    expect(only('Jane,Boss,Excellent.')).toBe('Jane Boss')
    expect(only(',Boss,Excellent.')).toBe('Boss')
    expect(only('Jane,,Excellent.')).toBe('Jane')
  })

  it('trims an unquoted padded value', () => {
    const store = zip({ 'Positions.csv': csv('Company Name,Title', '  Acme  ,  Architect  ') })
    expect(store.work_experiences[0].employer).toEqual({ en: 'Acme' })
    expect(store.work_experiences[0].role_title).toEqual({ en: 'Architect' })
  })
})
